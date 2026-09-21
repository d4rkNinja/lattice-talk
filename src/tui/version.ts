import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Resolve the installed package version at runtime — dist/tui/main.js sits
 * two levels below the package root in both the repo build and the npm
 * tarball, so ../../package.json is always correct.
 */
export const VERSION: string = (() => {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
