import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Minimal fake `codex app-server`: initialize, thread/start, turn/start,
// turn/steer. With CODEX_HOLD_TURN=1 the turn stays in-flight so the next
// send must come through as turn/steer.
const log = process.env.FAKE_LOG;
const hold = process.env.CODEX_HOLD_TURN === "1";
const note = (s) => {
  if (log) appendFileSync(log, s + "\n");
};
let turnNo = 0;
let openTurn = null;

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notifications: ignore
  const { id, method, params = {} } = msg;
  const reply = (result) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  const notify = (m, p) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: m, params: p }) + "\n");

  if (method === "initialize") {
    note(`init=${JSON.stringify(params.clientInfo)}`);
    reply({});
  } else if (method === "thread/start") {
    reply({ thread: { id: "t-1" } });
  } else if (method === "turn/start") {
    turnNo += 1;
    const text = params.input?.[0]?.text ?? "";
    note(`turn=${text}`);
    const turnId = `turn-${turnNo}`;
    notify("turn/started", { threadId: params.threadId, turn: { id: turnId } });
    openTurn = turnId;
    reply({ turn: { id: turnId } });
    if (!hold) {
      notify("turn/completed", { threadId: params.threadId, turn: { id: turnId } });
      openTurn = null;
    }
  } else if (method === "turn/steer") {
    if (process.env.CODEX_STEER_FAIL === "1") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32000, message: "no turn in progress" },
        }) + "\n",
      );
      return;
    }
    const text = params.input?.[0]?.text ?? "";
    note(`steer=${text}`);
    reply({});
  } else {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown " + method } }) +
        "\n",
    );
  }
});
