# Lattice

Local **stdio** [MCP](https://modelcontextprotocol.io/docs) server that is a **session bus**. Agents in Claude Code, Cursor, Codex, or a custom host join the same `session_id`, then DM, talk in rooms, share short session memory, and emit optional OpenTelemetry spans.

The MCP process is the product. Redis is only the shared store. This is not a hosted Lattice API and not Redis-as-MCP.

**Package:** [`lattice-talk`](https://github.com/d4rkNinja/lattice-talk) (unscoped). Binary: `lattice-talk` → `dist/index.js`. **Node ≥ 20.**

**Not on npm yet.** `npx -y lattice-talk` 404s until the package is published. Until then, build from this repo and point the host at `node dist/index.js`.

## Features

- Join one `session_id` from any harness or machine (Redis required across processes)
- DMs (recipient must exist) and rooms (membership enforced)
- Intentional shared memory (KV + append-only notes) — not raw tool dumps
- 14 tools, 3 resources, 3 prompts; `openWorldHint: false` (closed store)
- Optional OTLP traces with `gen_ai.conversation.id` = `session_id`

## Install

**After publish:**

```bash
npx -y lattice-talk
```

**From this repo today:**

```bash
npm install
npm run build
node dist/index.js
```

`dist/` is a build output (gitignored). Rebuild after source changes. Do not treat a committed bundle as the product.

Redis is required for anything beyond one process. For a single-process smoke test, set `LATTICE_STORE=memory` in the MCP env.

### Claude Code / Cursor (`mcp.json`)

After publish:

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

Local-from-source (until npm publish): `"command": "node"`, `"args": ["/absolute/path/to/lattice-talk/dist/index.js"]` after `npm run build` (absolute path if the host does not start in this repo). Put Redis URL and namespace in `env` — never as tool arguments.

Claude Code expands `${VAR}` and `${VAR:-default}` in `command`, `args`, and `env`. A missing `${VAR}` with no default stays literal. Cursor uses the same `mcpServers` / `command` / `args` / `env` shape (Cursor may omit `"type"`).

```bash
# command goes after --
claude mcp add --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 --env LATTICE_NAMESPACE=dev --transport stdio lattice -- npx -y lattice-talk
```

`--transport stdio` must sit between `--env` and the server name. Scopes: `local` (default, `~/.claude.json` for this project), `user` (all your projects), `project` (checked-in `.mcp.json`).

```bash
claude mcp add-json lattice '{"type":"stdio","command":"npx","args":["-y","lattice-talk"],"env":{"LATTICE_REDIS_URL":"${LATTICE_REDIS_URL}","LATTICE_NAMESPACE":"${LATTICE_NAMESPACE:-dev}"}}'
```

Until publish, swap the command after `--` for `node` plus the absolute path to `dist/index.js`.

Logs go to **stderr**. Inspect a local build with:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Codex

`~/.codex/config.toml` (or project config):

```toml
[mcp_servers.lattice]
command = "npx"
args = ["-y", "lattice-talk"]

[mcp_servers.lattice.env]
LATTICE_REDIS_URL = "redis://127.0.0.1:6379/0"
LATTICE_NAMESPACE = "dev"
```

Same unpublished caveat: use `command = "node"` and `args = ["<absolute>/dist/index.js"]` until `lattice-talk` is on npm.

## Tools

14 tools. Flat JSON Schema objects (no root `anyOf` / `oneOf` / `allOf`). Results: text JSON + `structuredContent` + `isError` on execution errors. `list_peers` and `memory_list` paginate (`cursor`, `limit`; defaults 100 / 50, max 200). `pull_messages` default limit 50, max 200; bodies over ~2k characters set `truncated: true`.

After `join_session`, **this process** owns `session_id` / `agent_id`. Mutating tools do not take `agent_id`. Optional `session_id` on those tools must match the joined session. Read-only tools may pass `session_id` only when it matches the joined session or `LATTICE_DEFAULT_SESSION_ID`. `agent_id` exists only on `join_session` (optional self-id).

| Tool | Purpose |
| --- | --- |
| `join_session` | Register this agent, ensure room `main`, start presence (~45s TTL), return peers |
| `leave_session` | This process leaves and clears its presence (cannot kick another agent) |
| `list_peers` | Who is in the session; `online` if the presence key exists. Paginated |
| `session_info` | Compact debug: session_id, namespace, peer count, rooms (capped) |
| `tell_agent` | DM another agent as this process. Recipient must already be in the session |
| `tell_room` | Broadcast as this process (`room_id` default `main`). Caller must be a member |
| `pull_messages` | Read since **this process's** cursor (room or inbox), advance it, refresh presence. Room pulls require membership |
| `create_room` | Create a room and add this process as a member |
| `join_room` | Join a room as this process |
| `memory_set` | Set a session key/value (shared fact, not a tool dump) |
| `memory_get` | Get a key |
| `memory_list` | List keys (paginated; optional short values) |
| `memory_note` | Append-only note |
| `trace_context` | `{ session_id, conversation_id, traceparent, namespace }` |

**DMs:** per-pair Redis stream. Pair key = sorted agent ids joined by `:` (e.g. `backend:frontend`). Cursor id is `dm:{pair}`. `pull_messages` with `inbox=true` reads every pair involving this process, or one pair if `other_agent_id` is set.

**Rooms:** `tell_room` / room `pull_messages` call `assertRoomMember`. Non-members cannot send or read.

**Traces:** mutating tools emit an OTEL span when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (`gen_ai.conversation.id` = `session_id`). Outbound stream messages include `traceparent` when a span is active. If the endpoint is unset, tracing is a no-op.

## Resources

| Resource | Kind | What you get |
| --- | --- | --- |
| `lattice://about` | static | Package name, spec date, store kind, namespace — no secrets |
| `lattice://session/{session_id}` | template | Same compact snapshot as `session_info` |
| `lattice://session/{session_id}/memory` | template | Memory **keys** only (same as `memory_list` without values) |

If `LATTICE_DEFAULT_SESSION_ID` is set, those two session URIs also appear in `resources/list`. Other session ids are readable via the templates **only if that session has been joined** (has session meta). Unknown session ids return JSON-RPC **`-32602`** (`Resource not found`), not an empty success body. The list does not change after `join_session` (`listChanged: false`).

## Prompts

| Prompt | Use |
| --- | --- |
| `join-session` | Join a session and inspect peers / `lattice://session/{id}` |
| `two-agent-handoff` | Same `session_id` on two harnesses or machines (Redis required) |
| `pull-and-reply` | `pull_messages` then `tell_room` / `tell_agent` |

`session_id` arguments complete from the default session and the last join.

## Environment

Agents **never** pass Redis passwords in tool arguments. Configure the MCP server process only.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LATTICE_REDIS_URL` | if store=redis | — | `redis://user:pass@host:6379/0` (or `rediss://`). `REDIS_URL` also accepted |
| `REDIS_HOST` | alternative | — | Used with `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_SSL` |
| `LATTICE_NAMESPACE` | no | `dev` | Key prefix namespace |
| `LATTICE_DEFAULT_SESSION_ID` | no | — | Used when tools omit `session_id`; also listed as `lattice://session/{id}` |
| `LATTICE_JOIN_TOKEN` | no | — | Shared secret; `join_session` must send matching `join_token` |
| `LATTICE_STORE` | no | `redis` | `redis` \| `memory` (`memory` is **one process**) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — | If unset, tracing is a no-op |
| `OTEL_SERVICE_NAME` | no | `lattice-talk` | OTEL resource `service.name` |
| `OTEL_EXPORTER_OTLP_HEADERS` | no | — | `k=v,k2=v2` or header-line / `k: v` form |
| `LATTICE_PRESENCE_TTL` | no | `45` | Presence TTL (seconds) |
| `LATTICE_STREAM_MAXLEN` | no | `1000` | Approx `XADD MAXLEN` |

## Identity and security

- After `join_session`, later tools use this process's identity. Passing another `agent_id` is not possible (`agent_id` is only on `join_session`).
- Room send/read requires membership. `tell_agent` validates body and recipient **before** writing DM indexes.
- `LATTICE_JOIN_TOKEN` is checked on join only (timing-safe compare). Hash stored at the session join key.
- Redis credentials: **environment only**.
- stdout is MCP JSON-RPC only. Logs (and OTEL) go to **stderr**.
- Resource URIs validate `session_id` charset. Unknown URIs are JSON-RPC invalid params, not an empty `contents` array.

## Two-machine demo

1. Redis reachable from both machines (`LATTICE_REDIS_URL` identical, including DB index).
2. Same `LATTICE_NAMESPACE` on both MCP configs.
3. Same optional `LATTICE_JOIN_TOKEN` if set.
4. Same optional `OTEL_EXPORTER_OTLP_ENDPOINT` if you want one trace timeline.
5. Agent A: `join_session` `session_id=demo-1` `role=frontend`.
6. Agent B: `join_session` **same** `session_id=demo-1` `role=backend`.
7. `list_peers` on either side shows both (online while presence TTL is fresh).
8. A: `tell_room` body `hello from A`. B: `pull_messages` (after idle) sees it.
9. A: `memory_set` `key=api.base` `value=https://api.dev`. B: `memory_get` returns the same value. Either side can read `lattice://session/demo-1/memory`.
10. `trace_context` returns `conversation_id` equal to `session_id`.

`LATTICE_STORE=memory` cannot cross processes. Two harnesses cannot share it.

## Redis keys

Prefix: `lattice:{ns}:...`. Every key includes `{session_id}` so a session maps to one cluster hash slot (e.g. `lattice:dev:session:{team-42}:meta`).

| Key | Type | Purpose |
| --- | --- | --- |
| `lattice:{ns}:session:{sid}:meta` | Hash | created_at, created_by, namespace |
| `lattice:{ns}:session:{sid}:agents` | Hash | agent records |
| `lattice:{ns}:session:{sid}:presence:{agent_id}` | String + TTL | Online if key exists |
| `lattice:{ns}:session:{sid}:rooms` | Set | Room ids |
| `lattice:{ns}:session:{sid}:join` | String | SHA-256 of join token (optional) |
| `lattice:{ns}:session:{sid}:dm_partners:{agent_id}` | Set | DM counterpart ids |
| `lattice:{ns}:room:{sid}:{rid}:meta` | Hash | Room metadata |
| `lattice:{ns}:room:{sid}:{rid}:members` | Set | Members |
| `lattice:{ns}:stream:session:{sid}:room:{rid}` | Stream | Room messages (`XADD MAXLEN ~ 1000`) |
| `lattice:{ns}:stream:session:{sid}:dm:{pair}` | Stream | DM pair stream |
| `lattice:{ns}:cursor:{sid}:{agent_id}:{rid}` | String | Last-read stream id (`rid` is a room id or `dm:{pair}`) |
| `lattice:{ns}:wake:{sid}` | Pub/Sub | Optional wakeup on new messages |
| `lattice:{ns}:memory:{sid}:kv` | Hash | Shared facts |
| `lattice:{ns}:memory:{sid}:notes` | Stream | Append-only notes |
| `lattice:{ns}:memory:{sid}:meta:{key}` | Hash | Optional per-key memory metadata |

Default room: **`main`** (created on join). Stream fields: `from`, `to?`, `role`, `harness`, `kind` (`chat` \| `status` \| `task` \| `system`), `body`, `ts`, `traceparent`. Presence is refreshed on join and pull.

## Protocol and packaging

Feature-aligned with [MCP 2026-07-28](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro) (tools / resources / prompts, annotations, `structuredContent`, stderr logging). **Wire = [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1 / `initialize`** so Claude, Cursor, and Codex can connect. We do not speak `server/discover` or per-request `_meta` on the wire.

- Capabilities advertise `listChanged: false` on tools, resources, and prompts (listings are static; we do not emit `notifications/*/list_changed`).
- No Streamable HTTP, OAuth, resource subscriptions, protocol `notifications/message`, MCP Apps, Tasks, or elicitation.
- Completions exist only for `session_id` on prompts and resource templates.
- npm package (when published) ships `dist/`, README, LICENSE, `package.json`. GitHub is source + tests. `prepublishOnly` runs `npm run build`.

## Develop

```bash
npm install
npm run typecheck
npm test          # MemoryStore + unit tests; Redis / two-process E2E skipped unless LATTICE_REDIS_URL is set
npm run build
npm start         # node dist/index.js
```

```bash
LATTICE_STORE=memory node dist/index.js
```

## License

MIT
