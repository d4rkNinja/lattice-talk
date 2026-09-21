import type { LatticeConfig } from "./config.js";
import { hasRedisTarget } from "./config.js";
import { MemoryStore } from "./memory-store.js";
import { RedisStore } from "./redis.js";
import type { AgentRecord, RoomMeta, SessionMeta, StreamEntry } from "./types.js";

export interface Store {
  readonly kind: "redis" | "memory";

  getSessionMeta(sessionId: string): Promise<SessionMeta | null>;
  /** Atomic create-or-lose: writes the full meta (including join policy) only if absent. */
  initSessionMeta(sessionId: string, meta: SessionMeta): Promise<boolean>;
  putAgent(sessionId: string, agent: AgentRecord): Promise<void>;
  getAgent(sessionId: string, agentId: string): Promise<AgentRecord | null>;
  getAgents(sessionId: string, agentIds: string[]): Promise<AgentRecord[]>;
  listAgentIds(sessionId: string): Promise<string[]>;
  listAgents(sessionId: string): Promise<AgentRecord[]>;
  countAgents(sessionId: string): Promise<number>;
  removeAgent(sessionId: string, agentId: string): Promise<void>;

  /**
   * Drop everything tied to one agent's presence in the session beyond the
   * agent record and room memberships: read cursors and DM partner lists.
   * Keeps a reused agent_id from inheriting a previous occupant's state.
   */
  clearAgentState(sessionId: string, agentId: string): Promise<void>;

  touchPresence(sessionId: string, agentId: string, ttlSeconds: number): Promise<void>;
  clearPresence(sessionId: string, agentId: string): Promise<void>;
  presenceStatus(sessionId: string, agentIds: string[]): Promise<Record<string, boolean>>;

  /** Session ids ever created in this namespace (index kept by initSessionMeta). */
  listSessions(): Promise<string[]>;

  addRoom(sessionId: string, roomId: string, meta: RoomMeta): Promise<boolean>;
  listRooms(sessionId: string): Promise<string[]>;
  /**
   * Drop a room entirely: registry entry, meta, members, stream, and every
   * agent cursor pointing at it. Not part of the MCP tool surface — the TUI
   * uses it for room management.
   */
  deleteRoom(sessionId: string, roomId: string): Promise<void>;
  getRoomMeta(sessionId: string, roomId: string): Promise<RoomMeta | null>;
  addRoomMember(sessionId: string, roomId: string, agentId: string): Promise<void>;
  removeRoomMember(sessionId: string, roomId: string, agentId: string): Promise<void>;
  listRoomMembers(sessionId: string, roomId: string): Promise<string[]>;
  isRoomMember(sessionId: string, roomId: string, agentId: string): Promise<boolean>;
  removeAgentFromAllRooms(sessionId: string, agentId: string): Promise<void>;

  addStreamMessage(
    streamKey: string,
    fields: Record<string, string>,
    maxLen: number,
  ): Promise<string>;
  readStreamAfter(streamKey: string, afterId: string, limit: number): Promise<StreamEntry[]>;

  addDmPartner(sessionId: string, agentId: string, otherId: string): Promise<void>;
  listDmPartners(sessionId: string, agentId: string): Promise<string[]>;

  getCursor(sessionId: string, agentId: string, rid: string): Promise<string | null>;
  setCursor(sessionId: string, agentId: string, rid: string, cursor: string): Promise<void>;

  memorySet(
    sessionId: string,
    key: string,
    value: string,
    meta?: Record<string, string>,
  ): Promise<void>;
  memoryGet(sessionId: string, key: string): Promise<string | null>;
  memoryGetMeta(sessionId: string, key: string): Promise<Record<string, string>>;
  memoryKeys(sessionId: string): Promise<string[]>;
  memoryGetMany(sessionId: string, fieldKeys: string[]): Promise<Record<string, string>>;
  memoryList(sessionId: string): Promise<Record<string, string>>;
  appendNote(sessionId: string, fields: Record<string, string>): Promise<string>;
  readNotes(sessionId: string, afterId: string, limit: number): Promise<StreamEntry[]>;

  /**
   * Publish a wake-up payload on a notify channel. Fire-and-forget: payloads
   * are hints, streams are the source of truth.
   */
  publish(channel: string, payload: string): Promise<void>;
  /**
   * Subscribe to notify channels; resolves with an unsubscribe function.
   * Used for long-poll wake-ups (pull_messages wait_ms) and the TUI live feed.
   */
  subscribe(
    channels: string[],
    onMessage: (channel: string, payload: string) => void,
  ): Promise<() => Promise<void>>;

  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export async function createStore(
  config: LatticeConfig,
  options?: { clock?: () => number },
): Promise<Store> {
  if (config.store === "memory") {
    return new MemoryStore(config.namespace, options?.clock);
  }
  if (!hasRedisTarget(config)) {
    throw new Error(
      "LATTICE_STORE=redis requires LATTICE_REDIS_URL or REDIS_HOST. Use LATTICE_STORE=memory for single-process smoke tests.",
    );
  }
  return RedisStore.connect(config);
}
