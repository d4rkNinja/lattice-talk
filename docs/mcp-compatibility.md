# MCP compatibility

How Lattice Talk relates to the [Model Context Protocol](https://modelcontextprotocol.io/docs) specifications and SDK generations. This page is the detail; the README stays product-level.

## Summary

| Aspect | Value |
| --- | --- |
| Docs / spec hub | <https://modelcontextprotocol.io/docs> · <https://modelcontextprotocol.io/specification/2026-07-28> |
| Current spec revision | **2026-07-28** |
| Feature shape Lattice aligns with | 2026-07-28 (tools / resources / prompts, annotations, `structuredContent`, stderr logging) |
| Bytes on the wire | **SDK v1 / `initialize` era** — `@modelcontextprotocol/sdk` (v1 line, currently 1.30.x) |
| v2 SDK (2026-07-28 wire) | `@modelcontextprotocol/server` 2.x — not yet adopted |

## Why Lattice stays on SDK v1

The 2026-07-28 revision made MCP stateless: it removed the `initialize`/`notifications/initialized` handshake, requires per-request `_meta` (`io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities`), and adds `server/discover` for version selection. That wire is implemented by the SDK v2 line (`@modelcontextprotocol/server`).

Today's installed base of stdio hosts — Claude Code, Cursor, Codex — connects with the `initialize` handshake. The 2026-07-28 spec itself defines the bridge: modern clients **SHOULD** probe with `server/discover` and, when the server answers like a legacy server (unknown-method error or silence), **fall back to `initialize`**. A server speaking SDK v1 / `initialize` therefore stays connectable from both modern and legacy clients, which is exactly what Lattice wants for a local multi-harness bus.

When the host ecosystem moves to the 2026-07-28 wire, migrating to `@modelcontextprotocol/server` (v2) is a tracked goal; nothing in Lattice's feature set depends on the old handshake.

## What Lattice implements per current docs

These behaviors match the 2026-07-28 docs even though the handshake is v1:

* **Flat tool input schemas** — `{ type: "object", properties }` with no root `anyOf`/`oneOf`/`allOf`, ASCII property names (Claude Code restricts them to `[A-Za-z0-9_.-]{1,64}`).
* **`outputSchema` + `structuredContent`** — every tool publishes an output schema and returns structured content plus the same JSON serialized as text content (the spec's backwards-compatibility recommendation).
* **Tool execution errors are `isError` results**, not JSON-RPC failures — user mistakes (bad `room_id`, not joined, wrong token) come back as actionable `isError` content so the model can self-correct. `structuredContent` is omitted on error results because v1 clients validate it against `outputSchema` even on `isError`.
* **Unknown resources return `-32602`** (Invalid params) — the 2026-07-28 code for a missing resource, replacing the old `-32002`. Lattice never returns an empty `contents` array for a missing session.
* **Annotations** on every tool (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false` — Lattice tools talk only to this process and the configured store). Clients treat them as untrusted hints per the spec.
* **`listChanged: false`** on tools, resources, and prompts — Lattice never emits list-changed notifications, and its lists do not vary per connection (resource listings derive from process env, not from who joined).
* **stdio transport rules** — JSON-RPC on stdout, one message per line, all logging on stderr, graceful shutdown on stdin EOF (the spec's primary portable shutdown signal).
* **Deterministic lists** — tools, prompts, and resources come back in stable order.
* **Pagination** — `list_peers`, `memory_list`, `memory_notes` use opaque cursor strings with `next_cursor`/`truncated` fields, mirroring the protocol's cursor model at the tool layer.
* **Stdio + env credentials** — the spec says stdio implementations should retrieve credentials from the environment rather than the HTTP authorization framework; Lattice takes Redis credentials and `LATTICE_JOIN_TOKEN` only from env and refuses them as tool arguments.

## Not implemented (by design)

* `server/discover`, per-request `_meta` negotiation, `resultType` fields — v2 wire; arrives with the SDK v2 migration.
* `subscriptions/listen`, resource subscriptions — Lattice's read model is pull-based (`pull_messages` with per-agent cursors).
* Progress, cancellation, logging (`notifications/message`) utilities — Lattice logs to stderr and answers quickly; nothing to cancel or stream today.
* Roots, sampling, elicitation — deprecated in 2026-07-28; a session bus has no use for them.

## References

* Spec: <https://modelcontextprotocol.io/specification/2026-07-28>
* Key changes in 2026-07-28: <https://modelcontextprotocol.io/specification/2026-07-28/changelog>
* Tools: <https://modelcontextprotocol.io/specification/2026-07-28/server/tools>
* Resources: <https://modelcontextprotocol.io/specification/2026-07-28/server/resources>
* Prompts: <https://modelcontextprotocol.io/specification/2026-07-28/server/prompts>
* stdio transport: <https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio>
* TypeScript SDK: <https://github.com/modelcontextprotocol/typescript-sdk> (v1) · v2 docs: <https://ts.sdk.modelcontextprotocol.io/v2/>
