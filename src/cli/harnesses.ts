import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Harness MCP-config installers. Every harness ends up with an entry named
 * `lattice` that runs `npx -y lattice-talk serve` with the resolved bus env.
 * Writes are read-modify-write merges so existing user config is preserved.
 */

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface HarnessSpec {
  id: string;
  label: string;
  kind: "json" | "codex-toml";
  configPath(home: string): string;
}

export const HARNESSES: HarnessSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    kind: "json",
    configPath: (home) => join(home, ".claude.json"),
  },
  {
    id: "codex",
    label: "Codex",
    kind: "codex-toml",
    configPath: (home) => join(home, ".codex", "config.toml"),
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    kind: "json",
    configPath: (home) => join(home, ".gemini", "settings.json"),
  },
  {
    id: "cursor",
    label: "Cursor",
    kind: "json",
    configPath: (home) => join(home, ".cursor", "mcp.json"),
  },
  {
    id: "windsurf",
    label: "Windsurf",
    kind: "json",
    configPath: (home) => join(home, ".codeium", "windsurf", "mcp_config.json"),
  },
];

export const LATTICE_SERVER_NAME = "lattice";

export function findHarness(id: string): HarnessSpec | undefined {
  const needle = id.trim().toLowerCase();
  return HARNESSES.find(
    (h) => h.id === needle || h.label.toLowerCase().replace(/\s+/g, "-") === needle,
  );
}

export function resolveHarnesses(ids: string[]): { specs: HarnessSpec[]; unknown: string[] } {
  if (ids.some((i) => i.trim().toLowerCase() === "all")) {
    return { specs: [...HARNESSES], unknown: [] };
  }
  const specs: HarnessSpec[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const spec = findHarness(id);
    if (spec) specs.push(spec);
    else unknown.push(id);
  }
  return { specs, unknown };
}

/**
 * The MCP server entry written into a harness config.
 *
 * npm exposes `npx.cmd` on Windows. Harnesses generally spawn commands
 * directly rather than through a shell, so using `npx` there is not portable.
 */
export function mcpEntry(
  env: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): McpServerEntry {
  return {
    command: platform === "win32" ? "npx.cmd" : "npx",
    args: ["-y", "lattice-talk", "serve"],
    env,
  };
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object; not modifying it.`);
  }
  return parsed as Record<string, unknown>;
}

function installJson(path: string, entry: McpServerEntry, remove: boolean): void {
  const root = readJsonObject(path);
  const servers =
    root.mcpServers && typeof root.mcpServers === "object" && !Array.isArray(root.mcpServers)
      ? { ...(root.mcpServers as Record<string, unknown>) }
      : {};
  if (remove) {
    delete servers[LATTICE_SERVER_NAME];
  } else {
    servers[LATTICE_SERVER_NAME] = entry;
  }
  root.mcpServers = servers;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(root, null, 2)}\n`);
}

const CODEX_LATTICE_SECTION = /^\[mcp_servers\.lattice(\.[^\]]*)?\]\s*$/;
const TOML_SECTION = /^\[/;

function installCodexToml(path: string, entry: McpServerEntry, remove: boolean): void {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (TOML_SECTION.test(line.trim())) {
      skipping = CODEX_LATTICE_SECTION.test(line.trim());
    }
    if (!skipping) kept.push(line);
  }
  let out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (!remove) {
    const envLines = Object.entries(entry.env)
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n");
    const block = [
      "",
      "[mcp_servers.lattice]",
      `command = ${JSON.stringify(entry.command)}`,
      `args = [${entry.args.map((a) => JSON.stringify(a)).join(", ")}]`,
      "",
      "[mcp_servers.lattice.env]",
      envLines,
      "",
    ].join("\n");
    out = out ? `${out}\n${block}` : block.trimStart();
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out.endsWith("\n") ? out : `${out}\n`);
}

export interface InstallResult {
  harness: HarnessSpec;
  path: string;
  action: "installed" | "updated" | "removed" | "absent";
}

export function isInstalled(spec: HarnessSpec, home = homedir()): boolean {
  const path = spec.configPath(home);
  if (!existsSync(path)) return false;
  try {
    if (spec.kind === "json") {
      const root = readJsonObject(path);
      const servers = root.mcpServers as Record<string, unknown> | undefined;
      return Boolean(servers && servers[LATTICE_SERVER_NAME]);
    }
    return readFileSync(path, "utf8")
      .split("\n")
      .some((l) => CODEX_LATTICE_SECTION.test(l.trim()));
  } catch {
    return false;
  }
}

export function installHarness(
  spec: HarnessSpec,
  entry: McpServerEntry,
  home = homedir(),
): InstallResult {
  const path = spec.configPath(home);
  const existed = isInstalled(spec, home);
  if (spec.kind === "json") installJson(path, entry, false);
  else installCodexToml(path, entry, false);
  return { harness: spec, path, action: existed ? "updated" : "installed" };
}

export function removeHarness(spec: HarnessSpec, home = homedir()): InstallResult {
  const path = spec.configPath(home);
  // Leave files that don't mention lattice untouched.
  if (!isInstalled(spec, home)) return { harness: spec, path, action: "absent" };
  if (spec.kind === "json") installJson(path, mcpEntry({}), true);
  else installCodexToml(path, mcpEntry({}), true);
  return { harness: spec, path, action: "removed" };
}
