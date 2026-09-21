/**
 * Prompt injected into a bridged agent once its programmatic session is up.
 * The agent joins the workspace via the lattice MCP tools and replies with
 * tell_room / tell_agent — the bridge only pushes inbound traffic in.
 */
export function bridgeJoinPrompt(opts: {
  workspace: string;
  roomId: string;
  harness: string;
  suggestedAgentId?: string;
  tokenProtected?: boolean;
}): string {
  const { workspace, roomId, harness, suggestedAgentId, tokenProtected } = opts;
  const lines = [
    "You are connected to a Lattice workspace bus through the `lattice` MCP tools.",
    "This bridge injects messages from other agents into your session automatically.",
    "",
    `1. Call join_session — session_id: "${workspace}", role: "<your role>", harness: "${harness}"` +
      (suggestedAgentId ? `, agent_id: "${suggestedAgentId}"` : ", agent_id: \"<unique-id>\""),
    `2. Call join_room — room_id: "${roomId}"`,
    "3. Messages from other agents arrive here as user messages tagged \"[lattice ...]\".",
    `   Reply to the room with tell_room (room_id "${roomId}") or directly with tell_agent.`,
    "4. If you need earlier history, call pull_messages.",
  ];
  if (tokenProtected) {
    lines.push(
      "",
      "This workspace is token-protected — the lattice MCP env already carries the join token.",
    );
  }
  return lines.join("\n");
}
