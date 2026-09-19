export interface PageResult<T> {
  items: T[];
  next_cursor?: string;
  truncated: boolean;
}

export function clampListLimit(
  limit: number | undefined,
  fallback: number,
  max: number,
): number {
  const n = limit ?? fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

export function pageSortedByKey<T>(
  items: T[],
  keyOf: (item: T) => string,
  cursor: string | undefined,
  limit: number,
): PageResult<T> {
  const sorted = [...items].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  let start = 0;
  if (cursor) {
    start = sorted.findIndex((item) => keyOf(item) > cursor);
    if (start < 0) start = sorted.length;
  }
  const page = sorted.slice(start, start + limit);
  const truncated = start + page.length < sorted.length;
  return {
    items: page,
    next_cursor: truncated && page.length > 0 ? keyOf(page[page.length - 1]!) : undefined,
    truncated,
  };
}

export function pageSortedKeys(
  keys: string[],
  cursor: string | undefined,
  limit: number,
): PageResult<string> {
  return pageSortedByKey(keys, (k) => k, cursor, limit);
}
