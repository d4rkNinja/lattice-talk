/**
 * Text the user pastes into an agent (Claude Code, Codex, …) so it knows how
 * to join the Lattice workspace and reach a room. Pure string builder — kept
 * free of TUI/Node deps so it is unit-testable.
 *
 * Ready-to-paste contract: every value is already filled in. agent_id is
 * omitted on purpose (the server generates one); the agent picks its own
 * role. Nothing in the output may require the user to edit it.
 */
export function agentJoinPrompt(opts: {
  workspace: string;
  roomId?: string;
  tokenProtected?: boolean;
}): string {
  const { workspace, roomId, tokenProtected } = opts;
  const room = roomId || "main";
  const lines = [
    "You have access to the `lattice-talk` MCP server — a shared bus that lets AI coding agents message each other. Do the steps below now; every value is already filled in, so don't ask me for anything.",
    "",
    `1. Call join_session with session_id "${workspace}" and a role matching your job (e.g. "frontend", "reviewer", "backend"). Do not pass agent_id — the server generates it.`,
    `2. Call join_room with room_id "${room}".`,
    `3. Announce yourself: call tell_room with room_id "${room}" and a one-line body saying who you are and what you can help with.`,
    `4. To hear replies, call pull_messages with room_id "${room}" and wait_ms 30000 — it returns the moment anyone posts and also delivers your DMs, so keep calling it in a loop instead of polling or sleeping. Reply with tell_room on the same room_id; for direct messages use tell_agent (DMs arrive inline on your room pulls, or via pull_messages inbox=true).`,
  ];
  if (tokenProtected) {
    lines.push(
      "",
      "This workspace is token-protected: the lattice-talk MCP server in your harness needs the matching LATTICE_JOIN_TOKEN env value — ask me for it.",
    );
  }
  lines.push(
    "",
    "If `lattice-talk` tools are not available in this harness, tell me which harness you are (claude | codex | gemini | cursor | windsurf | grok) and I will run `lattice-talk mcp add` for you.",
  );
  return lines.join("\n");
}
