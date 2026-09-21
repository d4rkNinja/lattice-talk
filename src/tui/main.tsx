import { appendFileSync } from "node:fs";
import { CliRenderEvents, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App.js";
import { asciiGlyphs, colorTier, noAnim } from "./theme.js";
import { VERSION } from "./version.js";

// Spawned as a child process by `lattice-talk` / `lattice-talk tui|setup`
// (see src/cli.ts) — OpenTUI's native renderer needs Bun or Node >= 26.4,
// which is why it never shares a process with the MCP stdio server.
const forceSetup = process.argv.slice(2).includes("--setup");

/**
 * Diagnostics: LATTICE_TUI_LOG=/path/to/log captures what the renderer
 * actually detected on this terminal — the answers to "why does it look
 * wrong on my machine" without guessing.
 */
const logFile = process.env.LATTICE_TUI_LOG?.trim();
function dlog(message: string, data?: unknown): void {
  if (!logFile) return;
  try {
    const extra =
      data === undefined ? "" : ` ${JSON.stringify(data)?.slice(0, 2000) ?? String(data)}`;
    appendFileSync(logFile, `[${new Date().toISOString()}] ${message}${extra}\n`);
  } catch {
    // Logging must never break the TUI.
  }
}

const runtime = process.versions.bun
  ? `bun ${process.versions.bun}`
  : `node ${process.version}`;
dlog(`lattice-talk ${VERSION} (${runtime}, ${process.platform}/${process.arch})`);
dlog(
  `tier=${colorTier} ascii=${asciiGlyphs} noAnim=${noAnim} ` +
    `TERM=${process.env.TERM ?? ""} COLORTERM=${process.env.COLORTERM ?? ""} ` +
    `TERM_PROGRAM=${process.env.TERM_PROGRAM ?? ""} WT_SESSION=${process.env.WT_SESSION ? "set" : ""} ` +
    `NO_COLOR=${process.env.NO_COLOR ?? ""} LATTICE_ASCII=${process.env.LATTICE_ASCII ?? ""}`,
);

let renderer;
try {
  renderer = await createCliRenderer({
    exitOnCtrlC: false,
    // The built-in log console otherwise pops over the UI on any internal
    // error and dims the whole screen — fatal on terminals where stray
    // capability errors are common (older Windows consoles, minimal
    // emulators). It stays available via its keybinding; errors still log.
    openConsoleOnError: false,
  });
} catch (e) {
  dlog("renderer init failed", { error: e instanceof Error ? e.message : String(e) });
  process.stderr.write(
    `lattice-talk: the TUI's native renderer failed to start on this terminal` +
      ` (${e instanceof Error ? e.message : String(e)}).\n` +
      `Try Windows Terminal, iTerm2, or a modern emulator — or use the MCP ` +
      `tools directly; \`lattice-talk serve\` needs only Node >= 20.\n`,
  );
  process.exit(1);
}

renderer.on(CliRenderEvents.RENDER_ERROR, (e: unknown) =>
  dlog("render:error", { error: e instanceof Error ? e.message : String(e) }),
);
renderer.on(CliRenderEvents.HANDLER_ERROR, (e: unknown) =>
  dlog("handler:error", { error: e instanceof Error ? e.message : String(e) }),
);
renderer.on(CliRenderEvents.CAPABILITIES, (caps: unknown) => dlog("capabilities", caps));
renderer.on(CliRenderEvents.PALETTE, (palette: unknown) => dlog("palette", palette));

renderer.setTerminalTitle("lattice-talk");
createRoot(renderer).render(<App forceSetup={forceSetup} />);
