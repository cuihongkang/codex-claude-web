import test from "node:test";
import assert from "node:assert/strict";
import {
  createToolDiscovery,
  discoveryName,
} from "../src/providers/tool-discovery.mjs";
import { fetchDeferredChat } from "../src/providers/deferred-chat.mjs";
import {
  prepareToolSearch,
  restoreToolSearch,
} from "../src/providers/tool-search.mjs";

const tool = (name, description) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties: {} },
  },
});
const input = () => ({
  model: "model",
  stream: true,
  messages: [{ role: "user", content: "Find a repository" }],
  tools: [
    tool("shell", "Run commands"),
    tool("mcp__github__search", "Search repositories"),
    tool("mcp__mail__read", "Read mail"),
  ],
});
const searchCall = (query) => ({
  id: "search",
  type: "function",
  function: {
    name: discoveryName,
    arguments: JSON.stringify({ query, limit: 1 }),
  },
});

test("首轮提供发现入口，匹配后仅加载选中工具，历史调用和不同请求保持隔离", () => {
  const original = input();
  const discovery = createToolDiscovery(original);
  assert.deepEqual(
    discovery.request().tools.map((tool) => tool.function.name),
    ["shell", discoveryName],
  );
  assert.equal(
    discovery.complete({
      role: "assistant",
      tool_calls: [searchCall("repositories github")],
    }).done,
    false,
  );
  assert.ok(
    discovery
      .request()
      .tools.some((tool) => tool.function.name === "mcp__github__search"),
  );
  assert.equal(
    discovery
      .request()
      .tools.some((tool) => tool.function.name === "mcp__mail__read"),
    false,
  );
  assert.equal(original.messages.length, 1);
  assert.equal(original.tools.length, 3);
  assert.equal(createToolDiscovery(input()).request().tools.length, 2);
  const resumed = input();
  resumed.messages.push({
    role: "assistant",
    tool_calls: [{ function: { name: "mcp__mail__read" } }],
  });
  assert.ok(
    createToolDiscovery(resumed)
      .request()
      .tools.some((tool) => tool.function.name === "mcp__mail__read"),
  );
  const noMatch = createToolDiscovery(input());
  noMatch.complete({
    role: "assistant",
    tool_calls: [searchCall("unmatched_73491")],
  });
  assert.match(noMatch.request().messages.at(-1).content, /No matching tools/);
});

test("流式发现内部完成，真实工具调用交给 Codex，推理和最终用量继续流式输出", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests.push(JSON.parse(options.body));
    const call =
      requests.length === 1
        ? searchCall("github repositories")
        : {
            id: "actual",
            type: "function",
            function: {
              name: "mcp__github__search",
              arguments: '{"query":"repo"}',
            },
          };
    const events = [
      {
        choices: [
          { delta: { reasoning_content: "Think " }, finish_reason: null },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, ...call }] },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        choices: [],
        usage: {
          prompt_tokens: 100 + requests.length,
          completion_tokens: 10,
          total_tokens: 112,
        },
      },
    ];
    return new Response(
      events
        .map((event) => "data: " + JSON.stringify(event) + "\n\n")
        .join("") + "data: [DONE]\n\n",
      { headers: { "Content-Type": "text/event-stream" } },
    );
  });
  const response = await fetchDeferredChat("https://fixture.test", input(), {
    method: "POST",
  });
  const body = await response.text();
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].tools.some(
      (tool) => tool.function.name === "mcp__github__search",
    ),
    false,
  );
  assert.ok(
    requests[1].tools.some(
      (tool) => tool.function.name === "mcp__github__search",
    ),
  );
  assert.equal(body.includes(discoveryName), false);
  assert.match(body, /mcp__github__search/);
  assert.equal(body.match(/Think /g).length, 2);
  assert.match(body, /"prompt_tokens":102/);
});

test("非流式发现可恢复，认证错误原样返回，无 MCP 的请求直接发送", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return count === 1
      ? Response.json({
          choices: [
            {
              message: { role: "assistant", tool_calls: [searchCall("mail")] },
            },
          ],
        })
      : Response.json({
          choices: [{ message: { role: "assistant", content: "done" } }],
        });
  });
  const response = await fetchDeferredChat(
    "https://fixture.test",
    { ...input(), stream: false },
    {},
  );
  assert.equal((await response.json()).choices[0].message.content, "done");
  assert.equal(count, 2);
  const denied = new Response("unauthorized", { status: 401 });
  t.mock.method(globalThis, "fetch", async () => denied);
  assert.equal(
    await fetchDeferredChat("https://fixture.test", input(), {}),
    denied,
  );
  const direct = { messages: [], tools: [tool("shell", "Run commands")] };
  assert.equal(createToolDiscovery(direct), null);
  assert.equal(
    await fetchDeferredChat("https://fixture.test", direct, {}),
    denied,
  );
});

test("已有原生工具搜索沿用 Codex 搜索调用，Chat 映射保留参数和结果", () => {
  const request = prepareToolSearch({
    tools: [{ type: "tool_search", parameters: {} }],
    input: [
      {
        type: "tool_search_call",
        call_id: "call",
        execution: "client",
        arguments: { query: "mail" },
      },
      {
        type: "tool_search_output",
        call_id: "call",
        tools: [{ type: "function", name: "mcp__mail__read", parameters: {} }],
      },
    ],
  });
  assert.equal(request.tools[0].name, "tool_search");
  assert.equal(request.input[0].type, "function_call");
  assert.equal(request.input[1].type, "function_call_output");
  restoreToolSearch(request.input[0]);
  assert.equal(request.input[0].type, "tool_search_call");
  assert.deepEqual(request.input[0].arguments, { query: "mail" });
  assert.equal(prepareToolSearch({ input: "text" }).input, "text");
});
