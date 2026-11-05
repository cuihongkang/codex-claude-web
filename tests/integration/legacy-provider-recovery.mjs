import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { providerSession } from "./provider-session.mjs";
import { nativeClient } from "../helpers/native-client.mjs";
import { chatProvider } from "../helpers/chat-provider.mjs";
import { resumeAfterClose } from "../../server/src/providers/resume.mjs";

const upstream = await chatProvider(),
  session = await providerSession();
let native;
try {
  await session.call("lan/providers/set", {
    id: "legacy-chat",
    name: "旧对话恢复验证",
    protocol: "chat",
    baseUrl: upstream.baseUrl,
    models: [
      { id: "legacy-model", contextWindow: 32768, maxOutputTokens: 2048 },
    ],
  });
  const selection = { providerId: "legacy-chat", model: "legacy-model" };
  const { thread } = await session.call("thread/start", {
    ...selection,
    cwd: session.home,
    baseInstructions:
      "Answer briefly. Preserve remembered markers in summaries. Do not use tools.",
    config: { "features.shell_tool": false },
  });
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "中断切换恢复验证",
  });
  const marker = "NATIVE-" + Math.random().toString(36).slice(2, 10);
  await session.turn(thread.id, "Remember marker " + marker, selection);
  await session.call("thread/unsubscribe", { threadId: thread.id });
  native = await nativeClient(session.backendUrl);
  const model = process.env.GPT_MODEL || "gpt-6.1-terra";
  await resumeAfterClose(native.call, {
    threadId: thread.id,
    modelProvider: "openai",
    model,
    excludeTurns: true,
    config: { thread_unload_delay_secs: 0 },
  });
  await native.call("thread/unsubscribe", { threadId: thread.id });
  native.close();
  const events = await session.turn(
    thread.id,
    "Reply with the remembered marker only.",
    { providerId: "codex", model, effort: "low" },
  );
  assert.ok(
    events.some(
      (event) =>
        event.method === "item/completed" &&
        event.params.item.type === "agentMessage" &&
        event.params.item.text.includes(marker),
    ),
  );
  const { thread: restored } = await session.call("thread/read", {
    threadId: thread.id,
    includeTurns: false,
  });
  assert.equal(restored.modelProvider, "openai");
  const report = {
    status: "passed",
    interruptedSwitchRecovered: true,
    originalThreadPreserved: true,
    nativeProvider: restored.modelProvider,
    memoryPreserved: true,
  };
  if (process.env.PROVIDER_RESULT)
    await writeFile(
      process.env.PROVIDER_RESULT,
      JSON.stringify(report, null, 2),
    );
  console.log(JSON.stringify(report));
} finally {
  native?.close();
  await session.close();
  await upstream.close();
}
