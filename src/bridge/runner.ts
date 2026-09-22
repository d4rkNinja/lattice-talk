import { loadConfig, type LatticeConfig } from "../core/config.js";
import { RuntimeContext } from "../core/context.js";
import { dmPair, keys } from "../core/keys.js";
import { parseStreamMessage } from "../core/messages.js";
import { ensureRoom } from "../core/rooms.js";
import { ensureWorkspaceSession } from "../core/session.js";
import { createStore, type Store } from "../core/store.js";
import type { BusDeps, LatticeMessage } from "../core/types.js";
import {
  connectionToHarnessEnv,
  type ResolvedConnection,
} from "../cli/config-file.js";
import { mcpEntry } from "../cli/harnesses.js";
import { AcpDriver, ACP_SPECS } from "./acp.js";
import { CodexDriver } from "./codex.js";
import {
  isBridgeHarness,
  type AcpMcpServer,
  type HarnessDriver,
} from "./driver.js";
import { bridgeJoinPrompt } from "./prompt.js";

export interface BridgeOptions {
  harness: string;
  conn: ResolvedConnection;
  roomId: string;
  /** Pin the identity the spawned agent will claim (skips discovery polling). */
  agentId?: string;
  cwd: string;
  log?: (line: string) => void;
  /**
   * Supervisor mode (`bridge --keep` / `lattice-talk watch`): the bridge
   * stays subscribed after the agent process exits, and respawns it —
   * resuming its harness session when the driver supports it — the moment
   * new room/DM traffic arrives. Queued mail is replayed from parked stream
   * cursors, so nothing is lost while the agent is down.
   */
  persistent?: boolean;
  /** Test seam: drive the pump without spawning a real process. */
  driver?: HarnessDriver;
  /** Test seam: fresh driver per (re)spawn — persistent mode restarts. */
  driverFactory?: () => HarnessDriver;
  /** Test seam: stop the bridge without relying on process signals. */
  signal?: AbortSignal;
  /** Extra env merged into the spawned process + bus config (tests set memory store). */
  extraEnv?: Record<string, string>;
  /** Test seam: share an existing store instance instead of creating one. */
  store?: Store;
}

const SWEEP_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 120_000;
const RESPAWN_MIN_MS = 2_000;
const RESPAWN_MAX_MS = 60_000;
const PAGE = 100;

export function createDriver(harness: string): HarnessDriver {
  const win = process.platform === "win32";
  if (harness === "codex") return new CodexDriver("codex", ["app-server"], win);
  const spec = ACP_SPECS[harness];
  if (spec) return new AcpDriver(harness, spec, win);
  throw new Error(`No bridge driver for "${harness}"`);
}

/** The lattice MCP server registered into ACP sessions so spawned agents can talk back. */
function latticeMcpSpec(env: Record<string, string>): AcpMcpServer {
  const entry = mcpEntry(env);
  return {
    name: "lattice",
    command: entry.command,
    args: entry.args,
    env: Object.entries(entry.env).map(([name, value]) => ({ name, value })),
  };
}

function formatInjected(msg: LatticeMessage, roomId: string): string {
  const via = msg.to ? `dm · ${msg.from}` : `room "${roomId}" · ${msg.from}`;
  return `[lattice · ${via}] ${msg.body}`;
}

/**
 * Long-running bus→session pump: subscribes to Lattice notify channels and
 * injects every new bus message into the spawned agent's session through its
 * programmatic interface. With `persistent` it becomes a supervisor — an
 * exited agent is respawned (with harness-session resume) the next time mail
 * arrives for it. Resolves when the bridge is shut down, or — non-persistent —
 * when the agent process dies.
 */
export async function runBridge(opts: BridgeOptions): Promise<void> {
  if (!isBridgeHarness(opts.harness)) {
    throw new Error(
      opts.harness === "windsurf"
        ? "Windsurf has no supported programmatic session API — its Cascade interface is IDE-internal. Use `lattice-talk mcp add windsurf` instead; agents still get push wake-ups via pull_messages wait_ms."
        : `Unknown harness "${opts.harness}". Bridgeable: claude, codex, gemini, cursor.`,
    );
  }
  if (!opts.conn.workspace) {
    throw new Error(
      "No workspace configured. Run `lattice-talk setup` or pass --workspace.",
    );
  }

  const env = connectionToHarnessEnv(opts.conn);
  env.LATTICE_DEFAULT_SESSION_ID = opts.conn.workspace;
  Object.assign(env, opts.extraEnv);
  const config: LatticeConfig = loadConfig(env);
  const store: Store = opts.store ?? (await createStore(config));
  const deps: BusDeps = { store, config, ctx: new RuntimeContext() };
  const sessionId = opts.conn.workspace;
  const roomId = opts.roomId;
  const ns = config.namespace;
  const log = opts.log ?? (() => {});
  const persistent = opts.persistent === true;

  await ensureWorkspaceSession(deps, sessionId);
  await ensureRoom(deps, sessionId, roomId, "lattice-bridge");
  const preAgents = new Set(await store.listAgentIds(sessionId));

  const stop = new AbortController();
  opts.signal?.addEventListener("abort", () => stop.abort(), { once: true });
  let stopped = false;
  let bridgedAgentId: string | undefined = opts.agentId;
  let dmUnsub: (() => Promise<void>) | undefined;

  // Bridge cursors — separate from any agent's read cursors so pushing never
  // disturbs what the agent still has to pull itself. Every stream starts
  // undefined: first sight parks at the tail so only new traffic is injected.
  // A cursor only advances after the message was actually injected — while
  // the agent is down they stay parked, and the backlog replays on respawn.
  const cursors = new Map<string, string>();
  const roomStream = keys.roomStream(ns, sessionId, roomId);
  await seedTail(roomStream);

  async function seedTail(streamKey: string): Promise<void> {
    let cursor = "0-0";
    let page = await store.readStreamAfter(streamKey, cursor, PAGE);
    while (page.length > 0) {
      cursor = page[page.length - 1]!.id;
      page = await store.readStreamAfter(streamKey, cursor, PAGE);
    }
    cursors.set(streamKey, cursor);
  }

  // ---------------------------------------------------------------------------
  // Driver lifecycle: a dead agent is just parked mail until mail arrives.
  // ---------------------------------------------------------------------------

  let driver: HarnessDriver | undefined;
  let sessionRef: string | undefined;
  let spawning: Promise<void> | undefined;
  let wakePending = false;
  let spawnFailures = 0;
  let lastSpawnFail = 0;
  let wakeTimer: NodeJS.Timeout | undefined;
  let firstSpawn = true;

  const onDriverExit = (d: HarnessDriver, code: number | null) => {
    if (driver !== d) return; // stale exit from a replaced driver
    driver = undefined;
    void d.close().catch(() => {}); // release the dead process handle now
    if (!persistent) {
      log(`[bridge] agent process exited (code ${code ?? "?"}) — shutting down.`);
      stop.abort();
      return;
    }
    log(
      `[bridge] agent process exited (code ${code ?? "?"}) — staying subscribed; ` +
        "it will be respawned when new messages arrive.",
    );
    // The harness process is verifiably dead — freeing its presence lets a
    // respawned session reclaim the same agent_id immediately instead of
    // waiting out the TTL.
    if (bridgedAgentId) {
      void store
        .clearPresence(sessionId, bridgedAgentId)
        .catch(() => {});
    }
    if (code !== 0) {
      // Crashed mid-work: treat as mail pending so it comes back promptly.
      wakePending = true;
    }
    // Pending mail (or a crash) respawns now — a clean exit with nothing
    // queued just keeps the subscription idle.
    void maybeRespawn();
  };

  async function spawn(resume: boolean): Promise<void> {
    const d =
      firstSpawn && opts.driver
        ? opts.driver
        : (opts.driverFactory?.() ?? createDriver(opts.harness));
    firstSpawn = false;
    await d.start({
      cwd: opts.cwd,
      env,
      mcpServers: [latticeMcpSpec(env)],
      initialPrompt: bridgeJoinPrompt({
        workspace: sessionId,
        roomId,
        harness: opts.harness,
        suggestedAgentId: bridgedAgentId ?? opts.agentId,
        tokenProtected: Boolean(opts.conn.joinToken),
      }),
      resumeRef: resume ? sessionRef : undefined,
      onEvent: log,
      onExit: (code) => onDriverExit(d, code),
    });
    driver = d;
    spawnFailures = 0;
    sessionRef = d.sessionRef ?? sessionRef;
    log(
      `[bridge] ${opts.harness} session ${resume ? "respawned" : "up"} — injecting room "${roomId}" traffic into it.`,
    );
  }

  function maybeRespawn(): void {
    if (!persistent || stopped || driver || spawning || !wakePending) return;
    if (spawnFailures > 0) {
      const wait = Math.min(RESPAWN_MAX_MS, RESPAWN_MIN_MS * 2 ** (spawnFailures - 1));
      const elapsed = Date.now() - lastSpawnFail;
      if (elapsed < wait) {
        wakeTimer ??= setTimeout(() => {
          wakeTimer = undefined;
          maybeRespawn();
        }, wait - elapsed);
        wakeTimer.unref?.();
        return;
      }
    }
    wakePending = false;
    spawning = (async () => {
      try {
        await spawn(true);
        await sweep();
      } catch (e) {
        spawnFailures += 1;
        lastSpawnFail = Date.now();
        wakePending = true;
        log(`[bridge] respawn failed: ${e instanceof Error ? e.message : e}`);
        maybeRespawn(); // schedules the backoff retry
      } finally {
        spawning = undefined;
      }
    })();
  }

  /**
   * Inject one message; returns false when it couldn't be delivered (agent
   * down) so callers leave the cursor parked for replay on respawn.
   */
  const sendToAgent = async (msg: LatticeMessage): Promise<boolean> => {
    if (!driver) {
      wakePending = true;
      void maybeRespawn();
      return false;
    }
    try {
      await driver.send(formatInjected(msg, roomId));
      return true;
    } catch (e) {
      log(`[bridge] inject failed: ${e instanceof Error ? e.message : e}`);
      wakePending = true;
      void maybeRespawn();
      return false;
    }
  };

  async function drainStream(streamKey: string, dmPeer?: string): Promise<void> {
    let cursor = cursors.get(streamKey);
    if (cursor === undefined) {
      // Only DM pair streams reach here unseeded. Start them at the beginning —
      // seeding at the tail would lose the message that triggered this drain.
      // The agent's own messages are filtered below, so it never re-reads itself.
      cursor = "0-0";
    }
    const entries = await store.readStreamAfter(streamKey, cursor, PAGE);
    for (const entry of entries) {
      const msg = parseStreamMessage(entry);
      // Never echo the bridged agent's own output back at it.
      if (bridgedAgentId && msg.from === bridgedAgentId) {
        cursors.set(streamKey, entry.id);
        continue;
      }
      // DMs addressed to someone else aren't ours to inject.
      if (dmPeer && msg.to && msg.to !== bridgedAgentId) {
        cursors.set(streamKey, entry.id);
        continue;
      }
      if (!(await sendToAgent(msg))) return; // cursor stays parked — replay later
      cursors.set(streamKey, entry.id);
    }
  }

  async function discoverAgent(): Promise<void> {
    if (bridgedAgentId || stopped) return;
    const agents = await store.listAgents(sessionId);
    const candidates = agents.filter((a) => !preAgents.has(a.agent_id));
    // The join prompt tells the agent to report its harness — prefer that
    // match so an unrelated agent joining in the window isn't misidentified.
    const fresh =
      candidates.find((a) => a.harness === opts.harness)?.agent_id ??
      candidates[0]?.agent_id;
    if (!fresh) return;
    bridgedAgentId = fresh;
    log(`[bridge] bridged agent joined: ${fresh}`);
    // Now that we know the identity, also push its DMs.
    dmUnsub = await store.subscribe(
      [keys.notifyDm(ns, sessionId, fresh)],
      () => void drainDms().catch(() => {}),
    );
  }

  /**
   * Advertise on the agent record that a supervisor can respawn it — senders
   * see wake:"bridge" in tell_agent results / list_peers instead of a silent
   * queue. Re-patched after every respawned rejoin (join_session rewrites
   * the record), cleared when the bridge shuts down for real.
   */
  async function markWakeable(): Promise<void> {
    if (!persistent || !bridgedAgentId) return;
    const agent = await store.getAgent(sessionId, bridgedAgentId);
    if (agent && agent.wake !== "bridge") {
      await store.putAgent(sessionId, { ...agent, wake: "bridge" });
    }
  }

  async function clearWakeable(): Promise<void> {
    if (!bridgedAgentId) return;
    const agent = await store.getAgent(sessionId, bridgedAgentId).catch(() => null);
    if (agent?.wake === "bridge") {
      const { wake: _drop, ...rest } = agent;
      await store.putAgent(sessionId, rest).catch(() => {});
    }
  }

  async function drainDms(): Promise<void> {
    if (!bridgedAgentId) return;
    for (const peer of await store.listDmPartners(sessionId, bridgedAgentId)) {
      const pair = dmPair(bridgedAgentId, peer);
      await drainStream(keys.dmStream(ns, sessionId, pair), peer);
    }
  }

  async function sweep(): Promise<void> {
    if (stopped) return;
    try {
      await discoverAgent();
      await markWakeable();
      await drainStream(roomStream);
      await drainDms();
    } catch (e) {
      log(`[bridge] sweep failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  try {
    await spawn(false);
  } catch (e) {
    await store.close().catch(() => {});
    throw e;
  }

  // If the agent id is pinned, subscribe to its DM channel right away.
  if (bridgedAgentId) {
    const aid = bridgedAgentId;
    dmUnsub = await store.subscribe([keys.notifyDm(ns, sessionId, aid)], () =>
      void drainDms().catch(() => {}),
    );
  }

  const unsub = await store.subscribe(
    [keys.notifyRoom(ns, sessionId, roomId), keys.notifyMeta(ns, sessionId)],
    (channel) => {
      if (channel === keys.notifyMeta(ns, sessionId)) {
        void discoverAgent().catch(() => {});
        void markWakeable().catch(() => {});
      } else {
        void drainStream(roomStream).catch(() => {});
      }
    },
  );
  // Close the seed→subscribe gap: anything written between the tail-seed and
  // the subscription going live would otherwise wait for the next sweep.
  await sweep();

  const sweepTimer = setInterval(() => void sweep(), SWEEP_MS);
  const discoveryTimer = setTimeout(() => {
    if (!bridgedAgentId) {
      log(
        "[bridge] still waiting for the agent to join the workspace — check that it ran join_session.",
      );
    }
  }, DISCOVERY_TIMEOUT_MS);

  const onSignal = () => stop.abort();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await new Promise<void>((resolve) => {
      if (stop.signal.aborted) return resolve();
      stop.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  } finally {
    stopped = true;
    clearInterval(sweepTimer);
    clearTimeout(discoveryTimer);
    if (wakeTimer) clearTimeout(wakeTimer);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await unsub().catch(() => {});
    await dmUnsub?.().catch(() => {});
    await clearWakeable().catch(() => {});
    await driver?.close().catch(() => {});
    await store.close().catch(() => {});
  }
}
