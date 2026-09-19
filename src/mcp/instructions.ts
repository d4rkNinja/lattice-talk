/**
 * Claude Code loads server instructions at session start (tool search).
 * Keep this under 2KB and put the “when to use us” line first.
 */
export const SERVER_INSTRUCTIONS = [
  "Lattice is a local stdio MCP session bus for agents in Claude Code, Cursor, Codex, and custom harnesses.",
  "Search these tools when multiple agents must share one session_id: join the session, DM or room-chat, pull new messages, and store short shared facts.",
  "Always join_session first (same session_id + Redis URL + namespace = the same bus across machines). Redis credentials and LATTICE_JOIN_TOKEN live in MCP env, never as Redis-password tool arguments.",
  "pull_messages paginates (default 50, max 200) and truncates bodies over ~2k characters so results stay under Claude Code’s MCP output limits (warn at 10k tokens, default cap 25k).",
  "LATTICE_STORE=memory is single-process only. Cross-harness and cross-machine require Redis.",
].join(" ");

export const CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS = 2048;
export const CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS = 2048;
export const CLAUDE_CODE_PROPERTY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
