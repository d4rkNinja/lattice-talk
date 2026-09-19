# Lattice — Cross-Harness MCP Session Bus

Lattice is a **stdio MCP server** that lets AI agents in any harness (Claude Code, Cursor, Codex, or custom) join the **same session**, talk via DMs and rooms, share intentional session memory, and emit OpenTelemetry traces so work stays coherent even when agents run on different machines.

Install once, point every harness at the same Redis URL + `session_id`. Stop copy-pasting between a frontend agent in Cursor and a backend agent in Claude Code.

The MCP process **is** the product. Redis is only the shared store behind it. This is not a database platform, not a hosted Lattice HTTP API, and not Redis-as-MCP.

**Package:** `lattice-mcp` (intended scoped publish name: `@scope/lattice-mcp`)

```bash
npx -y @scope/lattice-mcp
```

## Why

Two coding agents cannot see each other across harnesses or machines. Users become the message bus. Lattice gives them one `session_id` and tools: tell an agent, tell a room, shared memory, pull messages.

## Non-goals (v1)

- SQLite mega-DB / multi-model database product
- A separate always-on Lattice HTTP/API server
- Clustering UI / Studio
- A2A as the primary wire protocol

## How it works

```
Harness A (Claude / Cursor / Codex)
  └─ spawns lattice-mcp (stdio MCP)
        ├─ tools: join / tell / pull / memory / …
        ├─ Redis (sessions, rooms, streams, presence, memory)
        └─ OTEL exporter (optional)

Harness B (other machine / harness)
  └─ same package, same Redis URL + same OTEL endpoint + same session_id
```

Three stores:

| Store | Backend | Role |
| --- | --- | --- |
| **Bus** | Redis (or in-memory) | Sessions, agents, presence, rooms, message streams, cursors |
| **Memory** | Redis (or in-memory) | Intentional shared KV + append-only notes — not raw tool dumps |
| **Traces** | OpenTelemetry OTLP | Harness/tool timeline. `session_id` === `gen_ai.conversation.id` |

`LATTICE_STORE=memory` is single-process only (local smoke tests). Cross-harness and cross-machine require Redis.

## Install

```bash
npx -y @scope/lattice-mcp
```

Or publish/link this package as `lattice-mcp` and run `npx -y lattice-mcp`. The binary is `lattice-mcp` → `dist/index.js`.

Requires **Node ≥ 20**. Redis is required for anything beyond one process.

### Run from this repo (no npm install)

`dist/index.js` is a bundled stdio MCP server (shebang + deps inlined). Point Claude, Cursor, or Codex at it with `node` and the path to that file — no `npm install` and no `npx` publish step.

Replace the path with the absolute path to this clone:

```json
{
  "mcpServers": {
    "lattice": {
      "command": "node",
      "args": ["D:/Codeverse/lettice-mcp/dist/index.js"],
      "env": {
        "LATTICE_REDIS_URL": "redis://127.0.0.1:6379/0",
        "LATTICE_NAMESPACE": "dev"
      }
    }
  }
}
```

Relative path from the workspace root also works: `args: ["dist/index.js"]`.

Claude Code (local binary, no `npx`):

```bash
claude mcp add --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 --env LATTICE_NAMESPACE=dev --transport stdio lattice -- node /absolute/path/to/dist/index.js
```

A committed `dist/` is for **local MCP**. The intended npm install path remains `npx -y @scope/lattice-mcp` after publish.

## Environment (MCP `env` only)

Agents **never** pass Redis passwords in tool arguments. Configure the MCP server process:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LATTICE_REDIS_URL` | if store=redis | — | `redis://user:pass@host:6379/0` (or `rediss://`) |
| `REDIS_HOST` | alternative | — | Used with `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_SSL` |
| `LATTICE_NAMESPACE` | no | `dev` | Key prefix namespace |
| `LATTICE_DEFAULT_SESSION_ID` | no | — | Used when tools omit `session_id` |
| `LATTICE_JOIN_TOKEN` | no | — | Shared secret; `join_session` must send matching `join_token` |
| `LATTICE_STORE` | no | `redis` | `redis` \| `memory` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | If unset, tracing is a no-op |
| `OTEL_SERVICE_NAME` | no | `lattice-mcp` | OTEL resource `service.name` |
| `OTEL_EXPORTER_OTLP_HEADERS` | no | — | `k=v,k2=v2` or header-line / `k: v` form |

Optional knobs: `LATTICE_PRESENCE_TTL` (seconds, default 45), `LATTICE_STREAM_MAXLEN` (approx XADD MAXLEN, default 1000).

## Harness config

User config target (replace `@scope/lattice-mcp` with `lattice-mcp` if you published unscoped):

```json
{
  "mcpServers": {
    "lattice": {
      "command": "npx",
      "args": ["-y", "@scope/lattice-mcp"],
      "env": {
        "LATTICE_REDIS_URL": "redis://...",
        "LATTICE_NAMESPACE": "dev"
      }
    }
  }
}
```

### Claude Code

Lattice is a **local stdio** server. Put the launch command after `--` so Claude Code does not parse `-y` as its own flag. Put `--transport stdio` between `--env` and the server name (if the name follows `--env` directly, the CLI treats it as another `KEY=value` pair).

```bash
# local scope (default): only you, this project — stored in ~/.claude.json
claude mcp add --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 --env LATTICE_NAMESPACE=dev --transport stdio lattice -- npx -y @scope/lattice-mcp

# user scope: only you, all projects
claude mcp add --scope user --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 --transport stdio lattice -- npx -y @scope/lattice-mcp

# project scope: team-shared .mcp.json at the repo root (Claude Code prompts for approval)
claude mcp add --scope project --transport stdio lattice -- npx -y @scope/lattice-mcp
```

Equivalent JSON (`claude mcp add-json` takes the object *inside* `mcpServers`, not the wrapper):

```bash
claude mcp add-json lattice '{"type":"stdio","command":"npx","args":["-y","@scope/lattice-mcp"],"env":{"LATTICE_REDIS_URL":"${LATTICE_REDIS_URL}","LATTICE_NAMESPACE":"${LATTICE_NAMESPACE:-dev}"}}'
```

Project `.mcp.json` (check this in). Claude Code expands `${VAR}` and `${VAR:-default}` in `command`, `args`, and `env`. A missing `${VAR}` with no default stays literal and warns in `claude mcp list`.

```json
{
  "mcpServers": {
    "lattice": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@scope/lattice-mcp"],
      "env": {
        "LATTICE_REDIS_URL": "${LATTICE_REDIS_URL}",
        "LATTICE_NAMESPACE": "${LATTICE_NAMESPACE:-dev}",
        "LATTICE_JOIN_TOKEN": "${LATTICE_JOIN_TOKEN}",
        "OTEL_EXPORTER_OTLP_ENDPOINT": "${OTEL_EXPORTER_OTLP_ENDPOINT}"
      }
    }
  }
}
```

| Scope | File | Who sees it |
| --- | --- | --- |
| `local` (default) | `~/.claude.json` under this project | Only you, this project |
| `project` | `.mcp.json` in the project root | Everyone who clones the repo |
| `user` | `~/.claude.json` top-level `mcpServers` | Only you, all projects |

On Windows, `~/.claude.json` is `%USERPROFILE%\.claude.json`. `claude mcp add` works in PowerShell and Command Prompt. Official examples use `"command": "npx"` (not a `cmd /c` wrapper). A first `npx -y` download can exceed the 30s startup timeout:

```powershell
$env:MCP_TIMEOUT = "60000"; claude
```

Lattice follows the Claude Code stdio contract: **stdout is MCP JSON-RPC only** (logs go to stderr), tool input schemas are **flat objects** (no root `anyOf` / `oneOf` / `allOf`, ASCII property names), Redis credentials stay in `env`, and tool results stay small (paginate / truncate; Claude Code warns above 10k tokens and caps at 25k by default). OAuth / `--header` apply to remote HTTP servers, not this process.

### Cursor

`mcp.json` (Cursor MCP settings):

```json
{
  "mcpServers": {
    "lattice": {
      "command": "npx",
      "args": ["-y", "@scope/lattice-mcp"],
      "env": {
        "LATTICE_REDIS_URL": "redis://127.0.0.1:6379/0",
        "LATTICE_NAMESPACE": "dev"
      }
    }
  }
}
```

From this repo without install or publish, use `node` and the built file:

```json
{
  "mcpServers": {
    "lattice": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "LATTICE_REDIS_URL": "redis://127.0.0.1:6379/0",
        "LATTICE_NAMESPACE": "dev"
      }
    }
  }
}
```

### Codex

`~/.codex/config.toml` (or project config):

```toml
[mcp_servers.lattice]
command = "npx"
args = ["-y", "@scope/lattice-mcp"]

[mcp_servers.lattice.env]
LATTICE_REDIS_URL = "redis://127.0.0.1:6379/0"
LATTICE_NAMESPACE = "dev"
```

## Two-machine demo checklist

1. Run Redis reachable from both machines (`LATTICE_REDIS_URL` identical, including DB index).
2. Same `LATTICE_NAMESPACE` on both MCP configs.
3. Same optional `LATTICE_JOIN_TOKEN` if set.
4. Same optional `OTEL_EXPORTER_OTLP_ENDPOINT` if you want one trace timeline.
5. Agent A: `join_session` with `session_id=demo-1`, `role=frontend`.
6. Agent B: `join_session` with the **same** `session_id=demo-1`, `role=backend`.
7. `list_peers` on either side shows both (online while presence TTL is fresh).
8. A: `tell_room` body `hello from A`. B: `pull_messages` (after idle) sees it.
9. A: `memory_set` `key=api.base` `value=https://api.dev`. B: `memory_get` returns the same value.
10. `trace_context` returns `conversation_id` equal to `session_id`.

Local smoke without Redis:

```bash
# in MCP env
LATTICE_STORE=memory
```

Memory store is **one process**. Two harnesses cannot share it.

## Tools

After `join_session`, this process remembers `session_id` / `agent_id`. You can still pass them on every call (flat schema). If omitted, `LATTICE_DEFAULT_SESSION_ID` is used for `session_id`.

### Session / presence

| Tool | Purpose |
| --- | --- |
| `join_session` | Register agent, ensure room `main`, start presence (TTL ~45s), return peers |
| `leave_session` | Leave and clear presence |
| `list_peers` | Who is in the session; `online` if the presence key exists |
| `session_info` | Debug: session_id, namespace, peer count, rooms |

### Messaging

| Tool | Purpose |
| --- | --- |
| `tell_agent` | DM another agent |
| `tell_room` | Broadcast to a room (`room_id` default `main`) |
| `pull_messages` | Read since cursor (room or inbox), advance cursor, refresh presence |
| `create_room` | Create a named room |
| `join_room` | Join room membership |

**Inbox design:** DMs live on a **per-pair stream**. Pair key = sorted agent ids joined by `:` (`backend:frontend`). Cursor id is `dm:{pair}`. `pull_messages` with `inbox=true` reads every pair involving the caller (or one pair if `other_agent_id` is set). Room pulls use `room_id` (default `main`). Default limit 50, max 200. Bodies longer than ~2k characters are truncated with `truncated: true`.

### Memory (shared facts, not tool dumps)

| Tool | Purpose |
| --- | --- |
| `memory_set` | Set session key/value |
| `memory_get` | Get key |
| `memory_list` | List keys (optional short values) |
| `memory_note` | Append-only note |

### Observability

| Tool | Purpose |
| --- | --- |
| `trace_context` | `{ session_id, conversation_id, traceparent, namespace }` |

Mutating tools emit an OTEL span when an exporter is configured, with:

- `gen_ai.conversation.id` = `session_id`
- `gen_ai.agent.name` = role or display name
- `lattice.session_id`, `lattice.agent_id`, `lattice.harness`, `lattice.room_id`, `lattice.namespace`

Outbound stream messages include `traceparent` when a span is active.

## Redis key layout

Prefix: `lattice:{ns}:...`

**Cluster hash tags:** every key includes `{session_id}` so all keys for a session map to one hash slot. Example: `lattice:dev:session:{team-42}:meta`.

| Key | Type | Purpose |
| --- | --- | --- |
| `lattice:{ns}:session:{sid}:meta` | Hash | created_at, created_by, namespace |
| `lattice:{ns}:session:{sid}:agents` | Hash | agent records |
| `lattice:{ns}:session:{sid}:presence:{agent_id}` | String + TTL 45s | Online if key exists |
| `lattice:{ns}:session:{sid}:rooms` | Set | Room ids |
| `lattice:{ns}:session:{sid}:join` | String | SHA-256 of join token (optional) |
| `lattice:{ns}:session:{sid}:dm_partners:{agent_id}` | Set | DM counterpart ids (inbox index) |
| `lattice:{ns}:room:{sid}:{rid}:meta` | Hash | Room metadata |
| `lattice:{ns}:room:{sid}:{rid}:members` | Set | Members |
| `lattice:{ns}:stream:session:{sid}:room:{rid}` | Stream | Room messages (`XADD MAXLEN ~ 1000`) |
| `lattice:{ns}:stream:session:{sid}:dm:{pair}` | Stream | DM pair stream |
| `lattice:{ns}:cursor:{sid}:{agent_id}:{rid}` | String | Last-read stream id (`rid` is a room id or `dm:{pair}`) |
| `lattice:{ns}:wake:{sid}` | Pub/Sub | Optional wakeup on new messages |
| `lattice:{ns}:memory:{sid}:kv` | Hash | Shared facts |
| `lattice:{ns}:memory:{sid}:notes` | Stream | Append-only notes |
| `lattice:{ns}:memory:{sid}:meta:{key}` | Hash | Optional per-key memory metadata |

Default room: **`main`** (created on join).

Stream fields: `from`, `to?`, `role`, `harness`, `kind` (`chat` \| `status` \| `task` \| `system`), `body`, `ts`, `traceparent`.

Presence is refreshed on **join** and **pull**.

## OpenTelemetry

If `OTEL_EXPORTER_OTLP_ENDPOINT` is unset, Lattice does not crash and does not export spans.

When set, spans share `gen_ai.conversation.id` = `session_id` so a Cursor agent and a Claude Code agent on two machines land on one conversation timeline.

## Security

- Redis credentials: **environment only**, never tool args.
- `LATTICE_JOIN_TOKEN`: optional shared secret, checked on `join_session` only (timing-safe compare). Hash stored at the session join key.
- Logs go to **stderr**. stdout is MCP JSON-RPC only (a `console.log` would break the client).
- Tool results are compact JSON. Claude Code warns above **10,000** tokens and persists results above **25,000** tokens (`MAX_MCP_OUTPUT_TOKENS`). Lists paginate; message bodies over ~2k characters are truncated.

## Develop

```bash
npm install
npm test          # MemoryStore + unit tests; Redis integration skipped unless LATTICE_REDIS_URL is set
npm run build     # bundled dist/index.js (shebang via tsup banner)
npm start         # node dist/index.js
```

```bash
LATTICE_STORE=memory node dist/index.js
```

Rebuild `dist/` after source changes (`npm run build`). The committed bundle is enough to run MCP without installing dependencies.

## License

MIT
