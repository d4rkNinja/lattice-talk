import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AcpDriver } from "../src/bridge/acp.js";
import { CodexDriver } from "../src/bridge/codex.js";
import { NdjsonRpc } from "../src/bridge/ndjson-rpc.js";
import { createDriver, runBridge } from "../src/bridge/runner.js";
import { bridgeJoinPrompt } from "../src/bridge/prompt.js";
import type { DriverOpts, HarnessDriver } from "../src/bridge/driver.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { tellAgent, tellRoom } from "../src/core/messages.js";
import { joinSession } from "../src/core/session.js";
import { makeDeps, testConfig } from "./helpers.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FIXTURES = join(import.meta.dirname, "fixtures");
const NODE = process.execPath;

async function waitUntil(pred: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await sleep(15);
  }
  throw new Error("waitUntil timed out");
}

const tmpDirs: string[] = [];
function logPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "lt-bridge-"));
  tmpDirs.push(dir);
  return join(dir, "log.txt");
}
const readLog = (p: string) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
};

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("NdjsonRpc transport", () => {
  const echo = () =>
    new NdjsonRpc(NODE, [join(FIXTURES, "echo-rpc.mjs")], { shell: false });

  it("resolves requests with their result", async () => {
    const rpc = echo();
    const res = await rpc.request<{ hi: string }>("echo", { hi: "there" });
    expect(res.hi).toBe("there");
    await rpc.close();
  });

  it("rejects requests with the JSON-RPC error", async () => {
    const rpc = echo();
    await expect(rpc.request("boom")).rejects.toThrow(/kaboom.*123/);
    await rpc.close();
  });

  it("dispatches notifications to registered handlers", async () => {
    const rpc = echo();
    let n = 0;
    rpc.onNotification("poked", () => n++);
    await rpc.request("poke");
    await waitUntil(() => n === 1);
    await rpc.close();
  });

  it("answers server-to-client requests through onRequest", async () => {
    const rpc = echo();
    rpc.onRequest("whoareyou", () => ({ name: "the-bridge" }));
    const res = await rpc.request<{ name: string }>("ask");
    expect(res.name).toBe("the-bridge");
    await rpc.close();
  });
});

describe("ACP driver (gemini/cursor/claude-adapter protocol)", () => {
  it("handshakes, registers the lattice MCP server, and forwards prompts", async () => {
    const log = logPath();
    const events: string[] = [];
    const driver = new AcpDriver(
      "gemini",
      { command: NODE, args: [join(FIXTURES, "fake-acp.mjs")], installHint: "fake" },
      false,
    );
    await driver.start({
      cwd: process.cwd(),
      env: { FAKE_LOG: log },
      mcpServers: [
        { name: "lattice", command: "npx", args: ["-y", "lattice-talk", "serve"], env: [] },
      ],
      initialPrompt: "join the bus",
      onEvent: (l) => events.push(l),
    });
    await driver.send("hello agent");
    await driver.close();

    const text = readLog(log);
    expect(text).toContain('"name":"lattice-talk-bridge"');
    expect(text).toContain('"lattice"');
    expect(text).toContain("prompt=join the bus");
    expect(text).toContain("prompt=hello agent");
    expect(events.some((l) => l.includes("ACK:hello agent"))).toBe(true);
  });

  it("auto-approves session/request_permission with the allow option", async () => {
    const log = logPath();
    const driver = new AcpDriver(
      "claude",
      { command: NODE, args: [join(FIXTURES, "fake-acp.mjs")], installHint: "fake" },
      false,
    );
    await driver.start({
      cwd: process.cwd(),
      env: { FAKE_LOG: log },
      mcpServers: [],
      initialPrompt: "init",
    });
    await driver.send("do a need-perm thing");
    await waitUntil(() => readLog(log).includes("permResult="));
    await driver.close();
    expect(readLog(log)).toContain('"optionId":"allow-1"');
  });

  it("fails session setup with a friendly error naming the install hint", async () => {
    const driver = new AcpDriver(
      "gemini",
      {
        command: NODE,
        args: [join(FIXTURES, "fake-acp.mjs")],
        installHint: "requires `gemini` (Gemini CLI) installed and logged in",
      },
      false,
    );
    await expect(
      driver.start({
        cwd: process.cwd(),
        env: { FAKE_LOG: logPath(), FAKE_FAIL_SESSION: "1" },
        mcpServers: [],
        initialPrompt: "init",
      }),
    ).rejects.toThrow(/requires `gemini`/);
    await driver.close();
  });
});

describe("Codex app-server driver", () => {
  it("starts a thread and steers an in-flight turn for later messages", async () => {
    const log = logPath();
    const driver = new CodexDriver(NODE, [join(FIXTURES, "fake-codex.mjs")], false);
    await driver.start({
      cwd: process.cwd(),
      env: { FAKE_LOG: log, CODEX_HOLD_TURN: "1" },
      mcpServers: [],
      initialPrompt: "join the bus",
    });
    // First prompt lands as turn/start; the turn is held open, so the next
    // message must be delivered through turn/steer.
    await driver.send("second message");
    await driver.close();

    const text = readLog(log);
    expect(text).toContain('"name":"lattice-talk-bridge"');
    expect(text).toContain("turn=join the bus");
    expect(text).toContain("steer=second message");
  });

  it("falls back to turn/start when steer reports no in-flight turn", async () => {
    const log = logPath();
    const driver = new CodexDriver(NODE, [join(FIXTURES, "fake-codex.mjs")], false);
    await driver.start({
      cwd: process.cwd(),
      env: { FAKE_LOG: log, CODEX_HOLD_TURN: "1", CODEX_STEER_FAIL: "1" },
      mcpServers: [],
      initialPrompt: "join the bus",
    });
    // Turn is held open → send() tries steer first, which fails → turn/start.
    await driver.send("fallback message");
    await driver.close();
    const text = readLog(log);
    expect(text).toContain("turn=fallback message");
    expect(text).not.toContain("steer=fallback message");
  });
});

class FakeDriver implements HarnessDriver {
  readonly id = "fake";
  sent: string[] = [];
  initialPrompt = "";
  closed = false;
  private onExit?: (code: number | null) => void;
  async start(opts: DriverOpts) {
    this.initialPrompt = opts.initialPrompt;
    this.onExit = opts.onExit;
    this.sent.push(opts.initialPrompt);
  }
  async send(text: string) {
    this.sent.push(text);
  }
  /** Simulate the agent process dying. */
  exit(code = 0) {
    this.onExit?.(code);
  }
  async close() {
    this.closed = true;
  }
}

describe("runBridge pump", () => {
  it("injects room + DM traffic into the session and suppresses echoes", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    const g = makeDeps(store, testConfig());
    const driver = new FakeDriver();
    const ac = new AbortController();
    const logs: string[] = [];

    const bridge = runBridge({
      harness: "gemini",
      conn: { namespace: "test", workspace: "w1" },
      roomId: "main",
      cwd: process.cwd(),
      driver,
      signal: ac.signal,
      store,
      log: (l) => logs.push(l),
    });

    // The join prompt is the first thing injected.
    await waitUntil(() => driver.sent.length > 0);
    expect(driver.initialPrompt).toContain('session_id: "w1"');
    expect(driver.initialPrompt).toContain('room_id "main"');

    // The bridged agent joins reporting its harness — discovery locks on it.
    await joinSession(g, { session_id: "w1", role: "gem", agent_id: "g1", harness: "gemini" });
    await waitUntil(() => logs.some((l) => l.includes("g1")));

    // An unrelated agent joins and talks in the room → injected.
    await joinSession(fe, { session_id: "w1", role: "fe", agent_id: "fe", harness: "claude" });
    await tellRoom(fe, { room_id: "main", body: "room hello" });
    await waitUntil(() => driver.sent.some((s) => s.includes("room hello")));
    const injected = driver.sent.find((s) => s.includes("room hello"))!;
    expect(injected).toContain('[lattice · room "main" · fe]');

    // Echo suppression: the bridged agent's own output is not re-injected.
    const before = driver.sent.length;
    await tellRoom(g, { room_id: "main", body: "my own reply" });
    await sleep(50);
    expect(driver.sent.length).toBe(before);

    // A DM to the bridged agent arrives through its DM channel.
    await tellAgent(fe, { to_agent_id: "g1", body: "dm here" });
    await waitUntil(() => driver.sent.some((s) => s.includes("[lattice · dm · fe] dm here")));

    ac.abort();
    await bridge;
    expect(driver.closed).toBe(true);
  });

  it("does not inject room history written before the bridge started", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    await joinSession(fe, { session_id: "w1", role: "fe", agent_id: "fe" });
    await tellRoom(fe, { room_id: "main", body: "ancient history" });

    const driver = new FakeDriver();
    const ac = new AbortController();
    const bridge = runBridge({
      harness: "gemini",
      conn: { namespace: "test", workspace: "w1" },
      roomId: "main",
      cwd: process.cwd(),
      driver,
      signal: ac.signal,
      store,
    });
    await waitUntil(() => driver.sent.length > 0);
    await sleep(60); // let the post-subscribe sweep run
    expect(driver.sent.every((s) => !s.includes("ancient history"))).toBe(true);

    // New traffic still flows.
    await tellRoom(fe, { room_id: "main", body: "fresh message" });
    await waitUntil(() => driver.sent.some((s) => s.includes("fresh message")));
    ac.abort();
    await bridge;
  });

  it("shuts the bridge down when the agent process exits", async () => {
    const store = new MemoryStore("test");
    const driver = new FakeDriver();
    const logs: string[] = [];
    const bridge = runBridge({
      harness: "codex",
      conn: { namespace: "test", workspace: "w1" },
      roomId: "main",
      cwd: process.cwd(),
      driver,
      store,
      log: (l) => logs.push(l),
    });
    await waitUntil(() => driver.sent.length > 0);
    driver.exit(0);
    await bridge; // resolves on its own — no abort needed
    expect(driver.closed).toBe(true);
    expect(logs.some((l) => l.includes("agent process exited"))).toBe(true);
  });

  it("delivers DMs immediately for a pinned --agent-id (no discovery wait)", async () => {
    const store = new MemoryStore("test");
    const fe = makeDeps(store, testConfig());
    const g = makeDeps(store, testConfig());
    const driver = new FakeDriver();
    const ac = new AbortController();
    const bridge = runBridge({
      harness: "claude",
      conn: { namespace: "test", workspace: "w1" },
      roomId: "main",
      agentId: "g1",
      cwd: process.cwd(),
      driver,
      signal: ac.signal,
      store,
    });
    await waitUntil(() => driver.sent.length > 0);
    await joinSession(g, { session_id: "w1", role: "g", agent_id: "g1", harness: "claude" });
    await joinSession(fe, { session_id: "w1", role: "f", agent_id: "fe" });
    await tellAgent(fe, { to_agent_id: "g1", body: "direct ping" });
    await waitUntil(() => driver.sent.some((s) => s.includes("[lattice · dm · fe] direct ping")));
    ac.abort();
    await bridge;
  });

  it("rejects windsurf with the honest fallback message", async () => {
    await expect(
      runBridge({
        harness: "windsurf",
        conn: { namespace: "test", workspace: "w1" },
        roomId: "main",
        cwd: process.cwd(),
      }),
    ).rejects.toThrow(/no supported programmatic session API/);
  });

  it("rejects unknown harnesses and missing workspace", async () => {
    await expect(
      runBridge({
        harness: "bogus",
        conn: { namespace: "test", workspace: "w1" },
        roomId: "main",
        cwd: process.cwd(),
      }),
    ).rejects.toThrow(/Unknown harness/);
    await expect(
      runBridge({
        harness: "claude",
        conn: { namespace: "test" },
        roomId: "main",
        cwd: process.cwd(),
      }),
    ).rejects.toThrow(/No workspace/);
  });
});

describe("bridge plumbing", () => {
  it("maps harnesses to drivers", () => {
    expect(createDriver("gemini")).toBeInstanceOf(AcpDriver);
    expect(createDriver("cursor")).toBeInstanceOf(AcpDriver);
    expect(createDriver("claude")).toBeInstanceOf(AcpDriver);
    expect(createDriver("codex")).toBeInstanceOf(CodexDriver);
  });

  it("builds a join prompt with the workspace, room, and harness", () => {
    const p = bridgeJoinPrompt({
      workspace: "ws",
      roomId: "backend",
      harness: "gemini",
      suggestedAgentId: "g-1",
      tokenProtected: true,
    });
    expect(p).toContain('"ws"');
    expect(p).toContain('"backend"');
    expect(p).toContain('"g-1"');
    expect(p).toContain("join_session");
    expect(p).toContain("tell_room");
    expect(p).toContain("token-protected");
  });
});
