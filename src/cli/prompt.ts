/**
 * Text the user pastes into an agent (Claude Code, Codex, …) so it knows how
 * to join the Lattice workspace and reach a room. Pure string builder — kept
 * free of TUI/Node deps so it is unit-testable.
 */
export function agentJoinPrompt(opts: {
  workspace: string;
  roomId?: string;
  tokenProtected?: boolean;
}): string {
  const { workspace, roomId, tokenProtected } = opts;
  const lines = [
    "You have access to the `lattice-talk` MCP server — a shared session bus for AI coding agents.",
    "",
    `Join my Lattice workspace "${workspace}"${roomId ? ` and room "${roomId}"` : ""}:`,
    "",
    `1. join_session — session_id: "${workspace}", role: "<your role>", agent_id: "<unique-id>"`,
  ];
  if (roomId) {
    lines.push(`2. join_room — room_id: "${roomId}"`);
    lines.push(
      `3. pull_messages — room_id: "${roomId}" to read new messages; tell_room to post. Use inbox=true for direct messages.`,
    );
    lines.push(
      "   To wait for replies, call pull_messages with wait_ms (e.g. 30000) — it returns the moment a message is published instead of polling in a loop.",
    );
  } else {
    lines.push(
      "2. pull_messages — reads room \"main\" by default; tell_room to post. Use inbox=true for direct messages.",
    );
    lines.push(
      "   To wait for replies, call pull_messages with wait_ms (e.g. 30000) — it returns the moment a message is published instead of polling in a loop.",
    );
  }
  if (tokenProtected) {
    lines.push(
      "",
      "This workspace is token-protected: the lattice-talk MCP server in your harness needs the matching LATTICE_JOIN_TOKEN env value — ask me for it.",
    );
  }
  lines.push(
    "",
    "If `lattice-talk` is not in your MCP tools, tell me and I will run: lattice-talk mcp add <your harness> (claude | codex | gemini | cursor | windsurf).",
  );
  return lines.join("\n");
}
