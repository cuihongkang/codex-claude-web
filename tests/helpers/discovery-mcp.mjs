import { createInterface } from "node:readline";

const tools = Array.from({ length: 80 }, (_, index) => ({
  name: index === 37 ? "needle_lookup" : "unused_task_" + index,
  description:
    index === 37
      ? "Retrieve the needle verification value."
      : "Unrelated operation " +
        index +
        ". " +
        "Detailed schema documentation. ".repeat(100),
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
}));
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  if (request.method === "initialize")
    result = {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "discovery-fixture", version: "1" },
    };
  else if (request.method === "tools/list") result = { tools };
  else if (request.method === "tools/call")
    result = { content: [{ type: "text", text: "TOOL-RESULT-37" }] };
  else result = {};
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
  );
}
