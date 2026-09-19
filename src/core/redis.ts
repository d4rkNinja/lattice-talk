import Redis from "ioredis";
import type { LatticeConfig } from "./config.js";
import { keys } from "./keys.js";
import { log, redactUrl } from "../log.js";
import { exclusiveStart } from "./stream.js";
import type { Store } from "./store.js";
import type { AgentRecord, RoomMeta, SessionMeta, StreamEntry } from "./types.js";

function flattenFields(fields: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== "") {
      out.push(k, v);
    }
  }
  return out;
}

function parseXEntries(raw: unknown): StreamEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StreamEntry[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const id = String(item[0]);
    out.push({ id, fields: toFieldMap(item[1]) });
  }
  return out;
}

function toFieldMap(fields: unknown): Record<string, string> {
  if (fields && !Array.isArray(fields) && typeof fields === "object") {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      o[k] = String(v);
    }
    return o;
  }
  if (!Array.isArray(fields)) return {};
  const o: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    o[String(fields[i])] = String(fields[i + 1]);
  }
  return o;
}

function parseAgent(raw: string): AgentRecord | null {
  try {
    return JSON.parse(raw) as AgentRecord;
  } catch {
    return null;
  }
}

export function createRedisClient(config: LatticeConfig): Redis {
  const common = {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy(times: number) {
      return Math.min(times * 200, 2000);
    },
  };

  let client: Redis;
  if (config.redisUrl) {
    const tls = config.redisSsl || config.redisUrl.startsWith("rediss://") ? {} : undefined;
    client = new Redis(config.redisUrl, { ...common, tls });
    log("redis connecting", redactUrl(config.redisUrl));
  } else {
    client = new Redis({
      ...common,
      host: config.redisHost ?? "127.0.0.1",
      port: config.redisPort,
      username: config.redisUsername,
      password: config.redisPassword,
      db: config.redisDb,
      tls: config.redisSsl ? {} : undefined,
    });
    log("redis connecting", `${config.redisHost ?? "127.0.0.1"}:${config.redisPort}`);
  }

  client.on("error", (err) => {
    log("redis error", err.message);
  });
  client.on("reconnecting", () => {
    log("redis reconnecting");
  });

  return client;
}

export class RedisStore implements Store {
  readonly kind = "redis" as const;

  constructor(
    private readonly redis: Redis,
    private readonly ns: string,
  ) {}

  static connect(config: LatticeConfig): RedisStore {
    return new RedisStore(createRedisClient(config), config.namespace);
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    const data = await this.redis.hgetall(keys.sessionMeta(this.ns, sessionId));
    if (!data || !data.session_id) return null;
    return {
      session_id: data.session_id,
      namespace: data.namespace ?? this.ns,
      created_at: data.created_at ?? "",
      created_by: data.created_by ?? "",
    };
  }

  async initSessionMeta(sessionId: string, meta: SessionMeta): Promise<boolean> {
    const key = keys.sessionMeta(this.ns, sessionId);
    const created = await this.redis.hsetnx(key, "session_id", meta.session_id);
    if (created === 1) {
      await this.redis.hset(key, {
        namespace: meta.namespace,
        created_at: meta.created_at,
        created_by: meta.created_by,
      });
      return true;
    }
    return false;
  }

  async putAgent(sessionId: string, agent: AgentRecord): Promise<void> {
    await this.redis.hset(keys.sessionAgents(this.ns, sessionId), agent.agent_id, JSON.stringify(agent));
  }

  async getAgent(sessionId: string, agentId: string): Promise<AgentRecord | null> {
    const raw = await this.redis.hget(keys.sessionAgents(this.ns, sessionId), agentId);
    return raw ? parseAgent(raw) : null;
  }

  async getAgents(sessionId: string, agentIds: string[]): Promise<AgentRecord[]> {
    if (agentIds.length === 0) return [];
    const raws = await this.redis.hmget(keys.sessionAgents(this.ns, sessionId), ...agentIds);
    const out: AgentRecord[] = [];
    for (const raw of raws) {
      if (!raw) continue;
      const agent = parseAgent(raw);
      if (agent) out.push(agent);
    }
    return out;
  }

  async listAgentIds(sessionId: string): Promise<string[]> {
    const ids = await this.redis.hkeys(keys.sessionAgents(this.ns, sessionId));
    return ids.sort();
  }

  async listAgents(sessionId: string): Promise<AgentRecord[]> {
    const ids = await this.listAgentIds(sessionId);
    const agents = await this.getAgents(sessionId, ids);
    return agents.sort((a, b) => a.agent_id.localeCompare(b.agent_id));
  }

  async countAgents(sessionId: string): Promise<number> {
    return this.redis.hlen(keys.sessionAgents(this.ns, sessionId));
  }

  async removeAgent(sessionId: string, agentId: string): Promise<void> {
    await this.redis.hdel(keys.sessionAgents(this.ns, sessionId), agentId);
  }

  async getJoinTokenHash(sessionId: string): Promise<string | null> {
    return this.redis.get(keys.sessionJoin(this.ns, sessionId));
  }

  async setJoinTokenHash(sessionId: string, hash: string): Promise<void> {
    await this.redis.set(keys.sessionJoin(this.ns, sessionId), hash);
  }

  async touchPresence(sessionId: string, agentId: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(keys.presence(this.ns, sessionId, agentId), "1", "EX", ttlSeconds);
  }

  async clearPresence(sessionId: string, agentId: string): Promise<void> {
    await this.redis.del(keys.presence(this.ns, sessionId, agentId));
  }

  async presenceStatus(
    sessionId: string,
    agentIds: string[],
  ): Promise<Record<string, boolean>> {
    const out: Record<string, boolean> = {};
    if (agentIds.length === 0) return out;
    const pipeline = this.redis.pipeline();
    for (const id of agentIds) {
      pipeline.exists(keys.presence(this.ns, sessionId, id));
    }
    const replies = await pipeline.exec();
    agentIds.forEach((id, i) => {
      const reply = replies?.[i];
      out[id] = reply?.[1] === 1;
    });
    return out;
  }

  async addRoom(sessionId: string, roomId: string, meta: RoomMeta): Promise<boolean> {
    const added = await this.redis.sadd(keys.sessionRooms(this.ns, sessionId), roomId);
    const key = keys.roomMeta(this.ns, sessionId, roomId);
    if (added === 1) {
      await this.redis.hset(key, {
        room_id: meta.room_id,
        session_id: meta.session_id,
        display_name: meta.display_name,
        created_at: meta.created_at,
        created_by: meta.created_by,
      });
      return true;
    }
    const exists = await this.redis.exists(key);
    if (exists === 0) {
      await this.redis.hset(key, {
        room_id: meta.room_id,
        session_id: meta.session_id,
        display_name: meta.display_name,
        created_at: meta.created_at,
        created_by: meta.created_by,
      });
    }
    return false;
  }

  async listRooms(sessionId: string): Promise<string[]> {
    const rooms = await this.redis.smembers(keys.sessionRooms(this.ns, sessionId));
    return rooms.sort();
  }

  async getRoomMeta(sessionId: string, roomId: string): Promise<RoomMeta | null> {
    const data = await this.redis.hgetall(keys.roomMeta(this.ns, sessionId, roomId));
    if (!data || !data.room_id) return null;
    return {
      room_id: data.room_id,
      session_id: data.session_id ?? sessionId,
      display_name: data.display_name ?? roomId,
      created_at: data.created_at ?? "",
      created_by: data.created_by ?? "",
    };
  }

  async addRoomMember(sessionId: string, roomId: string, agentId: string): Promise<void> {
    await this.redis.sadd(keys.roomMembers(this.ns, sessionId, roomId), agentId);
  }

  async removeRoomMember(sessionId: string, roomId: string, agentId: string): Promise<void> {
    await this.redis.srem(keys.roomMembers(this.ns, sessionId, roomId), agentId);
  }

  async listRoomMembers(sessionId: string, roomId: string): Promise<string[]> {
    const members = await this.redis.smembers(keys.roomMembers(this.ns, sessionId, roomId));
    return members.sort();
  }

  async isRoomMember(sessionId: string, roomId: string, agentId: string): Promise<boolean> {
    return (await this.redis.sismember(keys.roomMembers(this.ns, sessionId, roomId), agentId)) === 1;
  }

  async removeAgentFromAllRooms(sessionId: string, agentId: string): Promise<void> {
    const rooms = await this.listRooms(sessionId);
    if (rooms.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const roomId of rooms) {
      pipeline.srem(keys.roomMembers(this.ns, sessionId, roomId), agentId);
    }
    await pipeline.exec();
  }

  async addStreamMessage(
    streamKey: string,
    fields: Record<string, string>,
    maxLen: number,
  ): Promise<string> {
    const flat = flattenFields(fields);
    const id = await this.redis.xadd(
      streamKey,
      "MAXLEN",
      "~",
      String(maxLen),
      "*",
      ...flat,
    );
    if (!id) {
      throw new Error("Redis XADD returned no id");
    }
    return id;
  }

  async readStreamAfter(
    streamKey: string,
    afterId: string,
    limit: number,
  ): Promise<StreamEntry[]> {
    const start = exclusiveStart(afterId);
    const raw = await this.redis.xrange(streamKey, start, "+", "COUNT", limit);
    return parseXEntries(raw);
  }

  async addDmPartner(sessionId: string, agentId: string, otherId: string): Promise<void> {
    await this.redis.sadd(keys.dmPartners(this.ns, sessionId, agentId), otherId);
  }

  async listDmPartners(sessionId: string, agentId: string): Promise<string[]> {
    const partners = await this.redis.smembers(keys.dmPartners(this.ns, sessionId, agentId));
    return partners.sort();
  }

  async getCursor(sessionId: string, agentId: string, rid: string): Promise<string | null> {
    return this.redis.get(keys.cursor(this.ns, sessionId, agentId, rid));
  }

  async setCursor(
    sessionId: string,
    agentId: string,
    rid: string,
    cursor: string,
  ): Promise<void> {
    await this.redis.set(keys.cursor(this.ns, sessionId, agentId, rid), cursor);
  }

  async memorySet(
    sessionId: string,
    key: string,
    value: string,
    meta?: Record<string, string>,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.hset(keys.memoryKv(this.ns, sessionId), key, value);
    if (meta && Object.keys(meta).length > 0) {
      pipeline.hset(keys.memoryMeta(this.ns, sessionId, key), meta);
    }
    await pipeline.exec();
  }

  async memoryGet(sessionId: string, key: string): Promise<string | null> {
    return this.redis.hget(keys.memoryKv(this.ns, sessionId), key);
  }

  async memoryKeys(sessionId: string): Promise<string[]> {
    return this.redis.hkeys(keys.memoryKv(this.ns, sessionId));
  }

  async memoryGetMany(sessionId: string, fieldKeys: string[]): Promise<Record<string, string>> {
    if (fieldKeys.length === 0) return {};
    const values = await this.redis.hmget(keys.memoryKv(this.ns, sessionId), ...fieldKeys);
    const out: Record<string, string> = {};
    fieldKeys.forEach((k, i) => {
      const v = values[i];
      if (v !== null && v !== undefined) out[k] = v;
    });
    return out;
  }

  async memoryList(sessionId: string): Promise<Record<string, string>> {
    const fieldKeys = await this.memoryKeys(sessionId);
    return this.memoryGetMany(sessionId, fieldKeys);
  }

  async appendNote(sessionId: string, fields: Record<string, string>): Promise<string> {
    return this.addStreamMessage(keys.memoryNotes(this.ns, sessionId), fields, 5000);
  }

  async readNotes(sessionId: string, afterId: string, limit: number): Promise<StreamEntry[]> {
    return this.readStreamAfter(keys.memoryNotes(this.ns, sessionId), afterId, limit);
  }

  async publishWake(sessionId: string, payload: string): Promise<void> {
    await this.redis.publish(keys.wake(this.ns, sessionId), payload);
  }

  async ping(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
