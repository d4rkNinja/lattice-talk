import { UserError } from "./errors.js";
import { ID_MAX_LEN, MEMORY_KEY_MAX_LEN } from "./limits.js";

/**
 * Public IDs (session, agent, room). Colon is excluded: composite Redis keys
 * and cursor rids join dynamic parts with ':', so an ID containing ':' could
 * collide with a different ID pair (dmPair("a:b","c") vs dmPair("a","b:c")).
 */
const ID_RE = /^[A-Za-z0-9._-]+$/;

export function assertId(value: string, field: string, max = ID_MAX_LEN): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new UserError(`${field} is required.`);
  }
  if (trimmed.length > max) {
    throw new UserError(`${field} must be at most ${max} characters.`);
  }
  if (!ID_RE.test(trimmed)) {
    throw new UserError(
      `${field} may only contain letters, numbers, and . _ - (got ${JSON.stringify(trimmed)}).`,
    );
  }
  return trimmed;
}

export function assertMemoryKey(value: string): string {
  return assertId(value, "key", MEMORY_KEY_MAX_LEN);
}

export function optionalId(value: string | undefined, field: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  return assertId(value, field);
}

/** Non-empty free text (roles, display names, note bodies) with a hard bound. */
export function assertBoundedText(
  value: string | undefined,
  field: string,
  max: number,
): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new UserError(`${field} is required.`);
  }
  if (trimmed.length > max) {
    throw new UserError(`${field} must be at most ${max} characters.`);
  }
  return trimmed;
}
