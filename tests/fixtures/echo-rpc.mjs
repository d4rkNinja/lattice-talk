import { createInterface } from "node:readline";

// Generic newline-JSON-RPC peer for NdjsonRpc unit tests:
//   echo → returns params verbatim
//   boom → JSON-RPC error
//   poke → emits a "poked" notification, replies {}
//   ask  → sends a client-bound request "whoareyou", resolves with its result
let pendingAsk = null;

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  // Response to our own client-bound request — resolve the pending `ask`.
  if (msg.id !== undefined && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
    if (pendingAsk !== null) {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: pendingAsk, result: msg.result ?? null }) + "\n",
      );
      pendingAsk = null;
    }
    return;
  }
  if (msg.id === undefined) return;
  const { id, method, params } = msg;
  const reply = (result) =>
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");

  if (method === "echo") reply(params);
  else if (method === "boom") {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: 123, message: "kaboom" },
      }) + "\n",
    );
  } else if (method === "poke") {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", method: "poked", params: { n: 1 } }) + "\n",
    );
    reply({});
  } else if (method === "ask") {
    pendingAsk = id;
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: 777, method: "whoareyou", params: {} }) + "\n",
    );
  } else {
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown " + method } }) +
        "\n",
    );
  }
});
