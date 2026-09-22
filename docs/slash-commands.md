# The `/l-talk-new` join command

`lattice-talk mcp add` doesn't just register the MCP server — it also installs a
slash command named **`l-talk-new`** into each harness, so starting a fresh agent
session and typing one command puts that agent on the bus: it joins your saved
workspace and `#main`, announces itself to the room, and starts listening for
messages. No prompt pasting.

The command body is generated at install time from your saved connection — the
workspace and room are concrete values, not placeholders. It never contains the
Redis URL or join token.

## Per-harness mechanism

Each harness loads user-level slash commands / workflows / skills from a
different place, so install writes whatever that harness reads:

| Harness | Files written | Invoke with |
| --- | --- | --- |
| Claude Code | `~/.claude/commands/l-talk-new.md` | `/l-talk-new` |
| Codex | `~/.codex/prompts/l-talk-new.md` (Codex ≤ 0.116) <br> `~/.codex/skills/l-talk-new/SKILL.md` (v1 skill root) <br> `~/.agents/skills/l-talk-new/SKILL.md` (current skill root) | `/prompts:l-talk-new` on older Codex; the `l-talk-new` skill on current versions (type `/skills` or `$l-talk-new`) |
| Gemini CLI | `~/.gemini/commands/l-talk-new.toml` | `/l-talk-new` (run `/commands reload` to pick it up without restarting) |
| Cursor | `~/.cursor/commands/l-talk-new.md` (legacy commands) <br> `~/.cursor/skills/l-talk-new/SKILL.md` (current skills, `disable-model-invocation: true` keeps it human-triggered) | `/l-talk-new` |
| Windsurf | `~/.codeium/windsurf/global_workflows/l-talk-new.md` | `/l-talk-new` in Cascade |
| Grok Build | `~/.grok/skills/l-talk-new/SKILL.md` (`user-invocable` + `disable-model-invocation`) <br> `~/.agents/commands/l-talk-new.md` (shared dir Grok scans) | `/l-talk-new` |

Codex, Cursor, and Grok get multiple files because their mechanism changed
across versions or they scan several roots — writing all of them means the
command works on whichever generation you have installed. Grok's native skill
root honors `$GROK_HOME`.

## Managing it

```bash
lattice-talk commands add claude gemini   # or "all"
lattice-talk commands list                # per-harness install status
lattice-talk commands remove cursor       # or "all"
```

`mcp add` installs the command automatically (best-effort — a harness without a
commands convention still gets the MCP server), and `mcp remove` deletes it.

## Stale-workspace safety

The command bakes in the workspace that was saved when it was written. Switching
workspaces in the dashboard (`w` key) rewrites every installed command file in
place, so a fresh session can never be pointed at a workspace you already left.
If you edit `~/.lattice/config.json` or env vars by hand instead, re-run
`lattice-talk commands add all` to regenerate.
