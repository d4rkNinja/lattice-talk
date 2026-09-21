import { describe, expect, it } from "vitest";
import { keys } from "../src/core/keys.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { pullMessages, tellAgent, tellRoom } from "../src/core/messages.js";
import { joinSession } from "../src/core/session.js";
import { makeDeps, testConfig } from "./helpers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("store publish/subscribe", () => {
  it("delivers payloads to subscribers and stops after unsubscribe", async () => {
    const store = new MemoryStore("test");
    const got: string[] = [];
    const unsub = await store.subscribe(["ch:a"], (_ch, payload) => {
      got.push(payload);
    });
    await store.publish("ch:a", "one");
    await store.publish("ch:other", "ignored");
    await unsub();
    await store.publish("ch:a", "two");
    expect(got).toEqual(["one"]);
  });

  it("fans out to multiple subscribers on the same channel", async () => {
    const store = new MemoryStore("test");
    let a = 0;
    let b = 0;
    await store.subscribe(["ch:x"], () => a++);
    await store.subscribe(["ch:x"], () => b++);
    await store.publish("ch:x", "p");
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});

describe("pull_messages wait_ms wake-ups", () => {
  it("wakes an inbox waiter when a DM arrives", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    const be = makeDeps(store, testConfig());
    await joinSession(fe, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });

    const waiting = pullMessages(be, { inbox: true, wait_ms: 5000 });
    await sleep(20);
    await tellAgent(fe, { to_agent_id: "be", body: "ping" });
    const res = await waiting;
    expect(res.messages).toHaveLength(1);
    expect(res.messages[0]!.body).toBe("ping");
    expect(res.messages[0]!.from).toBe("fe");
  });

  it("wakes a room waiter when a room message arrives", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    const be = makeDeps(store, testConfig());
    await joinSession(fe, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });

    const waiting = pullMessages(be, { room_id: "main", wait_ms: 5000 });
    await sleep(20);
    await tellRoom(fe, { room_id: "main", body: "room hello" });
    const res = await waiting;
    expect(res.messages.map((m) => m.body)).toContain("room hello");
  });

  it("a DM only wakes the recipient, not other agents' inbox waiters", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    const be = makeDeps(store, testConfig());
    const qa = makeDeps(store, testConfig());
    await joinSession(fe, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });
    await joinSession(qa, { session_id: "s1", role: "qa", agent_id: "qa" });

    const beWait = pullMessages(be, { inbox: true, wait_ms: 300 });
    const qaWait = pullMessages(qa, { inbox: true, wait_ms: 300 });
    await sleep(20);
    await tellAgent(fe, { to_agent_id: "be", body: "for be only" });
    const [beRes, qaRes] = await Promise.all([beWait, qaWait]);
    expect(beRes.messages).toHaveLength(1);
    expect(qaRes.messages).toHaveLength(0);
  });

  it("returns immediately when messages already exist, even with wait_ms", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    const be = makeDeps(store, testConfig());
    await joinSession(fe, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });
    await tellAgent(fe, { to_agent_id: "be", body: "already here" });

    const res = await pullMessages(be, { inbox: true, wait_ms: 5000 });
    expect(res.messages).toHaveLength(1);
  });

  it("times out empty when nothing arrives", async () => {
    const store = new MemoryStore("test");
    const be = makeDeps(store, testConfig());
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });

    const res = await pullMessages(be, { inbox: true, wait_ms: 50 });
    expect(res.messages).toHaveLength(0);
    expect(res.channel).toBe("inbox");
  });

  it("wait_ms=0 keeps the old immediate behavior", async () => {
    const store = new MemoryStore("test");
    const be = makeDeps(store, testConfig());
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });
    const res = await pullMessages(be, { room_id: "main", wait_ms: 0 });
    expect(res.messages).toHaveLength(0);
  });

  it("a cancelled request resolves the wait early", async () => {
    const store = new MemoryStore("test");
    const be = makeDeps(store, testConfig());
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });

    const controller = new AbortController();
    const waiting = pullMessages(
      be,
      { inbox: true, wait_ms: 5000 },
      { signal: controller.signal },
    );
    await sleep(20);
    controller.abort();
    const res = await waiting;
    expect(res.messages).toHaveLength(0);
  });

  it("onWaitStart fires only when the pull actually waits", async () => {
    const store = new MemoryStore("test");
    const be = makeDeps(store, testConfig());
    await joinSession(be, { session_id: "s1", role: "be", agent_id: "be" });

    let waited = 0;
    const onWaitStart = () => waited++;
    await pullMessages(be, { inbox: true, wait_ms: 50 }, { onWaitStart });
    expect(waited).toBe(1);
    // No wait_ms → no wait → callback never fires.
    await pullMessages(be, { inbox: true }, { onWaitStart });
    expect(waited).toBe(1);
  });
});

describe("meta notifications", () => {
  it("fires on agent join, leave, and room delete", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    const metaChannel = keys.notifyMeta("test", "s1");
    const events: string[] = [];
    await store.subscribe([metaChannel], (_ch, payload) => {
      events.push(JSON.parse(payload).type);
    });

    await joinSession(fe, { session_id: "s1", role: "fe", agent_id: "fe" });
    await store.deleteRoom("s1", "main");
    const { leaveSession } = await import("../src/core/session.js");
    await leaveSession(fe, {});
    expect(events).toContain("agents");
    expect(events).toContain("rooms");
  });
});
