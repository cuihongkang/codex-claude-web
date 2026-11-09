import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile,
  rm,
  cp,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClaudeAdapter } from "../../server/src/backends/claude/adapter.mjs";
import { recordModelApi } from "../helpers/record-model-api.mjs";

const cwd = process.env.VALIDATION_CWD;
const relative = process.env.VALIDATION_DIRECTORY;
const baseUrl = process.env.MODEL_BASE_URL;
const model = process.env.MODEL_ID;
const executable = process.env.CLAUDE_EXECUTABLE;
if (!cwd || !relative || !baseUrl || !model || !executable)
  throw new Error(
    "请设置 VALIDATION_CWD、VALIDATION_DIRECTORY、MODEL_BASE_URL、MODEL_ID、CLAUDE_EXECUTABLE",
  );
const prompt = `${relative} 介绍这个文件夹里面各个文件的功能`;
const target = resolve(cwd, relative);
const evidence = resolve(
  process.env.VALIDATION_OUTPUT ||
    ".cache/backend-acceptance/original-user-case",
);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const temporary = await mkdtemp(join(tmpdir(), "claude-readonly-directory-"));
const sourceFiles = (await readdir(target, { withFileTypes: true })).filter(
  (entry) => entry.isFile(),
);
async function snapshot() {
  return Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async ({ name }) => {
        const content = await readFile(join(target, name));
        return [
          name,
          {
            bytes: content.length,
            sha256: createHash("sha256").update(content).digest("hex"),
            symbols: [
              ...content.toString().matchAll(/^(?:def|class) ([A-Za-z]\w*)/gm),
            ].map((match) => match[1]),
          },
        ];
      }),
    ),
  );
}
const before = await snapshot();
const recording = await recordModelApi(baseUrl, join(evidence, "model-api"));
const events = [];
const startedAt = Date.now();
const adapter = createClaudeAdapter({
  backend: {
    id: "claude",
    type: "claude",
    executable,
    dataDir: temporary,
    stateDir: join(temporary, "web-state"),
    args: [],
  },
  config: { defaultCwd: cwd, projectlessRoot: join(temporary, "workspaces") },
  providers: {
    get: async () => ({
      id: "validation",
      protocol: "messages",
      baseUrl: recording.url,
      apiKey: process.env.MODEL_API_KEY || "",
      models: [model],
    }),
  },
  send: (client, message) => client.deliver(message),
  broadcast: (message) => {
    events.push({ receivedAt: Date.now(), ...message });
    if (message.method === "item/completed") {
      const item = message.params.item;
      if (["dynamicToolCall", "commandExecution"].includes(item.type))
        console.log(
          JSON.stringify({
            tool: item.tool || "Bash",
            status: item.status,
            file: item.arguments?.file_path,
          }),
        );
    }
  },
});
let sequence = 0;
const call = (method, params = {}) =>
  new Promise((resolve, reject) =>
    adapter
      .receive(
        {
          deliver: (message) =>
            message.error
              ? reject(new Error(message.error.message))
              : resolve(message.result),
        },
        { id: ++sequence, method, params },
      )
      .catch(reject),
  );
let report;
try {
  await adapter.connect();
  assert.ok(adapter.ready, JSON.stringify(adapter.state()));
  const { thread } = await call("thread/start", {
    cwd,
    model,
    providerId: "validation",
  });
  const { turn } = await call("turn/start", {
    threadId: thread.id,
    model,
    providerId: "validation",
    collaborationMode: {
      mode: "plan",
      settings: { model, reasoning_effort: null, developer_instructions: null },
    },
    input: [{ type: "text", text: prompt }],
  });
  let completion;
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    completion = events.find(
      (event) =>
        event.method === "turn/completed" && event.params.turn.id === turn.id,
    )?.params.turn;
    if (completion) break;
    await delay(50);
  }
  assert.ok(completion, "原请求在明确验收窗口内结束");
  assert.equal(completion.status, "completed", JSON.stringify(completion));
  const history = await call("thread/turns/list", {
    threadId: thread.id,
    itemsView: "full",
  });
  await writeFile(
    join(evidence, "history.json"),
    JSON.stringify(history, null, 2),
    { mode: 0o600 },
  );
  const items = new Map();
  for (const event of events)
    if (event.method === "item/completed")
      items.set(event.params.item.id, event.params.item);
  const answer = [...items.values()]
    .filter(
      (item) =>
        ["plan", "agentMessage"].includes(item.type) &&
        item.phase === "final_answer",
    )
    .map((item) => item.text || "")
    .join("\n\n");
  await writeFile(join(evidence, "answer.md"), answer, { mode: 0o600 });
  assert.ok(answer.length >= 300, "提供完整文件功能介绍");
  for (const [name, source] of Object.entries(before)) {
    assert.ok(answer.includes(name), `最终正文说明 ${name}`);
    if (source.symbols.length)
      assert.ok(
        source.symbols.some((symbol) => answer.includes(symbol)),
        `最终正文引用 ${name} 的真实API`,
      );
  }
  const requestFiles = (await readdir(join(evidence, "model-api"))).filter(
    (name) => name.endsWith(".request.json"),
  );
  const requests = await Promise.all(
    requestFiles.map(async (name) =>
      JSON.parse(await readFile(join(evidence, "model-api", name), "utf8")),
    ),
  );
  const blocks = requests.flatMap((request) =>
    (request.messages || []).flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    ),
  );
  const tools = new Map(
    blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => [block.id, block]),
  );
  const successfulResults = blocks.filter(
    (block) => block.type === "tool_result" && !block.is_error,
  );
  const nativeReads = {};
  for (const [name, source] of Object.entries(before)) {
    if (!source.bytes) continue;
    const result = successfulResults.find((block) => {
      const tool = tools.get(block.tool_use_id);
      const content =
        typeof block.content === "string"
          ? block.content
          : JSON.stringify(block.content);
      return (
        tool &&
        ["Read", "Bash"].includes(tool.name) &&
        source.symbols.some((symbol) => content.includes(symbol)) &&
        (tool.name === "Bash" || basename(tool.input.file_path) === name)
      );
    });
    assert.ok(result, `原生工具成功读取 ${name}，响应包含真实源代码API`);
    nativeReads[name] = {
      toolUseId: result.tool_use_id,
      tool: tools.get(result.tool_use_id).name,
      input: tools.get(result.tool_use_id).input,
      matchedSymbols: source.symbols,
    };
  }
  const after = await snapshot();
  assert.deepEqual(after, before, "用户目标目录源码字节保持原样");
  assert.ok(
    requests.some((request) =>
      JSON.stringify(request.messages).includes(prompt),
    ),
    "原请求原文送达原生CLI",
  );
  const timings = JSON.parse(
    await readFile(join(evidence, "model-api", "timings.json"), "utf8"),
  );
  assert.ok(
    timings.every((entry) => entry.status === 200 && !entry.error),
    "全部原生请求返回200且没有传输失败",
  );
  report = {
    status: "passed",
    completedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    cliVersion: execFileSync(executable, ["--version"], {
      encoding: "utf8",
    }).trim(),
    model,
    baseUrl,
    cwd,
    target,
    prompt,
    mode: "plan",
    turnStatus: completion.status,
    answerCharacters: answer.length,
    coveredFiles: Object.keys(before),
    nativeReads,
    unchangedSourceHashes: before,
    apiRequests: timings.length,
    apiStatuses: timings.map((entry) => entry.status),
    no500: true,
    allFilesDiscussed: true,
    sourceUnchanged: true,
  };
  console.log(JSON.stringify(report));
} catch (error) {
  report = {
    status: "failed",
    elapsedMs: Date.now() - startedAt,
    prompt,
    mode: "plan",
    error: error.stack,
  };
  throw error;
} finally {
  adapter.close();
  await recording.close();
  await writeFile(
    join(evidence, "events.json"),
    JSON.stringify(events, null, 2),
    { mode: 0o600 },
  );
  await writeFile(
    join(evidence, "report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  await cp(temporary, join(evidence, "native-session"), { recursive: true });
  await rm(temporary, { recursive: true, force: true });
}
