/**
 * Feature shape we align with (tools / resources / prompts, annotations,
 * structuredContent, stderr logging). We do not speak MCP 2026-07-28 on the wire.
 *
 * Accurate line: feature-aligned with 2026-07-28; wire = SDK v1 / initialize
 * for today’s Claude/Cursor/Codex.
 *
 * Current docs hub: https://modelcontextprotocol.io/docs
 * 2026-07-28 (current spec) removed `initialize` and requires `server/discover`
 * plus per-request `_meta` (`@modelcontextprotocol/server` v2). Lattice stays on
 * `@modelcontextprotocol/sdk` v1 so Claude Code, Cursor, and Codex can connect.
 */
export const MCP_FEATURE_SPEC_DATE = "2026-07-28";
/** Feature-alignment date (not the bytes on the wire). Prefer MCP_FEATURE_SPEC_DATE. */
export const MCP_SPEC_DATE = MCP_FEATURE_SPEC_DATE;
export const MCP_WIRE_ERA = "sdk-v1-initialize";
export const MCP_ALIGNMENT =
  "feature-aligned with 2026-07-28; wire = SDK v1 / initialize for today’s Claude/Cursor/Codex";
export const MCP_DOCS_HUB_URL = "https://modelcontextprotocol.io/docs";
export const MCP_INTRO_URL =
  "https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro";
export const MCP_SPEC_URL = "https://modelcontextprotocol.io/specification/2026-07-28";
export const MCP_TS_SDK_PACKAGE = "@modelcontextprotocol/sdk";

/**
 * SDK v1 `registerTool` / `registerResource` / `registerPrompt` default
 * `listChanged: true`. Spec: that flag means this server WILL emit
 * `notifications/*/list_changed`. Lattice never does, so we advertise false.
 */
export const STATIC_LIST_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false },
  prompts: { listChanged: false },
} as const;
