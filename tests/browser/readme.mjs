import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = process.env.BROWSER_OUTPUT_DIR || join(root, "docs/images");
const evidenceDirectory = join(root, ".cache/readme-screenshots/after");
await mkdir(output, { recursive: true });
await mkdir(evidenceDirectory, { recursive: true });
const demoDocument =
  "# Atlas\n\n一个轻量的项目工作台，用清晰的文档连接开发与协作。\n\n## 快速开始\n\n安装依赖并启动开发服务：\n\n```bash\nnpm ci\nnpm run dev\n```\n\n浏览器打开终端中显示的地址，即可开始使用。\n\n## 验证修改\n\n提交修改前，运行完整检查：\n\n```bash\nnpm run check\n```\n\n## 项目目录\n\n- `src/`：页面与组件\n- `docs/`：使用指南\n- `tests/`：功能验证\n";
const demoData = {
  document: demoDocument,
  items: [
    {
      id: "readme-user",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: "请为 Atlas 项目补充快速开始文档，包括本地启动和验证步骤。",
        },
      ],
    },
    {
      id: "readme-progress",
      type: "agentMessage",
      phase: "commentary",
      text: "我会先检查项目结构与启动命令，再整理成可以直接使用的文档。",
    },
    {
      id: "readme-command",
      type: "commandExecution",
      command: "cat package.json",
      cwd: "/demo/atlas",
      status: "completed",
      aggregatedOutput: "npm ci\nnpm run dev\nnpm run check",
      exitCode: 0,
    },
    {
      id: "readme-files",
      type: "fileChange",
      status: "completed",
      changes: [
        {
          path: "/demo/atlas/README.md",
          kind: {
            type: "add",
          },
          diff: demoDocument,
        },
      ],
    },
    {
      id: "readme-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "已补充快速开始文档，现在可以按以下步骤启动项目。\n\n### 本地启动\n\n```bash\nnpm ci\nnpm run dev\n```\n\n### 验证修改\n\n运行 `npm run check`，检查代码格式、测试结果和构建。\n\n文档还整理了项目目录与常用命令，完整内容见 [README.md](./README.md)。",
    },
  ],
};
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
const buildDirectory = await mkdtemp(join(tmpdir(), "codex-web-readme-build-"));
await cp(join(root, "client/dist"), buildDirectory, { recursive: true });
const buildInfo = JSON.parse(
  await readFile(join(root, "build-info.json"), "utf8"),
);
function fixture(data) {
  localStorage.clear();
  const now = Math.floor(Date.now() / 1000);
  const thread = {
    id: "readme-demo",
    cwd: "/demo/atlas",
    name: "完善项目的快速开始文档",
    createdAt: now - 1800,
    completedAt: now - 60,
  };
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  localStorage.setItem("cx-projects", JSON.stringify([thread.cwd]));
  window.demoRequests = [];
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              method: "lan/state",
              params: {
                ready: true,
                defaultCwd: thread.cwd,
                activeTurns: {},
                questions: [],
              },
            }),
          }),
        0,
      );
    }
    send(raw) {
      const m = JSON.parse(raw);
      window.demoRequests.push(m);
      let result = {};
      if (m.method === "thread/list")
        result = {
          data: m.params.archived
            ? []
            : [
                thread,
                {
                  ...thread,
                  id: "demo-navigation",
                  name: "为任务列表添加搜索",
                  completedAt: now - 3600,
                },
                {
                  ...thread,
                  id: "demo-theme",
                  name: "优化深色主题的阅读体验",
                  completedAt: now - 86400,
                },
                {
                  ...thread,
                  id: "demo-notes",
                  cwd: "/demo/notes",
                  name: "整理本周的项目笔记",
                  completedAt: now - 172800,
                },
              ],
          nextCursor: null,
        };
      if (["thread/read", "thread/resume"].includes(m.method))
        result = { thread, cwd: thread.cwd };
      if (m.method === "thread/turns/list")
        result = {
          data: [
            {
              id: "demo-turn",
              status: "completed",
              startedAt: now - 105,
              completedAt: now - 60,
            },
          ],
          nextCursor: null,
        };
      if (m.method === "thread/items/list")
        result = {
          data: [...data.items]
            .reverse()
            .map((item) => ({ turnId: "demo-turn", item })),
          nextCursor: null,
        };
      if (m.method === "model/list")
        result = {
          data: [
            {
              id: "demo-model",
              model: "demo-model",
              displayName: "Codex",
              isDefault: true,
              supportedReasoningEfforts: [
                { reasoningEffort: "low" },
                { reasoningEffort: "medium" },
                { reasoningEffort: "high" },
              ],
            },
          ],
        };
      if (m.method === "config/read")
        result = {
          config: { model: "demo-model", model_reasoning_effort: "high" },
        };
      if (m.method === "skills/list") result = { data: [] };
      if (m.method === "account/read")
        result = {
          account: {
            type: "chatgpt",
            email: "demo@example.test",
            planType: "plus",
          },
        };
      if (m.method === "account/rateLimits/read") {
        const limits = {
          limitId: "codex",
          planType: "plus",
          primary: {
            usedPercent: 28,
            windowDurationMins: 300,
            resetsAt: now + 7200,
          },
          secondary: {
            usedPercent: 41,
            windowDurationMins: 10080,
            resetsAt: now + 554400,
          },
        };
        result = { rateLimits: limits, rateLimitsByLimitId: { codex: limits } };
      }
      if (m.method === "lan/projectless/read") result = { directories: {} };
      if (m.method === "fs/readDirectory")
        result = {
          entries: [
            { fileName: "src", isDirectory: true },
            { fileName: "docs", isDirectory: true },
            { fileName: "tests", isDirectory: true },
            { fileName: "README.md", isDirectory: false },
            { fileName: "package.json", isDirectory: false },
          ],
        };
      if (m.method === "fs/readFile")
        result = {
          dataBase64: btoa(
            String.fromCharCode(...new TextEncoder().encode(data.document)),
          ),
        };
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
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
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let content = await readFile(
      join(buildDirectory, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace(
          "<head>",
          `<head><script>(${fixture.toString()})(${JSON.stringify(demoData)})</script>`,
        );
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
const profile = await mkdtemp(join(tmpdir(), "codex-web-readme-browser-"));
const child = spawn(
  process.env.CHROME_PATH,
  [
    "--headless",
    "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4",
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
      join(evidenceDirectory, "failure.png"),
      Buffer.from(debug.data, "base64"),
    );
    console.error(
      await evaluate(
        `JSON.stringify({text:document.body.innerText.slice(-1000),width:innerWidth,height:innerHeight})`,
      ),
    );
    throw new Error("等待超时：" + expression);
  };
  const click = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:"nearest"})`,
    );
    await pause(120);
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

  const screenshot = async (name, directory = output) => {
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    await writeFile(
      join(directory, name + ".png"),
      Buffer.from(data, "base64"),
    );
  };
  const evidence = [];
  async function inspect(name, quotaVisible = false) {
    const layout = await evaluate(
      `(()=>{const box=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}:null};return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,composer:box('.composer'),send:box('.send-button'),preview:box('.file-markdown-preview'),quota:box('.quota-toggle'),quotaExpanded:document.querySelector('.quota-toggle')?.getAttribute('aria-expanded'),remaining:[...document.querySelectorAll('.quota-summary')].map(e=>e.getAttribute('aria-valuenow')),text:document.body.innerText,errors:[...document.querySelectorAll('.error-banner')].map(e=>e.innerText)}})()`,
    );
    assert(!layout.overflow, name + " 无横向溢出");
    assert.equal(layout.errors.length, 0, name + " 无错误提示");
    assert(layout.send.bottom <= layout.height, name + " 发送按钮在视口内");
    assert(layout.text.includes("已编辑文件"), name + " 包含变更汇总");
    assert.equal(layout.quotaExpanded, "false", name + " 额度默认折叠");
    assert.deepEqual(
      layout.remaining,
      ["72", "59"],
      name + " 两个实际额度窗口",
    );
    if (quotaVisible)
      assert(
        layout.quota.x >= 0 &&
          layout.quota.x + layout.quota.width <= layout.width &&
          layout.quota.bottom <= layout.height,
        name + " 圆环在视口内",
      );
    evidence.push({ name, ...layout });
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    await pause(250);
    await screenshot(name);
  }
  async function inspectDetails(name) {
    await click(".quota-toggle");
    await waitFor('document.querySelector(".account-quota")');
    const details = await evaluate(
      `[...document.querySelectorAll('.quota-reset')].map(e=>({text:e.innerText,height:e.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(e).lineHeight)}))`,
    );
    assert.equal(details.length, 2, "展开后显示两个窗口的重置信息");
    for (const row of details) {
      assert(
        row.text.includes("后重置") && row.text.includes("·"),
        "倒计时与具体时间同时显示",
      );
      assert(row.height <= row.lineHeight + 1, "重置信息保持单行");
    }
    await screenshot(name, evidenceDirectory);
    await click(".quota-toggle");
    assert(
      await evaluate('!document.querySelector(".account-quota")'),
      "再次点击收起详情",
    );
    evidence.push({ name, details });
  }
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/",
  });
  await waitFor(
    'document.querySelector(".file-change-source") && document.querySelectorAll(".quota-summary").length===2',
  );
  await click(".file-change-source");
  await waitFor('document.querySelector(".file-markdown-preview")');
  await pause(300);
  await inspect("desktop-light", true);
  await inspectDetails("desktop-usage-expanded");
  await click(".account-button");
  await waitFor('document.querySelector(".theme-options")');
  await clickText("深色");
  await click(".modal-heading button");
  await inspect("desktop-dark", true);
  await click('.context-tools button[aria-label="折叠对话详情"]');
  await click(".account-button");
  await clickText("浅色");
  await click(".modal-heading button");
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page("Emulation.setTouchEmulationEnabled", { enabled: true });
  await pause(250);
  await inspect("mobile");
  await click('.topbar button[title="显示侧栏"]');
  await waitFor(
    'document.querySelector(".sidebar.mobile-open") && document.querySelector(".quota-toggle").getBoundingClientRect().x >= 0',
  );
  await inspect("mobile-sidebar", true);
  await inspectDetails("mobile-usage-expanded");
  await writeFile(
    join(evidenceDirectory, "results.json"),
    JSON.stringify(
      {
        passed: true,
        build: buildInfo,
        data: "当前生产构建；独立浏览器配置；隔离演示项目、Plus 双窗口额度与模拟消息",
        screenshots: evidence,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, output, evidenceDirectory }));
} finally {
  ws?.close();
  child.kill();
  server.close();
  await rm(buildDirectory, { recursive: true, force: true });
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
