import { homedir } from "node:os";
import {
  configFilePath,
  connectionToHarnessEnv,
  loadFileConfig,
  saveFileConfig,
  type ConnectionProfile,
  type FileConfig,
  type ResolvedConnection,
} from "./config-file.js";
import { agentJoinPrompt } from "./prompt.js";
import { JOIN_COMMAND_ROOM, refreshJoinCommands } from "./commands.js";
import {
  HARNESSES,
  installHarness,
  isInstalled,
  mcpEntry,
} from "./harnesses.js";

/**
 * Named connection profiles ("personal", "office", …) stored inside
 * ~/.lattice/config.json. The file's flat fields always mirror the active
 * profile, so `serve`, `mcp add`, and env resolution need no profile
 * awareness — switching profiles just rewrites the flat mirror.
 */

export const PROFILE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

export interface ProfileEntry {
  name: string;
  active: boolean;
  conn: ConnectionProfile;
}

export function assertProfileName(name: string): string {
  const trimmed = name.trim();
  if (!PROFILE_NAME_RE.test(trimmed)) {
    throw new Error(
      `Profile names may only contain letters, numbers, and . _ - (got ${JSON.stringify(name)}).`,
    );
  }
  return trimmed;
}

export function listProfiles(config: FileConfig): ProfileEntry[] {
  return Object.keys(config.profiles ?? {})
    .sort()
    .map((name) => ({
      name,
      active: name === config.active,
      conn: config.profiles![name]!,
    }));
}

function cleanFields(conn: ConnectionProfile): ConnectionProfile {
  const out: ConnectionProfile = {};
  for (const key of [
    "redisUrl",
    "namespace",
    "workspace",
    "joinToken",
    "sshHost",
    "sshPort",
    "sshUser",
    "sshKey",
    "sshLocalPort",
  ] as const) {
    const value = conn[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Mirror a profile's fields into the config's flat top-level keys. */
function flatMirror(profile: ConnectionProfile): FileConfig {
  return { ...cleanFields(profile) };
}

/**
 * Write/update a named profile. When `activate` (default true) the profile
 * becomes the active connection — its fields are mirrored into the flat
 * top-level keys every consumer reads.
 */
export function saveProfile(
  name: string,
  conn: ConnectionProfile,
  options: { activate?: boolean } = {},
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string {
  const profileName = assertProfileName(name);
  const { config } = loadFileConfig(env, home);
  const activate = options.activate ?? true;
  const profiles = { ...(config.profiles ?? {}), [profileName]: cleanFields(conn) };
  saveFileConfig(
    {
      ...(activate ? flatMirror(profiles[profileName]!) : config),
      profiles,
      ...(activate ? { active: profileName } : {}),
    },
    env,
    home,
  );
  return configFilePath(env, home);
}

/**
 * Make a saved profile the active connection. Returns the resolved
 * connection so callers can open a bus against it.
 */
export function activateProfile(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): ResolvedConnection {
  const profileName = assertProfileName(name);
  const { config } = loadFileConfig(env, home);
  const profile = config.profiles?.[profileName];
  if (!profile) {
    const known = Object.keys(config.profiles ?? {}).sort();
    throw new Error(
      `No connection profile named ${JSON.stringify(profileName)}` +
        (known.length ? `. Saved: ${known.join(", ")}` : " — no profiles saved yet."),
    );
  }
  saveFileConfig(
    { ...flatMirror(profile), profiles: config.profiles, active: profileName },
    env,
    home,
  );
  return { namespace: "dev", ...flatMirror(profile) } as ResolvedConnection;
}

export interface DeleteResult {
  removed: boolean;
  /** Name that is active after the delete (undefined = none). */
  activeNow?: string;
  /** The connection that became active, if one did. */
  conn?: ResolvedConnection;
}

/**
 * Delete a profile. Deleting the active one promotes the next profile
 * (alphabetical); with none left, the flat connection stays usable but no
 * profile is marked active.
 */
export function deleteProfile(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): DeleteResult {
  const profileName = assertProfileName(name);
  const { config } = loadFileConfig(env, home);
  if (!config.profiles?.[profileName]) return { removed: false };
  const profiles = { ...config.profiles };
  delete profiles[profileName];

  if (config.active !== profileName) {
    saveFileConfig({ ...config, profiles }, env, home);
    return { removed: true, activeNow: config.active };
  }
  const next = Object.keys(profiles).sort()[0];
  if (next) {
    const conn = { namespace: "dev", ...cleanFields(profiles[next]!) } as ResolvedConnection;
    saveFileConfig(
      { ...flatMirror(profiles[next]!), profiles, active: next },
      env,
      home,
    );
    return { removed: true, activeNow: next, conn };
  }
  // No profiles left — keep the flat fields (the connection still works),
  // just drop the active marker.
  saveFileConfig({ ...config, profiles, active: "" }, env, home);
  return { removed: true };
}

/** One-line, credential-masked description for list output. */
export function describeConnection(conn: ConnectionProfile): string {
  let target = conn.redisUrl ?? "(no redis url)";
  try {
    const url = new URL(target);
    if (url.password) url.password = "***";
    if (url.username && !url.password) url.username = "***";
    target = url.toString();
  } catch {
    // not a URL — print as-is
  }
  const parts = [target, `ns:${conn.namespace ?? "dev"}`];
  if (conn.workspace) parts.push(`ws:${conn.workspace}`);
  if (conn.joinToken) parts.push("token:***");
  if (conn.sshHost) {
    const user = conn.sshUser ? `${conn.sshUser}@` : "";
    const port = conn.sshPort && conn.sshPort !== "22" ? `:${conn.sshPort}` : "";
    parts.push(`ssh:${user}${conn.sshHost}${port}`);
  }
  return parts.join("  ");
}

/**
 * Parse `[user@]host[:port]` — the friendly single-flag shape for an SSH
 * bastion. IPv6 literals need brackets: `[::1]:2222`.
 */
export function parseSshTarget(raw: string): {
  sshUser?: string;
  sshHost: string;
  sshPort?: string;
} {
  const s = raw.trim();
  if (!s) throw new Error("--ssh needs a host, e.g. --ssh deploy@bastion.example.com:2222");
  let rest = s;
  let sshUser: string | undefined;
  const at = rest.lastIndexOf("@");
  if (at !== -1) {
    sshUser = rest.slice(0, at) || undefined;
    rest = rest.slice(at + 1);
  }
  let sshPort: string | undefined;
  let host = rest;
  const bracket = rest.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) {
    host = bracket[1]!;
    sshPort = bracket[2];
  } else {
    const colon = rest.lastIndexOf(":");
    if (colon !== -1 && /^\d+$/.test(rest.slice(colon + 1))) {
      host = rest.slice(0, colon);
      sshPort = rest.slice(colon + 1);
    }
  }
  if (!host.trim()) throw new Error(`--ssh is missing a host (got ${JSON.stringify(raw)})`);
  if (sshPort) {
    const n = Number(sshPort);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      throw new Error(`--ssh port must be 1-65535 (got ${JSON.stringify(sshPort)})`);
    }
  }
  return { sshUser, sshHost: host.trim(), sshPort };
}

export interface ConnectionFlags {
  conn: ConnectionProfile;
  switchProfile: boolean;
  noTest: boolean;
}

/** Parse the `connections add` flag tail into a profile + options. */
export function connectionFromFlags(rest: string[]): ConnectionFlags {
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith("--")) continue;
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      flags.set(arg.slice(2), "");
    } else {
      flags.set(arg.slice(2), value);
      i += 1;
    }
  }
  const conn: ConnectionProfile = {};
  const take = (...names: string[]) => {
    for (const n of names) {
      const v = flags.get(n)?.trim();
      if (v) return v;
    }
    return undefined;
  };
  conn.redisUrl = take("redis", "redis-url");
  conn.namespace = take("namespace", "ns");
  conn.workspace = take("workspace", "ws");
  conn.joinToken = take("token", "join-token");
  conn.sshKey = take("ssh-key");
  conn.sshLocalPort = take("ssh-local-port");
  const ssh = take("ssh");
  if (ssh) {
    const target = parseSshTarget(ssh);
    conn.sshHost = target.sshHost;
    if (target.sshPort) conn.sshPort = target.sshPort;
    if (target.sshUser) conn.sshUser = target.sshUser;
  }
  conn.sshHost = take("ssh-host") ?? conn.sshHost;
  conn.sshPort = take("ssh-port") ?? conn.sshPort;
  conn.sshUser = take("ssh-user") ?? conn.sshUser;
  for (const key of Object.keys(conn) as (keyof ConnectionProfile)[]) {
    if (conn[key] === undefined) delete conn[key];
  }
  return {
    conn,
    switchProfile: flags.has("switch"),
    noTest: flags.has("no-test") || flags.has("force"),
  };
}

/**
 * After switching the active connection, installed harnesses still hold the
 * old bus env in their MCP config. Re-point every installed harness and
 * rewrite /l-talk-new prompts so agents land on the new bus. Best-effort:
 * individual failures are reported, never fatal.
 */
export function applyConnectionToHarnesses(
  conn: ResolvedConnection,
  log: (line: string) => void,
  warn: (line: string) => void,
  home = homedir(),
): void {
  const env = connectionToHarnessEnv(conn);
  const entry = mcpEntry(env);
  const prompt = agentJoinPrompt({
    workspace: conn.workspace ?? "main",
    roomId: JOIN_COMMAND_ROOM,
    tokenProtected: Boolean(conn.joinToken),
  });
  for (const spec of HARNESSES) {
    if (!isInstalled(spec, home)) continue;
    try {
      installHarness(spec, entry, home);
      log(`  ${spec.id}: re-pointed at ${conn.redisUrl ?? "redis"}`);
    } catch (e) {
      warn(`  ${spec.id}: could not update MCP config — ${e instanceof Error ? e.message : e}`);
    }
  }
  try {
    const touched = refreshJoinCommands(prompt, home);
    if (touched.length > 0) log(`  rewrote ${touched.length} /l-talk-new command file(s)`);
  } catch (e) {
    warn(`  join commands not refreshed — ${e instanceof Error ? e.message : e}`);
  }
}
