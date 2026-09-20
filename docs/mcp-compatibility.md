# MCP compatibility

How Lattice Talk relates to the [Model Context Protocol](https://modelcontextprotocol.io/docs) specifications and SDK generations. This page is the detail; the README stays product-level.

## Summary

| Aspect | Value |
| --- | --- |
| Docs / spec hub | <https://modelcontextprotocol.io/docs> · <https://modelcontextprotocol.io/specification/2026-07-28> |
| Current spec revision | **2026-07-28** (stateless core, `server/discover`, per-request `_meta`) |
| SDK Lattice uses | **SDK v2 stable line** — `@modelcontextprotocol/server` 2.x (plus `@modelcontextprotocol/client` 2.x in tests) |
| Bytes on the wire | **initialize-era by default**; the 2026-07-28 stateless wire is an explicit opt-in per the SDK's migration docs |
| Feature shape | Aligned with the current 2026-07-28 docs (tools / resources / prompts, annotations, `structuredContent`, stderr logging) |

## Why "SDK v2 but initialize wire" is the correct combination

The [2026-07-28 announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/) describes MCP's move from a bidirectional stateful protocol to a request/response stateless core: the `initialize` handshake and `Mcp-Session-Id` are retired, every request carries protocol version/client identity/capabilities in `_meta`, and `server/discover` lets clients learn capabilities up front.

The TypeScript SDK v2 line is the stable release line supporting that specification. One important nuance from the SDK's own migration documentation: **constructing a normal v2 `Client`/`Server` still defaults to the 2025-era `initialize` wire** — speaking the 2026-07-28 stateless wire requires explicit opt-in/version negotiation. SDK v2 also maintains the legacy inbound route so modern clients can probe `server/discover` and fall back to `initialize` against servers like Lattice.

Lattice keeps that default deliberately:

* Today's installed stdio hosts — Claude Code, Cursor, Codex — connect with the `initialize` handshake and work unchanged.
* The 2026-07-28 spec defines the fallback path: modern clients probe with `server/discover`, and legacy-answer servers fall back to `initialize`. An initialize-era server is therefore reachable from both worlds.
* Nothing in Lattice's feature set depends on the old handshake; when the host ecosystem flips, enabling the stateless wire is an SDK-level change, not an application rewrite.

## What Lattice implements per current docs

These behaviors follow the 2026-07-28 docs regardless of wire era:

* **Flat tool input schemas** — `{ type: "object", properties }` with no root `anyOf`/`oneOf`/`allOf`, ASCII property names (Claude Code restricts them to `[A-Za-z0-9_.-]{1,64}`).
* **`outputSchema` + `structuredContent`** — every tool publishes a zod-derived output schema and returns structured content plus the same JSON serialized as text content (the spec's backwards-compatibility recommendation).
* **Tool execution errors are `isError` results**, not JSON-RPC failures — user mistakes (bad `room_id`, not joined, wrong token) come back as actionable `isError` content so the model can self-correct. `structuredContent` is omitted on error results because clients validate it against `outputSchema` even on `isError`.
* **Unknown resources return `-32602`** (Invalid params) — the 2026-07-28 code for a missing resource, replacing the old `-32002` (the SDK v2 `ResourceNotFoundError` emits exactly this). Lattice never returns an empty `contents` array for a missing session.
* **Annotations** on every tool (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false` — Lattice tools talk only to this process and the configured store). Clients treat them as untrusted hints per the spec.
* **`listChanged: false`** on tools, resources, and prompts — Lattice never emits list-changed notifications, and its lists do not vary per connection (resource listings derive from process env, not from who joined).
* **stdio transport rules** — JSON-RPC on stdout, one message per line, all logging on stderr, graceful shutdown on stdin EOF (the spec's primary portable shutdown signal).
* **Deterministic lists** — tools, prompts, and resources come back in stable order.
* **Pagination** — `list_peers`, `memory_list`, `memory_notes` use opaque cursor strings with `next_cursor`/`truncated` fields, mirroring the protocol's cursor model at the tool layer.
* **Stdio + env credentials** — the spec says stdio implementations should retrieve credentials from the environment rather than the HTTP authorization framework; Lattice takes Redis credentials and `LATTICE_JOIN_TOKEN` only from env and refuses them as tool arguments.

## Not implemented (by design)

* The 2026-07-28 stateless wire itself (`server/discover`, per-request `_meta` negotiation, `resultType`) — requires the SDK's explicit opt-in; Lattice serves hosts on the initialize era until the ecosystem moves.
* `subscriptions/listen`, resource subscriptions — Lattice's read model is pull-based (`pull_messages` with per-agent cursors).
* Progress, cancellation, logging (`notifications/message`) utilities — Lattice logs to stderr and answers quickly; nothing to cancel or stream today.
* Roots, sampling, elicitation — deprecated in 2026-07-28; a session bus has no use for them.

## References

* Spec: <https://modelcontextprotocol.io/specification/2026-07-28>
* 2026-07-28 announcement: <https://blog.modelcontextprotocol.io/posts/2026-07-28/>
* Key changes in 2026-07-28: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
* Tools: <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
* Resources: <https://modelcontextprotocol.io/specification/2026-07-28/server/resources>
* Prompts: <https://modelcontextprotocol.io/specification/2026-07-28/server/prompts>
* stdio transport: <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio>
* TypeScript SDK v2: <https://ts.sdk.modelcontextprotocol.io/v2/> — packages `@modelcontextprotocol/server` (servers) and `@modelcontextprotocol/client` (clients), with the v1 line (`@modelcontextprotocol/sdk` 1.x) still maintained for older setups.
