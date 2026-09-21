import { chmodSync, existsSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "tui/main": "src/tui/main.tsx",
  },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  bundle: true,
  minify: false,
  // Bundle the serve-time deps so `node dist/index.js serve` runs without
  // node_modules in a clone. The OpenTUI/React stack stays external: it is
  // loaded only by the TUI child process and resolved from node_modules.
  noExternal: [/^@modelcontextprotocol\//, /^@opentelemetry\//, "ioredis", "zod"],
  external: [/^@opentui\//, "react", "react-dom", "react-reconciler", "scheduler"],
  // ESM output has no `require`; CJS deps (ioredis, parts of OTEL) call
  // require("events") etc. createRequire must exist before esbuild's __require helper.
  shims: true,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  esbuildOptions(options) {
    options.legalComments = "none";
    options.jsx = "automatic";
    options.jsxImportSource = "@opentui/react";
  },
  async onSuccess() {
    if (process.platform !== "win32" && existsSync("dist/index.js")) {
      chmodSync("dist/index.js", 0o755);
    }
  },
});
