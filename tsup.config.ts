import { chmodSync, existsSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
  // Bundle application code and npm deps so `node dist/index.js` runs
  // without installing node_modules in a clone.
  noExternal: [/.*/],
  // ESM output has no `require`; CJS deps (ioredis, parts of OTEL) call
  // require("events") etc. createRequire must exist before esbuild's __require helper.
  shims: true,
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  esbuildOptions(options) {
    options.legalComments = "none";
  },
  async onSuccess() {
    if (process.platform !== "win32" && existsSync("dist/index.js")) {
      chmodSync("dist/index.js", 0o755);
    }
  },
});
