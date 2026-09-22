import { spawn } from "node:child_process";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../version.js";

/** Numeric semver compare: >0 when a > b. Prereleases sort before releases. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v.split("-")[0]!.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return (a.includes("-") ? 0 : 1) - (b.includes("-") ? 0 : 1);
}

export async function latestPublishedVersion(
  packageName: string = PACKAGE_NAME,
): Promise<string | undefined> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The package manager that owns this install, inferred from the runtime the
 * bin shim launched: bun installs execute under bun, npm installs under node.
 */
export function selfInstaller(
  packageName: string = PACKAGE_NAME,
): { cmd: string; args: string[] } {
  const spec = `${packageName}@latest`;
  if (process.versions.bun) {
    return { cmd: process.execPath, args: ["add", "-g", spec] };
  }
  return {
    cmd: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["install", "-g", spec],
  };
}

export async function updateCommand(
  out: (s: string) => void,
  err: (s: string) => void,
): Promise<number> {
  out(`lattice-talk ${PACKAGE_VERSION} — checking npm for updates…`);
  const latest = await latestPublishedVersion();
  if (!latest) {
    err("Couldn't reach the npm registry — check your network and try again.");
    return 1;
  }
  if (compareVersions(latest, PACKAGE_VERSION) <= 0) {
    out(`Already up to date (${PACKAGE_VERSION}).`);
    return 0;
  }
  out(`Updating ${PACKAGE_VERSION} → ${latest}…`);
  const { cmd, args } = selfInstaller();
  return new Promise((resolve) => {
    // Windows can't spawn .cmd shims directly — a shell is required there.
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (e) => {
      err(`Update failed to start (${cmd}): ${e.message}`);
      err(`Run it manually: npm install -g ${PACKAGE_NAME}@latest`);
      resolve(1);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        out(`Updated to ${latest} — restart lattice-talk (or l-talk) to use it.`);
        refreshHarnesses(out, err).then(() => resolve(0));
        return;
      }
      err(`Update failed (exit ${code}). Run it manually: npm install -g ${PACKAGE_NAME}@latest`);
      resolve(code ?? 1);
    });
  });
}

/**
 * After a global update, re-run `mcp refresh` through the *new* binary so
 * installed harnesses pick up the current launch command — otherwise they
 * keep spawning the copy npx cached before the update. Best-effort: on any
 * failure we just print the manual command.
 */
function refreshHarnesses(
  out: (s: string) => void,
  err: (s: string) => void,
): Promise<void> {
  return new Promise((resolve) => {
    out("Refreshing installed harness MCP entries…");
    const child = spawn("lattice-talk", ["mcp", "refresh"], {
      stdio: "inherit",
      shell: true, // resolve the lattice-talk(.cmd) bin shim on every platform
    });
    const done = (ok: boolean) => {
      if (!ok) {
        err(`Couldn't auto-refresh harnesses — run it once manually: lattice-talk mcp refresh`);
      }
      resolve();
    };
    child.on("error", () => done(false));
    child.on("exit", (code) => done(code === 0));
  });
}
