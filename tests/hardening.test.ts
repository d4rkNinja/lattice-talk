import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "../src/core/config.js";
import { UserError } from "../src/core/errors.js";
import { assertBoundedText, assertId } from "../src/core/ids.js";
import { memoryGet, memoryNote, memoryNotes, memorySet } from "../src/core/memory.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { pullMessages, tellRoom } from "../src/core/messages.js";
import { joinSession, leaveSession } from "../src/core/session.js";
import { createMcpServer } from "../src/mcp/server.js";
import { expectToolOk, makeDeps, testConfig } from "./helpers.js";

describe("public id and text bounds", () => {
  it("rejects ':' and other delimiters in ids — composite keys join with ':'", async () => {
    expect(() => assertId("a:b", "agent_id")).toThrow(UserError);
    expect(() => assertId("a b", "agent_id")).toThrow(UserError);
    expect(() => assertId("", "agent_id")).toThrow(UserError);
    expect(assertId("ok.id_1-x", "agent_id")).toBe("ok.id_1-x");
    // dmPair("a:b","c") === dmPair("a","b:c") can no longer happen.
    expect(() => assertId("frontend:backup", "session_id")).toThrow(/session_id/);
  });

  it("bounds free-text fields", () => {
    expect(() => assertBoundedText("x".repeat(65), "role", 64)).toThrow(/role/);
    expect(() => assertBoundedText("  ", "role", 64)).toThrow(UserError);
    expect(assertBoundedText("  fe  ", "role", 64)).toBe("fe");
  });
});

describe("config validation", () => {
  it("rejects unknown LATTICE_STORE values instead of silently using redis", () => {
    expect(() => loadConfig({ LATTICE_STORE: "sqlite" })).toThrow(/LATTICE_STORE/);
    expect(() => loadConfig({ LATTICE_STORE: "Redis" })).not.toThrow();
  });

  it("rejects zero, negative, and non-numeric numeric knobs", () => {
    expect(() => loadConfig({ LATTICE_PRESENCE_TTL: "0" })).toThrow(/LATTICE_PRESENCE_TTL/);
    expect(() => loadConfig({ LATTICE_PRESENCE_TTL: "-10" })).toThrow(/LATTICE_PRESENCE_TTL/);
    expect(() => loadConfig({ LATTICE_PRESENCE_TTL: "abc" })).toThrow(/LATTICE_PRESENCE_TTL/);
    expect(() => loadConfig({ LATTICE_STREAM_MAXLEN: "-5" })).toThrow(/LATTICE_STREAM_MAXLEN/);
    expect(() => loadConfig({ REDIS_PORT: "99999" })).toThrow(/REDIS_PORT/);
    expect(() => loadConfig({ REDIS_PORT: "not-a-port" })).toThrow(/REDIS_PORT/);
  });

  it("accepts valid ranges", () => {
    const config = loadConfig({
      LATTICE_PRESENCE_TTL: "60",
      LATTICE_STREAM_MAXLEN: "500",
      REDIS_PORT: "6380",
    });
    expect(config.presenceTtlSeconds).toBe(60);
    expect(config.streamMaxLen).toBe(500);
    expect(config.redisPort).toBe(6380);
  });
});

describe("env-only session-bound join token", () => {
  it("rejects a process whose LATTICE_JOIN_TOKEN differs", async () => {
    const store = new MemoryStore("tok");
    const first = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "secret" }));
    await joinSession(first, { session_id: "s1", role: "fe", agent_id: "fe" });

    const bad = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "wrong" }));
    await expect(joinSession(bad, { session_id: "s1", role: "be" })).rejects.toMatchObject({
      code: "auth",
    });
  });

  it("blocks tokenless processes from a token-protected session", async () => {
    const store = new MemoryStore("tok2");
    const guarded = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "env-secret" }));
    await joinSession(guarded, { session_id: "s1", role: "fe" });
    expect(await store.getJoinTokenHash("s1")).toBeTruthy();

    // A process with no token configured cannot join the protected session.
    const tokenless = makeDeps(store);
    await expect(joinSession(tokenless, { session_id: "s1", role: "be" })).rejects.toMatchObject({
      code: "auth",
    });

    // Sessions created without any token stay open.
    const open = await joinSession(tokenless, { session_id: "s2", role: "fe" });
    expect(open.created).toBe(true);
    expect(await store.getJoinTokenHash("s2")).toBeNull();
  });
});

describe("duplicate agent identity", () => {
  it("rejects claiming an agent_id whose presence is online", async () => {
    const store = new MemoryStore("dup");
    const a = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });

    const b = makeDeps(store);
    await expect(
      joinSession(b, { session_id: "s1", role: "impersonator", agent_id: "fe" }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message.includes("already online"),
    );

    // Own re-join (same process, same identity) stays allowed.
    const again = await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    expect(again.agent_id).toBe("fe");

    // After the online agent leaves, the id frees up.
    await leaveSession(a, {});
    const freed = await joinSession(b, { session_id: "s1", role: "new", agent_id: "fe" });
    expect(freed.agent_id).toBe("fe");
  });
});

describe("pull_messages truncated flag is exact", () => {
  it("is false when exactly limit messages remain", async () => {
    const store = new MemoryStore("trunc");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    for (let i = 0; i < 3; i += 1) {
      await tellRoom(a, { body: `m${i}` });
    }
    const exact = await pullMessages(b, { limit: 3 });
    expect(exact.messages).toHaveLength(3);
    expect(exact.truncated).toBe(false);

    // One more arrives; exactly one remains beyond the cursor.
    await tellRoom(a, { body: "m3" });
    const one = await pullMessages(b, { limit: 1 });
    expect(one.messages).toHaveLength(1);
    expect(one.truncated).toBe(false);
    expect(one.messages[0]?.body).toBe("m3");
  });

  it("is true only when an extra message exists beyond the page", async () => {
    const store = new MemoryStore("trunc2");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    for (let i = 0; i < 4; i += 1) {
      await tellRoom(a, { body: `m${i}` });
    }
    const page1 = await pullMessages(b, { limit: 3 });
    expect(page1.messages).toHaveLength(3);
    expect(page1.truncated).toBe(true);

    const page2 = await pullMessages(b, { limit: 3 });
    expect(page2.messages).toHaveLength(1);
    expect(page2.truncated).toBe(false);
  });
});

describe("memory notes are readable", () => {
  it("round-trips notes with exact pagination", async () => {
    const store = new MemoryStore("notes");
    const deps = makeDeps(store);
    await joinSession(deps, { session_id: "s1", role: "fe", agent_id: "fe" });

    await memoryNote(deps, { body: "one" });
    await memoryNote(deps, { body: "two" });

    const page1 = await memoryNotes(deps, { limit: 1 });
    expect(page1.notes).toHaveLength(1);
    expect(page1.notes[0]?.body).toBe("one");
    expect(page1.notes[0]?.from).toBe("fe");
    expect(page1.truncated).toBe(true);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await memoryNotes(deps, { cursor: page1.next_cursor, limit: 1 });
    expect(page2.notes.map((n) => n.body)).toEqual(["two"]);
    expect(page2.truncated).toBe(false);
    expect(page2.next_cursor).toBeUndefined();
  });

  it("bounds note bodies and exposes memory metadata", async () => {
    const store = new MemoryStore("notes2");
    const deps = makeDeps(store);
    await joinSession(deps, { session_id: "s1", role: "fe", agent_id: "fe" });

    await expect(memoryNote(deps, { body: "x".repeat(8193) })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message.includes("body"),
    );

    await memorySet(deps, { key: "api.base", value: "https://api.dev" });
    const got = await memoryGet(deps, { key: "api.base" });
    expect(got.found).toBe(true);
    expect(got.updated_by).toBe("fe");
    expect(got.updated_at).toBeTruthy();
  });
});

describe("resources enforce the same session authorization as tools", () => {
  it("rejects arbitrary session ids until joined", async () => {
    const store = new MemoryStore("res-auth");
    const server = createMcpServer(makeDeps(store));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "res-auth", version: "0.0.1" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await expect(
      client.readResource({ uri: "lattice://session/some-session" }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
    await expect(
      client.readResource({ uri: "lattice://session/some-session/memory" }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });

    expectToolOk(
      await client.callTool({
        name: "join_session",
        arguments: { session_id: "some-session", role: "fe", harness: "vitest" },
      }),
    );
    const read = await client.readResource({ uri: "lattice://session/some-session" });
    expect(read.contents[0]?.mimeType).toBe("application/json");

    await client.close();
    await server.close();
    await store.close();
  });
});
