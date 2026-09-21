import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  connectionToHarnessEnv,
  envWithFileDefaults,
  loadFileConfig,
  resolveConnection,
} from "./cli/config-file.js";
import {
  HARNESSES,
  installHarness,
  isInstalled,
  mcpEntry,
  removeHarness,
  resolveHarnesses,
} from "./cli/harnesses.js";
import { startServer } from "./mcp/server.js";
import { PACKAGE_VERSION } from "./version.js";

const out = (s: string) => process.stdout.write(`${s}\n`);
const err = (s: string) => process.stderr.write(`${s}\n`);

const HELP = `lattice-talk ${PACKAGE_VERSION} — cross-harness MCP session bus

Usage:
  lattice-talk                 Open the TUI (rooms, live agent chatter)
  lattice-talk tui             Same as above
  lattice-talk serve           Run the MCP stdio server (used by harnesses)
  lattice-talk setup           Guided setup: Redis URL, namespace, workspace, token
  lattice-talk add             Alias for setup
  lattice-talk mcp list        Show harness install status
  lattice-talk mcp add <h>...  Install into harnesses (claude codex gemini cursor windsurf | all)
  lattice-talk mcp remove <h>… Remove from harnesses
  lattice-talk --version       Print version
  lattice-talk --help          This help

The TUI and setup screens need Bun (bun.sh) or Node >= 26.4 — the MCP server
itself runs on plain Node >= 20.`;

function printHelp(): void {
  out(HELP);
}

/** Path to the bundled TUI entry produced by tsup (entry src/tui/main.ts). */
function tuiEntryPath(): string {
  return fileURLToPath(new URL("./tui/main.js", import.meta.url));
}

interface TuiRuntime {
  cmd: string;
  preArgs: string[];
}

function bunOnPath(): string | undefined {
  const probe = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return probe.status === 0 ? "bun" : undefined;
}

function nodeVersionAtLeast(major: number, minor: number): boolean {
  const [maj = 0, min = 0] = process.versions.node.split(".").map((n) => Number(n));
  return maj > major || (maj === major && min >= minor);
}

/**
 * OpenTUI's native renderer needs Bun or Node >= 26.4 (--experimental-ffi).
 * The TUI always runs as a child process so `serve` stays pure Node and the
 * renderer never shares a process with the JSON-RPC stdio stream.
 */
function resolveTuiRuntime(env: NodeJS.ProcessEnv = process.env): TuiRuntime | undefined {
  const override = env.LATTICE_TUI_RUNTIME?.trim();
  if (override) return { cmd: override, preArgs: [] };
  if (process.versions.bun) return { cmd: process.execPath, preArgs: [] };
  const bun = bunOnPath();
  if (bun) return { cmd: bun, preArgs: [] };
  if (nodeVersionAtLeast(26, 4)) {
    return { cmd: process.execPath, preArgs: ["--experimental-ffi"] };
  }
  return undefined;
}

async function runTui(tuiArgs: string[]): Promise<number> {
  const runtime = resolveTuiRuntime();
  if (!runtime) {
    err(
      [
        "The lattice-talk TUI needs Bun or Node >= 26.4.",
        "  - Install Bun: https://bun.sh  then run `bunx lattice-talk`",
        "  - Or upgrade Node and retry `npx lattice-talk`",
        "The MCP server (`lattice-talk serve`) works on plain Node >= 20.",
      ].join("\n"),
    );
    return 1;
  }
  const child = spawn(runtime.cmd, [...runtime.preArgs, tuiEntryPath(), ...tuiArgs], {
    stdio: "inherit",
    env: process.env,
  });
  return new Promise((resolve) => {
    child.on("error", (e) => {
      err(`Failed to start TUI runtime (${runtime.cmd}): ${e.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

function printMcpStatus(): void {
  const rows = HARNESSES.map((h) => {
    const path = h.configPath(homedir());
    const installed = isInstalled(h);
    const exists = existsSync(path);
    const state = installed ? "installed" : exists ? "config found, lattice not added" : "no config yet";
    return { id: h.id, label: h.label, path, state };
  });
  out("lattice-talk MCP install status\n");
  const idW = Math.max(...rows.map((r) => r.id.length));
  const labelW = Math.max(...rows.map((r) => r.label.length));
  for (const r of rows) {
    out(`  ${r.id.padEnd(idW)}  ${r.label.padEnd(labelW)}  ${r.state}`);
    out(`  ${" ".repeat(idW)}  ${" ".repeat(labelW)}  ${r.path}`);
  }
  out("\nInstall: lattice-talk mcp add <harness|all>");
}

async function mcpCommand(rest: string[]): Promise<number> {
  const sub = rest[0];
  if (!sub || sub === "list" || sub === "ls") {
    printMcpStatus();
    return 0;
  }
  if (sub !== "add" && sub !== "remove" && sub !== "rm") {
    err(`Unknown mcp subcommand: ${sub}`);
    printHelp();
    return 1;
  }
  const ids = rest.slice(1);
  if (ids.length === 0) {
    err(`mcp ${sub} needs at least one harness name (or "all").`);
    return 1;
  }
  const { specs, unknown } = resolveHarnesses(ids);
  if (unknown.length > 0) {
    err(`Unknown harness(es): ${unknown.join(", ")}. Known: ${HARNESSES.map((h) => h.id).join(", ")}, all.`);
    return 1;
  }

  if (sub === "remove" || sub === "rm") {
    for (const spec of specs) {
      const res = removeHarness(spec);
      out(res.action === "absent" ? `  ${spec.id}: nothing to remove` : `  ${spec.id}: removed (${res.path})`);
    }
    return 0;
  }

  const { config } = loadFileConfig();
  const conn = resolveConnection(config);
  if (!conn.redisUrl && !process.env.REDIS_HOST) {
    err(
      "No Redis configured yet. Run `lattice-talk setup` first (or set LATTICE_REDIS_URL), then `mcp add`.",
    );
    return 1;
  }
  const env = connectionToHarnessEnv(conn);
  const entry = mcpEntry(env);
  let failures = 0;
  for (const spec of specs) {
    try {
      const res = installHarness(spec, entry);
      out(`  ${spec.id}: ${res.action} → ${res.path}`);
    } catch (e) {
      failures += 1;
      err(`  ${spec.id}: failed — ${e instanceof Error ? e.message : e}`);
    }
  }
  if (failures > 0) {
    err(`\n${failures} harness installation${failures === 1 ? "" : "s"} failed.`);
    return 1;
  }
  out("\nRestart the harness to pick up the `lattice` MCP server.");
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
      // MCP clients spawn the command over pipes; a TTY means a human ran it.
      // Bare `lattice-talk` in a terminal opens the TUI; bare `lattice-talk`
      // spawned by a harness (or piped) runs the MCP server, keeping older
      // configs that point straight at the entrypoint working.
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        await startServer(envWithFileDefaults());
        return 0;
      }
      return runTui(rest);
    case "tui":
    case "ui":
      return runTui(rest);
    case "serve":
    case "server":
      await startServer(envWithFileDefaults());
      return 0;
    case "setup":
    case "add":
    case "config":
      return runTui(["--setup"]);
    case "mcp":
      return mcpCommand(rest);
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    case "version":
    case "--version":
    case "-v":
      out(PACKAGE_VERSION);
      return 0;
    default:
      err(`Unknown command: ${cmd}\n`);
      printHelp();
      return 1;
  }
}
