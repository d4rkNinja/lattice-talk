/** Redis-style stream id helpers (milliseconds-seq), used by both stores and pull logic. */

export function compareStreamIds(a: string, b: string): number {
  const [amRaw, asRaw] = a.split("-");
  const [bmRaw, bsRaw] = b.split("-");
  const am = Number(amRaw);
  const bm = Number(bmRaw);
  if (am !== bm) return am - bm;
  return Number(asRaw ?? 0) - Number(bsRaw ?? 0);
}

export function isAfterCursor(id: string, afterId: string | undefined): boolean {
  if (!afterId || afterId === "0" || afterId === "0-0") return true;
  return compareStreamIds(id, afterId) > 0;
}

/** Redis 6.2+ exclusive XRANGE start. "-" means from the beginning. */
export function exclusiveStart(afterId: string | undefined): string {
  if (!afterId || afterId === "0" || afterId === "0-0") return "-";
  return `(${afterId}`;
}
