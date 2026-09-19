import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP tool annotations. Claude Agent SDK uses readOnlyHint to batch
 * read-only calls; destructiveHint is informational.
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
