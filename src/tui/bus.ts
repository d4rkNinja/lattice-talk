import { loadConfig, type LatticeConfig } from "../core/config.js";
import { RuntimeContext } from "../core/context.js";
import { keys } from "../core/keys.js";
import { parseStreamMessage } from "../core/messages.js";
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

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "??:??:??";
  return d.toTimeString().slice(0, 8);
}
