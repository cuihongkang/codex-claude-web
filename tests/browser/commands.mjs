import { serveDemoSession } from "../helpers/browser-session.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testCompactionReload } from "./compaction-reload.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const beforeDismiss = process.env.COMPACTION_DISMISS_BEFORE === "1";
const buildRoot = join(
  root,
  beforeDismiss ? ".cache/compaction-dismiss-before" : "client",
);
const output =
  process.env.BROWSER_OUTPUT_DIR || join(root, ".cache/commands-browser");
await mkdir(output, { recursive: true });
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
function fixture() {
  if (!sessionStorage.getItem("commands-fixture-started")) localStorage.clear();
  sessionStorage.setItem("commands-fixture-started", "true");
  const thread = {
    id: "browser-command-fixture",
    cwd: "/fixture/project",
    name: "核对快捷命令",
    createdAt: 1,
    completedAt: 2,
  };
  const initial = [
    {
      id: "fixture-user",
      type: "userMessage",
      content: [{ type: "text", text: "检查项目并整理下一步工作。" }],
    },
    {
      id: "fixture-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "已读取项目结构。可以初始化项目指令、管理目标，或清理后台终端。",
    },
  ];
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  const requests = [],
    files = new Map([
      ["/fixture/project/AGENTS.md", "# 项目指南\n\n保留已有项目约定。"],
    ]);
  let goal = null,
    terminals = [
      {
        processId: "dev-server",
        osPid: 1234,
        cwd: thread.cwd,
        command: "npm run dev",
      },
    ];
  let fail = false,
    socket;
  let compaction = JSON.parse(
      sessionStorage.getItem("compact-fixture") || "null",
    ),
    compactRequest;
  let holdCompact = false,
    compactNumber = 0,
    legacy = sessionStorage.getItem("compact-legacy") === "true";
  const completedOnReload = sessionStorage.getItem("compact-on-reload");
  if (compaction && completedOnReload) {
    compaction = {
      ...compaction,
      status: completedOnReload,
      completedAt: Date.now() / 1000,
    };
    sessionStorage.setItem("compact-fixture", JSON.stringify(compaction));
  }
  sessionStorage.removeItem("compact-on-reload");
  const compactState = (entry) => {
    compaction = entry;
    sessionStorage.setItem("compact-fixture", JSON.stringify(entry));
    if (!legacy)
      socket.emit("lan/compaction", { threadId: thread.id, compaction: entry });
  };
  window.commandFixture = {
    requests,
    files,
    setFail(value) {
      fail = value;
    },
    holdCompact(value) {
      holdCompact = value;
    },
    useLegacy(value) {
      legacy = value;
      sessionStorage.setItem("compact-legacy", String(value));
    },
    compaction() {
      return compaction;
    },
    finishOnReload(status) {
      sessionStorage.setItem("compact-on-reload", status);
    },
    disconnect() {
      legacy = true;
      socket.readyState = 3;
      socket.onclose();
    },
    acknowledgeCompact() {
      socket.onmessage({
        data: JSON.stringify({ id: compactRequest.id, result: {} }),
      });
    },
    startCompact() {
      const turnId = "compact-browser-" + ++compactNumber;
      socket.emit("turn/started", {
        threadId: thread.id,
        turn: {
          id: turnId,
          status: "inProgress",
          startedAt: compaction.startedAt,
        },
      });
      compactState({ ...compaction, status: "running", turnId });
      socket.emit("item/started", {
        threadId: thread.id,
        turnId,
        item: {
          id: "compact-item-" + compactNumber,
          type: "contextCompaction",
        },
      });
    },
    finishCompact(status = "completed") {
      const { turnId } = compaction;
      if (status === "completed")
        socket.emit("item/completed", {
          threadId: thread.id,
          turnId,
          item: {
            id: "compact-item-" + compactNumber,
            type: "contextCompaction",
          },
        });
      const error = status === "failed" ? { message: "模拟整理失败" } : null;
      socket.emit("turn/completed", {
        threadId: thread.id,
        turn: { id: turnId, status, error, completedAt: Date.now() / 1000 },
      });
      compactState({
        ...compaction,
        status,
        error: error?.message,
        completedAt: Date.now() / 1000,
      });
      if (status === "completed")
        socket.emit("thread/tokenUsage/updated", {
          threadId: thread.id,
          tokenUsage: {
            last: { totalTokens: 2000 },
            modelContextWindow: 100000,
          },
        });
    },
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      socket = this;
      setTimeout(
        () =>
          this.emit("lan/state", {
            ready: true,
            defaultCwd: thread.cwd,
            activeTurns:
              compaction?.status === "running"
                ? { [thread.id]: compaction.turnId }
                : {},
            ...(!legacy && {
              compactions: compaction ? { [thread.id]: compaction } : {},
            }),
            questions: [],
          }),
        0,
      );
    }
    emit(method, params) {
      if (this.readyState !== 1) return;
      this.onmessage({ data: JSON.stringify({ method, params }) });
    }
    send(raw) {
      const request = JSON.parse(raw),
        { method, params } = request;
      requests.push(request);
      let result = {},
        error;
      if (method === "lan/compaction/check") {
        if (legacy) error = { code: -32601, message: "Unknown method" };
        else result = { compaction };
      }
      if (method === "model/list")
        result = {
          data: [
            {
              id: "fixture-model",
              model: "fixture-model",
              displayName: "测试模型",
              isDefault: true,
              serviceTiers: [{ id: "priority", name: "Fast" }],
              supportedReasoningEfforts: [
                { reasoningEffort: "high", description: "高" },
              ],
            },
          ],
        };
      if (method === "config/read")
        result = {
          config: {
            model: "fixture-model",
            model_reasoning_effort: "high",
          },
          layers: [],
        };
      if (method === "account/read")
        result = {
          account: { email: "fixture@example.test", planType: "测试账户" },
        };
      if (method === "thread/list")
        result = { data: [thread], nextCursor: null };
      if (["thread/read", "thread/resume", "thread/start"].includes(method))
        result = { thread };
      if (method === "thread/turns/list")
        result = {
          data: [
            ...(compaction?.turnId
              ? [
                  {
                    id: compaction.turnId,
                    status:
                      compaction.status === "running"
                        ? "inProgress"
                        : compaction.status,
                    startedAt: compaction.startedAt,
                    completedAt: compaction.completedAt,
                    items: [
                      { type: "contextCompaction", id: "compact-history" },
                    ],
                  },
                ]
              : []),
            {
              id: "history",
              status: "completed",
              startedAt: 1,
              completedAt: 2,
            },
          ],
          nextCursor: null,
        };
      if (method === "thread/items/list")
        result = {
          data: (params.cursor ? initial.slice(1) : initial.slice(0, 1)).map(
            (item) => ({ turnId: "history", item }),
          ),
          nextCursor: params.cursor ? null : "second-page",
        };
      if (method === "skills/list") result = { data: [] };
      if (method === "lan/projectless/read") result = { directories: {} };
      if (method === "fs/readDirectory")
        result = {
          entries: [...files.keys()]
            .filter((path) => path.startsWith(params.path + "/"))
            .map((path) => ({
              fileName: path.split("/").at(-1),
              isFile: true,
              isDirectory: false,
            })),
        };
      if (method === "fs/readFile")
        result = {
          dataBase64: btoa(
            unescape(encodeURIComponent(files.get(params.path) || "")),
          ),
        };
      if (method === "thread/goal/get") result = { goal };
      if (method === "thread/goal/set") {
        goal = {
          tokensUsed: 1200,
          timeUsedSeconds: 30,
          tokenBudget: null,
          ...goal,
          ...params,
        };
        result = { goal };
      }
      if (method === "thread/goal/clear") {
        goal = null;
        result = { cleared: true };
      }
      if (method === "thread/backgroundTerminals/list")
        result = { data: terminals, nextCursor: null };
      if (method === "thread/backgroundTerminals/clean") terminals = [];
      if (method === "thread/compact/start") {
        compactRequest = request;
        compactState({
          id: "request-" + request.id,
          status: "starting",
          startedAt: Date.now() / 1000,
        });
        if (holdCompact) return;
      }
      if (method === "turn/start") {
        if (fail) error = { message: "模拟提交失败，请重试。" };
        else {
          result = {
            turn: {
              id: "fixture-turn-" + requests.length,
              status: "completed",
            },
          };
          files.set(
            thread.cwd + "/AGENTS.md",
            "# 项目指南\n\n构建：npm run build\n\n验证：npm test\n",
          );
          setTimeout(() => {
            socket.emit("item/completed", {
              threadId: params.threadId,
              turnId: result.turn.id,
              item: {
                id: "command-answer-" + requests.length,
                type: "agentMessage",
                phase: "final_answer",
                text: "已生成 AGENTS.md，包含项目结构、构建命令和测试要求。",
              },
            });
            socket.emit("turn/completed", {
              threadId: params.threadId,
              turn: result.turn,
            });
          }, 30);
        }
      }
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              id: request.id,
              ...(error ? { error } : { result }),
            }),
          }),
        0,
      );
    }
  };
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let content = await readFile(
      join(buildRoot, "dist", path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace("<head>", `<head><script>(${fixture.toString()})()</script>`);
    response
      .writeHead(200, {
        "Content-Type":
          mime[extname(path)] ||
          (path === "/" ? "text/html" : "application/octet-stream"),
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "codex-web-command-browser-"));
const child = spawn(
  process.env.CHROME_PATH,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-proxy-server",
    "--no-first-run",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(new Error("Chromium 启动超时")),
      10000,
    );
    child.stderr.on("data", (data) => {
      log += data;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("error", reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve) =>
    ws.addEventListener("open", resolve, { once: true }),
  );
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const page = (method, params) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const r = await page("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(30);
    }
    const debug = await page("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(output, "failure.png"),
      Buffer.from(debug.data, "base64"),
    );
    console.error(
      await evaluate(
        `JSON.stringify({text:document.body.innerText.slice(-1000),draft:document.querySelector('textarea[aria-label="消息"]')?.value,active:document.activeElement?.tagName,width:innerWidth,scale:visualViewport.scale})`,
      ),
    );
    throw new Error("等待超时：" + expression);
  };
  const click = async (selector) => {
    const point = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('找不到控件');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await page("Input.dispatchMouseEvent", {
      type: "mousePressed",
      button: "left",
      buttons: 1,
      clickCount: 1,
      ...point,
    });
    await page("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      button: "left",
      buttons: 0,
      clickCount: 1,
      ...point,
    });
    await pause(60);
  };
  const clickText = async (text) => {
    const selector = await evaluate(
      `(()=>{const buttons=[...document.querySelectorAll('button')];const e=buttons.find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('找不到按钮 '+${JSON.stringify(text)});e.dataset.testClick='target';return 'button[data-test-click="target"]'})()`,
    );
    await click(selector);
    await evaluate(
      `document.querySelector('[data-test-click]')?.removeAttribute('data-test-click')`,
    );
  };
  const type = async (text) => {
    await click('textarea[aria-label="消息"]');
    assert.equal(
      await evaluate(`document.activeElement?.getAttribute('aria-label')`),
      "消息",
      "消息框的实际点击应取得焦点",
    );
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      commands: ["selectAll"],
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await page("Input.insertText", { text });
    assert.equal(
      await evaluate(
        `document.querySelector('textarea[aria-label="消息"]').value`,
      ),
      text,
    );
  };
  const submit = async (text) => {
    await type(text);
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      modifiers: 2,
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      modifiers: 2,
    });
    await pause(100);
  };
  const close = () => click('button[title="关闭窗口"]');
  let screenshots = 0;
  const screenshot = async (name) => {
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, name + ".png"), Buffer.from(data, "base64"));
    screenshots++;
  };
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}/`,
  });
  await waitFor(
    `document.querySelector('textarea[aria-label="消息"]') && document.querySelector('.breadcrumb > span')?.textContent==='核对快捷命令'`,
  );
  const reloadProof = await testCompactionReload({
    page,
    evaluate,
    waitFor,
    pause,
    click,
    clickText,
    type,
    screenshot,
  });
  await type("/");
  const expectedCommands = [
    "init",
    "new",
    "model",
    "plan",
    "review",
    "compact",
    "goal",
    "skills",
    "files",
    "diff",
    "terminal",
    "stop",
    "project",
    "search",
    "status",
    "fork",
    "rename",
    "delete",
  ];
  assert.deepEqual(
    await evaluate(
      `[...document.querySelectorAll('[role="option"] b')].map(e=>e.textContent.slice(1)).sort()`,
    ),
    expectedCommands.sort(),
  );
  await screenshot("retained-command-menu");
  for (const removed of ["resume", "ps", "clean", "side", "export", "fast"]) {
    await type("/" + removed);
    assert.equal(
      await evaluate(`document.querySelectorAll('[role="option"]').length`),
      0,
    );
  }
  await submit("/resume");
  await waitFor(
    `document.querySelector('.error-banner')?.textContent.includes('未识别的命令 /resume')`,
  );
  assert.equal(
    await evaluate(`commandFixture.requests.some(r=>r.method==='turn/start')`),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "/resume",
  );
  await screenshot("removed-resume");
  await click('button[title="关闭错误提示"]');
  await type("/in");
  await waitFor(
    `document.querySelector('[role="option"]')?.textContent.includes('/init')`,
  );
  await screenshot("init-menu");
  await click('[role="option"]');
  await waitFor(`document.body.textContent.includes('保留已有项目约定')`);
  assert.equal(
    await evaluate(
      `commandFixture.requests.filter(r=>r.method==='turn/start').length`,
    ),
    0,
  );
  await screenshot("init-existing");
  await evaluate(
    `commandFixture.files.delete('/fixture/project/AGENTS.md');commandFixture.setFail(true)`,
  );
  await submit("/init");
  await waitFor(
    `document.querySelector('.error-banner')?.textContent.includes('模拟提交失败')`,
  );
  assert.equal(
    await evaluate(`!!document.querySelector('[role="listbox"]')`),
    false,
    "提交后收起建议层，错误提示保持可见",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "/init",
  );
  await screenshot("init-retry");
  await evaluate(`commandFixture.setFail(false)`);
  await click('button[aria-label="发送消息"]');
  await waitFor(`document.body.textContent.includes('已生成 AGENTS.md')`);
  await submit("/goal 完成命令对照与回归验证");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('保存并开始')`,
  );
  await screenshot("goal-light");
  await clickText("暂停目标");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('已暂停')`,
  );
  await clickText("恢复目标");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('进行中')`,
  );
  for (const [selector, text] of [
    ['[role="dialog"] textarea', "完成三项保留命令的验证"],
    ['[role="dialog"] input[type="number"]', "5000"],
  ]) {
    await click(selector);
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      modifiers: 2,
      commands: ["selectAll"],
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      modifiers: 2,
    });
    await page("Input.insertText", { text });
  }
  await clickText("保存并开始");
  await waitFor(
    `commandFixture.requests.some(r=>r.method==='thread/goal/set'&&r.params.objective==='完成三项保留命令的验证'&&r.params.tokenBudget===5000&&r.params.origin==='user')`,
  );
  await close();
  await submit("/stop");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('npm run dev')`,
  );
  await screenshot("background-terminals");
  await clickText("停止全部后台终端");
  await waitFor(
    `document.querySelector('[role="dialog"]')?.textContent.includes('没有后台终端')`,
  );
  await screenshot("background-terminals-cleaned");
  assert.equal(
    await evaluate(
      `commandFixture.requests.some(r=>r.method==='thread/backgroundTerminals/clean')`,
    ),
    true,
  );
  await close();
  assert.equal(
    await evaluate(
      `commandFixture.requests.some(r=>r.method==='turn/interrupt')`,
    ),
    false,
  );
  const layouts = [];
  for (const theme of ["light", "dark"]) {
    for (const width of [1440, 390]) {
      await page("Emulation.setDeviceMetricsOverride", {
        width,
        height: width === 390 ? 844 : 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      await pause(350);
      await submit("/goal");
      await waitFor(
        `document.querySelector('[role="dialog"]')?.textContent.includes('保存并开始')`,
      );
      const bounds = await evaluate(
        `(()=>{const e=document.querySelector('[role="dialog"]'),r=e.getBoundingClientRect();return{left:r.left,right:r.right,bottom:r.bottom,viewport:innerWidth,scroll:document.documentElement.scrollWidth,inputs:[...e.querySelectorAll('input,textarea,button')].map(e=>({label:e.getAttribute('aria-label')||e.textContent.trim(),color:getComputedStyle(e).color,bg:getComputedStyle(e).backgroundColor}))}})()`,
      );
      assert(
        bounds.left >= 0 &&
          bounds.right <= bounds.viewport + 1 &&
          bounds.scroll <= bounds.viewport,
      );
      layouts.push({ theme, width, ...bounds });
      await screenshot(`goal-${theme}-${width}`);
      await close();
    }
  }
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    'document.documentElement.dataset.theme="light";commandFixture.holdCompact(true)',
  );
  await pause(350);
  await submit("/compact");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在提交上下文整理')`,
  );
  await screenshot("compact-submitting");
  await type("整理期间保留的草稿");
  const writesBefore = await evaluate(
    `commandFixture.requests.filter(r=>r.method==='turn/start'||r.method==='turn/steer').length`,
  );
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
  });
  await page("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    modifiers: 2,
  });
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    true,
  );
  await click('button[aria-label="发送消息"]');
  await evaluate("commandFixture.acknowledgeCompact()");
  await pause(100);
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    true,
  );
  await evaluate("commandFixture.startCompact()");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在整理上下文')`,
  );
  const elapsedBefore = await evaluate(
    `document.querySelector('.compaction-status time').textContent`,
  );
  await pause(1200);
  assert.notEqual(
    await evaluate(
      `document.querySelector('.compaction-status time').textContent`,
    ),
    elapsedBefore,
  );
  assert.equal(
    await evaluate(
      `commandFixture.requests.filter(r=>r.method==='turn/start'||r.method==='turn/steer').length`,
    ),
    writesBefore,
  );
  await screenshot("compact-running");
  await page("Page.reload", {});
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在整理上下文')&&document.querySelector('textarea[aria-label="消息"]')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "整理期间保留的草稿",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    true,
  );
  await screenshot("compact-reloaded");
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.documentElement.dataset.theme="dark"');
  await pause(350);
  await screenshot("compact-running-dark-390");
  await evaluate("commandFixture.finishCompact()");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('button[aria-label="发送消息"]').disabled`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "整理期间保留的草稿",
  );
  await screenshot("compact-completed-dark-390");
  const completedLayout = await evaluate(`(()=>{
    const title=document.querySelector('.compaction-status strong').getBoundingClientRect();
    const close=document.querySelector('button[title="关闭整理状态"]').getBoundingClientRect();
    return {titleTop:title.top,closeTop:close.top,scrollWidth:document.documentElement.scrollWidth,width:innerWidth};
  })()`);
  assert(Math.abs(completedLayout.titleTop - completedLayout.closeTop) < 20);
  assert(completedLayout.scrollWidth <= completedLayout.width);
  await click('button[aria-label="发送消息"]');
  await waitFor(
    `document.querySelector('textarea[aria-label="消息"]').value === ''`,
  );
  await screenshot("compact-after-send-button-dark-390");
  assert.equal(
    await evaluate(`!!document.querySelector('.compaction-status')`),
    beforeDismiss,
    "发送按钮提交新消息后自动关闭整理完成提示",
  );
  if (beforeDismiss) await click('button[title="关闭整理状态"]');
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.documentElement.dataset.theme="light"');
  await pause(350);
  await submit("/compact");
  await evaluate("commandFixture.startCompact()");
  await type("失败后继续保留的草稿");
  await evaluate('commandFixture.finishCompact("failed")');
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('模拟整理失败')`,
  );
  await screenshot("compact-failed");
  await clickText("重新整理");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('正在提交上下文整理')`,
  );
  await evaluate(
    "commandFixture.startCompact();commandFixture.finishCompact()",
  );
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "失败后继续保留的草稿",
  );
  await screenshot("compact-retried-completed");
  await submit("整理完成后通过快捷键继续对话");
  await waitFor(
    `document.querySelector('textarea[aria-label="消息"]').value === ''`,
  );
  await screenshot("compact-after-send-keyboard-light-1440");
  assert.equal(
    await evaluate(`!!document.querySelector('.compaction-status')`),
    beforeDismiss,
    "Ctrl+Enter 提交新消息后自动关闭整理完成提示",
  );
  if (beforeDismiss) await click('button[title="关闭整理状态"]');
  await evaluate("commandFixture.holdCompact(false)");
  await submit("/compact");
  await evaluate("commandFixture.startCompact()");
  await type("后台断线后继续编辑的草稿");
  assert.equal(
    await evaluate("document.querySelector('.compaction-status p') === null"),
    true,
  );
  const background = await call("Target.createTarget", { url: "about:blank" });
  await call("Target.activateTarget", { targetId: background.targetId });
  await waitFor("document.visibilityState === 'hidden'");
  const checkCount = await evaluate(
    `commandFixture.requests.filter(request => request.method === 'lan/compaction/check').length`,
  );
  await evaluate("commandFixture.disconnect()");
  await screenshot("compact-reconnecting");
  await evaluate("commandFixture.finishCompact()");
  await call("Target.activateTarget", { targetId });
  await page("Page.bringToFront", {});
  await waitFor("document.visibilityState === 'visible'");
  await waitFor(
    `document.querySelector('.compaction-status')?.textContent.includes('上下文整理完成') && document.querySelector('button[aria-label="发送消息"]')?.disabled === false`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea[aria-label="消息"]').value`,
    ),
    "后台断线后继续编辑的草稿",
  );
  assert.equal(
    await evaluate(
      `commandFixture.requests.filter(request => request.method === 'lan/compaction/check').length`,
    ),
    checkCount,
    "旧桥接不依赖新增状态接口",
  );
  await screenshot("compact-background-recovered");
  await call("Target.closeTarget", { targetId: background.targetId });
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('document.documentElement.dataset.theme="dark"');
  await pause(350);
  await screenshot("compact-background-recovered-dark-390");
  const proof = {
    build: JSON.parse(
      await readFile(
        join(beforeDismiss ? buildRoot : root, "build-info.json"),
        "utf8",
      ),
    ),
    beforeDismiss,
    data: "隔离 WebSocket 模拟后端",
    layouts,
    reloadProof,
    requests: await evaluate("commandFixture.requests.map(r=>r.method)"),
  };
  await writeFile(join(output, "results.json"), JSON.stringify(proof, null, 2));
  console.log(
    JSON.stringify({
      passed: true,
      output,
      screenshots,
      layouts: layouts.length,
    }),
  );
} finally {
  ws?.close();
  child.kill();
  server.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
