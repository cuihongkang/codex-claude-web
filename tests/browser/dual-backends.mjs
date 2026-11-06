import { shutdownBrowserClaudeWorker } from "../helpers/claude-worker-cleanup.mjs";
import { testDualConversation } from "./dual-backends-conversation.mjs";
import { testDualPresentation } from "./dual-backends-presentation.mjs";
import { testContextTimer } from "./dual-backends-context-timer.mjs";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { createWebApplication } from "../../server/src/application.mjs";
import { createAuthentication } from "../../server/src/auth.mjs";
import { readConfig } from "../../server/src/config.mjs";
import { authenticationFixture } from "../helpers/auth.mjs";
import { messagesServer } from "../helpers/claude-messages-server.mjs";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const directory = await mkdtemp(join(tmpdir(), "dual-backend-browser-"));
const artifacts = join(process.cwd(), ".cache/dual-backend-browser");
await mkdir(artifacts, { recursive: true });
let releaseReply;
const replyGate = new Promise((resolve) => {
  releaseReply = resolve;
});
let releaseEdit, editStarted, releaseFailure, failureStarted;
const editGate = new Promise((resolve) => {
  releaseEdit = resolve;
});
const editRequest = new Promise((resolve) => {
  editStarted = resolve;
});
const failureGate = new Promise((resolve) => {
  releaseFailure = resolve;
});
const failureRequest = new Promise((resolve) => {
  failureStarted = resolve;
});
let releaseTimer, timerStarted;
const timerGate = new Promise((resolve) => {
  releaseTimer = resolve;
});
const timerRequest = new Promise((resolve) => {
  timerStarted = resolve;
});
const modelServer = await messagesServer(async () => {
  await replyGate;
  return [
    {
      type: "thinking",
      thinking: "这是原生完整思考正文。".repeat(40) + "\n\n思考正文末尾标记。",
      signature: "fixture-signature",
    },
    { type: "text", text: "双后端验证通过" },
  ];
});
const secondServer = await messagesServer(async (body) => {
  const latest = body.messages
    .filter((message) => message.role === "user")
    .at(-1);
  if (JSON.stringify(latest).includes("上下文计时验证"))
    return [
      {
        type: "tool_use",
        id: "timer_read",
        name: "Read",
        input: { file_path: join(directory, "fuzzy-target.mjs") },
      },
    ];
  if (JSON.stringify(latest).includes('"tool_use_id":"timer_read"')) {
    timerStarted();
    await timerGate;
    return [{ type: "text", text: "计时验证完成" }];
  }
  if (JSON.stringify(latest).includes("触发API故障")) {
    failureStarted();
    await failureGate;
    return {
      status: 400,
      body: {
        type: "error",
        error: { type: "invalid_request_error", message: "fixture-api-error" },
      },
    };
  }
  if (JSON.stringify(latest).includes("修改当前问题")) {
    editStarted();
    await editGate;
  }
  return [{ type: "text", text: "供应商切换成功" }];
});
const largeFile = join(directory, "large-native-file.txt");
const largeFileOriginal = ("x".repeat(1000) + "\n").repeat(10000);
await writeFile(largeFile, largeFileOriginal);
await mkdir(join(directory, ".claude", "skills", "native-browser-fixture"), {
  recursive: true,
});
await writeFile(
  join(directory, ".claude", "skills", "native-browser-fixture", "SKILL.md"),
  "---\nname: native-browser-fixture\ndescription: Native browser skill fixture\n---\nnative-browser-fixture-body\n",
);
await mkdir(join(directory, "中文目录"));
await writeFile(
  join(directory, "中文目录", "中文文件.js"),
  "export const value = 1;\n",
);
await writeFile(
  join(directory, "fuzzy-target.mjs"),
  "export const file = true;\n",
);
const codexThread = {
  id: "codex-fixture",
  name: "Codex 示例对话",
  cwd: directory,
  createdAt: Date.now() / 1000,
  status: { type: "idle" },
};
const native = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(native, "listening");
native.on("connection", (socket) =>
  socket.on("message", (bytes) => {
    const m = JSON.parse(bytes);
    if (m.id === undefined) return;
    const result =
      m.method === "model/list"
        ? {
            data: [
              {
                id: "gpt-test",
                model: "gpt-test",
                displayName: "GPT Test",
                isDefault: true,
                supportedReasoningEfforts: [],
              },
            ],
          }
        : m.method === "thread/list"
          ? { data: [codexThread], nextCursor: null }
          : ["thread/read", "thread/resume"].includes(m.method)
            ? { thread: codexThread, model: "gpt-test", cwd: directory }
            : ["thread/turns/list", "thread/items/list"].includes(m.method)
              ? { data: [], nextCursor: null }
              : m.method === "config/read"
                ? { config: {} }
                : m.method === "skills/list"
                  ? { data: [] }
                  : m.method === "account/read"
                    ? { account: null }
                    : m.method === "plugin/installed"
                      ? {
                          marketplaces: [
                            {
                              plugins: [
                                {
                                  id: "codex-only-plugin",
                                  name: "codex-only-plugin",
                                  enabled: true,
                                },
                              ],
                            },
                          ],
                        }
                      : m.method === "mcpServerStatus/list"
                        ? {
                            data: [
                              {
                                name: "codex-only-server",
                                status: "connected",
                                tools: { "codex-tool": { name: "codex-tool" } },
                              },
                            ],
                            nextCursor: null,
                          }
                        : {};
    socket.send(JSON.stringify({ id: m.id, result }));
  }),
);
const config = readConfig({
  CODEX_HOME: directory,
  CODEX_WEB_CONFIG_DIR: directory,
  HOST: "127.0.0.1",
  PORT: "0",
  DEFAULT_CWD: directory,
  CODEX_APP_SERVER_URL: `ws://127.0.0.1:${native.address().port}`,
});
await mkdir(join(directory, "codex-web"), { recursive: true });
await writeFile(
  config.backendsFile,
  JSON.stringify({
    version: 1,
    backends: [
      {
        id: "codex",
        type: "codex",
        name: "Codex",
        enabled: true,
        dataDir: directory,
        url: config.upstreamUrl,
        executable: "codex",
        args: [],
      },
      {
        id: "claude",
        type: "claude",
        name: "Claude Code",
        enabled: true,
        dataDir: join(directory, "claude"),
        executable: process.env.CLAUDE_EXECUTABLE,
        args: [],
      },
    ],
    providers: [
      {
        id: "second",
        backendId: "claude",
        name: "第二供应商",
        baseUrl: secondServer.url,
        models: ["fixture-model"],
        modelCapabilities: {
          "fixture-model": { supportedEffortLevels: [], contextWindow: 65536 },
        },
        apiKey: "second-only",
      },
      {
        id: "fixture",
        backendId: "claude",
        name: "测试供应商",
        baseUrl: modelServer.url,
        apiKey: "test-only",
        models: ["fixture-model"],
        modelCapabilities: {
          "fixture-model": { supportedEffortLevels: [], contextWindow: 196608 },
        },
        compatibility: {},
      },
    ],
  }),
);
const mcpScript = join(directory, "mcp-fixture.mjs"),
  mcpReady = join(directory, "allow-mcp");
await writeFile(
  mcpScript,
  `import readline from 'node:readline'; import { access } from 'node:fs/promises';
readline.createInterface({input:process.stdin}).on('line',async(line)=>{const request=JSON.parse(line);if(!('id' in request))return;
if(request.method==='initialize'){while(true){try{await access(${JSON.stringify(mcpReady)});break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}}
const result=request.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'browser-fixture',version:'1'}}:request.method==='tools/list'?{tools:[{name:'browser_fixture_tool',description:'Browser fixture tool',inputSchema:{type:'object',properties:{}}}]}:{};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');});`,
);
await promisify(execFile)(
  process.env.CLAUDE_EXECUTABLE,
  [
    "mcp",
    "add",
    "--scope",
    "user",
    "browser-fixture",
    process.execPath,
    mcpScript,
  ],
  {
    cwd: directory,
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(directory, "claude") },
  },
);
const auth = await authenticationFixture(directory);
const app = createWebApplication({
  config,
  tls: auth.tls,
  authentication: await createAuthentication(config),
  version: { displayVersion: "3.1.1", version: "3.1.1" },
});
await app.start();
const url = `https://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox"],
});
let debugPage;
const errors = [];
const frames = [];
let socketSequence = 0;
async function completed(text, status = "completed") {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const requestFrame = frames.findLast(
      ({ event, message }) =>
        event === "framesent" &&
        message.method === "turn/start" &&
        message.params.input?.some((part) => part.text === text),
    );
    const request = requestFrame?.message;
    const turn =
      request &&
      frames.find(
        ({ event, message, socketIndex }) =>
          socketIndex === requestFrame.socketIndex &&
          event === "framereceived" &&
          message.id === request.id,
      )?.message.result?.turn;
    const result =
      turn &&
      frames.find(
        ({ message }) =>
          message.method === "turn/completed" &&
          message.params.turn.id === turn.id,
      )?.message.params.turn;
    if (result) {
      assert.equal(result.status, status);
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`等待轮次结果超时：${text}`);
}
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies([
    {
      name: "__Host-codex-web-session",
      value: auth.cookie.split("=")[1],
      url,
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  debugPage = page;
  page.on("websocket", (socket) => {
    const socketIndex = ++socketSequence;
    for (const event of ["framesent", "framereceived"])
      socket.on(event, (frame) => {
        frames.push({ socketIndex, event, message: JSON.parse(frame.payload) });
      });
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const input = await testDualConversation({
    page,
    url,
    mcpReady,
    releaseReply,
    editRequest,
    releaseEdit,
    failureRequest,
    releaseFailure,
    modelServer,
    secondServer,
    completed,
    largeFile,
    largeFileOriginal,
  });
  await testContextTimer({
    page,
    input,
    timerRequest,
    releaseTimer,
    completed,
    artifacts,
  });
  await testDualPresentation({
    page,
    input,
    artifacts,
    modelServer,
    secondServer,
    completed,
    errors,
  });
} catch (error) {
  if (debugPage) {
    await debugPage
      .screenshot({ path: join(artifacts, "failure.png"), fullPage: true })
      .catch(() => {});
    await writeFile(join(artifacts, "failure.html"), await debugPage.content());
    await writeFile(
      join(artifacts, "failure-body.txt"),
      await debugPage.locator("body").innerText(),
    );
  }
  await writeFile(
    join(artifacts, "failure-requests.json"),
    JSON.stringify(
      {
        error: error.stack,
        pageErrors: errors,
        first: modelServer.requests,
        second: secondServer.requests,
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(artifacts, "failure-frames.json"),
    JSON.stringify(frames, null, 2),
  );
  async function preserveNative(path, relative = "") {
    const entries = await readdir(path, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const file = join(path, entry.name),
        target = join(relative, entry.name);
      if (entry.isDirectory()) await preserveNative(file, target);
      else if (
        entry.name.endsWith(".jsonl") ||
        entry.name === "codex-web-index.json"
      ) {
        const destination = join(artifacts, "native", target);
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, await readFile(file));
      }
    }
  }
  await preserveNative(join(directory, "claude"));
  console.error("Browser failure evidence: " + artifacts);
  throw error;
} finally {
  await browser.close();
  await app.close();
  await shutdownBrowserClaudeWorker(config, [
    () => {
      releaseReply();
      releaseEdit();
      releaseFailure();
      releaseTimer();
    },
    () => writeFile(mcpReady, "ready"),
  ]);
  await modelServer.close();
  await secondServer.close();
  for (const socket of native.clients) socket.terminate();
  await new Promise((resolve) => native.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
