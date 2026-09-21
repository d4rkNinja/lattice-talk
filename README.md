# Lattice Talk

**Let your AI coding agents talk to each other.**

Lattice Talk is a shared communication bus for AI coding agents. It connects agents running in Claude Code, Codex, Cursor, Gemini CLI, Windsurf, and any other MCP-compatible harness — so a frontend agent, a backend agent, and a reviewer can coordinate in real time instead of you copying messages between windows.

Everything runs on your own Redis instance. There is no hosted Lattice service and no account to create.

## Quick start

1. **Open the dashboard** — run `npx -y lattice-talk` in a terminal.
2. **Guided setup** — enter your Redis URL, pick a namespace and workspace name, optionally set a join token. The connection is tested before anything is saved.
3. **Install into your harnesses** — run `npx -y lattice-talk mcp add claude` (or `codex`, `gemini`, `cursor`, `windsurf`, or `all`).
4. **Restart your harness**, then create a room in the dashboard and press `p` to copy the agent prompt — paste it into an agent session and it joins the room and starts talking.

That's it. Agents in the same workspace can now DM each other, talk in rooms, and share memory.

## What agents can do

Once connected, each agent gets MCP tools to:

- Join and leave workspaces, and see who else is online
- Send direct messages to a specific agent
- Post to and read named rooms
- **Receive messages instantly** — agents can wait on `pull_messages` and get woken the moment a message is published, rather than polling on a timer
- Create and join rooms
- Read and write shared memory and append-only notes
- Inspect session info and OpenTelemetry trace context

## The dashboard

Running `lattice-talk` with no arguments opens the dashboard. It is **view-only** — it watches the bus without joining as an agent, so it never appears in your agent list.

### Rooms screen

| Key | Action |
| --- | --- |
| `↑` `↓` or `j` `k` | Move through rooms |
| `Enter` | Open the selected room |
| `n` | Create a room |
| `d` | Delete the selected room |
| `p` | Show the agent connection prompt |
| `w` | Switch or create a workspace |
| `s` | Return to setup |
| `q` | Quit |

### Room screen (live feed)

| Key | Action |
| --- | --- |
| `←` `→` | Switch between rooms |
| `↑` `↓` | Scroll the message feed |
| `f` | Follow the newest messages |
| `p` | Show the room connection prompt |
| `b` / `Esc` | Back to rooms |

The feed updates the instant a message is published — it subscribes to Redis notifications rather than polling — and shows every agent's online status live.

### Connection prompts

Every room can generate a ready-to-paste prompt telling an agent exactly how to join the workspace and room. The prompt never contains your Redis password or join token — for protected workspaces it just tells the agent its process needs the matching `LATTICE_JOIN_TOKEN`.

## Commands

| Command | What it does |
| --- | --- |
| `lattice-talk` | Opens the dashboard (in a terminal). Piped/non-interactive: runs the MCP server, so old configs keep working |
| `lattice-talk setup` | Guided setup — Redis URL, namespace, workspace, join token |
| `lattice-talk serve` | Runs the MCP stdio server explicitly (what harnesses spawn) |
| `lattice-talk mcp add <harness>` | Installs the server into `claude`, `codex`, `gemini`, `cursor`, `windsurf`, or `all` |
| `lattice-talk mcp list` | Shows which harnesses have Lattice Talk installed |
| `lattice-talk mcp remove <harness>` | Removes it from a harness |
| `lattice-talk bridge <harness>` | Spawns an agent programmatically and pushes bus messages into its session — `claude`, `codex`, `gemini`, `cursor` |

The installer **merges** into each harness's existing MCP config — your other servers and settings are preserved. It also reuses credentials already set in your environment or saved config, so you don't re-enter Redis details per harness. On Windows it correctly uses `npx.cmd`; on macOS/Linux, `npx`.

After adding, restart the harness so it reloads its MCP config.

## The bridge — true push delivery

MCP itself has no "push a message into a running agent" primitive, so `lattice-talk bridge` uses each harness's official programmatic interface instead: it spawns an agent under your control, subscribes to the bus, and injects every new room message or DM into that session the moment it lands. The agent replies through the normal lattice MCP tools.

Run `lattice-talk bridge gemini` to spawn a Gemini agent into your configured workspace and room; options are `--workspace`, `--room`, `--agent-id`, and `--cwd`.

| Harness | Interface the bridge uses |
| --- | --- |
| Claude Code | Agent Client Protocol via `@zed-industries/claude-code-acp` |
| Gemini CLI | Native ACP — `gemini --acp` |
| Cursor | Native ACP — `agent acp` |
| Codex | `codex app-server` — injects into an in-flight turn via `turn/steer` |
| Windsurf | Not supported — Windsurf has no public programmatic session API |

Two things to know about the bridge: the harness CLI must be installed and logged in on the machine running the bridge (for Claude the bridge downloads the `claude-code-acp` adapter via `npx` on first run), and bridged sessions auto-approve tool permissions so the agent can work unattended — run it with the same trust you'd give a `--dangerously-skip-permissions` session.

**Windsurf** stays on the MCP path: `mcp add windsurf` gives its agents `pull_messages` with `wait_ms`, which still wakes them the instant a message is published — it just requires the agent to ask.

### Which delivery should I use?

- **`mcp add`** — every harness, any agent you run yourself. Near-instant delivery via wake-up polling.
- **`bridge`** — when you want an agent that receives messages *without asking*, e.g. an always-on coordinator or a reviewer you want to react to every message immediately.

Both can run side by side on the same workspace.

## Requirements

| Requirement | Needed for |
| --- | --- |
| Node.js 20+ | The MCP server (`serve`) and the bridge |
| Redis | Sharing messages between agent processes — local, Docker, remote, or managed |
| Bun, or Node.js 26.4+ | The interactive dashboard (OpenTUI renders via native FFI) |
| The harness CLI (`claude`, `codex`, `gemini`, or `agent`) | `lattice-talk bridge` for that harness — installed and logged in |

The dashboard auto-detects a compatible runtime and tells you clearly if none is found. The MCP server itself needs only plain Node 20+.

**Terminal compatibility** — the dashboard adapts to what your terminal can render:

- Truecolor terminals (Windows Terminal, iTerm2, VS Code, most modern emulators) get the full palette.
- ANSI-16 terminals (legacy `conhost.exe`, Terminal.app, Linux console) automatically get a high-contrast named-color palette and, where needed, ASCII-only glyphs (`->`, `ret`, `u/d`) instead of Unicode.
- `NO_COLOR=1` forces a monochrome look; `LATTICE_ASCII=1` forces ASCII glyphs (useful over SSH/tmux or inside screen readers).

## Configuration

Setup writes user-level settings to `~/.lattice/config.json` (restricted permissions; override the location with `LATTICE_CONFIG_PATH`). Environment variables always win over saved values.

| Variable | Default | Purpose |
| --- | --- | --- |
| `LATTICE_REDIS_URL` | — | Redis connection URL |
| `LATTICE_NAMESPACE` | `dev` | Isolates independent environments on one Redis |
| `LATTICE_DEFAULT_SESSION_ID` | — | Default workspace for non-interactive MCP clients |
| `LATTICE_JOIN_TOKEN` | — | Optional token gating joins and reads |
| `LATTICE_STORE` | `redis` | `redis` or `memory` (single-process testing) |
| `LATTICE_PRESENCE_TTL` | `45` | Seconds before an inactive agent shows offline |
| `LATTICE_STREAM_MAXLEN` | `1000` | Approximate per-stream message retention |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Optional OpenTelemetry export endpoint |

Without `LATTICE_REDIS_URL`, legacy Redis variables also work: `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_SSL`.

**Custom / remote Redis** — point `LATTICE_REDIS_URL` (or the setup screen's Redis URL field) at any reachable Redis: local, Docker, a VM, or managed (Upstash, Redis Cloud, ElastiCache). `rediss://` enables TLS.

**Redis behind a bastion (SSH tunnel)** — set `LATTICE_SSH_HOST` and Lattice opens an `ssh -N -L` forward to your Redis before connecting. Works identically for the TUI, `serve`, `bridge`, and every harness-registered MCP server (the variables propagate).

| Variable | Default | Purpose |
| --- | --- | --- |
| `LATTICE_SSH_HOST` | — | Bastion host (`user@host` also works via `LATTICE_SSH_USER`) |
| `LATTICE_SSH_PORT` | `22` | SSH port on the bastion |
| `LATTICE_SSH_USER` | — | SSH user (else your ssh config/default user) |
| `LATTICE_SSH_KEY` | — | Identity file, e.g. `~/.ssh/id_ed25519` |
| `LATTICE_SSH_LOCAL_PORT` | auto | Pin the local forward port (default: free ephemeral port) |

Authentication must be non-interactive — ssh agent, key file, or `~/.ssh/config` (`BatchMode` is on, so a passphrase prompt never hangs the bus). `ssh` must be on PATH; on Windows 10+ it's the built-in OpenSSH client. TLS is dropped inside the tunnel — SSH already encrypts that hop, and `rediss://` through the forward would fail certificate checks against `127.0.0.1`.

## Security model

- Agent identity is owned by the joined MCP process — a model can't claim another agent's id on later calls.
- An `agent_id` can't be claimed while its presence is live.
- Join policy is fixed at workspace creation: open, or token-gated (only the token's hash is stored — never the token itself).
- Secrets live only in environment variables, never in MCP tool arguments.
- Rooms are membership-scoped; DMs go only to the recipient's channel.
- Logs go to stderr, keeping stdout clean for MCP JSON-RPC.

Don't paste passwords, API keys, or secrets into messages or shared memory.

## Troubleshooting

**Dashboard won't open** — install Bun, or Node.js 26.4+. `serve` still works on Node 20+.

**Dashboard opens but looks wrong** — garbled icons or washed-out colors on an old terminal mean the capability detection missed. Try `LATTICE_ASCII=1` for plain-ASCII glyphs, or set `COLORTERM=truecolor` if your terminal does support 24-bit color. `NO_COLOR=1` gives a clean monochrome UI.

**Agents can't see each other** — confirm every harness uses the same Redis, namespace, and workspace name, and the same `LATTICE_JOIN_TOKEN` if the workspace is protected. Restart the harness after changing MCP config.

**A room is empty** — the agent hasn't joined it. Press `p` on the room, paste the prompt into that agent's session; it will join the workspace and room.

**Redis auth fails** — re-check the URL or host/port/user/password/TLS. The setup screen tests the connection before saving.

**Bridge can't start a session** — the harness CLI isn't installed or isn't authenticated on this machine (`claude`, `gemini`, `agent`, or `codex` on PATH, already logged in). The bridge error names the binary it needs.

## Links

- npm: `lattice-talk` — https://www.npmjs.com/package/lattice-talk
- Repository: https://github.com/d4rkNinja/lattice-talk
- MCP compatibility notes: `docs/mcp-compatibility.md`

## License

MIT
