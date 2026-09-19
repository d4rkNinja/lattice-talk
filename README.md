# Lattice — Cross-Harness MCP Session Bus

**[Model Context Protocol](https://modelcontextprotocol.io/docs)** (MCP) is an open standard for connecting AI applications to external systems — tools, data, and workflows — over JSON-RPC. Think of it as a USB-C port for agents: one protocol, many hosts (Claude, Cursor, Codex, and others).

**Lattice** is a **local stdio MCP server** that uses that protocol as a **session bus**. Agents in any harness join the same `session_id`, talk via DMs and rooms, share intentional session memory, and emit OpenTelemetry traces so work stays coherent even when agents run on different machines.

The MCP process **is** the product. Redis is only the shared store behind it. This is not a database platform, not a hosted Lattice HTTP API, and not Redis-as-MCP.

Canonical docs: [MCP documentation hub](https://modelcontextprotocol.io/docs). **Feature-aligned with 2026-07-28; wire = SDK v1 / initialize for today’s Claude/Cursor/Codex.** We do not speak MCP 2026-07-28 on the wire (`server/discover` + per-request `_meta`). Feature docs snapshot: [2026-07-28 intro](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro).

**Package:** `lattice-talk` (unscoped). Binary: `lattice-talk` → `dist/index.js`. **Not on npm yet** — `npx -y lattice-talk` 404s until the package is published. Clone this repo and `npm run build` for a local binary.

## How Lattice follows MCP (feature-aligned with 2026-07-28)

Lattice is a **stdio-only** server: the host launches this process and speaks newline-delimited JSON-RPC on stdin/stdout. The **wire** is `@modelcontextprotocol/sdk` v1 / classic `initialize` (what Claude, Cursor, and Codex still open). Feature shape (tools, resources, prompts) matches the [2026-07-28 docs](https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts). The 2026-07-28 spec itself [removed `initialize`](https://modelcontextprotocol.io/specification/2026-07-28/changelog) in favor of `server/discover` + per-request `_meta`; we do not migrate to `@modelcontextprotocol/server` v2.

| MCP primitive | Lattice |
| --- | --- |
| **Tools** (model-controlled) | 14 tools: join/leave/list/info, tell/pull/rooms, memory, `trace_context`. Registered with `McpServer.registerTool` from `@modelcontextprotocol/sdk`. Flat JSON Schema objects (no root `anyOf` / `oneOf` / `allOf`). Annotations: `title`, `readOnlyHint`, `destructiveHint`, `openWorldHint` (**false** — Lattice is a closed store, not the open web), `idempotentHint`. Results: `content` text JSON + `structuredContent` matching each tool’s `outputSchema` + `isError` for execution errors. |
| **Resources** (application-controlled) | Compact session context, not a filesystem. `lattice://about`, template `lattice://session/{session_id}`, template `lattice://session/{session_id}/memory`. URI + `mimeType` + `resources/read`. Missing / never-joined session → JSON-RPC `-32602` (`Resource not found`). |
| **Prompts** (user-controlled) | `join-session`, `two-agent-handoff`, `pull-and-reply` — slash-style starters that tell the model how to use the tools. |
| **Logging** | **stderr** (and optional OTEL). Protocol `notifications/message` is [deprecated in 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/deprecated); this server does not adopt it. **Never** write non-protocol bytes to stdout. |
| **Auth for this process** | Stdio inherits MCP `env`. Redis passwords and `LATTICE_JOIN_TOKEN` stay in env, never in tool args. OAuth / Streamable HTTP are out of scope for v1. |

**Server metadata:** `name` is `lattice-talk`, plus `instructions` for tool search. Capabilities for tools, resources, and prompts are advertised. `listChanged` is **false** on all three — this server does not emit `notifications/*/list_changed`.

**SDK note:** Official 2026-07-28 TypeScript samples now use `@modelcontextprotocol/server` (SDK v2: `server/discover`, per-request `_meta`, no `initialize`). Lattice stays on **`@modelcontextprotocol/sdk` v1** so Claude Code, Cursor, and Codex — which still open stdio with the legacy `initialize` handshake — can connect. Feature-aligned with 2026-07-28; wire = SDK v1 / initialize for today’s Claude/Cursor/Codex. See [Gaps](#gaps-vs-the-full-2026-07-28-spec).

## Why

Two coding agents cannot see each other across harnesses or machines. Users become the message bus. Lattice gives them one `session_id` and tools: tell an agent, tell a room, shared memory, pull messages.

## Non-goals (v1)

- SQLite mega-DB / multi-model database product
- A separate always-on Lattice HTTP/API server
- Clustering UI / Studio
- A2A as the primary wire protocol
- Streamable HTTP / OAuth remote hosting

## How it works

```
Harness A (Claude / Cursor / Codex)
  └─ spawns lattice-talk (stdio MCP)
        ├─ tools / resources / prompts
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

**Primary path (after publish):** `npx -y lattice-talk`. The npm package ships `dist/`, README, LICENSE, and `package.json`. Requires **Node ≥ 20**. Redis is required for anything beyond one process.

This package is **not on npm yet**. Until it is published, `npx -y lattice-talk` 404s.

**Local from source:** `npm install && npm run build`, then `node dist/index.js` (or `npx lattice-talk` from this repo after build). `dist/` is a build output, not a committed product.

```json
{
  "mcpServers": {
    "lattice": {
      "command": "npx",
      "args": ["-y", "lattice-talk"],
      "env": {
        "LATTICE_REDIS_URL": "redis://127.0.0.1:6379/0",
        "LATTICE_NAMESPACE": "dev"
      }
    }
  }
}
```

Local-from-source equivalent: `"command": "node"`, `"args": ["dist/index.js"]` after `npm run build` (use an absolute path if the host does not start in this repo).

```bash
claude mcp add --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 --env LATTICE_NAMESPACE=dev --transport stdio lattice -- npx -y lattice-talk
```

## Official-style server config

Same shape as the [local MCP servers](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers) guide (`mcpServers` + `command` / `args` / `env`). Claude Desktop uses `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "lattice": {
      "command": "npx",
      "args": ["-y", "lattice-talk"],
      "env": {
        "LATTICE_REDIS_URL": "redis://127.0.0.1:6379/0",
        "LATTICE_NAMESPACE": "dev"
      }
    }
  }
}
```

Logs belong on **stderr**. Inspect a running server with:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Set `LATTICE_STORE=memory` in the Inspector env for a single-process smoke test.

## Environment (MCP `env` only)

Agents **never** pass Redis passwords in tool arguments. Configure the MCP server process:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LATTICE_REDIS_URL` | if store=redis | — | `redis://user:pass@host:6379/0` (or `rediss://`) |
| `REDIS_HOST` | alternative | — | Used with `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_SSL` |
| `LATTICE_NAMESPACE` | no | `dev` | Key prefix namespace |
| `LATTICE_DEFAULT_SESSION_ID` | no | — | Used when tools omit `session_id`; also listed as `lattice://session/{id}` |
| `LATTICE_JOIN_TOKEN` | no | — | Shared secret; `join_session` must send matching `join_token` |
| `LATTICE_STORE` | no | `redis` | `redis` \| `memory` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | If unset, tracing is a no-op |
| `OTEL_SERVICE_NAME` | no | `lattice-talk` | OTEL resource `service.name` |
| `OTEL_EXPORTER_OTLP_HEADERS` | no | — | `k=v,k2=v2` or header-line / `k: v` form |

Optional knobs: `LATTICE_PRESENCE_TTL` (seconds, default 45), `LATTICE_STREAM_MAXLEN` (approx XADD MAXLEN, default 1000).

## Claude Code

Lattice is a **local stdio** server. Put the launch command after `--`. Put `--transport stdio` between `--env` and the server name (if the name follows `--env` directly, the CLI treats it as another `KEY=value` pair).

```bash
# local scope (default): only you, this project — stored in ~/.claude.json
claude mcp add --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 --env LATTICE_NAMESPACE=dev --transport stdio lattice -- npx -y lattice-talk

# user scope: only you, all projects
claude mcp add --scope user --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 --transport stdio lattice -- npx -y lattice-talk

# project scope: team-shared .mcp.json at the repo root (Claude Code prompts for approval)
claude mcp add --scope project --transport stdio lattice -- npx -y lattice-talk
```

Equivalent JSON (`claude mcp add-json` takes the object *inside* `mcpServers`, not the wrapper):

```bash
claude mcp add-json lattice '{"type":"stdio","command":"npx","args":["-y","lattice-talk"],"env":{"LATTICE_REDIS_URL":"${LATTICE_REDIS_URL}","LATTICE_NAMESPACE":"${LATTICE_NAMESPACE:-dev}"}}'
```

Project `.mcp.json` (check this in). Claude Code expands `${VAR}` and `${VAR:-default}` in `command`, `args`, and `env`. A missing `${VAR}` with no default stays literal and warns in `claude mcp list`.

```json
{
  "mcpServers": {
    "lattice": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "lattice-talk"],
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

On Windows, `~/.claude.json` is `%USERPROFILE%\.claude.json`. `claude mcp add` works in PowerShell and Command Prompt. Until this package is published, use local-from-source: `npm run build` then `"command": "node"` and the absolute path to `dist/index.js`.

Lattice follows the Claude Code stdio contract: **stdout is MCP JSON-RPC only** (logs go to stderr), tool input schemas are **flat objects** (no root `anyOf` / `oneOf` / `allOf`, ASCII property names), Redis credentials stay in `env`, and tool results stay small (paginate / truncate; Claude Code warns above 10k tokens and caps at 25k by default). OAuth / `--header` apply to remote HTTP servers, not this process.

## Cursor

`mcp.json` (Cursor MCP settings):

```json
{
  "mcpServers": {
    "lattice": {
      "command": "npx",
      "args": ["-y", "lattice-talk"],
      "env": {
        "LATTICE_REDIS_URL": "redis://127.0.0.1:6379/0",
        "LATTICE_NAMESPACE": "dev"
      }
    }
  }
}
```

## Codex

`~/.codex/config.toml` (or project config):

```toml
[mcp_servers.lattice]
command = "npx"
args = ["-y", "lattice-talk"]

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
9. A: `memory_set` `key=api.base` `value=https://api.dev`. B: `memory_get` returns the same value. Either side can read `lattice://session/demo-1/memory`.
10. `trace_context` returns `conversation_id` equal to `session_id`.

Local smoke without Redis:

```bash
# in MCP env
LATTICE_STORE=memory
```

Memory store is **one process**. Two harnesses cannot share it.

## Tools

After `join_session`, **this process** owns `session_id` / `agent_id`. Mutating tools (`tell_agent`, `tell_room`, `pull_messages`, `memory_set`, `memory_note`, `create_room`, `join_room`, `leave_session`) use that identity — they do not accept another `agent_id`. Read-only tools (`session_info`, `list_peers`, `memory_get`, `memory_list`, `trace_context`) may pass `session_id` only when it matches the joined session or `LATTICE_DEFAULT_SESSION_ID`. `agent_id` remains on `join_session` only (optional self-id). Schemas stay flat.

### Session / presence

| Tool | Purpose |
| --- | --- |
| `join_session` | Register agent, ensure room `main`, start presence (TTL ~45s), return peers |
| `leave_session` | This process leaves and clears its presence (cannot kick another agent) |
| `list_peers` | Who is in the session; `online` if the presence key exists. Paginated (`cursor`, `limit` default 100, max 200) |
| `session_info` | Debug: session_id, namespace, peer count, rooms (capped) |

### Messaging

| Tool | Purpose |
| --- | --- |
| `tell_agent` | DM another agent as this process (`from` is the joined agent; recipient must exist) |
| `tell_room` | Broadcast to a room as this process (`room_id` default `main`; caller must be a member) |
| `pull_messages` | Read since **this process's** cursor (room or inbox), advance cursor, refresh presence. Room pulls require membership |
| `create_room` | Create a named room and add this process as a member |
| `join_room` | Join room membership as this process |

**Inbox design:** DMs live on a **per-pair stream**. Pair key = sorted agent ids joined by `:` (`backend:frontend`). Cursor id is `dm:{pair}`. `pull_messages` with `inbox=true` reads every pair involving the caller (or one pair if `other_agent_id` is set). Room pulls use `room_id` (default `main`). Default limit 50, max 200. Bodies longer than ~2k characters are truncated with `truncated: true`.

### Memory (shared facts, not tool dumps)

| Tool | Purpose |
| --- | --- |
| `memory_set` | Set session key/value |
| `memory_get` | Get key |
| `memory_list` | List keys (paginated; `cursor`, `limit` default 50, max 200; optional short values) |
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

## Resources and prompts

These are the other two [core MCP server primitives](https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts) (feature-aligned; wire is still SDK v1 / initialize). They stay small on purpose: Lattice is a session bus, not a filesystem or HTTP API.

| Resource | Kind | What you get |
| --- | --- | --- |
| `lattice://about` | static | Package name, spec date, store kind, namespace — no secrets |
| `lattice://session/{session_id}` | template | Same compact snapshot as `session_info` |
| `lattice://session/{session_id}/memory` | template | Memory **keys** only (same as `memory_list` without values) |

If `LATTICE_DEFAULT_SESSION_ID` is set, those two session URIs also appear in `resources/list`. Other session ids are readable via the templates **only if that session has been joined** (has session meta). Unknown session ids return JSON-RPC `-32602` (`Resource not found`), not an empty success body. The list does **not** change after `join_session` (feature-aligned 2026-07-28: listings must not vary as a side effect of other requests).

| Prompt | Use |
| --- | --- |
| `join-session` | Join a session and inspect peers / `lattice://session/{id}` |
| `two-agent-handoff` | Same `session_id` on two harnesses or machines (Redis required) |
| `pull-and-reply` | `pull_messages` then `tell_room` / `tell_agent` |

Prompt `session_id` arguments support completions from the default session and the last join.

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
- After `join_session`, later tools use this process's identity. Passing another `agent_id` is ignored or rejected (the field exists only on `join_session`).
- Tool results are compact JSON. Claude Code warns above **10,000** tokens and persists results above **25,000** tokens (`MAX_MCP_OUTPUT_TOKENS`). `memory_list` and `list_peers` paginate (`cursor` / `limit`); message bodies over ~2k characters are truncated.
- Resource URIs are validated (`session_id` charset). Unknown URIs are JSON-RPC invalid params, not an empty `contents` array.

## Gaps vs the full 2026-07-28 spec

Honest subset — v1 stays a stdio session bus that current harnesses can launch:

- **Wire era:** feature-aligned with 2026-07-28; wire = SDK v1 / initialize for today’s Claude/Cursor/Codex. 2026-07-28 removed that handshake for `server/discover` + per-request `_meta`. Dual-era / modern-only servers use `@modelcontextprotocol/server` (SDK v2). We do not migrate, so Claude Code / Cursor / Codex keep working.
- **No Streamable HTTP, OAuth, MCP Apps, Tasks extension, elicitation / MRTR.**
- **No protocol logging capability** (deprecated; stderr + OTEL instead).
- **No resource subscriptions** (`subscriptions/listen`) — session data changes through tools; re-read the URI when you need a snapshot.
- **No `listChanged` notifications** — capabilities advertise `listChanged: false` because the 14 tools / 3 resources / 3 prompts are static.
- Completions exist only for `session_id` on prompts/resource templates.

## Develop

```bash
npm install
npm run typecheck
npm test          # MemoryStore + unit tests; Redis / two-process E2E skipped unless LATTICE_REDIS_URL is set
npm run build     # bundled dist/index.js (shebang via tsup banner) — required before stdio smoke / E2E
npm start         # node dist/index.js
```

```bash
LATTICE_STORE=memory node dist/index.js
```

`dist/` is gitignored. Rebuild after source changes (`npm run build`) before running `node dist/index.js` or MCP configs that point at the local binary.

## License

MIT
