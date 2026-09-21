import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./App.js";

// Spawned as a child process by `lattice-talk` / `lattice-talk tui|setup`
// (see src/cli.ts) — OpenTUI's native renderer needs Bun or Node >= 26.4,
// which is why it never shares a process with the MCP stdio server.
const forceSetup = process.argv.slice(2).includes("--setup");

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
  process.stderr.write(
    `lattice-talk: the TUI's native renderer failed to start on this terminal` +
      ` (${e instanceof Error ? e.message : String(e)}).\n` +
      `Try Windows Terminal, iTerm2, or a modern emulator — or use the MCP ` +
      `tools directly; \`lattice-talk serve\` needs only Node >= 20.\n`,
  );
  process.exit(1);
}

renderer.setTerminalTitle("lattice-talk");
createRoot(renderer).render(<App forceSetup={forceSetup} />);
