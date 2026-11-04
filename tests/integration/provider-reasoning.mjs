import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { providerSession } from "./provider-session.mjs";

const upstream = createServer(async (request, response) => {
  for await (const bytes of request) void bytes;
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of [
    { reasoning_content: "Inspecting the calculation.\n\n" },
    { reasoning_content: "Checking the final result." },
    { content: "323" },
  ])
    response.write(
      "data: " +
        JSON.stringify({ id: "chat", choices: [{ index: 0, delta }] }) +
        "\n\n",
    );
  response.end(
    "data: " +
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
      }) +
      "\n\ndata: [DONE]\n\n",
  );
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const session = await providerSession();
try {
  const model = process.env.MODEL_ID || "reasoning-model";
  await session.call("lan/providers/set", {
    id: "reasoning",
    name: "推理验证",
    baseUrl:
      process.env.MODEL_BASE_URL ||
      `http://127.0.0.1:${upstream.address().port}/v1`,
    protocol: "chat",
    apiKey: process.env.MODEL_API_KEY || "",
    models: [{ id: model, contextWindow: 196608, maxOutputTokens: 8192 }],
  });
  const selection = { providerId: "reasoning", model };
  const { thread } = await session.call("thread/start", {
    ...selection,
    cwd: session.home,
    baseInstructions: "Answer briefly. Do not use tools.",
    config: { "features.shell_tool": false },
  });
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "推理正文验证（临时）",
  });
  const events = await session.turn(
    thread.id,
    "计算 17×19，只在最终回答中给出数字。",
    selection,
  );
  const deltas = events.filter((e) => e.method === "item/reasoning/textDelta");
  assert.ok(deltas.length > 0, "Codex 发出真实推理正文增量");
  const completed = events.find(
    (e) => e.method === "item/completed" && e.params.item?.type === "reasoning",
  );
  assert.ok(
    completed?.params.item.content.join("").trim(),
    "完成记录保留推理正文",
  );
  assert.ok(
    events.some(
      (e) =>
        e.method === "item/completed" &&
        e.params.item?.type === "agentMessage" &&
        e.params.item.text.includes("323"),
    ),
  );
  const { data: turns } = await session.call("thread/turns/list", {
    threadId: thread.id,
    itemsView: "full",
    limit: 100,
  });
  const history = turns || [];
  assert.ok(
    history
      .flatMap((t) => t.items || [])
      .some((i) => i.type === "reasoning" && i.content?.join("").trim()),
    "原生历史读取恢复推理正文",
  );
  const report = {
    status: "passed",
    reasoningDeltas: deltas.length,
    reasoningCharacters: completed.params.item.content.join("").length,
    historyRestored: true,
  };
  if (process.env.PROVIDER_EVENTS)
    await writeFile(
      process.env.PROVIDER_EVENTS,
      JSON.stringify(events, null, 2) + "\n",
    );
  if (process.env.PROVIDER_RESULT)
    await writeFile(
      process.env.PROVIDER_RESULT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report));
} finally {
  await session.close();
  await new Promise((resolve) => upstream.close(resolve));
}
