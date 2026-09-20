import {
  NAMESPACE_MAX_LEN,
  PRESENCE_TTL_MAX_SECONDS,
  PRESENCE_TTL_MIN_SECONDS,
  PRESENCE_TTL_SECONDS,
  STREAM_MAXLEN,
  STREAM_MAXLEN_MAX,
  STREAM_MAXLEN_MIN,
} from "./limits.js";

export type StoreKind = "redis" | "memory";

export interface LatticeConfig {
  store: StoreKind;
  namespace: string;
  defaultSessionId?: string;
  joinToken?: string;
  redisUrl?: string;
  redisHost?: string;
  redisPort: number;
  redisUsername?: string;
  redisPassword?: string;
  redisDb: number;
  redisSsl: boolean;
  otelEndpoint?: string;
  otelServiceName: string;
  otelHeaders?: Record<string, string>;
  presenceTtlSeconds: number;
  streamMaxLen: number;
}

export function parseOtelHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  const out: Record<string, string> = {};
  for (const part of raw.split(/[\n,]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    const col = trimmed.indexOf(":");
    let idx = -1;
    if (eq === -1) idx = col;
    else if (col === -1) idx = eq;
    else idx = Math.min(eq, col);
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/** Named numeric knobs must be valid integers in range — fail fast at startup. */
function envIntInRange(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max} (got ${JSON.stringify(raw)}).`);
  }
  return n;
}

function envPort(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || String(n) !== raw || n < 1 || n > 65_535) {
    throw new Error(`${name} must be a TCP port between 1 and 65535 (got ${JSON.stringify(raw)}).`);
  }
  return n;
}

/**
 * The namespace is embedded verbatim into Redis keys. Restrict it like other
 * public IDs: braces in particular would corrupt Redis Cluster hash tags.
 */
function envNamespace(env: NodeJS.ProcessEnv): string {
  const raw = (env.LATTICE_NAMESPACE ?? "dev").trim() || "dev";
  if (raw.length > NAMESPACE_MAX_LEN) {
    throw new Error(
      `LATTICE_NAMESPACE must be at most ${NAMESPACE_MAX_LEN} characters (got ${raw.length}).`,
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    throw new Error(
      `LATTICE_NAMESPACE may only contain letters, numbers, and . _ - (got ${JSON.stringify(raw)}).`,
    );
  }
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LatticeConfig {
  const storeRaw = (env.LATTICE_STORE ?? "redis").trim().toLowerCase();
  if (storeRaw !== "redis" && storeRaw !== "memory") {
    throw new Error(
      `LATTICE_STORE must be "redis" or "memory" (got ${JSON.stringify(storeRaw)}).`,
    );
  }
  const store: StoreKind = storeRaw === "memory" ? "memory" : "redis";

  const redisUrl = env.LATTICE_REDIS_URL?.trim() || env.REDIS_URL?.trim() || undefined;
  const sslFromUrl = redisUrl?.startsWith("rediss://") ?? false;

  return {
    store,
    namespace: envNamespace(env),
    defaultSessionId: env.LATTICE_DEFAULT_SESSION_ID?.trim() || undefined,
    joinToken: env.LATTICE_JOIN_TOKEN?.trim() || undefined,
    redisUrl,
    redisHost: env.REDIS_HOST?.trim() || undefined,
    redisPort: envPort(env, "REDIS_PORT", 6379),
    redisUsername: env.REDIS_USERNAME?.trim() || undefined,
    redisPassword: env.REDIS_PASSWORD || undefined,
    redisDb: envIntInRange(env, "REDIS_DB", 0, 0, 9999),
    redisSsl: envFlag(env.REDIS_SSL) || sslFromUrl,
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined,
    otelServiceName: (env.OTEL_SERVICE_NAME ?? "lattice-talk").trim() || "lattice-talk",
    otelHeaders: parseOtelHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    presenceTtlSeconds: envIntInRange(
      env,
      "LATTICE_PRESENCE_TTL",
      PRESENCE_TTL_SECONDS,
      PRESENCE_TTL_MIN_SECONDS,
      PRESENCE_TTL_MAX_SECONDS,
    ),
    streamMaxLen: envIntInRange(
      env,
      "LATTICE_STREAM_MAXLEN",
      STREAM_MAXLEN,
      STREAM_MAXLEN_MIN,
      STREAM_MAXLEN_MAX,
    ),
  };
}

export function hasRedisTarget(config: LatticeConfig): boolean {
  return Boolean(config.redisUrl || config.redisHost);
}
