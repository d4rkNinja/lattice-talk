import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { RuntimeContext } from "../src/core/context.js";
import { memoryGet, memorySet } from "../src/core/memory.js";
import { pullMessages, tellRoom } from "../src/core/messages.js";
import { RedisStore } from "../src/core/redis.js";
import { joinSession, listPeers } from "../src/core/session.js";
import type { BusDeps } from "../src/core/types.js";

const redisUrl = process.env.LATTICE_REDIS_URL;

describe.skipIf(!redisUrl)("Redis integration", () => {
  let storeA: RedisStore | undefined;
  let storeB: RedisStore | undefined;

  afterAll(async () => {
    await storeA?.close();
    await storeB?.close();
  });

  it("two clients share join, room messages, and memory", async () => {
    const config = loadConfig({
      ...process.env,
      LATTICE_STORE: "redis",
      LATTICE_NAMESPACE: "itest",
      LATTICE_REDIS_URL: redisUrl,
    });
    storeA = RedisStore.connect(config);
    storeB = RedisStore.connect(config);
    if (!(await storeA.ping())) {
      throw new Error("Redis ping failed");
    }

    const sessionId = `itest-${Date.now()}`;
    const a: BusDeps = { store: storeA, config, ctx: new RuntimeContext() };
    const b: BusDeps = { store: storeB, config, ctx: new RuntimeContext() };

    await joinSession(a, { session_id: sessionId, role: "frontend", agent_id: "fe" });
    await joinSession(b, { session_id: sessionId, role: "backend", agent_id: "be" });

    const peers = await listPeers(a, { session_id: sessionId });
    expect(peers.peer_count).toBe(2);
    expect(peers.online_count).toBe(2);

    await tellRoom(a, { body: "hello from A" });
    const pulled = await pullMessages(b, { room_id: "main" });
    expect(pulled.messages.some((m) => m.body === "hello from A")).toBe(true);

    await memorySet(a, { key: "shared.flag", value: "on" });
    const got = await memoryGet(b, { key: "shared.flag" });
    expect(got.value).toBe("on");
  });
});
