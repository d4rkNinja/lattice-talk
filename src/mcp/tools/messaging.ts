import type { McpServer } from "@modelcontextprotocol/server";
import { pullMessages, tellAgent, tellRoom } from "../../core/messages.js";
import { createRoom, joinRoom } from "../../core/rooms.js";
import type { BusDeps } from "../../core/types.js";
import { write } from "../annotations.js";
import { toolOk } from "../result.js";
import { runTool } from "../run.js";
import {
  createRoomOutputSchema,
  createRoomSchema,
  joinRoomOutputSchema,
  joinRoomSchema,
  pullMessagesOutputSchema,
  pullMessagesSchema,
  tellAgentOutputSchema,
  tellAgentSchema,
  tellRoomOutputSchema,
  tellRoomSchema,
} from "../schemas.js";

export function registerMessagingTools(server: McpServer, deps: BusDeps): void {
  server.registerTool(
    "tell_agent",
    {
      description:
        "Send a DM from this joined process to another agent in this session. Stored durably on the sorted pair stream (a:b). The result reports recipient_online: when false, the message is queued until the agent next joins — or its supervisor (recipient_wake field, e.g. \"bridge\") respawns it. The recipient reads it with pull_messages inbox=true.",
      inputSchema: tellAgentSchema,
      outputSchema: tellAgentOutputSchema,
      annotations: write("Tell agent"),
    },
    async (args) =>
      runTool(
        "tell_agent",
        deps,
        { sessionId: args.session_id, harness: deps.ctx.harness },
        async () => toolOk(await tellAgent(deps, args)),
      ),
  );

  server.registerTool(
    "tell_room",
    {
      description:
        "Broadcast a message from this joined process to a session room (default main). Caller must be a room member. Room members waiting on pull_messages with wait_ms are woken immediately.",
      inputSchema: tellRoomSchema,
      outputSchema: tellRoomOutputSchema,
      annotations: write("Tell room"),
    },
    async (args) =>
      runTool(
        "tell_room",
        deps,
        {
          sessionId: args.session_id,
          roomId: args.room_id,
          harness: deps.ctx.harness,
        },
        async () => toolOk(await tellRoom(deps, args)),
      ),
  );

  server.registerTool(
    "pull_messages",
    {
      description:
        "Read new messages since this process's cursor, then advance the cursor and refresh presence. Pass room_id for a room (must be a member), or inbox=true (optionally other_agent_id) for this process's DMs. Set wait_ms (max 30000) to block until a new message arrives via push wake-up instead of polling. Bodies longer than ~2k chars are truncated.",
      inputSchema: pullMessagesSchema,
      outputSchema: pullMessagesOutputSchema,
      annotations: write("Pull messages"),
    },
    async (args, ctx) =>
      runTool(
        "pull_messages",
        deps,
        { sessionId: args.session_id, roomId: args.room_id },
        async () =>
          toolOk(
            await pullMessages(deps, args, {
              signal: ctx.mcpReq.signal,
              onWaitStart: () => {
                const progressToken = ctx.mcpReq._meta?.progressToken;
                if (progressToken === undefined) return;
                void ctx.mcpReq
                  .notify({
                    method: "notifications/progress",
                    params: {
                      progressToken,
                      progress: 0,
                      message: "waiting for new messages",
                    },
                  })
                  .catch(() => {});
              },
            }),
          ),
      ),
  );

  server.registerTool(
    "create_room",
    {
      description: "Create a named room in the session and add this process as a member.",
      inputSchema: createRoomSchema,
      outputSchema: createRoomOutputSchema,
      annotations: write("Create room"),
    },
    async (args) =>
      runTool(
        "create_room",
        deps,
        { sessionId: args.session_id, roomId: args.room_id },
        async () => toolOk(await createRoom(deps, args)),
      ),
  );

  server.registerTool(
    "join_room",
    {
      description: "Join an existing room's membership set as this process.",
      inputSchema: joinRoomSchema,
      outputSchema: joinRoomOutputSchema,
      annotations: write("Join room", { idempotentHint: true }),
    },
    async (args) =>
      runTool(
        "join_room",
        deps,
        { sessionId: args.session_id, roomId: args.room_id },
        async () => toolOk(await joinRoom(deps, args)),
      ),
  );
}
