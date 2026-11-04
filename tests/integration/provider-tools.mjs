export const dynamicTools = [
  {
    type: "function",
    name: "ledger_read",
    description: "Read the authoritative ledger balance and revision.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "ledger_add",
    description:
      "Add delta using the revision just returned by ledger_read, then verify with ledger_read.",
    inputSchema: {
      type: "object",
      properties: { delta: { type: "integer" }, revision: { type: "integer" } },
      required: ["delta", "revision"],
      additionalProperties: false,
    },
  },
];
export function createLedger({ padding = "" } = {}) {
  const state = { balance: 137, revision: 1 };
  const calls = [];
  let failNext = false;
  return {
    state,
    calls,
    failOnce() {
      failNext = true;
    },
    handle(socket, message) {
      if (message.method !== "item/tool/call") return;
      const { tool, arguments: args } = message.params;
      let success = true,
        result;
      if (tool === "ledger_read") result = { ...state };
      else if (
        tool === "ledger_add" &&
        (failNext || args.revision !== state.revision)
      ) {
        failNext = false;
        success = false;
        result = {
          error: "revision_conflict",
          action: "Read the ledger and retry once with the returned revision.",
        };
      } else if (tool === "ledger_add") {
        state.balance += args.delta;
        state.revision++;
        result = { ...state };
      } else {
        success = false;
        result = { error: "Unknown test tool" };
      }
      calls.push({ tool, success, result });
      socket.send(
        JSON.stringify({
          id: message.id,
          result: {
            contentItems: [
              {
                type: "inputText",
                text: JSON.stringify(
                  padding && success
                    ? { ...result, diagnosticLog: padding }
                    : result,
                ),
              },
            ],
            success,
          },
        }),
      );
    },
  };
}
