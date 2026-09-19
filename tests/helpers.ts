import { expect } from "vitest";
import { loadConfig, type LatticeConfig } from "../src/core/config.js";
import { RuntimeContext } from "../src/core/context.js";
import { MemoryStore } from "../src/core/memory-store.js";
import type { BusDeps } from "../src/core/types.js";

/** SDK Client.callTool result is a union; we only read content + isError. */
type ToolResultLike = {
  isError?: boolean;
  content?: Array<{ type: string; text?: string }>;
};

export function testConfig(overrides: NodeJS.ProcessEnv = {}): LatticeConfig {
  return loadConfig({
    LATTICE_STORE: "memory",
    LATTICE_NAMESPACE: "test",
    ...overrides,
  });
}

export function makeDeps(
  store: MemoryStore,
  config: LatticeConfig = testConfig(),
): BusDeps {
  return {
    store,
    config,
    ctx: new RuntimeContext(),
  };
}

export function parseToolJson<T>(result: unknown): T {
  const r = result as ToolResultLike;
  const text = r.content?.[0]?.text ?? "";
  return JSON.parse(text) as T;
}

export function expectToolOk<T>(result: unknown): T {
  const r = result as ToolResultLike;
  expect(r.isError).toBeFalsy();
  return parseToolJson<T>(r);
}

export function expectToolError(result: unknown, match: RegExp | string): string {
  const r = result as ToolResultLike;
  expect(r.isError).toBe(true);
  const parsed = parseToolJson<{ error: string }>(r);
  expect(parsed.error).toMatch(match);
  return parsed.error;
}
