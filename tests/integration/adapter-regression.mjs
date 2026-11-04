import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  buildOpenAIChatRequest,
} = require("../../vendor/anyresponses/src/providers/openai/request.js");
const {
  createOpenAIChatAdapter,
} = require("../../vendor/anyresponses/src/adapters/openai-chat.js");
const { eventsToSSE } = require("../../vendor/anyresponses/src/stream/sse.js");
const native = {
  model: "probe",
  tools: [
    {
      type: "namespace",
      name: "functions",
      tools: [
        { type: "function", name: "read", parameters: { type: "object" } },
      ],
    },
  ],
  input: [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "system" }],
    },
    { type: "reasoning", encrypted_content: "opaque" },
    {
      type: "function_call",
      namespace: "functions",
      name: "read",
      call_id: "call1",
      arguments: "{}",
    },
    { type: "function_call_output", call_id: "call1", output: "137" },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "done" }],
    },
  ],
};
const mapped = buildOpenAIChatRequest(native);
assert.equal(mapped.messages[0].role, "system");
assert.equal(mapped.messages[1].tool_calls[0].function.name, "functions__read");
assert.equal(mapped.messages[2].tool_call_id, "call1");
assert.equal(mapped.messages[3].content, "done");
assert.equal(mapped.tools[0].function.name, "functions__read");
assert.ok(!JSON.stringify(mapped).includes("opaque"));
const adapter = createOpenAIChatAdapter();
async function* chunks() {
  yield {
    id: "resp_probe",
    model: "probe",
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call1",
              function: { name: "read", arguments: '{"p":' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
  yield {
    id: "resp_probe",
    model: "probe",
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] },
        finish_reason: null,
      },
    ],
  };
  yield {
    id: "resp_probe",
    model: "probe",
    choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 80 },
    },
  };
}
const events = [];
for await (const e of adapter.toOpenStream(chunks(), {
  request: native,
  strict: false,
}))
  events.push(e);
const calls = events.filter(
  (e) =>
    e.type === "response.output_item.done" && e.item.type === "function_call",
);
assert.equal(calls.length, 1);
assert.equal(calls[0].item.call_id, "call1");
assert.deepEqual(JSON.parse(calls[0].item.arguments), { p: 1 });
const completed = events.at(-1);
assert.equal(completed.type, "response.completed");
assert.equal(completed.response.usage.input_tokens, 100);
assert.equal(completed.response.usage.input_tokens_details.cached_tokens, 80);
async function* stream() {
  yield completed;
}
let encoded = "";
for await (const x of eventsToSSE(stream())) encoded += x;
assert.ok(encoded.includes("\n\n"));
assert.ok(encoded.endsWith("data: [DONE]\n\n"));
console.log(
  "PASS native history, encrypted omission, namespace tools, assistant text, streamed argument aggregation, call IDs, cached usage, SSE framing",
);
const parallel = buildOpenAIChatRequest({
  model: "probe",
  input: [
    { type: "function_call", call_id: "a", name: "read", arguments: "{}" },
    { type: "function_call", call_id: "b", name: "peek", arguments: "{}" },
    { type: "function_call_output", call_id: "a", output: "1" },
    { type: "function_call_output", call_id: "b", output: "2" },
  ],
});
assert.equal(parallel.messages[0].tool_calls.length, 2);
assert.deepEqual(
  parallel.messages.slice(1).map((m) => m.tool_call_id),
  ["a", "b"],
);
console.log("PASS parallel call history remains one assistant call group");
