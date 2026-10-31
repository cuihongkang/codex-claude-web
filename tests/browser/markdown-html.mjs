import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(
  root,
  process.env.BROWSER_BEFORE === "1"
    ? ".cache/markdown-html-browser/before"
    : ".cache/markdown-html-browser/after",
);
await mkdir(output, { recursive: true });
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
const buildDirectory = await mkdtemp(
  join(tmpdir(), "codex-web-annotation-build-"),
);
await cp(
  join(
    root,
    process.env.BROWSER_BEFORE === "1"
      ? ".cache/markdown-html-before/dist"
      : "client/dist",
  ),
  buildDirectory,
  { recursive: true },
);
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      process.env.BROWSER_BEFORE === "1"
        ? ".cache/markdown-html-before/build-info.json"
        : "build-info.json",
    ),
    "utf8",
  ),
);
const document = await readFile(join(root, "README.md"), "utf8");
const files = Object.fromEntries(
  await Promise.all(
    [
      "client/src/assets/codex-web.svg",
      "docs/images/desktop-light.png",
      "docs/images/desktop-dark.png",
      "docs/images/mobile.png",
      "docs/images/mobile-sidebar.png",
    ].map(async (path) => [
      path,
      (await readFile(join(root, path))).toString("base64"),
    ]),
  ),
);
const fixtureData = {
  document,
  files,
  items: [
    {
      id: "user",
      type: "userMessage",
      content: [
        {
          type: "text",
          text: "请阅读项目说明，展示 Markdown 中的排版与界面图片。",
        },
      ],
    },
    {
      id: "answer",
      type: "agentMessage",
      phase: "final_answer",
      text: [
        '<h2 align="center">项目文档预览</h2>',
        '<p align="center"><strong>在浏览器中继续工作。</strong><br>查看对话、任务与文件。</p>',
        "<details><summary>查看说明</summary>\n\n支持 **Markdown** 与 HTML 混排。\n\n</details>",
        "![项目图标](./client/src/assets/codex-web.svg)",
        "完整说明见 [README.md](./README.md)。",
        "<script>window.htmlExecuted=true</script><style>body{display:none}</style>",
      ].join("\n\n"),
    },
  ],
};
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
  window.demoRequests = [];
  window.htmlFixture = data;
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
        result = { account: { type: "演示账号" } };
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
          dataBase64: m.params.path.endsWith("/README.md")
            ? btoa(unescape(encodeURIComponent(data.document)))
            : data.files[m.params.path.replace("/demo/atlas/", "")],
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
          `<head><script>(${fixture.toString()})(${JSON.stringify(fixtureData).replaceAll("<", "\\u003c")})</script>`,
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

  const screenshot = async (name) => {
    const { data } = await page("Page.captureScreenshot", { format: "png" });
    await writeFile(join(output, name + ".png"), Buffer.from(data, "base64"));
  };
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port + "/",
  });
  await waitFor(
    'document.querySelector(".assistant-message") && document.querySelector(".composer textarea")',
  );
  await click(".assistant-message a");
  await waitFor('document.querySelector(".file-markdown-preview")');
  await pause(300);
  if (process.env.BROWSER_BEFORE === "1") {
    assert(
      await evaluate(
        'document.querySelector(".file-markdown-preview").textContent.includes("<p align=")',
      ),
    );
    assert(
      await evaluate(
        'document.querySelector(".assistant-message").textContent.includes("<h2 align=")',
      ),
    );
    await screenshot("raw-html-reproduced");
    console.log("复现：消息与文件预览均将 HTML 显示为文字");
  } else {
    await waitFor(
      'document.querySelector(".file-markdown-preview h1")?.textContent === "Codex Web"',
    );
    await waitFor(
      'document.querySelector(".file-markdown-preview picture img")?.naturalWidth === 1440',
    );
    await waitFor(
      'document.querySelector(".assistant-message img")?.naturalWidth > 0',
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".assistant-message h2").textContent',
      ),
      "项目文档预览",
    );
    assert.equal(await evaluate("window.htmlExecuted"), undefined);
    assert.equal(
      await evaluate(
        'document.querySelectorAll(".markdown script,.markdown style,.markdown iframe").length',
      ),
      0,
    );
    assert.equal(
      await evaluate(
        'document.querySelector(".file-markdown-preview").textContent.includes("<p align=")',
      ),
      false,
    );
    const icon = await evaluate(
      '(()=>{const i=document.querySelector(".file-markdown-preview img");return {width:i.getBoundingClientRect().width,loaded:i.naturalWidth>0}})()',
    );
    assert(
      icon.loaded && Math.abs(icon.width - 88) < 1,
      "图标按 HTML 宽度显示",
    );
    await screenshot("desktop-light");
    await click('.file-markdown-preview a[href="#快速开始"]');
    assert(
      await evaluate(
        'document.querySelector(".file-markdown-preview").scrollTop > 0',
      ),
      "文内链接在当前预览中定位",
    );
    await evaluate(
      'document.querySelector(".file-markdown-preview").scrollTop=0',
    );
    await click(".assistant-message summary");
    assert(
      await evaluate(
        'document.querySelector(".assistant-message details").open',
      ),
      "消息折叠块可点击展开",
    );
    await screenshot("message-expanded");
    await click(".file-markdown-preview summary");
    assert(
      await evaluate(
        'document.querySelector(".file-markdown-preview details").open',
      ),
      "文件折叠块可点击展开",
    );
    await waitFor(
      '[...document.querySelectorAll(".file-markdown-preview img")].some(i=>i.alt.includes("手机界面") && i.naturalWidth===780)',
    );
    await waitFor(
      '[...document.querySelectorAll(".file-markdown-preview img")].some(i=>i.alt.includes("手机侧栏") && i.naturalWidth===780)',
    );
    await screenshot("readme-expanded");
    await click(".file-markdown-preview summary");
    await evaluate(
      'document.querySelector(".file-markdown-preview").scrollTop=0',
    );
    await click(".file-markdown-preview picture");
    await waitFor('document.querySelector("dialog[open]")');
    assert(
      await evaluate(
        'document.querySelector("dialog img").src===document.querySelector(".file-markdown-preview picture img").currentSrc',
      ),
      "大图预览使用实际选中的图片",
    );
    await screenshot("image-preview");
    for (const type of ["keyDown", "keyUp"])
      await page("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
      });
    await waitFor('!document.querySelector("dialog")');
    assert(
      await evaluate(
        'document.activeElement.classList.contains("message-image-button")',
      ),
      "关闭大图后恢复焦点",
    );
    await click(".account-button");
    await clickText("深色");
    await click(".modal-heading button");
    await waitFor(
      'document.querySelector(".file-markdown-preview picture img").currentSrc==="data:image/png;base64,"+htmlFixture.files["docs/images/desktop-dark.png"]',
    );
    await evaluate(
      'document.querySelector(".file-markdown-preview").scrollTop=0',
    );
    await screenshot("desktop-dark");
    await click(".account-button");
    await clickText("跟随系统");
    await click(".modal-heading button");
    await page("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await waitFor(
      'document.querySelector(".file-markdown-preview picture img").currentSrc==="data:image/png;base64,"+htmlFixture.files["docs/images/desktop-dark.png"]',
    );
    await page("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "light" }],
    });
    await waitFor(
      'document.querySelector(".file-markdown-preview picture img").currentSrc==="data:image/png;base64,"+htmlFixture.files["docs/images/desktop-light.png"]',
    );
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await pause(100);
    assert.equal(
      await evaluate("document.documentElement.scrollWidth>innerWidth"),
      false,
      "窄屏无页面横向溢出",
    );
    await screenshot("mobile-light");
    await page("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    await waitFor(
      'document.querySelector(".file-markdown-preview picture img").currentSrc==="data:image/png;base64,"+htmlFixture.files["docs/images/desktop-dark.png"]',
    );
    await screenshot("mobile-dark");
    console.log(
      "通过：消息与文件 HTML 排版、折叠、图标尺寸、本地图片、主题选图、大图预览、焦点恢复、安全过滤与窄屏",
    );
  }
  await writeFile(
    join(output, "source.json"),
    JSON.stringify(
      {
        build: buildInfo,
        data: "当前 README、仓库图片与隔离演示消息；独立 Chromium 配置；模拟后端",
      },
      null,
      2,
    ),
  );
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
