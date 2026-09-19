import { UserError } from "./errors.js";
import { assertMemoryKey } from "./ids.js";
import {
  MEMORY_LIST_DEFAULT_LIMIT,
  MEMORY_LIST_MAX_LIMIT,
  MEMORY_LIST_PREVIEW_CHARS,
  MEMORY_VALUE_MAX_CHARS,
} from "./limits.js";
import { truncateBody } from "./messages.js";
import { clampListLimit, pageSortedKeys } from "./page.js";
import { requireJoinedSession, resolveProvidedOrInspectSessionId } from "./resolve.js";
import type { BusDeps } from "./types.js";

export async function memorySet(
  deps: BusDeps,
  input: { session_id?: string; key: string; value: string },
): Promise<{ key: string; session_id: string }> {
  const { sessionId, agentId } = requireJoinedSession(deps, input.session_id);
  const key = assertMemoryKey(input.key);
  if (input.value === undefined || input.value === null) {
    throw new UserError("value is required.");
  }
  if (input.value.length > MEMORY_VALUE_MAX_CHARS) {
    throw new UserError(`value must be at most ${MEMORY_VALUE_MAX_CHARS} characters.`);
  }
  await deps.store.memorySet(sessionId, key, input.value, {
    updated_at: new Date().toISOString(),
    updated_by: agentId,
  });
  return { key, session_id: sessionId };
}

export async function memoryGet(
  deps: BusDeps,
  input: { session_id?: string; key: string },
): Promise<{ key: string; value: string | null; found: boolean; session_id: string }> {
  const sessionId = resolveProvidedOrInspectSessionId(deps, input.session_id);
  const key = assertMemoryKey(input.key);
  const value = await deps.store.memoryGet(sessionId, key);
  return { key, value, found: value !== null, session_id: sessionId };
}

export async function memoryList(
  deps: BusDeps,
  input: { session_id?: string; include_values?: boolean; cursor?: string; limit?: number },
): Promise<{
  session_id: string;
  keys: string[];
  values?: Record<string, string>;
  next_cursor?: string;
  truncated: boolean;
}> {
  const sessionId = resolveProvidedOrInspectSessionId(deps, input.session_id);
  const allKeys = await deps.store.memoryKeys(sessionId);
  const limit = clampListLimit(input.limit, MEMORY_LIST_DEFAULT_LIMIT, MEMORY_LIST_MAX_LIMIT);
  const page = pageSortedKeys(allKeys, input.cursor, limit);
  if (!input.include_values) {
    return {
      session_id: sessionId,
      keys: page.items,
      next_cursor: page.next_cursor,
      truncated: page.truncated,
    };
  }
  const rawValues = await deps.store.memoryGetMany(sessionId, page.items);
  const values: Record<string, string> = {};
  let previewTruncated = false;
  for (const key of page.items) {
    const raw = rawValues[key] ?? "";
    const cut = truncateBody(raw, MEMORY_LIST_PREVIEW_CHARS);
    values[key] = cut.body;
    if (cut.truncated) previewTruncated = true;
  }
  return {
    session_id: sessionId,
    keys: page.items,
    values,
    next_cursor: page.next_cursor,
    truncated: page.truncated || previewTruncated,
  };
}

export async function memoryNote(
  deps: BusDeps,
  input: { session_id?: string; body: string },
): Promise<{ note_id: string; session_id: string }> {
  const { sessionId, agentId } = requireJoinedSession(deps, input.session_id);
  if (!input.body?.trim()) {
    throw new UserError("body is required.");
  }
  const noteId = await deps.store.appendNote(sessionId, {
    from: agentId,
    body: input.body,
    ts: new Date().toISOString(),
    kind: "note",
  });
  return { note_id: noteId, session_id: sessionId };
}
