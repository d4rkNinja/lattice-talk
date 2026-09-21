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
  /** Test seam: drive the pump without spawning a real process. */
  driver?: HarnessDriver;
  /** Test seam: stop the bridge without relying on process signals. */
  signal?: AbortSignal;
  /** Extra env merged into the spawned process + bus config (tests set memory store). */
  extraEnv?: Record<string, string>;
  /** Test seam: share an existing store instance instead of creating one. */
  store?: Store;
}

const SWEEP_MS = 15_000;
const DISCOVERY_TIMEOUT_MS = 120_000;
const PAGE = 100;

export function createDriver(harness: string): HarnessDriver {
  if (harness === "codex") return new CodexDriver();
  const spec = ACP_SPECS[harness];
  if (spec) return new AcpDriver(harness, spec);
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
 * programmatic interface. Resolves when the bridge is shut down or the agent
 * process dies.
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

  await ensureWorkspaceSession(deps, sessionId);
  await ensureRoom(deps, sessionId, roomId, "lattice-bridge");
  const preAgents = new Set(await store.listAgentIds(sessionId));

  const driver = opts.driver ?? createDriver(opts.harness);
  const stop = new AbortController();
  opts.signal?.addEventListener("abort", () => stop.abort(), { once: true });
  let stopped = false;
  let bridgedAgentId: string | undefined = opts.agentId;
  let dmUnsub: (() => Promise<void>) | undefined;

  // Bridge cursors — separate from any agent's read cursors so pushing never
  // disturbs what the agent still has to pull itself. Every stream starts
  // undefined: first sight parks at the tail so only new traffic is injected.
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

  const sendToAgent = (msg: LatticeMessage) =>
    driver.send(formatInjected(msg, roomId)).catch((e) =>
      log(`[bridge] inject failed: ${e instanceof Error ? e.message : e}`),
    );

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
      cursors.set(streamKey, entry.id);
      const msg = parseStreamMessage(entry);
      // Never echo the bridged agent's own output back at it.
      if (bridgedAgentId && msg.from === bridgedAgentId) continue;
      // DMs addressed to someone else aren't ours to inject.
      if (dmPeer && msg.to && msg.to !== bridgedAgentId) continue;
      await sendToAgent(msg);
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
      await drainStream(roomStream);
      await drainDms();
    } catch (e) {
      log(`[bridge] sweep failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  await driver.start({
    cwd: opts.cwd,
    env,
    mcpServers: [latticeMcpSpec(env)],
    initialPrompt: bridgeJoinPrompt({
      workspace: sessionId,
      roomId,
      harness: opts.harness,
      suggestedAgentId: opts.agentId,
      tokenProtected: Boolean(opts.conn.joinToken),
    }),
    onEvent: log,
    onExit: (code) => {
      log(`[bridge] agent process exited (code ${code ?? "?"}) — shutting down.`);
      stop.abort();
    },
  });
  log(`[bridge] ${opts.harness} session up — injecting room "${roomId}" traffic into it.`);

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
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await unsub().catch(() => {});
    await dmUnsub?.().catch(() => {});
    await driver.close().catch(() => {});
    await store.close().catch(() => {});
  }
}
