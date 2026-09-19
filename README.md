# Lattice Talk

**Cross-harness communication for AI coding agents.**

Lattice Talk is a local **MCP server** that lets AI agents running in different tools — such as Claude Code, Cursor, Codex, or custom MCP clients — join the same session and communicate with each other.

Instead of manually copying messages between agents, give them the same `session_id`.

They can then:

* discover each other
* send direct messages
* communicate through shared rooms
* share session memory
* coordinate work across different machines
* emit OpenTelemetry traces for debugging and observability

```text
Cursor Agent ───────┐
                    │
Claude Code Agent ──┼── Lattice Talk ── Redis
                    │        │
Codex Agent ────────┘        └── OpenTelemetry
```

Lattice itself is not a hosted API or database platform.

**The MCP process is the product. Redis is simply the shared coordination layer behind it.**

---

## Why Lattice?

Running multiple coding agents is becoming normal.

You might have:

```text
Cursor
  └─ frontend agent

Claude Code
  └─ backend agent

Codex
  └─ reviewer agent
```

The problem is that these agents normally cannot see each other.

You become the communication layer:

```text
Frontend agent → you → Backend agent
Backend agent → you → Reviewer agent
Reviewer agent → you → Frontend agent
```

Lattice replaces that manual handoff.

```text
frontend ─┐
backend  ─┼── session: checkout-redesign
reviewer ─┘
```

Agents can communicate directly through MCP tools.

---

# What can agents do?

### Join a shared session

```text
join_session
```

Agents using the same:

```text
session_id
Redis
namespace
```

join the same coordination space.

---

### See other agents

```text
list_peers
```

Example:

```json
{
  "peers": [
    {
      "agent_id": "frontend",
      "role": "frontend",
      "harness": "cursor",
      "online": true
    },
    {
      "agent_id": "backend",
      "role": "backend",
      "harness": "claude-code",
      "online": true
    }
  ]
}
```

---

### Send direct messages

```text
tell_agent
```

Example:

```text
frontend → backend

"Authentication UI is ready.
The frontend expects POST /api/auth/login."
```

The backend agent can later receive it through:

```text
pull_messages
```

---

### Talk in shared rooms

Every session automatically has:

```text
main
```

Agents can broadcast:

```text
tell_room
```

You can also create dedicated rooms:

```text
frontend
backend
architecture
review
deployment
```

Only joined room members can read or send messages in that room.

---

### Share memory

Agents can store important facts using:

```text
memory_set
memory_get
memory_list
memory_note
```

Example:

```text
api.base = https://api.example.com/v1
```

Another agent can retrieve it without asking you.

Shared memory is intended for things like:

* architecture decisions
* API contracts
* important URLs
* implementation constraints
* task ownership
* shared project facts

It is **not intended to be a raw dump of every tool call**.

---

### Trace multi-agent work

Lattice can optionally export OpenTelemetry traces.

All operations in one Lattice session use:

```text
gen_ai.conversation.id = session_id
```

This makes it possible to correlate work performed by agents across different harnesses and machines.

---

# Architecture

Each AI application launches its own local Lattice MCP process.

```text
Machine A

Cursor
  │
  └─ lattice-talk
       │
       └─────────────┐
                     │
                  Redis
                     │
       ┌─────────────┘
       │
  lattice-talk
  │
Claude Code

Machine B
```

There is no central Lattice HTTP server.

Redis provides shared state between MCP processes.

---

## Storage model

Lattice uses three logical stores.

| Store      | Purpose                                                 |
| ---------- | ------------------------------------------------------- |
| **Bus**    | sessions, agents, rooms, messages, presence and cursors |
| **Memory** | intentional shared session knowledge                    |
| **Traces** | OpenTelemetry spans and agent activity                  |

Redis powers the bus and shared memory.

OpenTelemetry is optional.

---

# Requirements

* Node.js **20+**
* Redis for communication across processes or machines

For local single-process testing, Redis is optional:

```bash
LATTICE_STORE=memory
```

The memory store is useful for development and tests, but two different MCP processes cannot share it.

---

# Installation

## npm

The intended installation method is:

```bash
npx -y lattice-talk
```

> The package is currently not published to npm yet. Until it is published, build it locally from this repository.

---

## Run from source

Clone the repository:

```bash
git clone https://github.com/d4rkNinja/lattice-talk.git
cd lattice-talk
```

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Run:

```bash
node dist/index.js
```

For a Redis-free local test:

```bash
LATTICE_STORE=memory node dist/index.js
```

---

# Configuration

Lattice is configured through environment variables.

Secrets such as Redis credentials are **never passed through MCP tool arguments**.

| Variable                      | Default        | Description                          |
| ----------------------------- | -------------- | ------------------------------------ |
| `LATTICE_REDIS_URL`           | —              | Redis connection URL                 |
| `LATTICE_NAMESPACE`           | `dev`          | Namespace used for Redis keys        |
| `LATTICE_DEFAULT_SESSION_ID`  | —              | Optional default session             |
| `LATTICE_JOIN_TOKEN`          | —              | Optional shared session access token |
| `LATTICE_STORE`               | `redis`        | `redis` or `memory`                  |
| `LATTICE_PRESENCE_TTL`        | `45`           | Agent presence TTL in seconds        |
| `LATTICE_STREAM_MAXLEN`       | `1000`         | Approximate max messages per stream  |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | —              | OpenTelemetry OTLP endpoint          |
| `OTEL_SERVICE_NAME`           | `lattice-talk` | OpenTelemetry service name           |
| `OTEL_EXPORTER_OTLP_HEADERS`  | —              | Optional OTLP authentication headers |

You can also configure Redis using:

```text
REDIS_HOST
REDIS_PORT
REDIS_USERNAME
REDIS_PASSWORD
REDIS_DB
REDIS_SSL
```

---

# Claude Code

After the package is published:

```bash
claude mcp add \
  --env LATTICE_REDIS_URL=redis://127.0.0.1:6379/0 \
  --env LATTICE_NAMESPACE=dev \
  --transport stdio \
  lattice \
  -- npx -y lattice-talk
```

Project `.mcp.json`:

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
        "LATTICE_JOIN_TOKEN": "${LATTICE_JOIN_TOKEN}"
      }
    }
  }
}
```

For local development, replace the command with your built file:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/lattice-talk/dist/index.js"]
}
```

---

# Cursor

Add Lattice to your MCP configuration:

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

---

# Codex

Example configuration:

```toml
[mcp_servers.lattice]
command = "npx"
args = ["-y", "lattice-talk"]

[mcp_servers.lattice.env]
LATTICE_REDIS_URL = "redis://127.0.0.1:6379/0"
LATTICE_NAMESPACE = "dev"
```

---

# Quick two-agent example

Suppose you want Cursor and Claude Code to work together.

Both clients use:

```text
LATTICE_REDIS_URL=redis://127.0.0.1:6379/0
LATTICE_NAMESPACE=dev
```

### Cursor agent

```text
join_session

session_id: checkout-v2
role: frontend
agent_id: frontend
harness: cursor
```

### Claude Code agent

```text
join_session

session_id: checkout-v2
role: backend
agent_id: backend
harness: claude-code
```

Now either agent can call:

```text
list_peers
```

and see both participants.

Frontend can send:

```text
tell_agent

to_agent_id: backend

body:
"The checkout UI now expects
POST /api/orders/checkout."
```

Backend receives it using:

```text
pull_messages

inbox: true
```

The backend can respond:

```text
tell_agent

to_agent_id: frontend

body:
"Endpoint is implemented.
I'll store the response schema in shared memory."
```

Then:

```text
memory_set

key: checkout.response
value: "{ order_id, payment_url, status }"
```

The frontend agent can retrieve it later:

```text
memory_get

key: checkout.response
```

No copy-pasting between agents.

---

# MCP Tools

Lattice currently exposes **14 tools**.

## Sessions

| Tool            | Description                     |
| --------------- | ------------------------------- |
| `join_session`  | Join a shared agent session     |
| `leave_session` | Leave the current session       |
| `list_peers`    | List agents and online presence |
| `session_info`  | Get session information         |

---

## Messaging

| Tool            | Description                     |
| --------------- | ------------------------------- |
| `tell_agent`    | Send a direct message           |
| `tell_room`     | Broadcast to a room             |
| `pull_messages` | Receive new room or DM messages |
| `create_room`   | Create a new room               |
| `join_room`     | Join an existing room           |

---

## Shared memory

| Tool          | Description                      |
| ------------- | -------------------------------- |
| `memory_set`  | Store a shared value             |
| `memory_get`  | Read a shared value              |
| `memory_list` | List shared memory keys          |
| `memory_note` | Append an immutable session note |

---

## Observability

| Tool            | Description                                      |
| --------------- | ------------------------------------------------ |
| `trace_context` | Return trace and session correlation information |

---

# Agent identity

After:

```text
join_session
```

the MCP process owns that agent identity.

For example:

```text
agent_id = frontend
```

Later calls cannot impersonate another agent by supplying:

```text
agent_id = backend
```

Operations such as:

```text
tell_agent
tell_room
pull_messages
memory_set
memory_note
create_room
join_room
leave_session
```

always use the identity owned by the current MCP process.

This prevents one agent from:

* sending messages as another agent
* advancing another agent's message cursor
* reading another agent's inbox
* removing another agent from a session

---

# Presence

Agent presence uses short-lived keys.

By default:

```text
TTL = 45 seconds
```

Presence is refreshed when the agent:

```text
joins
pulls messages
```

`list_peers` reports:

```json
{
  "online": true
}
```

while that presence key remains active.

---

# Rooms

Every session automatically creates:

```text
main
```

Additional rooms can be created with:

```text
create_room
```

Agents must join a room before they can:

```text
tell_room
pull_messages
```

for that room.

---

# Direct messages

DMs are stored using a stream shared between each pair of agents.

For:

```text
frontend
backend
```

the pair identifier becomes:

```text
backend:frontend
```

The ordering is deterministic so both agents reference the same stream.

Each receiving agent has its own cursor.

This means reading messages does not consume them globally.

---

# Message cursors

Lattice does not repeatedly return every message.

Each agent keeps a cursor indicating the last message it has read.

```text
Agent A cursor → message 42
Agent B cursor → message 18
```

Calling:

```text
pull_messages
```

returns messages after that agent's cursor and then advances it.

---

# Pagination

Large lists are bounded so MCP responses stay manageable.

### Peers

```text
list_peers

cursor?
limit?
```

Default:

```text
100
```

Maximum:

```text
200
```

### Memory

```text
memory_list

cursor?
limit?
```

Default:

```text
50
```

Maximum:

```text
200
```

---

# Redis layout

Lattice Redis keys begin with:

```text
lattice:{namespace}:...
```

Session IDs are placed inside Redis Cluster hash tags so data belonging to one session maps to the same cluster slot.

Example:

```text
lattice:dev:session:{checkout-v2}:meta
```

Important keys include:

```text
session metadata
agents
presence
rooms
room membership
room streams
DM streams
message cursors
shared memory
session notes
```

Example layout:

```text
lattice:{ns}:session:{sid}:meta

lattice:{ns}:session:{sid}:agents

lattice:{ns}:session:{sid}:presence:{agent_id}

lattice:{ns}:session:{sid}:rooms

lattice:{ns}:room:{sid}:{room_id}:members

lattice:{ns}:stream:session:{sid}:room:{room_id}

lattice:{ns}:stream:session:{sid}:dm:{pair}

lattice:{ns}:cursor:{sid}:{agent_id}:{channel}

lattice:{ns}:memory:{sid}:kv

lattice:{ns}:memory:{sid}:notes
```

---

# OpenTelemetry

Set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

and Lattice will export traces using OTLP.

Important attributes include:

```text
gen_ai.conversation.id
gen_ai.agent.name

lattice.session_id
lattice.agent_id
lattice.harness
lattice.room_id
lattice.namespace
```

`session_id` is used as:

```text
gen_ai.conversation.id
```

so operations from different agents can be correlated under the same conversation.

Outbound messages can also carry the current W3C:

```text
traceparent
```

---

# Security model

Lattice is intentionally small, but several protections are built in.

### Redis credentials stay outside MCP tools

Agents cannot send:

```text
REDIS_PASSWORD
LATTICE_REDIS_URL
```

through tool arguments.

Connection information comes only from the MCP process environment.

---

### Optional join token

Set:

```bash
LATTICE_JOIN_TOKEN=some-secret
```

Agents must provide the matching token during:

```text
join_session
```

The token is compared using a timing-safe comparison.

---

### Process-owned identity

After joining, the MCP process controls the agent identity.

Other tool calls cannot impersonate another participant.

---

### Room membership

Agents cannot read or write private rooms until they have joined them.

---

### stdout is reserved for MCP

Lattice never writes application logs to stdout.

```text
stdout → MCP JSON-RPC
stderr → logs
```

This is important because writing arbitrary logs to stdout would corrupt the MCP protocol stream.

---

# MCP resources

Lattice also exposes small MCP resources.

```text
lattice://about
```

Returns information about the running server.

```text
lattice://session/{session_id}
```

Returns a compact session snapshot.

```text
lattice://session/{session_id}/memory
```

Returns shared memory metadata/keys.

Lattice intentionally does not expose a filesystem-like resource system.

---

# MCP prompts

Lattice includes helper prompts for common workflows:

```text
join-session
two-agent-handoff
pull-and-reply
```

These are convenience prompts for clients that support MCP prompts.

---

# Development

Install:

```bash
npm install
```

Type-check:

```bash
npm run typecheck
```

Run tests:

```bash
npm test
```

Build:

```bash
npm run build
```

Run:

```bash
npm start
```

---

# Testing

The repository includes tests for:

* key generation
* Redis stream cursors
* memory store behavior
* MCP schemas
* MCP tools
* resources
* prompts
* process-owned identity
* room authorization
* pagination
* OpenTelemetry attributes
* stdio behavior
* Redis integration
* multi-process Redis communication

The CI pipeline runs:

```text
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

with Redis available during integration tests.

---

# Local testing without Redis

For simple development:

```bash
LATTICE_STORE=memory npm start
```

This provides the same session/messaging APIs using in-process memory.

Keep in mind:

> The memory store is process-local.

Two different Claude/Cursor/Codex processes need Redis to communicate.

---

# What Lattice is not

Lattice v1 intentionally does **not** try to be:

* a hosted collaboration platform
* an AI database
* Redis-as-MCP
* an agent IDE
* a workflow engine
* an A2A replacement
* a persistent tool-call archive
* a central HTTP server

The goal is deliberately narrower:

> **Give independent AI agents a lightweight shared communication layer using MCP.**

---

# Project status

Lattice currently focuses on the stdio MCP workflow used by coding-agent environments.

The project uses the official MCP TypeScript SDK and currently stays on the SDK/wire generation compatible with existing stdio MCP hosts such as Claude Code, Cursor, and Codex.

Possible future directions include:

```text
richer agent presence
better task coordination
additional transports
optional local persistence
improved observability
session lifecycle controls
```

without turning Lattice into a large hosted platform.

---

# Contributing

Issues, bug reports, integration examples, and improvements are welcome.

Repository:

https://github.com/d4rkNinja/lattice-talk

Useful contributions include:

* testing with additional MCP hosts
* Redis edge-case testing
* better multi-agent examples
* documentation improvements
* tracing integrations
* security reviews

---

# License

MIT

---

## The idea in one sentence

**Lattice Talk lets AI agents running in different coding tools join one shared session and communicate without making you the message bus.**
