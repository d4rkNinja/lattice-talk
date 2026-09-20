# Lattice Talk

**Let AI coding agents talk to each other across Claude Code, Cursor, Codex, and other MCP clients.**

Lattice Talk is a local MCP server that gives multiple AI agents a shared communication layer. Instead of manually copying messages between agents, connect them to the same Lattice session.

```text
Cursor ────────┐
Claude Code ───┼── Lattice Talk ── Redis
Codex ─────────┘
```

## What does this do?

Imagine you have:

```text
Cursor       → frontend
Claude Code  → backend
Codex        → reviewer
```

Normally, those agents cannot communicate with each other. With Lattice Talk, they can join the same session and:

* discover other agents
* send direct messages
* communicate in shared rooms
* share project memory and notes
* coordinate work across different processes or machines
* optionally emit OpenTelemetry traces

For example:

```text
frontend → backend

"The login UI is ready.
It expects POST /api/auth/login."
```

The backend agent receives that message directly through Lattice. No manual copy-pasting between agents.

---

## Installation

Requires **Node.js 20+** and Redis (for anything beyond single-process testing).

### 1. Start Redis

Agents running in different processes need the same Redis instance.

```bash
docker run --rm -p 6379:6379 redis:7
```

### 2. Add Lattice to your MCP client

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

Claude Code:

```bash
claude mcp add \
  --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 \
  --env LATTICE_NAMESPACE=dev \
  --transport stdio \
  lattice \
  -- npx -y lattice-talk
```

Codex (`config.toml`):

```toml
[mcp_servers.lattice]
command = "npx"
args = ["-y", "lattice-talk"]

[mcp_servers.lattice.env]
LATTICE_REDIS_URL = "redis://127.0.0.1:6379/0"
LATTICE_NAMESPACE = "dev"
```

### Run from source instead

```bash
git clone https://github.com/d4rkNinja/lattice-talk.git
cd lattice-talk
npm install
npm run build
```

Then point your client at `node /absolute/path/to/lattice-talk/dist/index.js`.

---

## Quick example

Suppose Cursor handles the frontend and Claude Code handles the backend. Both MCP clients must use the same `LATTICE_REDIS_URL`, `LATTICE_NAMESPACE`, and `session_id`.

### Cursor

```text
join_session

session_id: checkout-v2
role: frontend
agent_id: frontend
harness: cursor
```

### Claude Code

```text
join_session

session_id: checkout-v2
role: backend
agent_id: backend
harness: claude-code
```

Now either agent can call `list_peers` and see the other participant.

The frontend sends:

```text
tell_agent

to_agent_id: backend
body: "Checkout now expects POST /api/orders/checkout."
```

The backend receives it:

```text
pull_messages

inbox: true
```

The backend stores the response contract in shared memory:

```text
memory_set

key: checkout.response
value: "{ order_id, payment_url, status }"
```

The frontend retrieves it later:

```text
memory_get

key: checkout.response
```

---

## Core tools

### Sessions

| Tool            | Purpose                       |
| --------------- | ----------------------------- |
| `join_session`  | Join a shared Lattice session |
| `leave_session` | Leave the current session     |
| `list_peers`    | See other agents              |
| `session_info`  | Inspect the current session   |

### Messaging

| Tool            | Purpose                  |
| --------------- | ------------------------ |
| `tell_agent`    | Send a direct message    |
| `tell_room`     | Send a message to a room |
| `pull_messages` | Receive new messages     |
| `create_room`   | Create a room            |
| `join_room`     | Join a room              |

### Shared memory

| Tool           | Purpose                       |
| -------------- | ----------------------------- |
| `memory_set`   | Store a shared value          |
| `memory_get`   | Read a shared value           |
| `memory_list`  | List shared memory keys       |
| `memory_note`  | Append an immutable note      |
| `memory_notes` | Read notes back (paginated)   |

### Observability

| Tool            | Purpose                                       |
| --------------- | --------------------------------------------- |
| `trace_context` | Get session and trace correlation information |

MCP resources (`lattice://about`, `lattice://session/{session_id}`, `lattice://session/{session_id}/memory`) and prompts (`join-session`, `two-agent-handoff`, `pull-and-reply`) are also exposed.

---

## Configuration

| Variable                      | Default        | Purpose                              |
| ----------------------------- | -------------- | ------------------------------------ |
| `LATTICE_REDIS_URL`           | —              | Redis connection URL                 |
| `LATTICE_NAMESPACE`           | `dev`          | Isolates Lattice environments        |
| `LATTICE_DEFAULT_SESSION_ID`  | —              | Optional default session             |
| `LATTICE_JOIN_TOKEN`          | —              | Optional session join token (env-only) |
| `LATTICE_STORE`               | `redis`        | `redis` or `memory`                  |
| `LATTICE_PRESENCE_TTL`        | `45`           | Agent presence TTL seconds (5–86400) |
| `LATTICE_STREAM_MAXLEN`       | `1000`         | Approximate retained messages (10–1M) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —              | Optional OTLP trace endpoint         |
| `OTEL_SERVICE_NAME`           | `lattice-talk` | OpenTelemetry service name           |
| `OTEL_EXPORTER_OTLP_HEADERS`  | —              | Optional OTLP authentication headers |

Redis can also be configured with `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `REDIS_DB`, `REDIS_SSL`. Invalid values (unknown `LATTICE_STORE`, out-of-range integers) fail fast at startup.

### Local testing without Redis

```bash
LATTICE_STORE=memory npm start
```

The memory store implements the same core APIs but exists only inside one process. It is for testing — it cannot connect separate Cursor, Claude Code, or Codex processes. Use Redis for real multi-agent communication.

---

## How it works

Every coding tool runs its own local Lattice MCP process.

```text
Machine A

Cursor
  │
  └─ lattice-talk
        │
        │
      Redis
        │
        │
  ┌─────┘
  │
lattice-talk
  │
Claude Code
```

Redis acts as the shared coordination layer. There is no central hosted Lattice service. The same setup works across machines as long as every Lattice process can reach the same Redis instance and uses the same namespace.

---

## Identity and security

* **Process-owned identity.** After `join_session`, the MCP process owns that agent identity. Later tool calls cannot spoof another agent's `agent_id`, read another agent's inbox, or advance another agent's cursor. Claiming an `agent_id` that is currently online is rejected.
* **No secrets in tool arguments.** Redis credentials and `LATTICE_JOIN_TOKEN` live in the MCP process environment only — no tool accepts them.
* **Join token.** Set `LATTICE_JOIN_TOKEN` on every process that should share protected sessions. Only the SHA-256 hash is stored per session; joins are compared against it. Sessions created without a token stay open.
* **Membership-scoped rooms.** Room tools check membership: agents cannot read or write a room until they call `join_room` (or create it). Any session member can join an existing room by id — rooms are membership-scoped, not invitation-only. Don't put secrets in rooms.
* **stdout is reserved for MCP.** Logs go to stderr only, so the JSON-RPC stream is never corrupted.

---

## OpenTelemetry

Tracing is optional:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Lattice correlates operations using the session ID (`gen_ai.conversation.id`), so activity from multiple agents can be traced together. Messages can carry a W3C `traceparent`.

---

## Development

```bash
npm install        # dependencies
npm run typecheck  # type-check
npm test           # vitest (Redis-gated tests skip without LATTICE_REDIS_URL)
npm run build      # bundle to dist/
npm start          # run the built server
```

CI runs typecheck, build, tests, and `npm pack --dry-run` on Node 20 and 22 (Linux, with Redis services) plus Node 22 on Windows (stdio smoke tests).

Protocol/wire compatibility details live in [docs/mcp-compatibility.md](docs/mcp-compatibility.md).

---

## Contributing

Contributions are welcome: additional MCP client testing, Redis edge cases, security reviews, multi-agent examples, observability integrations, and documentation improvements.

Repository: <https://github.com/d4rkNinja/lattice-talk>

---

## License

MIT

---

**Lattice Talk gives independent AI coding agents a lightweight shared communication layer so you don't have to be the message bus.**
