import type { ToolAnnotations } from "@modelcontextprotocol/server";

/**
 * Tool annotations (title, readOnlyHint, destructiveHint, openWorldHint,
 * idempotentHint). Clients treat these as untrusted hints.
 *
 * openWorldHint: true only if the tool talks to an unbounded world outside
 * Lattice (e.g. web search). Spec example: a memory tool is closed.
 * Lattice tools stay inside this process + the configured store — default false.
 */
const CLOSED_WORLD = { openWorldHint: false } as const;

export function readOnly(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    ...CLOSED_WORLD,
  };
}

export function write(title: string, extra?: Partial<ToolAnnotations>): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: false,
    ...CLOSED_WORLD,
    ...extra,
    openWorldHint: extra?.openWorldHint ?? false,
  };
}

export function destructive(title: string): ToolAnnotations {
  return {
    title,
    readOnlyHint: false,
    destructiveHint: true,
    ...CLOSED_WORLD,
  };
}
