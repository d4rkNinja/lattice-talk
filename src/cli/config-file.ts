import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * User-level Lattice config, written by `lattice-talk setup` (the guided TUI)
 * and read by the TUI, `mcp add`, and `serve`. Environment variables always
 * win over file values.
 *
 * The file can hold several named connection profiles ("personal", "office",
 * …). The flat fields always mirror the *active* profile, so consumers that
 * predate profiles — and env-var overrides — keep working unchanged. See
 * cli/connections.ts for the profile operations.
 */
export interface ConnectionProfile {
  redisUrl?: string;
  namespace?: string;
  /** Session id the TUI treats as the workspace (rooms live inside it). */
  workspace?: string;
  joinToken?: string;
  /** Optional SSH bastion for reaching Redis. */
  sshHost?: string;
  sshPort?: string;
  sshUser?: string;
  sshKey?: string;
  sshLocalPort?: string;
}

export interface FileConfig extends ConnectionProfile {
  /** Name of the profile the flat fields currently mirror. */
  active?: string;
  profiles?: Record<string, ConnectionProfile>;
}

export interface ResolvedConnection extends ConnectionProfile {
  namespace: string;
}

const FLAT_KEYS = [
  "redisUrl",
  "namespace",
  "workspace",
  "joinToken",
  "sshHost",
  "sshPort",
  "sshUser",
  "sshKey",
  "sshLocalPort",
] as const;

export function configFilePath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.LATTICE_CONFIG_PATH?.trim();
  if (override) return override;
  return join(home, ".lattice", "config.json");
}

function cleanProfile(raw: unknown): ConnectionProfile | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const rec = raw as Record<string, unknown>;
  const out: ConnectionProfile = {};
  let any = false;
  for (const key of FLAT_KEYS) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) {
      (out as Record<string, string>)[key] = value.trim();
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Raw config object — preserves keys this version doesn't know about. */
function readRawConfig(path: string): { raw: Record<string, unknown>; corrupt: boolean } {
  if (!existsSync(path)) return { raw: {}, corrupt: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { raw: {}, corrupt: true };
    }
    return { raw: parsed as Record<string, unknown>, corrupt: false };
  } catch {
    return { raw: {}, corrupt: true };
  }
}

export function loadFileConfig(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): { path: string; config: FileConfig; exists: boolean; corrupt: boolean } {
  const path = configFilePath(env, home);
  if (!existsSync(path)) {
    return { path, config: {}, exists: false, corrupt: false };
  }
  const { raw, corrupt } = readRawConfig(path);
  if (corrupt) return { path, config: {}, exists: true, corrupt: true };

  const config: FileConfig = { ...(cleanProfile(raw) ?? {}) };
  if (typeof raw.active === "string" && raw.active.trim()) config.active = raw.active.trim();
  if (raw.profiles && typeof raw.profiles === "object" && !Array.isArray(raw.profiles)) {
    const profiles: Record<string, ConnectionProfile> = {};
    for (const [name, p] of Object.entries(raw.profiles as Record<string, unknown>)) {
      const clean = cleanProfile(p);
      if (clean) profiles[name] = clean;
    }
    if (Object.keys(profiles).length > 0) config.profiles = profiles;
  }
  return { path, config, exists: true, corrupt: false };
}

/**
 * Save the flat connection fields. `profiles`/`active` and any unknown keys in
 * the existing file are preserved unless the passed config carries them —
 * callers that only touch the active connection (setup screen, workspace
 * switch) must never wipe the saved profile list.
 */
export function saveFileConfig(
  config: FileConfig,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const path = configFilePath(env, home);
  const { raw } = readRawConfig(path);
  const merged: Record<string, unknown> = { ...raw };
  for (const key of FLAT_KEYS) {
    const value = config[key]?.trim();
    if (value) merged[key] = value;
    else delete merged[key];
  }
  if (config.profiles !== undefined) {
    if (Object.keys(config.profiles).length > 0) merged.profiles = config.profiles;
    else delete merged.profiles;
  }
  if (config.active !== undefined) {
    if (config.active?.trim()) merged.active = config.active.trim();
    else delete merged.active;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
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
    sshHost: env.LATTICE_SSH_HOST?.trim() || file.sshHost,
    sshPort: env.LATTICE_SSH_PORT?.trim() || file.sshPort,
    sshUser: env.LATTICE_SSH_USER?.trim() || file.sshUser,
    sshKey: env.LATTICE_SSH_KEY?.trim() || file.sshKey,
    sshLocalPort: env.LATTICE_SSH_LOCAL_PORT?.trim() || file.sshLocalPort,
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
  if (conn.sshHost) env.LATTICE_SSH_HOST = conn.sshHost;
  if (conn.sshPort) env.LATTICE_SSH_PORT = conn.sshPort;
  if (conn.sshUser) env.LATTICE_SSH_USER = conn.sshUser;
  if (conn.sshKey) env.LATTICE_SSH_KEY = conn.sshKey;
  if (conn.sshLocalPort) env.LATTICE_SSH_LOCAL_PORT = conn.sshLocalPort;
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
  "LATTICE_SSH_HOST",
  "LATTICE_SSH_PORT",
  "LATTICE_SSH_USER",
  "LATTICE_SSH_KEY",
  "LATTICE_SSH_LOCAL_PORT",
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
