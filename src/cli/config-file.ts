import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * User-level Lattice config, written by `lattice-talk setup` (the guided TUI)
 * and read by the TUI, `mcp add`, and `serve`. Environment variables always
 * win over file values.
 */
export interface FileConfig {
  redisUrl?: string;
  namespace?: string;
  /** Session id the TUI treats as the workspace (rooms live inside it). */
  workspace?: string;
  joinToken?: string;
}

export interface ResolvedConnection {
  redisUrl?: string;
  namespace: string;
  workspace?: string;
  joinToken?: string;
}

export function configFilePath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.LATTICE_CONFIG_PATH?.trim();
  if (override) return override;
  return join(home, ".lattice", "config.json");
}

export function loadFileConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): { path: string; config: FileConfig; exists: boolean; corrupt: boolean } {
  const path = configFilePath(env, home);
  if (!existsSync(path)) {
    return { path, config: {}, exists: false, corrupt: false };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { path, config: {}, exists: true, corrupt: true };
    }
    const raw = parsed as Record<string, unknown>;
    const config: FileConfig = {};
    if (typeof raw.redisUrl === "string" && raw.redisUrl.trim()) config.redisUrl = raw.redisUrl.trim();
    if (typeof raw.namespace === "string" && raw.namespace.trim()) config.namespace = raw.namespace.trim();
    if (typeof raw.workspace === "string" && raw.workspace.trim()) config.workspace = raw.workspace.trim();
    if (typeof raw.joinToken === "string" && raw.joinToken.trim()) config.joinToken = raw.joinToken.trim();
    return { path, config, exists: true, corrupt: false };
  } catch {
    return { path, config: {}, exists: true, corrupt: true };
  }
}

export function saveFileConfig(
  config: FileConfig,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const path = configFilePath(env, home);
  mkdirSync(dirname(path), { recursive: true });
  const clean: Record<string, string> = {};
  if (config.redisUrl?.trim()) clean.redisUrl = config.redisUrl.trim();
  if (config.namespace?.trim()) clean.namespace = config.namespace.trim();
  if (config.workspace?.trim()) clean.workspace = config.workspace.trim();
  if (config.joinToken?.trim()) clean.joinToken = config.joinToken.trim();
  writeFileSync(path, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/** Merge order: environment variables > config file > built-in defaults. */
export function resolveConnection(
  file: FileConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConnection {
  return {
    redisUrl: env.LATTICE_REDIS_URL?.trim() || env.REDIS_URL?.trim() || file.redisUrl,
    namespace: env.LATTICE_NAMESPACE?.trim() || file.namespace || "dev",
    workspace: env.LATTICE_DEFAULT_SESSION_ID?.trim() || file.workspace,
    joinToken: env.LATTICE_JOIN_TOKEN?.trim() || file.joinToken,
  };
}

/**
 * Project a resolved connection back into env-var shape, for `serve` (which
 * runs loadConfig on the merged env) and for harness MCP configs.
 */
export function connectionToEnv(conn: ResolvedConnection): Record<string, string> {
  const env: Record<string, string> = { LATTICE_STORE: "redis" };
  if (conn.redisUrl) env.LATTICE_REDIS_URL = conn.redisUrl;
  if (conn.namespace) env.LATTICE_NAMESPACE = conn.namespace;
  if (conn.workspace) env.LATTICE_DEFAULT_SESSION_ID = conn.workspace;
  if (conn.joinToken) env.LATTICE_JOIN_TOKEN = conn.joinToken;
  return env;
}

/**
 * Environment values that should follow the user into a harness-launched MCP
 * process. This keeps credentials and operational settings consistent without
 * copying CLI-only variables such as LATTICE_CONFIG_PATH or LATTICE_TUI_RUNTIME.
 */
const HARNESS_ENV_KEYS = [
  "REDIS_HOST",
  "REDIS_PORT",
  "REDIS_USERNAME",
  "REDIS_PASSWORD",
  "REDIS_DB",
  "REDIS_SSL",
  "LATTICE_PRESENCE_TTL",
  "LATTICE_STREAM_MAXLEN",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_SERVICE_NAME",
] as const;

export function connectionToHarnessEnv(
  conn: ResolvedConnection,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env = connectionToEnv(conn);
  for (const key of HARNESS_ENV_KEYS) {
    const value = source[key]?.trim();
    if (value) env[key] = value;
  }
  return env;
}

/** Merged env for `serve`: file-derived defaults, real env overrides. */
export function envWithFileDefaults(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { config } = loadFileConfig(env);
  const conn = resolveConnection(config, env);
  return { ...connectionToEnv(conn), ...env };
}
