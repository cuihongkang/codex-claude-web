import assert from "node:assert/strict";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { messagesServer } from "../helpers/claude-messages-server.mjs";
import { createInputStream } from "../../server/src/backends/claude/input-stream.mjs";
import { providerRuntimeEnvironment } from "../../server/src/backends/claude/provider-environment.mjs";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";

const root = await mkdtemp(join(tmpdir(), "claude-native-checkpoints-"));
const cwd = join(root, "workspace"),
  dataDir = join(root, "config");
await mkdir(cwd);
const paths = [join(cwd, "first.txt"), join(cwd, "second.txt")];
await Promise.all(
  paths.map((path, index) => writeFile(path, `before-${index}\n`)),
);
let stage = 0;
const service = await messagesServer(() => {
  if (stage++ === 0)
    return paths.map((file_path, index) => ({
      type: "tool_use",
      id: `tool-read-${index}`,
      name: "Read",
      input: { file_path },
    }));
  if (stage === 2)
    return paths.map((file_path, index) => ({
      type: "tool_use",
      id: `tool-write-${index}`,
      name: "Write",
      input: { file_path, content: `after-${index}\n` },
    }));
  return [{ type: "text", text: "Native checkpoint proof" }];
});
const backend = {
  executable: process.env.CLAUDE_EXECUTABLE || "claude",
  dataDir,
};
const provider = {
  id: "fixture",
  protocol: "messages",
  baseUrl: service.url,
  apiKey: "test-token",
  models: ["fixture-model"],
};
const input = createInputStream(),
  messages = [],
  id = randomUUID(),
  promptId = randomUUID();
const native = query({
  prompt: input,
  options: {
    cwd,
    env: providerRuntimeEnvironment(provider, backend),
    pathToClaudeCodeExecutable: backend.executable,
    sessionId: id,
    model: "fixture-model",
    enableFileCheckpointing: true,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    persistSession: true,
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: [],
  },
});
const reading = (async () => {
  for await (const message of native) messages.push(message);
})();
try {
  input.push({
    type: "user",
    uuid: promptId,
    session_id: id,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "text",
          text: "Modify both files for the native checkpoint proof",
        },
      ],
    },
  });
  for (
    let attempt = 0;
    attempt < 1600 && !messages.some((message) => message.type === "result");
    attempt++
  )
    await delay(25);
  const result = messages.find((message) => message.type === "result");
  assert.ok(result, "the native tool turn returns a result");
  assert.equal(result.is_error, false, JSON.stringify(result));
  assert.deepEqual(
    await Promise.all(paths.map((path) => readFile(path, "utf8"))),
    ["after-0\n", "after-1\n"],
  );
  const preview = await native.rewindFiles(promptId, { dryRun: true });
  assert.equal(preview.canRewind, true, JSON.stringify(preview));
  assert.equal(preview.filesChanged.length, 2);
  assert.deepEqual(
    await Promise.all(paths.map((path) => readFile(path, "utf8"))),
    ["after-0\n", "after-1\n"],
  );
  const rewind = await native.rewindFiles(promptId);
  assert.equal(rewind.canRewind, true, JSON.stringify(rewind));
  assert.deepEqual(
    await Promise.all(paths.map((path) => readFile(path, "utf8"))),
    ["before-0\n", "before-1\n"],
  );
  const readSession = createSessionReader({ dataDir });
  const records = await readSession("getSessionMessages", id, { dir: cwd });
  assert.ok(records.some((record) => record.uuid === promptId));
  assert.ok(
    records.some((record) => record.type === "assistant"),
    "rewindFiles changes files while preserving native conversation history",
  );
  console.log(
    JSON.stringify({
      operation: "SDK Query.rewindFiles",
      preview,
      rewind,
      historyPreserved: true,
      modelCalls: service.requests.filter((request) =>
        request.tools?.some((tool) => tool.name === "Write"),
      ).length,
    }),
  );
} finally {
  input.close();
  native.close();
  await reading.catch(() => {});
  await service.close();
  await rm(root, { recursive: true, force: true });
}
