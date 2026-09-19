import { loadConfig, type LatticeConfig } from "../src/core/config.js";
import { RuntimeContext } from "../src/core/context.js";
import { MemoryStore } from "../src/core/memory-store.js";
import type { BusDeps } from "../src/core/types.js";

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
