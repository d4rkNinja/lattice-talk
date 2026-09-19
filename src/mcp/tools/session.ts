import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  joinSession,
  leaveSession,
  listPeers,
  sessionInfo,
} from "../../core/session.js";
import type { BusDeps } from "../../core/types.js";
import { destructive, readOnly, write } from "../annotations.js";
import { toolOk } from "../result.js";
import { runTool } from "../run.js";
import {
  joinSessionSchema,
  leaveSessionSchema,
  listPeersSchema,
  sessionInfoSchema,
} from "../schemas.js";

export function registerSessionTools(server: McpServer, deps: BusDeps): void {
  server.registerTool(
    "join_session",
    {
      description:
        "Join a Lattice session: register this agent, ensure the main room, start presence, and return peers. Same session_id + Redis = same bus across harnesses and machines.",
      inputSchema: joinSessionSchema,
      annotations: write("Join session", { idempotentHint: true }),
    },
    async (args) =>
      runTool(
        "join_session",
        deps,
        {
          sessionId: args.session_id,
          agentId: args.agent_id,
          role: args.role,
          displayName: args.display_name,
          harness: args.harness,
        },
        async () => toolOk(await joinSession(deps, args)),
      ),
  );

  server.registerTool(
    "leave_session",
    {
      description: "Leave the Lattice session and clear this agent's presence key.",
      inputSchema: leaveSessionSchema,
      annotations: destructive("Leave session"),
    },
    async (args) =>
      runTool(
        "leave_session",
        deps,
        { sessionId: args.session_id, agentId: args.agent_id },
        async () => toolOk(await leaveSession(deps, args)),
      ),
  );

  server.registerTool(
    "list_peers",
    {
      description:
        "List agents in the session. online is true when the presence key is still alive (TTL ~45s, refreshed on join and pull).",
      inputSchema: listPeersSchema,
      annotations: readOnly("List peers"),
    },
    async (args) =>
      runTool("list_peers", deps, { sessionId: args.session_id }, async () =>
        toolOk(await listPeers(deps, args)),
      ),
  );

  server.registerTool(
    "session_info",
    {
      description:
        "Debug snapshot: session_id, namespace, store kind, peer count, and rooms.",
      inputSchema: sessionInfoSchema,
      annotations: readOnly("Session info"),
    },
    async (args) =>
      runTool("session_info", deps, { sessionId: args.session_id }, async () =>
        toolOk(await sessionInfo(deps, args)),
      ),
  );
}
