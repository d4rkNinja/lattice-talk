import { UserError } from "./errors.js";
import { assertId } from "./ids.js";
import type { BusDeps } from "./types.js";

/**
 * Process-owned identity after a successful join_session.
 * Mutating and private-read tools must use this — never a model-supplied agent_id.
 */
export function requireJoinedAgent(deps: BusDeps): { sessionId: string; agentId: string } {
  if (!deps.ctx.sessionId || !deps.ctx.agentId) {
    throw new UserError("Call join_session first.");
  }
  return { sessionId: deps.ctx.sessionId, agentId: deps.ctx.agentId };
}

/**
 * Session-mutating / private-read ops: joined identity wins.
 * Optional session_id is accepted only when it matches the joined session.
 */
export function requireJoinedSession(
  deps: BusDeps,
  explicit?: string,
): { sessionId: string; agentId: string } {
  const identity = requireJoinedAgent(deps);
  const raw = explicit?.trim();
  if (raw) {
    const sid = assertId(raw, "session_id");
    if (sid !== identity.sessionId) {
      throw new UserError("session_id must match the joined session.");
    }
  }
  return identity;
}

/** join_session: explicit || last join || LATTICE_DEFAULT_SESSION_ID. */
export function resolveSessionId(deps: BusDeps, explicit?: string): string {
  const raw = explicit?.trim() || deps.ctx.sessionId || deps.config.defaultSessionId;
  if (!raw) {
    throw new UserError(
      "session_id is required. Call join_session first or set LATTICE_DEFAULT_SESSION_ID.",
    );
  }
  return assertId(raw, "session_id");
}

/**
 * Read-only inspection (session_info, list_peers, memory_get/list/notes,
 * trace_context, resources). Omitted → joined session or
 * LATTICE_DEFAULT_SESSION_ID. Provided session_id must match one of those
 * two — never an arbitrary session.
 */
export function resolveInspectSessionId(deps: BusDeps, explicit?: string): string {
  const joined = deps.ctx.sessionId;
  const fallback = deps.config.defaultSessionId;
  if (!joined && !fallback) {
    throw new UserError("Call join_session first.");
  }
  const raw = explicit?.trim();
  if (!raw) {
    return assertId((joined || fallback)!, "session_id");
  }
  const sid = assertId(raw, "session_id");
  if (sid === joined || sid === fallback) {
    return sid;
  }
  throw new UserError(
    "session_id must match the joined session or LATTICE_DEFAULT_SESSION_ID.",
  );
}
