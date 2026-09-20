/**
 * Wire and feature shape of this release.
 *
 * Lattice runs on the TypeScript SDK v2 line (`@modelcontextprotocol/server`),
 * which is the stable line supporting the 2026-07-28 specification. Per the
 * SDK's own migration docs, a normal v2 Client/Server still defaults to the
 * 2025-era `initialize` wire; speaking the stateless 2026-07-28 wire is an
 * explicit opt-in/version negotiation. Lattice keeps that default so today's
 * Claude Code, Cursor, and Codex hosts connect unchanged, while the feature
 * surface (tools / resources / prompts, annotations, structuredContent,
 * stderr logging) follows the current docs.
 *
 * Current docs hub: https://modelcontextprotocol.io/docs
 * 2026-07-28 (current spec) removed `initialize` and requires `server/discover`
 * plus per-request `_meta`.
 */
export const MCP_FEATURE_SPEC_DATE = "2026-07-28";
/** Feature-alignment date (not the bytes on the wire). Prefer MCP_FEATURE_SPEC_DATE. */
export const MCP_SPEC_DATE = MCP_FEATURE_SPEC_DATE;
export const MCP_WIRE_ERA = "sdk-v2-initialize-default";
export const MCP_ALIGNMENT =
  "on SDK v2; wire = initialize-era default with 2026-07-28 opt-in, feature-aligned with the current docs";
export const MCP_DOCS_HUB_URL = "https://modelcontextprotocol.io/docs";
export const MCP_INTRO_URL =
  "https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro";
export const MCP_SPEC_URL = "https://modelcontextprotocol.io/specification/2026-07-28";
export const MCP_TS_SDK_PACKAGE = "@modelcontextprotocol/server";

/**
 * Lattice never emits list_changed notifications, so it advertises
 * listChanged: false for tools, resources, and prompts.
 */
export const STATIC_LIST_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false },
  prompts: { listChanged: false },
} as const;
