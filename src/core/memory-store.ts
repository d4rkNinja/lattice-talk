import { keys, sessionTag } from "./keys.js";
import { isAfterCursor } from "./stream.js";
import type { Store } from "./store.js";
import type { AgentRecord, RoomMeta, SessionMeta, StreamEntry } from "./types.js";

interface StringValue {
  value: string;
  expiresAt?: number;
}

/**
 * In-process store that mirrors the Redis key layout.
 * Presence TTL is enforced lazily via an injectable clock (tests can warp time).
 */
export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly strings = new Map<string, StringValue>();
  private readonly streams = new Map<string, StreamEntry[]>();
  private readonly streamSeq = new Map<string, number>();

  constructor(
    private readonly ns: string,
    private readonly clock: () => number = Date.now,
  ) {}

  private now(): number {
    return this.clock();
  }

  private hash(key: string): Map<string, string> {
    let h = this.hashes.get(key);
    if (!h) {
      h = new Map();
      this.hashes.set(key, h);
    }
    return h;
  }

  private set(key: string): Set<string> {
    let s = this.sets.get(key);
    if (!s) {
      s = new Set();
      this.sets.set(key, s);
    }
    return s;
  }

  private nextId(streamKey: string): string {
    const n = (this.streamSeq.get(streamKey) ?? 0) + 1;
    this.streamSeq.set(streamKey, n);
    return `${this.now()}-${n}`;
  }

  private readString(key: string): string | null {
    const entry = this.strings.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.strings.delete(key);
      return null;
    }
    return entry.value;
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    const h = this.hashes.get(keys.sessionMeta(this.ns, sessionId));
    if (!h || h.size === 0) return null;
    const session_id = h.get("session_id");
    const namespace = h.get("namespace");
    const created_at = h.get("created_at");
    const created_by = h.get("created_by");
    const join_policy = h.get("join_policy");
    if (!session_id || !namespace || !created_at || !created_by) return null;
    const meta: SessionMeta = {
      session_id,
      namespace,
      created_at,
      created_by,
      join_policy: join_policy === "token" ? "token" : "open",
    };
    const join_token_hash = h.get("join_token_hash");
    if (meta.join_policy === "token" && join_token_hash) {
      meta.join_token_hash = join_token_hash;
    }
    return meta;
  }

  async initSessionMeta(sessionId: string, meta: SessionMeta): Promise<boolean> {
    const key = keys.sessionMeta(this.ns, sessionId);
    const existing = this.hashes.get(key);
    if (existing && existing.size > 0) return false;
    this.set(keys.sessionsIndex(this.ns)).add(sessionId);
    const h = this.hash(key);
    h.set("session_id", meta.session_id);
    h.set("namespace", meta.namespace);
    h.set("created_at", meta.created_at);
    h.set("created_by", meta.created_by);
    h.set("join_policy", meta.join_policy);
    if (meta.join_policy === "token" && meta.join_token_hash) {
      h.set("join_token_hash", meta.join_token_hash);
    }
    return true;
  }

  async putAgent(sessionId: string, agent: AgentRecord): Promise<void> {
    this.hash(keys.sessionAgents(this.ns, sessionId)).set(
      agent.agent_id,
      JSON.stringify(agent),
    );
  }

  async getAgent(sessionId: string, agentId: string): Promise<AgentRecord | null> {
    const raw = this.hashes.get(keys.sessionAgents(this.ns, sessionId))?.get(agentId);
    if (!raw) return null;
    return JSON.parse(raw) as AgentRecord;
  }

  async getAgents(sessionId: string, agentIds: string[]): Promise<AgentRecord[]> {
    const out: AgentRecord[] = [];
    for (const id of agentIds) {
      const agent = await this.getAgent(sessionId, id);
      if (agent) out.push(agent);
    }
    return out;
  }

  async listAgentIds(sessionId: string): Promise<string[]> {
    const h = this.hashes.get(keys.sessionAgents(this.ns, sessionId));
    return h ? [...h.keys()].sort() : [];
  }

  async listAgents(sessionId: string): Promise<AgentRecord[]> {
    const ids = await this.listAgentIds(sessionId);
    const agents = await this.getAgents(sessionId, ids);
    return agents.sort((a, b) => a.agent_id.localeCompare(b.agent_id));
  }

  async countAgents(sessionId: string): Promise<number> {
    return this.hashes.get(keys.sessionAgents(this.ns, sessionId))?.size ?? 0;
  }

  async removeAgent(sessionId: string, agentId: string): Promise<void> {
    this.hashes.get(keys.sessionAgents(this.ns, sessionId))?.delete(agentId);
  }

  async clearAgentState(sessionId: string, agentId: string): Promise<void> {
    const cursorPrefix = `${keys.cursor(this.ns, sessionId, agentId, "")}`;
    for (const key of [...this.strings.keys()]) {
      if (key.startsWith(cursorPrefix)) {
        this.strings.delete(key);
      }
    }
    this.sets.delete(keys.dmPartners(this.ns, sessionId, agentId));
  }

  async touchPresence(sessionId: string, agentId: string, ttlSeconds: number): Promise<void> {
    this.strings.set(keys.presence(this.ns, sessionId, agentId), {
      value: "1",
      expiresAt: this.now() + ttlSeconds * 1000,
    });
  }

  async clearPresence(sessionId: string, agentId: string): Promise<void> {
    this.strings.delete(keys.presence(this.ns, sessionId, agentId));
  }

  async presenceStatus(
    sessionId: string,
    agentIds: string[],
  ): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    for (const id of agentIds) {
      out[id] = this.readString(keys.presence(this.ns, sessionId, id)) !== null;
    }
    return out;
  }

  async addRoom(sessionId: string, roomId: string, meta: RoomMeta): Promise<boolean> {
    const rooms = this.set(keys.sessionRooms(this.ns, sessionId));
    const created = !rooms.has(roomId);
    rooms.add(roomId);
    const h = this.hash(keys.roomMeta(this.ns, sessionId, roomId));
    if (created || h.size === 0) {
      h.set("room_id", meta.room_id);
      h.set("session_id", meta.session_id);
      h.set("display_name", meta.display_name);
      h.set("created_at", meta.created_at);
      h.set("created_by", meta.created_by);
    }
    return created;
  }

  async listSessions(): Promise<string[]> {
    return [...(this.sets.get(keys.sessionsIndex(this.ns)) ?? [])].sort();
  }

  async listRooms(sessionId: string): Promise<string[]> {
    return [...(this.sets.get(keys.sessionRooms(this.ns, sessionId)) ?? [])].sort();
  }

  async deleteRoom(sessionId: string, roomId: string): Promise<void> {
    this.sets.get(keys.sessionRooms(this.ns, sessionId))?.delete(roomId);
    this.hashes.delete(keys.roomMeta(this.ns, sessionId, roomId));
    this.sets.delete(keys.roomMembers(this.ns, sessionId, roomId));
    this.streams.delete(keys.roomStream(this.ns, sessionId, roomId));
    const cursorPrefix = `lattice:${this.ns}:cursor:${sessionTag(sessionId)}:`;
    for (const key of [...this.strings.keys()]) {
      // Cursor keys look like {prefix}{agent}:{rid} — match the rid exactly so
      // a room named "b" doesn't wipe DM cursors like "dm:a:b" or "inbox:b".
      if (!key.startsWith(cursorPrefix)) continue;
      const rid = key.slice(cursorPrefix.length).split(":").slice(1).join(":");
      if (rid === roomId) this.strings.delete(key);
    }
  }

  async getRoomMeta(sessionId: string, roomId: string): Promise<RoomMeta | null> {
    const h = this.hashes.get(keys.roomMeta(this.ns, sessionId, roomId));
    if (!h || h.size === 0) return null;
    const room_id = h.get("room_id");
    const session_id = h.get("session_id");
    const display_name = h.get("display_name");
    const created_at = h.get("created_at");
    const created_by = h.get("created_by");
    if (!room_id || !session_id || !display_name || !created_at || !created_by) return null;
    return { room_id, session_id, display_name, created_at, created_by };
  }

  async addRoomMember(sessionId: string, roomId: string, agentId: string): Promise<void> {
    this.set(keys.roomMembers(this.ns, sessionId, roomId)).add(agentId);
  }

  async removeRoomMember(sessionId: string, roomId: string, agentId: string): Promise<void> {
    this.sets.get(keys.roomMembers(this.ns, sessionId, roomId))?.delete(agentId);
  }

  async listRoomMembers(sessionId: string, roomId: string): Promise<string[]> {
    return [...(this.sets.get(keys.roomMembers(this.ns, sessionId, roomId)) ?? [])].sort();
  }

  async isRoomMember(sessionId: string, roomId: string, agentId: string): Promise<boolean> {
    return this.sets.get(keys.roomMembers(this.ns, sessionId, roomId))?.has(agentId) ?? false;
  }

  async removeAgentFromAllRooms(sessionId: string, agentId: string): Promise<void> {
    for (const roomId of await this.listRooms(sessionId)) {
      await this.removeRoomMember(sessionId, roomId, agentId);
    }
  }

  async addStreamMessage(
    streamKey: string,
    fields: Record<string, string>,
    maxLen: number,
  ): Promise<string> {
    const list = this.streams.get(streamKey) ?? [];
    const id = this.nextId(streamKey);
    list.push({ id, fields: { ...fields } });
    if (list.length > maxLen) {
      list.splice(0, list.length - maxLen);
    }
    this.streams.set(streamKey, list);
    return id;
  }

  async readStreamAfter(
    streamKey: string,
    afterId: string,
    limit: number,
  ): Promise<StreamEntry[]> {
    const list = this.streams.get(streamKey) ?? [];
    const out: StreamEntry[] = [];
    for (const entry of list) {
      if (!isAfterCursor(entry.id, afterId)) continue;
      out.push({ id: entry.id, fields: { ...entry.fields } });
      if (out.length >= limit) break;
    }
    return out;
  }

  async addDmPartner(sessionId: string, agentId: string, otherId: string): Promise<void> {
    this.set(keys.dmPartners(this.ns, sessionId, agentId)).add(otherId);
  }

  async listDmPartners(sessionId: string, agentId: string): Promise<string[]> {
    return [...(this.sets.get(keys.dmPartners(this.ns, sessionId, agentId)) ?? [])].sort();
  }

  async getCursor(sessionId: string, agentId: string, rid: string): Promise<string | null> {
    return this.readString(keys.cursor(this.ns, sessionId, agentId, rid));
  }

  async setCursor(
    sessionId: string,
    agentId: string,
    rid: string,
    cursor: string,
  ): Promise<void> {
    this.strings.set(keys.cursor(this.ns, sessionId, agentId, rid), { value: cursor });
  }

  async memorySet(
    sessionId: string,
    key: string,
    value: string,
    meta?: Record<string, string>,
  ): Promise<void> {
    this.hash(keys.memoryKv(this.ns, sessionId)).set(key, value);
    if (meta) {
      const h = this.hash(keys.memoryMeta(this.ns, sessionId, key));
      for (const [k, v] of Object.entries(meta)) {
        h.set(k, v);
      }
    }
  }

  async memoryGet(sessionId: string, key: string): Promise<string | null> {
    return this.hashes.get(keys.memoryKv(this.ns, sessionId))?.get(key) ?? null;
  }

  async memoryGetMeta(sessionId: string, key: string): Promise<Record<string, string>> {
    const h = this.hashes.get(keys.memoryMeta(this.ns, sessionId, key));
    return h ? Object.fromEntries(h.entries()) : {};
  }

  async memoryKeys(sessionId: string): Promise<string[]> {
    const h = this.hashes.get(keys.memoryKv(this.ns, sessionId));
    return h ? [...h.keys()] : [];
  }

  async memoryGetMany(sessionId: string, fieldKeys: string[]): Promise<Record<string, string>> {
    const h = this.hashes.get(keys.memoryKv(this.ns, sessionId));
    const out: Record<string, string> = {};
    if (!h) return out;
    for (const k of fieldKeys) {
      const v = h.get(k);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  async memoryList(sessionId: string): Promise<Record<string, string>> {
    const keysOnly = await this.memoryKeys(sessionId);
    return this.memoryGetMany(sessionId, keysOnly);
  }

  async appendNote(sessionId: string, fields: Record<string, string>): Promise<string> {
    return this.addStreamMessage(keys.memoryNotes(this.ns, sessionId), fields, 5000);
  }

  async readNotes(sessionId: string, afterId: string, limit: number): Promise<StreamEntry[]> {
    return this.readStreamAfter(keys.memoryNotes(this.ns, sessionId), afterId, limit);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    this.hashes.clear();
    this.sets.clear();
    this.strings.clear();
    this.streams.clear();
    this.streamSeq.clear();
  }
}
