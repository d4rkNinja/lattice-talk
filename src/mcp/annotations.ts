import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP 2026-07-28 tool annotations (title, readOnlyHint, destructiveHint,
 * openWorldHint, idempotentHint). Clients treat these as untrusted hints.
 * Claude Code uses readOnlyHint to batch read-only calls.
 */
export function readOnly(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  };
}

export function write(title: string, extra?: Partial<ToolAnnotations>): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    ...extra,
  };
}

export function destructive(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  };
}
