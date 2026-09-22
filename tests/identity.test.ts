import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { UserError } from "../src/core/errors.js";
import { memoryNote, memorySet } from "../src/core/memory.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { pullMessages, tellAgent, tellRoom } from "../src/core/messages.js";
import { createRoom, joinRoom } from "../src/core/rooms.js";
import { joinSession, leaveSession, listPeers } from "../src/core/session.js";
import { createMcpServer } from "../src/mcp/server.js";
import { expectToolError, expectToolOk, makeDeps } from "./helpers.js";

describe("process-owned identity", () => {
  it("rejects mutating tools before join_session", async () => {
    const store = new MemoryStore("id");
    const deps = makeDeps(store);

    await expect(tellRoom(deps, { body: "hi" })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
    await expect(tellAgent(deps, { to_agent_id: "be", body: "hi" })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
    await expect(pullMessages(deps, { inbox: true })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
    await expect(memorySet(deps, { key: "k", value: "v" })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
    await expect(memoryNote(deps, { body: "n" })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
    await expect(createRoom(deps, { room_id: "x" })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
    await expect(joinRoom(deps, { room_id: "main" })).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
    await expect(leaveSession(deps, {})).rejects.toSatisfy(
      (err: unknown) => err instanceof UserError && err.message === "Call join_session first.",
    );
  });

  it("leave_session cannot kick another agent", async () => {
    const store = new MemoryStore("id");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    const left = await leaveSession(a, {});
    expect(left.agent_id).toBe("fe");

    const peers = await listPeers(b, { session_id: "s1" });
    expect(peers.peers.map((p) => p.agent_id)).toEqual(["be"]);
    expect(b.ctx.agentId).toBe("be");
  });

  it("pull_messages inbox and tell_room use the joined process, not a spoofed from", async () => {
    const store = new MemoryStore("id");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    await tellAgent(a, { to_agent_id: "be", body: "secret for be" });
    const bCursorBefore = await store.getCursor("s1", "be", "dm:be:fe");
    await pullMessages(a, { inbox: true });
    const bCursorAfter = await store.getCursor("s1", "be", "dm:be:fe");
    expect(bCursorAfter).toBe(bCursorBefore);

    const bInbox = await pullMessages(b, { inbox: true });
    expect(bInbox.messages).toHaveLength(1);
    expect(bInbox.messages[0]?.to).toBe("be");

    await tellRoom(a, { body: "from A" });
    const pulled = await pullMessages(b, { room_id: "main" });
    expect(pulled.messages[0]?.from).toBe("fe");
    expect(pulled.messages[0]?.role).toBe("fe");
  });
});

describe("room membership", () => {
  it("create_room adds the creator; non-members cannot tell or pull", async () => {
    const store = new MemoryStore("rooms");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    const created = await createRoom(a, { room_id: "secret" });
    expect(created.created).toBe(true);
    expect(await store.isRoomMember("s1", "secret", "fe")).toBe(true);
    expect(await store.isRoomMember("s1", "secret", "be")).toBe(false);

    await expect(tellRoom(b, { room_id: "secret", body: "nope" })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UserError && err.message.includes("Not a member of room secret"),
    );
    await expect(pullMessages(b, { room_id: "secret" })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UserError && err.message.includes("Not a member of room secret"),
    );

    await tellRoom(a, { room_id: "secret", body: "members only" });
    await joinRoom(b, { room_id: "secret" });
    const pulled = await pullMessages(b, { room_id: "secret" });
    expect(pulled.messages[0]?.body).toBe("members only");
  });
});

describe("tell_agent validation before Redis mutation", () => {
  it("does not add dm_partners on empty body", async () => {
    const store = new MemoryStore("dm");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    await expect(tellAgent(a, { to_agent_id: "be", body: "" })).rejects.toBeInstanceOf(UserError);
    await expect(tellAgent(a, { to_agent_id: "be", body: "   " })).rejects.toBeInstanceOf(UserError);
    expect(await store.listDmPartners("s1", "fe")).toEqual([]);
    expect(await store.listDmPartners("s1", "be")).toEqual([]);
  });

  it("errors when the recipient is not in the session and does not add partners", async () => {
    const store = new MemoryStore("dm");
    const a = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });

    await expect(tellAgent(a, { to_agent_id: "ghost", body: "hi" })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof UserError && err.message === "Agent ghost is not in this session.",
    );
    expect(await store.listDmPartners("s1", "fe")).toEqual([]);
  });

  it("reports recipient_online and recipient_wake honestly", async () => {
    const store = new MemoryStore("dm-status");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    const live = await tellAgent(a, { to_agent_id: "be", body: "hi" });
    expect(live.recipient_online).toBe(true);
    expect(live.recipient_wake).toBeNull();

    // Task done, process gone — presence expires/clears but the record stays.
    await store.clearPresence("s1", "be");
    const queued = await tellAgent(a, { to_agent_id: "be", body: "queued" });
    expect(queued.recipient_online).toBe(false);
    expect(queued.recipient_wake).toBeNull();

    // A supervisor advertising wake:"bridge" surfaces to the sender.
    const be = await store.getAgent("s1", "be");
    await store.putAgent("s1", { ...be!, wake: "bridge" });
    const supervised = await tellAgent(a, { to_agent_id: "be", body: "wake it" });
    expect(supervised.recipient_online).toBe(false);
    expect(supervised.recipient_wake).toBe("bridge");
  });

  it("happy path still delivers a DM", async () => {
    const store = new MemoryStore("dm");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s1", role: "fe", agent_id: "fe" });
    await joinSession(b, { session_id: "s1", role: "be", agent_id: "be" });

    const sent = await tellAgent(a, { to_agent_id: "be", body: "need auth header" });
    expect(sent.pair).toBe("be:fe");
    expect(await store.listDmPartners("s1", "fe")).toEqual(["be"]);
    const inbox = await pullMessages(b, { inbox: true });
    expect(inbox.messages[0]?.body).toBe("need auth header");
  });
});

describe("MCP tool identity (joined process wins)", () => {
  let client: Client | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  async function connect(deps: ReturnType<typeof makeDeps>): Promise<Client> {
    const server = createMcpServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "identity", version: "0.0.1" });
    await Promise.all([server.connect(serverTransport), c.connect(clientTransport)]);
    client = c;
    return c;
  }

  it("tools before join return Call join_session first", async () => {
    const store = new MemoryStore("mcp-id-pre");
    const deps = makeDeps(store);
    const c = await connect(deps);
    expectToolError(
      await c.callTool({ name: "tell_room", arguments: { body: "hi" } }),
      /Call join_session first/,
    );
    expectToolError(
      await c.callTool({ name: "leave_session", arguments: {} }),
      /Call join_session first/,
    );
    expectToolError(
      await c.callTool({ name: "pull_messages", arguments: { inbox: true } }),
      /Call join_session first/,
    );
    await store.close();
  });

  it("ignores extra agent_id on mutating tools after joining as A", async () => {
    const store = new MemoryStore("mcp-id-spoof");
    const deps = makeDeps(store);
    const c = await connect(deps);
    const joined = expectToolOk<{ agent_id: string; session_id: string }>(
      await c.callTool({
        name: "join_session",
        arguments: { session_id: "mcp-s", role: "fe", agent_id: "fe", harness: "vitest" },
      }),
    );
    expect(joined.agent_id).toBe("fe");

    const b = makeDeps(store);
    await joinSession(b, { session_id: "mcp-s", role: "be", agent_id: "be" });

    expectToolOk(
      await c.callTool({
        name: "tell_room",
        arguments: { agent_id: "be", body: "not from be" },
      }),
    );
    const pulled = await pullMessages(b, { room_id: "main" });
    expect(pulled.messages[0]?.from).toBe("fe");

    const beforeInbox = await store.getCursor("mcp-s", "be", "dm:be:fe");
    expectToolOk(
      await c.callTool({
        name: "pull_messages",
        arguments: { inbox: true, agent_id: "be" },
      }),
    );
    const afterInbox = await store.getCursor("mcp-s", "be", "dm:be:fe");
    expect(afterInbox).toBe(beforeInbox);

    expectToolOk(
      await c.callTool({
        name: "leave_session",
        arguments: { agent_id: "be" },
      }),
    );
    expect(deps.ctx.agentId).toBeUndefined();
    expect(await store.getAgent("mcp-s", "be")).toBeTruthy();
    expect(await store.getAgent("mcp-s", "fe")).toBeNull();
    await store.close();
  });
});
