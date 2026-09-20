import type { LatticeConfig } from "./config.js";
import { hasRedisTarget } from "./config.js";
import { MemoryStore } from "./memory-store.js";
import { RedisStore } from "./redis.js";
import type { AgentRecord, RoomMeta, SessionMeta, StreamEntry } from "./types.js";

export interface Store {
  readonly kind: "redis" | "memory";

  getSessionMeta(sessionId: string): Promise<SessionMeta | null>;
  initSessionMeta(sessionId: string, meta: SessionMeta): Promise<boolean>;
  putAgent(sessionId: string, agent: AgentRecord): Promise<void>;
  getAgent(sessionId: string, agentId: string): Promise<AgentRecord | null>;
  getAgents(sessionId: string, agentIds: string[]): Promise<AgentRecord[]>;
  listAgentIds(sessionId: string): Promise<string[]>;
  listAgents(sessionId: string): Promise<AgentRecord[]>;
  countAgents(sessionId: string): Promise<number>;
  removeAgent(sessionId: string, agentId: string): Promise<void>;

  getJoinTokenHash(sessionId: string): Promise<string | null>;
  /** Set-once (SETNX). Returns false when a hash is already stored. */
  initJoinTokenHash(sessionId: string, hash: string): Promise<boolean>;

  touchPresence(sessionId: string, agentId: string, ttlSeconds: number): Promise<void>;
  clearPresence(sessionId: string, agentId: string): Promise<void>;
  presenceStatus(sessionId: string, agentIds: string[]): Promise<Record<string, boolean>>;

  addRoom(sessionId: string, roomId: string, meta: RoomMeta): Promise<boolean>;
  listRooms(sessionId: string): Promise<string[]>;
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
