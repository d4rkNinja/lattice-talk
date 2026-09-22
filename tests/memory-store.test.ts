import { describe, expect, it } from "vitest";
import { memoryGet, memoryList, memoryNote, memorySet } from "../src/core/memory.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { pullMessages, tellAgent, tellRoom, truncateBody } from "../src/core/messages.js";
import { createRoom, joinRoom } from "../src/core/rooms.js";
import { joinSession, leaveSession, listPeers, sessionInfo } from "../src/core/session.js";
import { makeDeps, testConfig } from "./helpers.js";

describe("MemoryStore session bus", () => {
  it("stamps role and harness from the sending agent's stored record", async () => {
    const store = new MemoryStore("test");
    const frontend = makeDeps(store);
    const backend = makeDeps(store);

    await joinSession(frontend, {
      session_id: "one-proc",
      role: "frontend",
      agent_id: "fe",
      harness: "cursor",
    });
    await joinSession(backend, {
      session_id: "one-proc",
      role: "backend",
      agent_id: "be",
      harness: "claude",
    });
    expect(backend.ctx.role).toBe("backend");
    expect(backend.ctx.harness).toBe("claude");

    await tellRoom(frontend, { body: "hi from fe" });
    const pulled = await pullMessages(backend, { room_id: "main" });
    expect(pulled.messages).toHaveLength(1);
    expect(pulled.messages[0]?.from).toBe("fe");
    expect(pulled.messages[0]?.role).toBe("frontend");
    expect(pulled.messages[0]?.harness).toBe("cursor");
    expect(pulled.messages[0]?.body).toBe("hi from fe");
  });

  it("lets two agents join, see each other, tell a room, and share memory", async () => {
    const store = new MemoryStore("test");
    const config = testConfig({ LATTICE_DEFAULT_SESSION_ID: "sprint-1" });
    const frontend = makeDeps(store, config);
    const backend = makeDeps(store, config);

    const a = await joinSession(frontend, {
      session_id: "sprint-1",
      role: "frontend",
      agent_id: "fe",
      harness: "cursor",
      display_name: "FE",
    });
    const b = await joinSession(backend, {
      session_id: "sprint-1",
      role: "backend",
      agent_id: "be",
      harness: "claude-code",
      display_name: "BE",
    });

    expect(a.session_id).toBe("sprint-1");
    expect(b.room_id).toBe("main");

    const peers = await listPeers(frontend, { session_id: "sprint-1" });
    expect(peers.peer_count).toBe(2);
    expect(peers.online_count).toBe(2);
    expect(peers.peers.map((p) => p.agent_id).sort()).toEqual(["be", "fe"]);

    await tellRoom(frontend, { body: "API shape locked", kind: "task" });
    const pulled = await pullMessages(backend, { room_id: "main" });
    expect(pulled.messages).toHaveLength(1);
    expect(pulled.messages[0]?.body).toBe("API shape locked");
    expect(pulled.messages[0]?.from).toBe("fe");
    expect(pulled.channel).toBe("room:main");

    const idle = await pullMessages(backend, { room_id: "main" });
    expect(idle.messages).toHaveLength(0);

    await memorySet(frontend, { key: "api.base", value: "https://api.dev/v1" });
    const got = await memoryGet(backend, { key: "api.base" });
    expect(got.found).toBe(true);
    expect(got.value).toBe("https://api.dev/v1");

    const listed = await memoryList(backend, { include_values: true });
    expect(listed.keys).toContain("api.base");
    expect(listed.values?.["api.base"]).toBe("https://api.dev/v1");

    const note = await memoryNote(frontend, { body: "ship Friday" });
    expect(note.note_id).toBeTruthy();

    const info = await sessionInfo(frontend, {});
    expect(info.rooms).toContain("main");
    expect(info.store).toBe("memory");
    expect(info.namespace).toBe("test");
  });

  it("delivers DMs on the inbox channel and advances per-pair cursors", async () => {
    const store = new MemoryStore("test");
    const frontend = makeDeps(store);
    const backend = makeDeps(store);

    await joinSession(frontend, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(backend, { session_id: "s1", role: "be", agent_id: "be" });

    await tellAgent(frontend, { to_agent_id: "be", body: "need auth header" });
    const inbox = await pullMessages(backend, { inbox: true });
    expect(inbox.channel).toBe("inbox");
    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0]?.to).toBe("be");
    expect(inbox.cursors?.["dm:be:fe"]).toBeTruthy();

    const again = await pullMessages(backend, { inbox: true });
    expect(again.messages).toHaveLength(0);
  });

  it("creates and joins extra rooms", async () => {
    const store = new MemoryStore("test");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    const created = await createRoom(a, { room_id: "design", display_name: "Design" });
    expect(created.created).toBe(true);
    await joinRoom(b, { room_id: "design" });
    await tellRoom(a, { room_id: "design", body: "wireframes up" });
    const pulled = await pullMessages(b, { room_id: "design" });
    expect(pulled.messages[0]?.body).toBe("wireframes up");
  });

  it("fixes the token policy at session creation and enforces it on later joins", async () => {
    const store = new MemoryStore("test");
    const first = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "secret" }));
    const joined = await joinSession(first, { session_id: "s1", role: "fe", agent_id: "fe" });
    expect(joined.created).toBe(true);

    const meta = await store.getSessionMeta("s1");
    expect(meta?.join_policy).toBe("token");
    expect(meta?.join_token_hash).toBe(
      (await import("node:crypto")).createHash("sha256").update("secret").digest("hex"),
    );

    const wrong = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "wrong" }));
    await expect(
      joinSession(wrong, { session_id: "s1", role: "be" }),
    ).rejects.toMatchObject({ code: "auth" });

    const tokenless = makeDeps(store);
    await expect(
      joinSession(tokenless, { session_id: "s1", role: "be" }),
    ).rejects.toMatchObject({ code: "auth" });

    const right = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "secret" }));
    const ok = await joinSession(right, { session_id: "s1", role: "be" });
    expect(ok.agent_id).toBeTruthy();
  });

  it("never lets a token retroactively lock an open session", async () => {
    const store = new MemoryStore("test");
    const creator = makeDeps(store);
    await joinSession(creator, { session_id: "s1", role: "fe", agent_id: "fe" });
    expect((await store.getSessionMeta("s1"))?.join_policy).toBe("open");

    // A later token-bearing process cannot claim or lock the open session.
    const tokened = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "secret" }));
    const joined = await joinSession(tokened, { session_id: "s1", role: "be" });
    expect(joined.agent_id).toBeTruthy();
    expect((await store.getSessionMeta("s1"))?.join_policy).toBe("open");

    // And tokenless participants are still welcome.
    const late = makeDeps(store);
    await expect(joinSession(late, { session_id: "s1", role: "reviewer" })).resolves.toBeTruthy();
  });

  it("deleteSession wipes every session key and leaves siblings untouched", async () => {
    const store = new MemoryStore("test");
    const a = makeDeps(store);
    const b = makeDeps(store);
    const other = makeDeps(store);

    // Populate session s1 fully: two agents, rooms, room + DM traffic,
    // cursors (from pulls), and memory.
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });
    await createRoom(a, { session_id: "s1", room_id: "design" });
    await joinRoom(b, { session_id: "s1", room_id: "design" });
    await tellRoom(a, { session_id: "s1", room_id: "design", body: "room msg" });
    await tellAgent(a, { session_id: "s1", to_agent_id: "be", body: "dm msg" });
    await pullMessages(b, { session_id: "s1", room_id: "design" });
    await pullMessages(b, { session_id: "s1", inbox: true });
    await memorySet(a, { session_id: "s1", key: "api", value: "v1" });
    await memoryNote(a, { session_id: "s1", body: "note body" });

    // A neighbouring session that must survive intact.
    await joinSession(other, { session_id: "s2", role: "x", agent_id: "x1" });
    await tellRoom(other, { session_id: "s2", body: "untouched" });

    expect(await store.listSessions()).toEqual(["s1", "s2"]);
    await store.deleteSession("s1");

    // Everything under s1 is gone.
    expect(await store.listSessions()).toEqual(["s2"]);
    expect(await store.getSessionMeta("s1")).toBeNull();
    expect(await store.listAgents("s1")).toEqual([]);
    expect(await store.listRooms("s1")).toEqual([]);
    expect(await store.listDmPartners("s1", "be")).toEqual([]);
    expect(await store.getCursor("s1", "be", "design")).toBeNull();
    expect(await store.memoryGet("s1", "api")).toBeNull();
    expect((await store.presenceStatus("s1", ["fe"]))["fe"]).toBe(false);

    // s2 is untouched.
    expect(await store.listAgents("s2")).toHaveLength(1);
    expect(await store.listRooms("s2")).toEqual(["main"]);
    const s2pull = await pullMessages(other, { session_id: "s2", room_id: "main" });
    expect(s2pull.messages[0]?.body).toBe("untouched");
  });

  it("deleteSession tolerates names that are substrings of other sessions", async () => {
    const store = new MemoryStore("test");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "api", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "api-v2", role: "be", agent_id: "be" });
    await tellRoom(b, { session_id: "api-v2", body: "v2 msg" });

    await store.deleteSession("api");
    expect(await store.listSessions()).toEqual(["api-v2"]);
    expect(await store.listAgents("api-v2")).toHaveLength(1);
    const pulled = await pullMessages(b, { session_id: "api-v2", room_id: "main" });
    expect(pulled.messages[0]?.body).toBe("v2 msg");
  });

  it("expires presence after TTL", async () => {
    let now = 1_000_000;
    const store = new MemoryStore("test", () => now);
    const deps = makeDeps(store);
    await joinSession(deps, { session_id: "s1", role: "fe", agent_id: "fe" });
    let peers = await listPeers(deps, { session_id: "s1" });
    expect(peers.peers[0]?.online).toBe(true);
    now += 46_000;
    peers = await listPeers(deps, { session_id: "s1" });
    expect(peers.peers[0]?.online).toBe(false);
  });

  it("leave_session drops the agent from peers", async () => {
    const store = new MemoryStore("test");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });
    await leaveSession(a, {});
    const peers = await listPeers(b, {});
    expect(peers.peers.map((p) => p.agent_id)).toEqual(["be"]);
  });

  it("truncates pulled bodies", async () => {
    const store = new MemoryStore("test");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });
    const long = "z".repeat(2500);
    await tellRoom(a, { body: long });
    const pulled = await pullMessages(b, {});
    expect(pulled.messages[0]?.truncated).toBe(true);
    expect(pulled.messages[0]?.body).toHaveLength(truncateBody(long).body.length);
  });
});
