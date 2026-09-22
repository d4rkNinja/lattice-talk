import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configFilePath,
  connectionToEnv,
  connectionToHarnessEnv,
  envWithFileDefaults,
  loadFileConfig,
  resolveConnection,
  saveFileConfig,
} from "../src/cli/config-file.js";
import {
  HARNESSES,
  findHarness,
  installHarness,
  isInstalled,
  mcpEntry,
  removeHarness,
  resolveHarnesses,
} from "../src/cli/harnesses.js";
import { agentJoinPrompt } from "../src/cli/prompt.js";
import { compareVersions, selfInstaller } from "../src/cli/update.js";
import {
  commandInvoke,
  installJoinCommands,
  joinCommandInstalled,
  refreshJoinCommands,
  removeJoinCommands,
} from "../src/cli/commands.js";
import { MemoryStore } from "../src/core/memory-store.js";
import { tellRoom } from "../src/core/messages.js";
import { createRoom, joinRoom } from "../src/core/rooms.js";
import { ensureWorkspaceSession, joinSession } from "../src/core/session.js";
import { makeDeps, testConfig } from "./helpers.js";

const tmpDirs: string[] = [];
function tmpHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "lattice-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe("config file", () => {
  it("round-trips values under ~/.lattice/config.json with 0600", () => {
    const home = tmpHome();
    const env: NodeJS.ProcessEnv = {};
    const path = saveFileConfig(
      {
        redisUrl: "redis://h:6379/0",
        namespace: "prod",
        workspace: "alpha",
        joinToken: "tok",
      },
      env,
      home,
    );
    expect(path).toBe(join(home, ".lattice", "config.json"));
    const { config, exists, corrupt } = loadFileConfig(env, home);
    expect(exists).toBe(true);
    expect(corrupt).toBe(false);
    expect(config).toEqual({
      redisUrl: "redis://h:6379/0",
      namespace: "prod",
      workspace: "alpha",
      joinToken: "tok",
    });
  });

  it("honours LATTICE_CONFIG_PATH override", () => {
    const home = tmpHome();
    const env = { LATTICE_CONFIG_PATH: join(home, "custom.json") };
    expect(configFilePath(env, home)).toBe(join(home, "custom.json"));
  });

  it("flags corrupt JSON instead of throwing", () => {
    const home = tmpHome();
    const path = configFilePath({}, home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json", "utf8");
    const res = loadFileConfig({}, home);
    expect(res.exists).toBe(true);
    expect(res.corrupt).toBe(true);
    expect(res.config).toEqual({});
  });

  it("resolveConnection: env beats file beats defaults", () => {
    const file = { redisUrl: "redis://file:1/0", namespace: "filens", workspace: "ws" };
    expect(resolveConnection(file, {})).toMatchObject({
      redisUrl: "redis://file:1/0",
      namespace: "filens",
      workspace: "ws",
    });
    expect(
      resolveConnection(file, { LATTICE_REDIS_URL: "redis://env:2/0" }),
    ).toMatchObject({ redisUrl: "redis://env:2/0", namespace: "filens" });
    expect(resolveConnection({}, {}).namespace).toBe("dev");
  });

  it("connectionToEnv projects the connection back to env shape", () => {
    const connection = {
      redisUrl: "redis://x/0",
      namespace: "n",
      workspace: "w",
      joinToken: "t",
    };
    expect(connectionToEnv(connection)).toEqual({
      LATTICE_STORE: "redis",
      LATTICE_REDIS_URL: "redis://x/0",
      LATTICE_NAMESPACE: "n",
      LATTICE_DEFAULT_SESSION_ID: "w",
      LATTICE_JOIN_TOKEN: "t",
    });
    expect(
      connectionToHarnessEnv(connection, {
        REDIS_HOST: "redis.internal",
        REDIS_PASSWORD: "secret",
        LATTICE_STREAM_MAXLEN: "5000",
        OTEL_SERVICE_NAME: "agent-bus",
        LATTICE_CONFIG_PATH: "must-not-be-copied",
      }),
    ).toEqual({
      LATTICE_STORE: "redis",
      LATTICE_REDIS_URL: "redis://x/0",
      LATTICE_NAMESPACE: "n",
      LATTICE_DEFAULT_SESSION_ID: "w",
      LATTICE_JOIN_TOKEN: "t",
      REDIS_HOST: "redis.internal",
      REDIS_PASSWORD: "secret",
      LATTICE_STREAM_MAXLEN: "5000",
      OTEL_SERVICE_NAME: "agent-bus",
    });
  });

  it("envWithFileDefaults fills gaps from the file, env still wins", () => {
    const home = tmpHome();
    saveFileConfig({ redisUrl: "redis://file:1/0", workspace: "w" }, {}, home);
    try {
      const merged = envWithFileDefaults({
        LATTICE_CONFIG_PATH: configFilePath({}, home),
        LATTICE_NAMESPACE: "envns",
      });
      expect(merged.LATTICE_REDIS_URL).toBe("redis://file:1/0");
      expect(merged.LATTICE_NAMESPACE).toBe("envns");
      expect(merged.LATTICE_DEFAULT_SESSION_ID).toBe("w");
    } finally {
      // nothing to restore — env was passed explicitly
    }
  });
});

describe("harness installers", () => {
  it("resolves ids, labels, and 'all'", () => {
    expect(findHarness("claude")?.id).toBe("claude");
    expect(findHarness("Claude-Code")?.id).toBe("claude");
    expect(resolveHarnesses(["bogus"]).unknown).toEqual(["bogus"]);
    expect(resolveHarnesses(["all"]).specs).toHaveLength(HARNESSES.length);
  });

  it("uses the correct npx executable for each operating system", () => {
    // Pass a script path outside node_modules/lattice-talk to force the npx path.
    expect(mcpEntry({}, "win32", "x").command).toBe("npx.cmd");
    expect(mcpEntry({}, "darwin", "x").command).toBe("npx");
    expect(mcpEntry({}, "linux", "x").command).toBe("npx");
  });

  it("points harnesses at a global install, else npx @latest", () => {
    // A globally installed copy: harnesses spawn the real entrypoint so a
    // global update reaches them without rewriting configs.
    const global = mcpEntry({}, "win32", "C:\\npm\\node_modules\\lattice-talk\\dist\\index.js");
    expect(global.command).toBe(process.execPath);
    expect(global.args).toEqual([
      "C:\\npm\\node_modules\\lattice-talk\\dist\\index.js",
      "serve",
    ]);
    // Anything else (npx cache, repo checkout, missing argv) → npx @latest so
    // the tag re-resolves instead of pinning a stale cached copy.
    for (const script of [
      "C:\\Users\\u\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\lattice-talk\\dist\\index.js",
      "/home/u/repo/dist/index.js",
      undefined,
    ]) {
      const e = mcpEntry({}, "linux", script);
      expect(e.args).toEqual(["-y", "lattice-talk@latest", "serve"]);
    }
  });

  it("installs into a JSON harness without clobbering existing config", () => {
    const home = tmpHome();
    const claude = findHarness("claude")!;
    const path = claude.configPath(home);
    writeFileSync(path, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }));
    const res = installHarness(claude, mcpEntry({ LATTICE_REDIS_URL: "redis://h/0" }), home);
    expect(res.action).toBe("installed");
    const root = JSON.parse(readFileSync(path, "utf8")) as {
      theme: string;
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(root.theme).toBe("dark");
    expect(root.mcpServers.other.command).toBe("x");
    expect(root.mcpServers.lattice.command).toBe(
      process.platform === "win32" ? "npx.cmd" : "npx",
    );
    expect(root.mcpServers.lattice.args).toEqual(["-y", "lattice-talk@latest", "serve"]);
    expect(isInstalled(claude, home)).toBe(true);
    expect(installHarness(claude, mcpEntry({}), home).action).toBe("updated");
    expect(removeHarness(claude, home).action).toBe("removed");
    expect(isInstalled(claude, home)).toBe(false);
    expect(removeHarness(claude, home).action).toBe("absent");
  });

  it("installs and removes the codex TOML section, keeping other tables", () => {
    const home = tmpHome();
    const codex = findHarness("codex")!;
    const path = codex.configPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "x"\n',
    );
    installHarness(codex, mcpEntry({ LATTICE_REDIS_URL: "redis://h/0" }), home);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain("[mcp_servers.other]");
    expect(text).toContain("[mcp_servers.lattice]");
    expect(text).toContain('LATTICE_REDIS_URL = "redis://h/0"');
    expect(isInstalled(codex, home)).toBe(true);
    removeHarness(codex, home);
    const after = readFileSync(path, "utf8");
    expect(after).not.toContain("mcp_servers.lattice");
    expect(after).toContain("[mcp_servers.other]");
  });

  it("installs grok into ~/.grok/config.toml with the same TOML shape", () => {
    const home = tmpHome();
    const grok = findHarness("grok")!;
    const path = grok.configPath(home);
    expect(path).toBe(join(home, ".grok", "config.toml"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '[models]\ndefault = "grok-build"\n');
    installHarness(grok, mcpEntry({ LATTICE_REDIS_URL: "redis://h/0" }), home);
    const text = readFileSync(path, "utf8");
    expect(text).toContain('[models]');
    expect(text).toContain("[mcp_servers.lattice]");
    expect(text).toContain('LATTICE_REDIS_URL = "redis://h/0"');
    expect(isInstalled(grok, home)).toBe(true);
    removeHarness(grok, home);
    expect(readFileSync(path, "utf8")).not.toContain("mcp_servers.lattice");
  });
});

describe("agent join prompt", () => {
  it("names the workspace and room without leaking secrets", () => {
    const p = agentJoinPrompt({
      workspace: "alpha",
      roomId: "design",
      tokenProtected: true,
    });
    expect(p).toContain('"alpha"');
    expect(p).toContain('"design"');
    expect(p).toContain("join_session");
    expect(p).toContain("join_room");
    expect(p).toContain("LATTICE_JOIN_TOKEN");
    expect(p).not.toContain("redis://");
    // Ready-to-paste: no <placeholder> tokens the user would have to edit.
    expect(p).not.toMatch(/<[a-z -]+>/i);
    expect(p).not.toContain("agent_id:");
  });

  it("defaults to room main and needs no edits without a room", () => {
    const p = agentJoinPrompt({ workspace: "alpha" });
    expect(p).toContain('"main"');
    expect(p).toContain("join_room");
    expect(p).not.toMatch(/<[a-z -]+>/i);
  });
});

describe("join commands (/l-talk-new)", () => {
  const prompt = agentJoinPrompt({ workspace: "ws-1", roomId: "main" });

  it("claude gets a frontmatter markdown command", () => {
    const home = tmpHome();
    const claude = findHarness("claude")!;
    const written = installJoinCommands(claude, prompt, home);
    expect(written).toEqual([join(home, ".claude", "commands", "l-talk-new.md")]);
    const text = readFileSync(written[0]!, "utf8");
    expect(text).toContain("description:");
    expect(text).toContain('session_id "ws-1"');
    expect(text).toContain("join_room");
    expect(commandInvoke(claude)).toBe("/l-talk-new");
    expect(joinCommandInstalled(claude, home)).toBe(true);
    removeJoinCommands(claude, home);
    expect(joinCommandInstalled(claude, home)).toBe(false);
  });

  it("codex covers prompts (old) and both skill roots (new)", () => {
    const home = tmpHome();
    const codex = findHarness("codex")!;
    const written = installJoinCommands(codex, prompt, home);
    expect(written).toEqual([
      join(home, ".codex", "prompts", "l-talk-new.md"),
      join(home, ".codex", "skills", "l-talk-new", "SKILL.md"),
      join(home, ".agents", "skills", "l-talk-new", "SKILL.md"),
    ]);
    const skillText = readFileSync(written[1]!, "utf8");
    expect(skillText).toContain("name: l-talk-new");
    expect(skillText).toContain('session_id "ws-1"');
    removeJoinCommands(codex, home);
    // Skill directories are removed wholesale, not just the file.
    expect(existsSync(join(home, ".codex", "skills", "l-talk-new"))).toBe(false);
    expect(existsSync(join(home, ".agents", "skills", "l-talk-new"))).toBe(false);
  });

  it("gemini writes a TOML command with the prompt body", () => {
    const home = tmpHome();
    const gemini = findHarness("gemini")!;
    const [path] = installJoinCommands(gemini, prompt, home);
    expect(path).toBe(join(home, ".gemini", "commands", "l-talk-new.toml"));
    const text = readFileSync(path!, "utf8");
    expect(text).toContain("description =");
    expect(text).toContain("prompt =");
    expect(text).toContain('session_id "ws-1"');
  });

  it("cursor writes a plain command plus a slash-only skill", () => {
    const home = tmpHome();
    const cursor = findHarness("cursor")!;
    const written = installJoinCommands(cursor, prompt, home);
    expect(written).toHaveLength(2);
    expect(readFileSync(written[0]!, "utf8")).toContain('session_id "ws-1"');
    const skillText = readFileSync(written[1]!, "utf8");
    expect(skillText).toContain("disable-model-invocation: true");
  });

  it("grok writes a user-invocable skill plus the shared commands dir", () => {
    const home = tmpHome();
    const grok = findHarness("grok")!;
    const written = installJoinCommands(grok, prompt, home);
    expect(written).toEqual([
      join(home, ".grok", "skills", "l-talk-new", "SKILL.md"),
      join(home, ".agents", "commands", "l-talk-new.md"),
    ]);
    const skillText = readFileSync(written[0]!, "utf8");
    expect(skillText).toContain("name: l-talk-new");
    expect(skillText).toContain("user-invocable: true");
    expect(skillText).toContain("disable-model-invocation: true");
    expect(skillText).toContain('session_id "ws-1"');
    expect(commandInvoke(grok)).toBe("/l-talk-new");
    removeJoinCommands(grok, home);
    expect(existsSync(join(home, ".grok", "skills", "l-talk-new"))).toBe(false);
    expect(existsSync(join(home, ".agents", "commands", "l-talk-new.md"))).toBe(false);
  });

  it("windsurf writes a global workflow", () => {
    const home = tmpHome();
    const windsurf = findHarness("windsurf")!;
    const [path] = installJoinCommands(windsurf, prompt, home);
    expect(path).toBe(
      join(home, ".codeium", "windsurf", "global_workflows", "l-talk-new.md"),
    );
    expect(commandInvoke(windsurf)).toBe("/l-talk-new");
  });

  it("refreshJoinCommands rewrites only already-installed files", () => {
    const home = tmpHome();
    const claude = findHarness("claude")!;
    installJoinCommands(claude, prompt, home);
    const updated = refreshJoinCommands(
      agentJoinPrompt({ workspace: "ws-2", roomId: "main" }),
      home,
    );
    expect(updated).toHaveLength(1);
    expect(readFileSync(updated[0]!, "utf8")).toContain('"ws-2"');
    // Harnesses without an installed command get nothing.
    const codex = findHarness("codex")!;
    expect(joinCommandInstalled(codex, home)).toBe(false);
    expect(existsSync(join(home, ".codex", "prompts", "l-talk-new.md"))).toBe(false);
  });
});

describe("self-update helpers", () => {
  it("compareVersions orders numeric releases", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.10", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.1.10", "0.1.10")).toBe(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
  });

  it("compareVersions treats prereleases as older than the same release", () => {
    expect(compareVersions("0.2.0-beta.1", "0.2.0")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0-beta.1")).toBeGreaterThan(0);
  });

  it("selfInstaller targets the package's latest tag", () => {
    const { cmd, args } = selfInstaller("some-pkg");
    expect(args.join(" ")).toContain("some-pkg@latest");
    expect(cmd.length).toBeGreaterThan(0);
  });
});

describe("ensureWorkspaceSession + store additions", () => {
  it("creates the session + main room and reports an open policy", async () => {
    const store = new MemoryStore("test");
    const deps = makeDeps(store);
    const res = await ensureWorkspaceSession(deps, "ws1");
    expect(res.created).toBe(true);
    expect(res.join_policy).toBe("open");
    expect(await store.listSessions()).toEqual(["ws1"]);
    expect(await store.listRooms("ws1")).toEqual(["main"]);
    // second call is idempotent
    const again = await ensureWorkspaceSession(deps, "ws1");
    expect(again.created).toBe(false);
  });

  it("reports the token policy on the freshly created session", async () => {
    const store = new MemoryStore("test");
    const deps = makeDeps(store, testConfig({ LATTICE_JOIN_TOKEN: "sekrit" }));
    const res = await ensureWorkspaceSession(deps, "locked");
    expect(res.created).toBe(true);
    expect(res.join_policy).toBe("token");
    // a tokenless observer is refused
    const other = makeDeps(store);
    await expect(ensureWorkspaceSession(other, "locked")).rejects.toThrow(
      /token-protected/,
    );
  });

  it("deleteRoom drops meta, members, stream and cursors", async () => {
    const store = new MemoryStore("test");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s", role: "fe", agent_id: "a" });
    await joinSession(b, { session_id: "s", role: "be", agent_id: "b" });
    await createRoom(a, { room_id: "tmp" });
    await joinRoom(b, { room_id: "tmp" });
    await tellRoom(a, { room_id: "tmp", body: "hi" });
    await store.deleteRoom("s", "tmp");
    expect(await store.listRooms("s")).toEqual(["main"]);
    expect(await store.getRoomMeta("s", "tmp")).toBeNull();
    expect(await store.listRoomMembers("s", "tmp")).toEqual([]);
    await expect(joinRoom(b, { room_id: "tmp" })).rejects.toThrow(/does not exist/);
  });

  it("deleteRoom does not wipe DM cursors that end with the room id", async () => {
    const store = new MemoryStore("test");
    const a = makeDeps(store);
    const b = makeDeps(store);
    await joinSession(a, { session_id: "s", role: "fe", agent_id: "a" });
    await joinSession(b, { session_id: "s", role: "be", agent_id: "b" });
    // b reads a DM → cursor "inbox:a" + stream cursor "dm:a:b" … and a room
    // named "b" (a room id equal to an agent id must not eat those cursors).
    const { tellAgent, pullMessages } = await import("../src/core/messages.js");
    await tellAgent(a, { to_agent_id: "b", body: "hi" });
    const first = await pullMessages(b, { inbox: true });
    expect(first.messages).toHaveLength(1);
    await createRoom(a, { room_id: "b" });
    await store.deleteRoom("s", "b");
    await tellAgent(a, { to_agent_id: "b", body: "second" });
    const second = await pullMessages(b, { inbox: true });
    // If the DM cursors were wiped, "hi" would be redelivered here.
    expect(second.messages.map((m) => m.body)).toEqual(["second"]);
  });
});
