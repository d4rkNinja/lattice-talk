import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BusDeps } from "../core/types.js";
import { PACKAGE_NAME } from "../version.js";
import { MCP_ALIGNMENT } from "./protocol.js";
import { memoryResourceUri, sessionResourceUri, suggestSessionIds } from "./uris.js";

function sessionIdArg(deps: BusDeps) {
  return completable(
    z
      .string()
      .optional()
      .describe("Session id. Falls back to last join or LATTICE_DEFAULT_SESSION_ID."),
    (value) => suggestSessionIds(deps, value),
  );
}

/**
 * User-invoked templates (MCP prompts). They do not run tools; they tell
 * the model how to use join/tell/pull/memory on this stdio bus.
 */
export function registerPrompts(server: McpServer, deps: BusDeps): void {
  server.registerPrompt(
    "join-session",
    {
      title: "Join a Lattice session",
      description:
        "Start using this stdio MCP bus: join a shared session_id, then inspect peers and the session resource.",
      argsSchema: {
        session_id: sessionIdArg(deps),
        role: z.string().describe("This agent's role, e.g. frontend, backend, reviewer."),
      },
    },
    ({ session_id, role }) => {
      const sid = session_id?.trim() || deps.ctx.sessionId || deps.config.defaultSessionId || "<session_id>";
      const agentRole = role?.trim() || "<role>";
      return {
        description: `Join Lattice session ${sid} as ${agentRole}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `You are connected to Lattice (npm package ${PACKAGE_NAME}), a local stdio MCP session bus (${MCP_ALIGNMENT}).`,
                `1. Call join_session with session_id=${sid} and role=${agentRole}. Do not pass Redis passwords or URLs as tool arguments; they live in the MCP process env.`,
                `2. Call list_peers, or read resource ${sessionResourceUri(sid)} for a compact snapshot.`,
                "3. After idle, pull_messages (room main and/or inbox=true). Share short facts with memory_set, not raw tool dumps.",
                `4. Optional context: ${memoryResourceUri(sid)} lists shared memory keys.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "two-agent-handoff",
    {
      title: "Two-agent / two-machine handoff",
      description:
        "Same session_id on two harnesses or machines. Requires Redis (LATTICE_STORE=memory is one process only).",
      argsSchema: {
        session_id: sessionIdArg(deps),
        my_role: z.string().describe("Role for this agent, e.g. frontend."),
        other_role: z.string().optional().describe("Expected peer role, e.g. backend."),
      },
    },
    ({ session_id, my_role, other_role }) => {
      const sid = session_id?.trim() || deps.ctx.sessionId || deps.config.defaultSessionId || "demo-1";
      const mine = my_role?.trim() || "frontend";
      const other = other_role?.trim() || "backend";
      return {
        description: `Handoff on session ${sid} (${mine} ↔ ${other})`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Two agents share Lattice session_id=${sid}. Package ${PACKAGE_NAME}. Both MCP configs must use the same LATTICE_REDIS_URL, LATTICE_NAMESPACE, and optional LATTICE_JOIN_TOKEN (env only).`,
                `This agent: join_session session_id=${sid} role=${mine}. The other agent: join_session session_id=${sid} role=${other}.`,
                "Confirm with list_peers (online while presence TTL is fresh).",
                "Send tell_room or tell_agent. The other side calls pull_messages after idle (inbox=true for DMs).",
                `Put durable facts in memory_set. Read ${sessionResourceUri(sid)} and ${memoryResourceUri(sid)} for compact context.`,
                "LATTICE_STORE=memory cannot cross processes. Cross-machine requires Redis.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "pull-and-reply",
    {
      title: "Pull messages and reply",
      description: "Read new room or inbox messages since the cursor, then reply.",
      argsSchema: {
        session_id: sessionIdArg(deps),
        inbox: z
          .string()
          .optional()
          .describe("Set true to pull DMs instead of the main room."),
      },
    },
    ({ session_id, inbox }) => {
      const sid = session_id?.trim() || deps.ctx.sessionId || deps.config.defaultSessionId || "<session_id>";
      const wantInbox = inbox?.trim().toLowerCase() === "true";
      return {
        description: wantInbox ? `Pull inbox on ${sid}` : `Pull room main on ${sid}`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `If you have not joined, call join_session for session_id=${sid} first.`,
                wantInbox
                  ? "Call pull_messages with inbox=true (optionally other_agent_id for one pair). Default limit 50, max 200."
                  : "Call pull_messages for room main (or pass room_id). Default limit 50, max 200.",
                "Reply with tell_room or tell_agent. Bodies over ~2k characters are truncated.",
                `Optional snapshot: ${sessionResourceUri(sid)}.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
