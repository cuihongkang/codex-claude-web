import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { providerSession } from "./provider-session.mjs";

const requests = [];
const upstream = createServer(async (request, response) => {
  let body = "";
  for await (const bytes of request) body += bytes;
  const input = JSON.parse(body);
  requests.push(input);
  console.log(
    JSON.stringify({
      request: requests.length,
      tools: input.tools?.length,
      search: input.tools?.some(
        (tool) => tool.function.name === "codex_find_tools",
      ),
    }),
  );
  if (process.env.MODEL_BASE_URL) {
    const actual = await fetch(
      process.env.MODEL_BASE_URL + "/chat/completions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
    );
    response.writeHead(actual.status, {
      "Content-Type": actual.headers.get("content-type"),
    });
    for await (const bytes of actual.body) response.write(bytes);
    response.end();
    return;
  }
  const found = input.tools?.find((tool) =>
    tool.function.name.includes("needle_lookup"),
  );
  const completed = input.messages.some(
    (message) =>
      message.role === "tool" &&
      JSON.stringify(message.content).includes("TOOL-RESULT-37"),
  );
  const delta = completed
    ? { content: "TOOL-RESULT-37" }
    : {
        tool_calls: [
          {
            index: 0,
            id: "call_" + requests.length,
            type: "function",
            function: {
              name: found ? found.function.name : "codex_find_tools",
              arguments: found
                ? "{}"
                : JSON.stringify({
                    query: "needle retrieve verification value",
                    limit: 1,
                  }),
            },
          },
        ],
      };
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.end(
    "data: " +
      JSON.stringify({ id: "chat", choices: [{ index: 0, delta }] }) +
      "\n\ndata: " +
      JSON.stringify({
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: completed ? "stop" : "tool_calls",
          },
        ],
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const mcp = fileURLToPath(
  new URL("../helpers/discovery-mcp.mjs", import.meta.url),
);
const session = await providerSession(undefined, undefined, {
  backendConfig: `\n[mcp_servers.fixture]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(mcp)}]\n`,
  async prepareHome(home) {
    const skill = join(home, "skills", "discovery-test");
    await mkdir(skill, { recursive: true });
    await writeFile(
      join(skill, "SKILL.md"),
      "---\nname: discovery-test\ndescription: A fixture skill for testing lazy loading.\n---\n\nFULL_SKILL_BODY_SENTINEL_7319\n",
    );
  },
});
try {
  const model = process.env.MODEL_ID || "discovery-model";
  await session.call("lan/providers/set", {
    id: "discovery",
    name: "工具按需发现验证",
    protocol: "chat",
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    models: [{ id: model, contextWindow: 196608, maxOutputTokens: 2048 }],
  });
  const selection = { providerId: "discovery", model };
  const { thread } = await session.call("thread/start", {
    ...selection,
    cwd: session.home,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    baseInstructions:
      "Use the needle lookup tool to retrieve the verification value. Discover tools when necessary. Do not use shell tools. Return the retrieved value.",
  });
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "工具按需发现验证",
  });
  await session.turn(
    thread.id,
    "Retrieve the needle verification value using its tool.",
    selection,
  );
  assert.ok(
    requests[0].tools.some((tool) => tool.function.name === "codex_find_tools"),
  );
  assert.equal(
    requests[0].tools.some((tool) =>
      tool.function.name.includes("needle_lookup"),
    ),
    false,
  );
  assert.ok(requests[0].tools.length < 25);
  assert.equal(
    JSON.stringify(requests[0].messages).includes(
      "FULL_SKILL_BODY_SENTINEL_7319",
    ),
    false,
  );
  assert.ok(JSON.stringify(requests[0].messages).includes("discovery-test"));
  assert.ok(
    requests
      .slice(1)
      .some((request) =>
        request.tools?.some((tool) =>
          tool.function.name.includes("needle_lookup"),
        ),
      ),
  );
  assert.ok(
    requests
      .at(-1)
      .messages.some(
        (message) =>
          message.role === "tool" &&
          JSON.stringify(message.content).includes("TOOL-RESULT-37"),
      ),
  );
  const mark = session.events.length;
  const requestMark = requests.length;
  const started = await session.call("turn/start", {
    threadId: thread.id,
    ...selection,
    input: [
      {
        type: "text",
        text: "Use the selected discovery-test skill and return the verification value.",
      },
      {
        type: "skill",
        name: "discovery-test",
        path: join(session.home, "skills/discovery-test/SKILL.md"),
      },
    ],
  });
  const ended = await session.event(
    "turn/completed",
    (p) => p.threadId === thread.id && p.turn.id === started.turn.id,
    mark,
  );
  assert.equal(
    ended.turn.status,
    "completed",
    JSON.stringify(ended.turn.error),
  );
  assert.ok(
    requests
      .slice(requestMark)
      .some((request) =>
        JSON.stringify(request.messages).includes(
          "FULL_SKILL_BODY_SENTINEL_7319",
        ),
      ),
  );
  const report = {
    status: "passed",
    firstTools: requests[0].tools.length,
    requests: requests.length,
    skillBodyLoaded: false,
    toolExecutedByCodex: true,
    selectedSkillLoaded: true,
  };
  if (process.env.PROVIDER_RESULT)
    await writeFile(
      process.env.PROVIDER_RESULT,
      JSON.stringify(report, null, 2),
    );
  console.log(JSON.stringify(report));
} finally {
  await session.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
