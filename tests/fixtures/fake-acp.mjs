import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Minimal fake ACP agent: answers initialize/session/new/session/prompt,
// emits an agent_message_chunk per prompt, and exercises the driver's
// session/request_permission handler when the prompt contains "need-perm".
const log = process.env.FAKE_LOG;
const note = (s) => {
  if (log) appendFileSync(log, s + "\n");
};

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  // Response to a request this fake sent (permission) — record it.
  if (msg.id !== undefined && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
    note(`permResult=${JSON.stringify(msg.result ?? msg.error)}`);
    return;
  }
  if (msg.id === undefined) return; // notifications: ignore
  const { id, method, params = {} } = msg;
  const reply = (result) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  const fail = (code, message) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");

  if (method === "initialize") {
    note(`init=${JSON.stringify(params.clientInfo)}`);
    reply({ protocolVersion: 1, authMethods: [] });
  } else if (method === "session/new") {
    note(`session.new mcpServers=${JSON.stringify(params.mcpServers)} cwd=${params.cwd}`);
    if (process.env.FAKE_FAIL_SESSION === "1") {
      fail(-32000, "Session creation failed: not authenticated");
      return;
    }
    reply({ sessionId: "sess-1" });
  } else if (method === "session/prompt") {
    const text = params.prompt?.[0]?.text ?? "";
    note(`prompt=${text}`);
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "ACK:" + text.slice(0, 20) },
          },
        },
      }) + "\n",
    );
    if (text.includes("need-perm")) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 500000 + id,
          method: "session/request_permission",
          params: {
            sessionId: params.sessionId,
            options: [
              { optionId: "deny-1", name: "Deny once" },
              { optionId: "allow-1", name: "Allow once" },
            ],
          },
        }) + "\n",
      );
    }
    reply({ stopReason: "end_turn" });
  } else if (method === "session/load") {
    note(`session/load sessionId=${params.sessionId}`);
    if (process.env.FAKE_LOAD_OK === "1") {
      reply({});
      return;
    }
    fail(-32601, "session loading not supported");
  } else if (method === "session/cancel") {
    note("cancelled");
    reply({});
  } else {
    note(`${method} sessionId=${params.sessionId ?? ""}`);
    fail(-32601, "unknown " + method);
  }
});
