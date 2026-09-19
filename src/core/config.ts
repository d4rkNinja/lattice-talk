import {
  PRESENCE_TTL_SECONDS,
  STREAM_MAXLEN,
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

function envInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LatticeConfig {
  const storeRaw = (env.LATTICE_STORE ?? "redis").trim().toLowerCase();
  const store: StoreKind = storeRaw === "memory" ? "memory" : "redis";

  const redisUrl = env.LATTICE_REDIS_URL?.trim() || env.REDIS_URL?.trim() || undefined;
  const sslFromUrl = redisUrl?.startsWith("rediss://") ?? false;

  return {
    store,
    namespace: (env.LATTICE_NAMESPACE ?? "dev").trim() || "dev",
    defaultSessionId: env.LATTICE_DEFAULT_SESSION_ID?.trim() || undefined,
    joinToken: env.LATTICE_JOIN_TOKEN?.trim() || undefined,
    redisUrl,
    redisHost: env.REDIS_HOST?.trim() || undefined,
    redisPort: envInt(env.REDIS_PORT, 6379),
    redisUsername: env.REDIS_USERNAME?.trim() || undefined,
    redisPassword: env.REDIS_PASSWORD || undefined,
    redisDb: envInt(env.REDIS_DB, 0),
    redisSsl: envFlag(env.REDIS_SSL) || sslFromUrl,
    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || undefined,
    otelServiceName: (env.OTEL_SERVICE_NAME ?? "lattice-talk").trim() || "lattice-talk",
    otelHeaders: parseOtelHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    presenceTtlSeconds: envInt(env.LATTICE_PRESENCE_TTL, PRESENCE_TTL_SECONDS),
    streamMaxLen: envInt(env.LATTICE_STREAM_MAXLEN, STREAM_MAXLEN),
  };
}

export function hasRedisTarget(config: LatticeConfig): boolean {
  return Boolean(config.redisUrl || config.redisHost);
}
