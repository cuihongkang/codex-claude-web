import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { providerSession } from "./provider-session.mjs";

// 使用独立 Codex 后端验证第三方推理历史经原生整理后切换到 GPT。
const upstream = createServer(async (request, response) => {
  let body = "";
  for await (const bytes of request) body += bytes;
  const marker = body.match(/SWITCH-[a-z0-9]+/)?.[0];
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of [
    { reasoning_content: "Checking the remembered marker." },
    { content: marker || "Marker recorded." },
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
let session;
try {
  session = await providerSession();
  await session.call("lan/providers/set", {
    id: "reasoning",
    name: "推理切换验证",
    baseUrl:
      process.env.MODEL_BASE_URL ||
      `http://127.0.0.1:${upstream.address().port}/v1`,
    protocol: "chat",
    apiKey: process.env.MODEL_API_KEY || "",
    models: [
      {
        id: process.env.MODEL_ID || "reasoning-model",
        contextWindow: 196608,
        maxOutputTokens: 2048,
      },
    ],
  });
  const local = {
    providerId: "reasoning",
    model: process.env.MODEL_ID || "reasoning-model",
  };
  const native = {
    providerId: "codex",
    model: process.env.GPT_MODEL || "gpt-6.1-terra",
    effort: "low",
  };
  const { thread } = await session.call("thread/start", {
    ...local,
    cwd: session.home,
    baseInstructions:
      "Answer briefly. Do not use tools. Preserve the marker in summaries.",
    config: { "features.shell_tool": false },
  });
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "供应商推理历史切换验证",
  });
  const marker = "SWITCH-" + Math.random().toString(36).slice(2, 12);
  const checks = [];
  for (let round = 0; round < 2; round++) {
    const localEvents = await session.turn(
      thread.id,
      `Remember marker ${marker}.`,
      local,
    );
    assert.ok(localEvents.some((e) => e.method === "item/reasoning/textDelta"));
    const events = await session.turn(
      thread.id,
      "Reply with the remembered marker only.",
      native,
    );
    assert.ok(
      events.some(
        (e) =>
          e.method === "item/completed" &&
          e.params.item.type === "agentMessage" &&
          e.params.item.text.includes(marker),
      ),
    );
    const { data } = await session.call("thread/turns/list", {
      threadId: thread.id,
      itemsView: "full",
      limit: 100,
    });
    assert.ok(
      data
        .flatMap((t) => t.items || [])
        .some((i) => i.type === "reasoning" && i.content?.join("").trim()),
    );
    assert.ok(
      data.some((t) => t.items?.some((i) => i.type === "contextCompaction")),
    );
    checks.push(`原生整理后切回 GPT，第 ${round + 1} 次；标记和推理历史保留`);
    console.log(checks.at(-1));
  }
  const mark = session.events.length;
  await session.call("thread/compact/start", { threadId: thread.id });
  const ended = await session.event(
    "turn/completed",
    (p) => p.threadId === thread.id,
    mark,
  );
  assert.equal(
    ended.turn.status,
    "completed",
    JSON.stringify(ended.turn.error),
  );
  const events = await session.turn(
    thread.id,
    "Reply with the remembered marker only.",
    native,
  );
  assert.ok(
    events.some(
      (e) =>
        e.method === "item/completed" &&
        e.params.item.type === "agentMessage" &&
        e.params.item.text.includes(marker),
    ),
  );
  checks.push("混合推理历史在 GPT 下整理并继续对话");
  await session.turn(
    thread.id,
    "Reply with the remembered marker only.",
    local,
  );
  const returned = await session.turn(
    thread.id,
    "Reply with the remembered marker only.",
    native,
  );
  assert.ok(
    returned.some(
      (e) =>
        e.method === "item/completed" &&
        e.params.item.type === "agentMessage" &&
        e.params.item.text.includes(marker),
    ),
  );
  checks.push("GPT 原生整理后切回 Chat，再返回 GPT 保留记忆");
  const report = { status: "passed", checks };
  if (process.env.PROVIDER_RESULT)
    await writeFile(
      process.env.PROVIDER_RESULT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report));
} finally {
  await session?.close();
  await new Promise((resolve) => upstream.close(resolve));
}
