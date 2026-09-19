import type { BusDeps } from "../core/types.js";

export const ABOUT_RESOURCE_URI = "lattice://about";
export const SESSION_URI_TEMPLATE = "lattice://session/{session_id}";
export const MEMORY_URI_TEMPLATE = "lattice://session/{session_id}/memory";

export function sessionResourceUri(sessionId: string): string {
  return `lattice://session/${sessionId}`;
}

export function memoryResourceUri(sessionId: string): string {
  return `lattice://session/${sessionId}/memory`;
}

/** Completions for prompt/resource session_id — config + last join only. */
export function suggestSessionIds(deps: BusDeps, value?: string): string[] {
  const prefix = (value ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [deps.config.defaultSessionId, deps.ctx.sessionId]) {
    if (!id || seen.has(id)) continue;
    if (prefix && !id.toLowerCase().startsWith(prefix)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, 100);
}
