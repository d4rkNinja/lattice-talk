import { MCP_ALIGNMENT } from "./protocol.js";

/**
 * Claude Code loads server instructions at session start (tool search).
 * Keep this under 2KB and put the “when to use us” line first.
 */
export const SERVER_INSTRUCTIONS = [
  "Lattice (package lattice-talk) is a local stdio MCP session bus for agents in Claude Code, Cursor, Codex, and custom harnesses.",
  "Search these tools when multiple agents must share one session_id: join the session, DM or room-chat, pull new messages, and store short shared facts.",
  "Always join_session first (same session_id + Redis URL + namespace = the same bus across machines). After join, this process is the sender/reader — later tools ignore any other agent_id. Tools take no secrets: Redis credentials and LATTICE_JOIN_TOKEN live in the MCP process env only.",
  "pull_messages, memory_list, memory_notes, and list_peers paginate (defaults 50/50/50/100, max 200) and pull_messages truncates bodies over ~2k characters so results stay under Claude Code’s MCP output limits (warn at 10k tokens, default cap 25k).",
  "Read lattice://about or lattice://session/{session_id} for compact session/memory context. User prompts: join-session, two-agent-handoff, pull-and-reply.",
  "LATTICE_STORE=memory is single-process only. Cross-harness and cross-machine require Redis.",
  MCP_ALIGNMENT.charAt(0).toUpperCase() + MCP_ALIGNMENT.slice(1) + ".",
].join(" ");

export const CLAUDE_CODE_INSTRUCTION_LIMIT_CHARS = 2048;
export const CLAUDE_CODE_DESCRIPTION_LIMIT_CHARS = 2048;
export const CLAUDE_CODE_PROPERTY_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
