/** Stderr-only logger. Never write to stdout — that stream is MCP JSON-RPC. */
export function log(...args: unknown[]): void {
  console.error("[lattice-talk]", ...args);
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = parsed.username ? "***" : "";
    return parsed.toString();
  } catch {
    return "(unparseable)";
  }
}
