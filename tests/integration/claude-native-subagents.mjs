import assert from "node:assert/strict";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { messagesServer } from "../helpers/claude-messages-server.mjs";
import { providerRuntimeEnvironment } from "../../server/src/backends/claude/provider-environment.mjs";
import { createSessionReader } from "../../server/src/backends/claude/history.mjs";
import { historyTurns } from "../../server/src/backends/claude/messages.mjs";
import {
  recoverAgents,
  agentTurns,
} from "../../server/src/backends/claude/agent-history.mjs";

const root = await mkdtemp(join(tmpdir(), "claude-native-subagents-"));
const cwd = join(root, "workspace"),
  dataDir = join(root, "config");
await mkdir(cwd);
const toolId = "native-child-task-proof";
let sent = false;
const service = await messagesServer((request) => {
  const text = JSON.stringify(request.messages);
  if (text.includes(toolId))
    return [{ type: "text", text: "PARENT_NATIVE_ANSWER_PROOF" }];
  if (text.includes("CHILD_NATIVE_TASK_PROOF"))
    return [{ type: "text", text: "CHILD_NATIVE_ANSWER_PROOF" }];
  if (!sent && request.tools?.some((tool) => tool.name === "Agent")) {
    sent = true;
    return [
      {
        type: "tool_use",
        id: toolId,
        name: "Agent",
        input: {
          description: "Native child proof",
          subagent_type: "general-purpose",
          prompt: "CHILD_NATIVE_TASK_PROOF: report the proof marker only.",
        },
      },
    ];
  }
  return [{ type: "text", text: "Auxiliary response" }];
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
const id = randomUUID(),
  messages = [];
let native;
try {
  native = query({
    prompt: "Delegate the native child proof to a general-purpose agent.",
    options: {
      cwd,
      env: providerRuntimeEnvironment(provider, backend),
      pathToClaudeCodeExecutable: backend.executable,
      sessionId: id,
      model: "fixture-model",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: true,
      forwardSubagentText: true,
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: [],
    },
  });
  for await (const message of native) messages.push(message);
  assert.ok(sent, "the parent makes a real Agent tool call");
  const result = messages.findLast((message) => message.type === "result");
  assert.equal(result?.is_error, false, JSON.stringify(result));
  const readSession = createSessionReader({ dataDir });
  const ids = await readSession("listSubagents", id, { dir: cwd });
  assert.equal(ids.length, 1, JSON.stringify(messages));
  const records = await readSession("getSessionMessages", id, { dir: cwd });
  const child = await readSession("getSubagentMessages", id, ids[0], {
    dir: cwd,
  });
  assert.equal(child[0].parent_tool_use_id, toolId);
  assert.ok(
    JSON.stringify(child[0].message.content).includes(
      "CHILD_NATIVE_TASK_PROOF",
    ),
  );
  assert.ok(
    JSON.stringify(child).includes("CHILD_NATIVE_ANSWER_PROOF"),
    JSON.stringify({
      child,
      requests: service.requests.map((request) => ({
        tools: request.tools?.map((tool) => tool.name),
        last: request.messages?.at(-1),
      })),
    }),
  );
  const turns = historyTurns(records);
  const agents = await recoverAgents({ id, cwd }, turns, readSession);
  const key = `agent/${id}/${ids[0]}`;
  assert.equal(agents[key].toolUseId, toolId);
  assert.match(agents[key].prompt, /CHILD_NATIVE_TASK_PROOF/);
  assert.ok(
    turns.some((turn) => turn.items.some((item) => item.agentThreadId === key)),
  );
  const childTurns = agentTurns(child);
  assert.equal(childTurns[0].items[0].authorLabel, "主代理");
  console.log(
    JSON.stringify({
      operation: "native Agent + SDK subagent history",
      agentId: ids[0],
      toolId,
      initialTask: true,
      nativeAnswer: true,
      childMessages: child.length,
    }),
  );
} finally {
  native?.close();
  await service.close();
  await rm(root, { recursive: true, force: true });
}
