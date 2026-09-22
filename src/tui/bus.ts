import { loadConfig, type LatticeConfig } from "../core/config.js";
import { RuntimeContext } from "../core/context.js";
import { dmPair, keys } from "../core/keys.js";
import { parseStreamMessage } from "../core/messages.js";
import { publishNotify } from "../core/notify.js";
import { createStore, type Store } from "../core/store.js";
import type { AgentRecord, BusDeps, LatticeMessage } from "../core/types.js";
import type { ResolvedConnection } from "../cli/config-file.js";

/** The TUI observes the bus; it never joins as an agent. */
export interface BusHandle {
  deps: BusDeps;
  store: Store;
  config: LatticeConfig;
  close(): Promise<void>;
}

export async function connectBus(conn: ResolvedConnection): Promise<BusHandle> {
  const env: NodeJS.ProcessEnv = {
    LATTICE_STORE: "redis",
    LATTICE_REDIS_URL: conn.redisUrl ?? "",
    LATTICE_NAMESPACE: conn.namespace,
  };
  if (conn.joinToken) env.LATTICE_JOIN_TOKEN = conn.joinToken;
  if (conn.workspace) env.LATTICE_DEFAULT_SESSION_ID = conn.workspace;
  if (conn.sshHost) env.LATTICE_SSH_HOST = conn.sshHost;
  if (conn.sshPort) env.LATTICE_SSH_PORT = conn.sshPort;
  if (conn.sshUser) env.LATTICE_SSH_USER = conn.sshUser;
  if (conn.sshKey) env.LATTICE_SSH_KEY = conn.sshKey;
  if (conn.sshLocalPort) env.LATTICE_SSH_LOCAL_PORT = conn.sshLocalPort;
  const config = loadConfig(env);
  const store = await createStore(config);
  return {
    store,
    config,
    deps: { store, config, ctx: new RuntimeContext() },
    close: () => store.close(),
  };
}

/** Cheap connectivity check used by the setup screen's Test button. */
export async function pingBus(conn: ResolvedConnection): Promise<void> {
  const bus = await connectBus(conn);
  try {
    if (!(await bus.store.ping())) throw new Error("Redis ping failed");
  } finally {
    await bus.close();
  }
}

export interface RoomInfo {
  id: string;
  displayName: string;
  members: number;
  createdBy: string;
}

export async function listRoomsInfo(bus: BusHandle, sessionId: string): Promise<RoomInfo[]> {
  const ids = await bus.store.listRooms(sessionId);
  const out: RoomInfo[] = [];
  for (const id of ids) {
    const meta = await bus.store.getRoomMeta(sessionId, id);
    const members = await bus.store.listRoomMembers(sessionId, id);
    out.push({
      id,
      displayName: meta?.display_name ?? id,
      members: members.length,
      createdBy: meta?.created_by ?? "",
    });
  }
  return out;
}

export interface PeerView extends AgentRecord {
  online: boolean;
}

export async function listPeersView(bus: BusHandle, sessionId: string): Promise<PeerView[]> {
  const agents = await bus.store.listAgents(sessionId);
  const status = await bus.store.presenceStatus(
    sessionId,
    agents.map((a) => a.agent_id),
  );
  return agents.map((a) => ({ ...a, online: Boolean(status[a.agent_id]) }));
}

/**
 * Kick an agent out of the session. The TUI observes rather than joins, so
 * it can't go through leave_session — this performs the same store-level
 * teardown the agent's own leave would (presence, room memberships, cursors,
 * record) and wakes listeners. Their past messages stay in the streams.
 */
export async function removePeer(
  bus: BusHandle,
  sessionId: string,
  agentId: string,
): Promise<void> {
  await bus.store.clearPresence(sessionId, agentId);
  await bus.store.removeAgentFromAllRooms(sessionId, agentId);
  await bus.store.clearAgentState(sessionId, agentId);
  await bus.store.removeAgent(sessionId, agentId);
  await publishNotify(bus.store, keys.notifyMeta(bus.config.namespace, sessionId), {
    type: "agents",
    agent_id: agentId,
  });
}

/**
 * Drop a whole workspace (session): every room, stream, agent record,
 * presence, cursor, and memory entry under it. Callers confirm first — this
 * is irreversible. Live clients refresh via the meta notification.
 */
export async function deleteWorkspace(
  bus: BusHandle,
  sessionId: string,
): Promise<void> {
  await bus.store.deleteSession(sessionId);
}

/** How many agents a workspace has and how many are online — confirm-modal stats. */
export async function workspaceStats(
  bus: BusHandle,
  sessionId: string,
): Promise<{ agents: number; online: number }> {
  const peers = await listPeersView(bus, sessionId);
  return { agents: peers.length, online: peers.filter((p) => p.online).length };
}

/** Read new room-stream entries after `afterId`; returns messages + new cursor. */
export async function pollRoomMessages(
  bus: BusHandle,
  sessionId: string,
  roomId: string,
  afterId: string,
  limit = 200,
): Promise<{ messages: LatticeMessage[]; lastId: string }> {
  const streamKey = keys.roomStream(bus.config.namespace, sessionId, roomId);
  const entries = await bus.store.readStreamAfter(streamKey, afterId, limit);
  const messages = entries.map(parseStreamMessage);
  const last = messages[messages.length - 1];
  return { messages, lastId: last ? last.id : afterId };
}

/**
 * Pseudo-channel id for the merged DM view. Contains `:` — an impossible room
 * id (assertId excludes it) — so it can never collide with a real channel.
 */
export const DM_FEED_ID = "dm:all";

/** Every DM pair in the session (deduped union of all agents' partner lists). */
export async function listDmPairs(bus: BusHandle, sessionId: string): Promise<string[]> {
  const agents = await bus.store.listAgentIds(sessionId);
  const pairs = new Set<string>();
  for (const a of agents) {
    for (const other of await bus.store.listDmPartners(sessionId, a)) {
      pairs.add(dmPair(a, other));
    }
  }
  return [...pairs];
}

/**
 * Read new DM entries across every pair stream in the session. `cursors`
 * (pair → last stream id) is mutated in place — the TUI's own read position;
 * agent cursors are untouched. Message ids are namespaced with the pair so
 * feed keys stay unique across streams.
 */
export async function pollDmMessages(
  bus: BusHandle,
  sessionId: string,
  cursors: Map<string, string>,
  limit = 200,
): Promise<LatticeMessage[]> {
  const pairs = await listDmPairs(bus, sessionId);
  const fresh: LatticeMessage[] = [];
  for (const pair of pairs) {
    const after = cursors.get(pair) ?? "0";
    const streamKey = keys.dmStream(bus.config.namespace, sessionId, pair);
    const entries = await bus.store.readStreamAfter(streamKey, after, limit);
    if (entries.length === 0) continue;
    for (const e of entries) {
      const m = parseStreamMessage(e);
      m.id = `${pair}:${e.id}`;
      fresh.push(m);
    }
    cursors.set(pair, entries[entries.length - 1]!.id);
  }
  fresh.sort((a, b) => a.ts.localeCompare(b.ts));
  return fresh;
}

/**
 * Live DM feed: fires `onWake` when any agent receives a DM or the roster
 * changes. Re-resolves subscriptions when the roster shifts so DMs to agents
 * that joined later are covered too.
 */
export async function subscribeDmFeed(
  bus: BusHandle,
  sessionId: string,
  onWake: () => void,
): Promise<() => Promise<void>> {
  const ns = bus.config.namespace;
  const metaChannel = keys.notifyMeta(ns, sessionId);
  let unsub: (() => Promise<void>) | undefined;
  let stopped = false;
  const resub = async () => {
    await unsub?.().catch(() => {});
    if (stopped) return;
    const agents = await bus.store.listAgentIds(sessionId);
    unsub = await bus.store.subscribe(
      [metaChannel, ...agents.map((a) => keys.notifyDm(ns, sessionId, a))],
      (channel) => {
        onWake();
        if (channel === metaChannel) void resub().catch(() => {});
      },
    );
  };
  await resub();
  return async () => {
    stopped = true;
    await unsub?.();
  };
}

/**
 * Live room feed: fires `onWake` when a message lands in this room or the
 * session's roster/room list changes. Streams stay the source of truth — the
 * caller re-reads on each wake.
 */
export function subscribeRoomFeed(
  bus: BusHandle,
  sessionId: string,
  roomId: string,
  onWake: () => void,
): Promise<() => Promise<void>> {
  const ns = bus.config.namespace;
  return bus.store.subscribe(
    [keys.notifyRoom(ns, sessionId, roomId), keys.notifyMeta(ns, sessionId)],
    () => onWake(),
  );
}

/** Session-level changes only (rooms created/deleted, agents join/leave). */
export function subscribeSessionMeta(
  bus: BusHandle,
  sessionId: string,
  onWake: () => void,
): Promise<() => Promise<void>> {
  return bus.store.subscribe([keys.notifyMeta(bus.config.namespace, sessionId)], () =>
    onWake(),
  );
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??:??:??";
  return d.toTimeString().slice(0, 8);
}
