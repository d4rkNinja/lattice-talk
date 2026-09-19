import { describe, expect, it } from "vitest";
import { UserError } from "../src/core/errors.js";
import { memoryGet, memoryList, memoryNote, memorySet } from "../src/core/memory.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { pullMessages, tellAgent, tellRoom, truncateBody } from "../src/core/messages.js";
import { createRoom, joinRoom } from "../src/core/rooms.js";
import { joinSession, leaveSession, listPeers, sessionInfo } from "../src/core/session.js";
import { makeDeps, testConfig } from "./helpers.js";

describe("MemoryStore session bus", () => {
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

  it("requires a matching join token when configured", async () => {
    const store = new MemoryStore("test");
    const deps = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "secret" }));
    await expect(
      joinSession(deps, { session_id: "s1", role: "fe" }),
    ).rejects.toBeInstanceOf(UserError);
    await expect(
      joinSession(deps, { session_id: "s1", role: "fe", join_token: "wrong" }),
    ).rejects.toMatchObject({ code: "auth" });
    const ok = await joinSession(deps, {
      session_id: "s1",
      role: "fe",
      join_token: "secret",
    });
    expect(ok.agent_id).toBeTruthy();
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
