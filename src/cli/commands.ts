import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_ROOM } from "../core/limits.js";
import { HARNESSES, type HarnessSpec } from "./harnesses.js";

/**
 * Installs a `/l-talk-new` join command into each harness's custom-command
 * mechanism, so opening a fresh agent session and typing one command puts it
 * on the bus — no prompt pasting.
 *
 * The mechanism differs per harness (and per harness version), so a spec can
 * expand to several written files:
 *  - claude   → ~/.claude/commands/<name>.md              → /l-talk-new
 *  - codex    → ~/.codex/prompts/<name>.md (pre-0.117, /prompts:l-talk-new)
 *             → ~/.codex/skills/<name>/SKILL.md (v1 skill root)
 *             → ~/.agents/skills/<name>/SKILL.md (current skill root)
 *  - gemini   → ~/.gemini/commands/<name>.toml            → /l-talk-new
 *  - cursor   → ~/.cursor/commands/<name>.md (legacy commands)
 *             → ~/.cursor/skills/<name>/SKILL.md (current skills)
 *  - windsurf → ~/.codeium/windsurf/global_workflows/<name>.md → /l-talk-new
 *
 * The file body is the ready-to-paste join prompt generated from the saved
 * connection — workspace and room are baked in at install time.
 */
export const JOIN_COMMAND_NAME = "l-talk-new";
export const JOIN_COMMAND_ROOM = DEFAULT_ROOM;

const DESCRIPTION = "Join the Lattice session and start talking";

interface CommandTarget {
  path: string;
  /** What to delete on remove — the parent dir for SKILL.md targets. */
  removePath: string;
  render(body: string): string;
}

/** Markdown command with YAML frontmatter (claude commands, codex prompts). */
const mdCommand = (path: string): CommandTarget => ({
  path,
  removePath: path,
  render: (body) => `---\ndescription: ${DESCRIPTION}\n---\n\n${body}\n`,
});

/** Plain markdown file whose whole body is the prompt (cursor commands). */
const plainMd = (path: string): CommandTarget => ({
  path,
  removePath: path,
  render: (body) => `${body}\n`,
});

/** Agent-skills SKILL.md; removal drops the whole skill directory. */
const skill = (path: string, extraFrontmatter = ""): CommandTarget => ({
  path,
  removePath: dirname(path),
  render: (body) =>
    `---\nname: ${JOIN_COMMAND_NAME}\ndescription: ${DESCRIPTION}\n${extraFrontmatter}---\n\n${body}\n`,
});

/** Gemini custom command — TOML with a basic-string prompt body. */
const tomlCommand = (path: string): CommandTarget => ({
  path,
  removePath: path,
  render: (body) => {
    const esc = body.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
    return `description = ${JSON.stringify(DESCRIPTION)}\nprompt = """\n${esc}\n"""\n`;
  },
});

/** Windsurf Cascade workflow (global scope) — plain markdown with a title. */
const windsurfWorkflow = (path: string): CommandTarget => ({
  path,
  removePath: path,
  render: (body) => `# ${DESCRIPTION} (/${JOIN_COMMAND_NAME})\n\n${body}\n`,
});

export function commandTargets(spec: HarnessSpec, home: string): CommandTarget[] {
  const name = JOIN_COMMAND_NAME;
  switch (spec.id) {
    case "claude":
      return [mdCommand(join(home, ".claude", "commands", `${name}.md`))];
    case "codex":
      return [
        mdCommand(join(home, ".codex", "prompts", `${name}.md`)),
        skill(join(home, ".codex", "skills", name, "SKILL.md")),
        skill(join(home, ".agents", "skills", name, "SKILL.md")),
      ];
    case "gemini":
      return [tomlCommand(join(home, ".gemini", "commands", `${name}.toml`))];
    case "cursor":
      return [
        plainMd(join(home, ".cursor", "commands", `${name}.md`)),
        // Cursor's own command→skill migration keeps slash-only behaviour via
        // this flag; harmless on versions that don't read it.
        skill(
          join(home, ".cursor", "skills", name, "SKILL.md"),
          "disable-model-invocation: true\n",
        ),
      ];
    case "windsurf":
      return [
        windsurfWorkflow(
          join(home, ".codeium", "windsurf", "global_workflows", `${name}.md`),
        ),
      ];
    default:
      return [];
  }
}

/** How the user invokes the command inside each harness. */
export function commandInvoke(spec: HarnessSpec): string {
  if (spec.id === "codex") {
    // Newer codex removed custom prompts; the skill is invoked instead.
    return `/prompts:${JOIN_COMMAND_NAME} (older) or the ${JOIN_COMMAND_NAME} skill`;
  }
  return `/${JOIN_COMMAND_NAME}`;
}

export function installJoinCommands(
  spec: HarnessSpec,
  prompt: string,
  home = homedir(),
): string[] {
  const written: string[] = [];
  for (const t of commandTargets(spec, home)) {
    mkdirSync(dirname(t.path), { recursive: true });
    writeFileSync(t.path, t.render(prompt));
    written.push(t.path);
  }
  return written;
}

export function removeJoinCommands(spec: HarnessSpec, home = homedir()): string[] {
  const removed: string[] = [];
  for (const t of commandTargets(spec, home)) {
    if (existsSync(t.removePath)) {
      rmSync(t.removePath, { recursive: true, force: true });
      removed.push(t.removePath);
    }
  }
  return removed;
}

export function joinCommandInstalled(spec: HarnessSpec, home = homedir()): boolean {
  return commandTargets(spec, home).some((t) => existsSync(t.path));
}

/**
 * Rewrite the prompt body only where command files already exist — used when
 * the workspace (or token policy) changes so installed commands can't point
 * agents at a stale session.
 */
export function refreshJoinCommands(prompt: string, home = homedir()): string[] {
  const touched: string[] = [];
  for (const spec of HARNESSES) {
    for (const t of commandTargets(spec, home)) {
      if (existsSync(t.path)) {
        writeFileSync(t.path, t.render(prompt));
        touched.push(t.path);
      }
    }
  }
  return touched;
}
