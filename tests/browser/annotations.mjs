import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contextItems, verifyUserContext } from "./user-message-context.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output =
  process.env.BROWSER_OUTPUT_DIR || join(root, ".cache/annotations-browser");
await mkdir(output, { recursive: true });
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
const buildDirectory = await mkdtemp(
  join(tmpdir(), "codex-web-annotation-build-"),
);
await cp(
  process.env.BROWSER_BUILD_DIR || join(root, "client/dist"),
  buildDirectory,
  { recursive: true },
);
const buildInfo = JSON.parse(
  await readFile(
    process.env.BROWSER_BUILD_INFO || join(root, "build-info.json"),
    "utf8",
  ),
);
function fixture(contextItems) {
  const first = !sessionStorage.getItem("annotation-fixture");
  if (first) localStorage.clear();
  sessionStorage.setItem("annotation-fixture", "true");
  const thread = {
    id: "annotation-browser",
    cwd: "/fixture/annotations",
    name: "批注交互验证",
    createdAt: 1,
    completedAt: 2,
  };
  const items = contextItems || [
    {
      id: "user",
      type: "userMessage",
      content: [{ type: "text", text: "请说明项目的验证和交付流程。" }],
    },
    {
      id: "answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "先检查项目实际配置，再确定修改范围。\n\n验证时使用隔离测试数据，保留检查结果。\n\n完成后说明修改内容及验证依据。",
    },
    {
      id: "second-answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "第二条回复同样支持添加批注，并与前面的批注一起提交。",
    },
  ];
  const requests = [];
  let fail = false,
    running = false,
    socket;
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  window.annotationFixture = {
    requests,
    setFail: (v) => (fail = v),
    setRunning: (v) => {
      running = v;
      socket.onmessage({
        data: JSON.stringify({
          method: v ? "turn/started" : "turn/completed",
          params: {
            threadId: thread.id,
            turn: { id: "turn", status: v ? "inProgress" : "completed" },
          },
        }),
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
      requests.push(m);
      let result = {};
      let error;
      if (m.method === "model/list")
        result = {
          data: [
            {
              id: "fixture-model",
              model: "fixture-model",
              displayName: "测试模型",
              isDefault: true,
              supportedReasoningEfforts: [{ reasoningEffort: "high" }],
            },
          ],
        };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "thread/list")
        result = { data: [thread], nextCursor: null };
      if (m.method === "thread/read" || m.method === "thread/resume")
        result = { thread, cwd: thread.cwd };
      if (m.method === "thread/turns/list")
        result = {
          data: [{ id: "turn", status: running ? "inProgress" : "completed" }],
          nextCursor: null,
        };
      if (m.method === "thread/items/list")
        result = {
          data: [...items].reverse().map((item) => ({ turnId: "turn", item })),
          nextCursor: null,
        };
      if (m.method === "skills/list") result = { data: [] };
      if (m.method === "fs/readDirectory")
        result = { entries: [{ fileName: "planner.js", isDirectory: false }] };
      if (m.method === "fs/readFile")
        result = { dataBase64: btoa("export const hover = true;\n") };
      if (m.method === "fuzzyFileSearch")
        result = {
          files: [
            {
              root: thread.cwd,
              path: "global_planner",
              file_name: "global_planner",
              match_type: "directory",
            },
          ],
        };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      if (m.method === "turn/start" || m.method === "turn/steer") {
        if (fail) error = { message: "模拟发送失败" };
        else result = { turn: { id: "sent", status: "completed" } };
      }
      if (m.method === "command/exec") return;
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              id: m.id,
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
          `<head><script>(${fixture.toString()})(${process.env.USER_CONTEXT === "1" ? JSON.stringify(contextItems) : "null"})</script>`,
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
async function runScenario() {
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

  const screenshot = async (name, clip) => {
    const { data } = await page("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip } : {}),
    });
    await writeFile(join(output, name + ".png"), Buffer.from(data, "base64"));
  };
  const key = async (key, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"])
      await page("Input.dispatchKeyEvent", {
        type,
        key,
        code: key === "Enter" ? "Enter" : key,
        modifiers,
        ...(key === "Enter" && !modifiers && type === "keyDown"
          ? { text: "\r" }
          : {}),
      });
    await pause(80);
  };
  const fill = async (selector, text) => {
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
  };
  const select = async (text) => {
    await evaluate(
      `(()=>{const root=document.querySelector('.conversation');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const i=n.textContent.indexOf(${JSON.stringify(text)});if(i<0)continue;const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+${text.length});getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));return;}throw Error('未找到选区');})()`,
    );
    await waitFor('document.querySelector(".annotation-add")');
    await click(".annotation-add");
    await waitFor('document.querySelector(".annotation-editor textarea")');
  };
  const sentCount = () =>
    evaluate(
      "annotationFixture.requests.filter(r=>/^turn\\/(start|steer)$/.test(r.method)).length",
    );
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
    `document.querySelector('textarea[aria-label="消息"]') && document.querySelector('.assistant-message')`,
  );
  if (process.env.USER_CONTEXT === "1") {
    await verifyUserContext({
      evaluate,
      page,
      waitFor,
      click,
      fill,
      key,
      screenshot,
      output,
      buildInfo,
    });
    return;
  }
  await fill('textarea[aria-label="消息"]', "请合并处理这些批注。");
  await select("先检查项目实际配置");
  await screenshot("editor-empty");
  await fill(".annotation-editor textarea", "请明确需要检查的配置文件。");
  if (process.env.ANNOTATION_BEFORE === "1") {
    await screenshot("before-inline-editor");
    await click('.annotation-editor button[type="submit"]');
    assert.equal(await sentCount(), 1);
    await screenshot("before-immediate-send");
    await writeFile(
      join(output, "results.json"),
      JSON.stringify(
        {
          passed: true,
          mode: "before",
          build: buildInfo,
          data: "生产构建与隔离 WebSocket 模拟历史；独立 Chromium 配置目录",
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, mode: "before", output }));
  } else {
    const layouts = [];
    const checkFloating = async (label) => {
      const result = await evaluate(
        `(()=>{const e=document.querySelector('.annotation-editor');const r=e.getBoundingClientRect();const c=document.querySelector('.composer-wrap').getBoundingClientRect();const f=document.querySelector('.annotation-editor textarea').getBoundingClientRect();return {position:getComputedStyle(e).position,inMessage:!!e.closest('.conversation'),inside:r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,aboveComposer:r.bottom<=c.top,fieldVisible:f.width>100&&f.height>16,left:r.left,top:r.top,width:r.width,height:r.height}})()`,
      );
      assert.equal(result.position, "fixed", label);
      assert.equal(result.inMessage, false, label);
      assert(
        result.inside && result.aboveComposer && result.fieldVisible,
        label + JSON.stringify(result),
      );
      layouts.push({ label, ...result });
    };
    await checkFloating("桌面悬浮编辑");
    const surface = await evaluate(`(()=>{
      const editor=document.querySelector('.annotation-editor');
      const field=editor.querySelector('textarea');
      const button=editor.querySelector('[type="submit"]');
      const r=editor.getBoundingClientRect(),b=button.getBoundingClientRect();
      const style=getComputedStyle(field);
      return {width:r.width,height:r.height,quoted:!!editor.querySelector('blockquote'),heading:!!editor.querySelector('.annotation-editor-heading'),border:style.borderWidth,background:style.backgroundColor,doneLabel:button.getAttribute('aria-label'),doneWidth:b.width,doneHeight:b.height};
    })()`);
    assert(Math.abs(surface.width - 294) < 1);
    assert(
      surface.height <= 47,
      "单行编辑器保持紧凑：" + JSON.stringify(surface),
    );
    assert.equal(surface.quoted, false);
    assert.equal(surface.heading, false);
    assert.equal(surface.border, "0px");
    assert.equal(surface.background, "rgba(0, 0, 0, 0)");
    assert.equal(surface.doneLabel, "完成批注");
    assert.equal(surface.doneWidth, surface.doneHeight);
    await screenshot("after-floating-editor");
    await key("Enter");
    assert(
      (
        await evaluate(
          `document.querySelector('.annotation-editor textarea').value`,
        )
      ).includes("\n"),
    );
    await screenshot("editor-multiline");
    await fill(
      ".annotation-editor textarea",
      "需要保留的长批注内容。".repeat(45),
    );
    const longEditor = await evaluate(
      `(()=>{const e=document.querySelector('.annotation-editor'),f=e.querySelector('textarea');return {height:e.getBoundingClientRect().height,fieldHeight:f.clientHeight,scrollHeight:f.scrollHeight,lineHeight:parseFloat(getComputedStyle(f).lineHeight)}})()`,
    );
    assert(longEditor.fieldHeight <= longEditor.lineHeight * 5 + 1);
    assert(longEditor.scrollHeight > longEditor.fieldHeight);
    await checkFloating("长批注内部滚动");
    await screenshot("editor-long-comment");
    await fill(".annotation-editor textarea", "请明确需要检查的配置文件。");
    assert.equal(
      await evaluate(
        `document.querySelector('.annotation-editor').dataset.expanded`,
      ),
      "false",
    );
    await click('.annotation-editor button[type="submit"]');
    assert.equal(await sentCount(), 0, "完成批注仅保存草稿");
    await select("验证时使用隔离测试数据");
    await fill(".annotation-editor textarea", "请记录验证结果和截图路径。");
    await click('.annotation-editor button[type="submit"]');
    await select("第二条回复同样支持添加批注");
    await fill(".annotation-editor textarea", "一起核对第二条回复。");
    await click('.annotation-editor button[type="submit"]');
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.annotation-attachment').length`,
      ),
      3,
    );
    assert.equal(await sentCount(), 0);
    await screenshot("after-multiple-drafts");
    await click('button[aria-label="打开批注 1"]');
    await fill(".annotation-editor textarea", "改为列出配置文件及其用途。");
    await click('.annotation-editor button[type="submit"]');
    await click('button[aria-label="移除批注 3"]');
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.annotation-attachment').length`,
      ),
      2,
    );
    await page("Page.reload");
    await waitFor(
      `document.querySelectorAll('.annotation-attachment').length===2 && document.querySelector('.assistant-message')`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('textarea[aria-label="消息"]').value`,
      ),
      "请合并处理这些批注。",
    );
    await click('button[aria-label="打开批注 1"]');
    assert.equal(
      await evaluate(
        `document.querySelector('.annotation-editor textarea').value`,
      ),
      "改为列出配置文件及其用途。",
    );
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      await evaluate(`document.documentElement.style.zoom=${zoom}`);
      await pause(100);
      await checkFloating("缩放 " + zoom);
      await screenshot("after-zoom-" + zoom);
    }
    await evaluate(`document.documentElement.style.zoom=1`);
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(`document.documentElement.dataset.theme='dark'`);
    await pause(150);
    await checkFloating("窄屏深色");
    await screenshot("after-mobile-dark");
    await click('.annotation-editor button[type="submit"]');
    await evaluate(`annotationFixture.setFail(true)`);
    await click(".send-button");
    await waitFor(`document.querySelector('.send-button:not(:disabled)')`);
    assert.equal(await sentCount(), 1);
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.annotation-attachment').length`,
      ),
      2,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('textarea[aria-label="消息"]').value`,
      ),
      "请合并处理这些批注。",
    );
    await screenshot("after-failure-retained");
    await evaluate(`annotationFixture.setFail(false)`);
    await click('textarea[aria-label="消息"]');
    await key("Enter", 2);
    await waitFor(`!document.querySelector('.annotation-attachment')`);
    assert.equal(await sentCount(), 2);
    const sent = await evaluate(
      `annotationFixture.requests.filter(r=>r.method==='turn/start').at(-1).params.input[0].text`,
    );
    assert(
      sent.includes("改为列出配置文件及其用途。") &&
        sent.includes("请记录验证结果和截图路径。") &&
        sent.endsWith("请合并处理这些批注。"),
    );
    assert.equal(
      await evaluate(
        `document.querySelector('textarea[aria-label="消息"]').value`,
      ),
      "",
    );
    await screenshot("after-unified-send");
    await select("完成后说明修改内容及验证依据");
    await fill(".annotation-editor textarea", "只发送批注也应可用。");
    await click('.annotation-editor button[type="submit"]');
    assert.equal(
      await evaluate(`document.querySelector('.send-button').disabled`),
      false,
    );
    await click(".send-button");
    await waitFor(`!document.querySelector('.annotation-attachment')`);
    assert.equal(await sentCount(), 3);
    await evaluate(`(()=>{
      const paragraphs=document.querySelectorAll('[data-annotation-message="answer"] p');
      const r=document.createRange();r.setStart(paragraphs[0].firstChild,0);r.setEnd(paragraphs[1].firstChild,paragraphs[1].firstChild.textContent.length);
      getSelection().removeAllRanges();getSelection().addRange(r);document.dispatchEvent(new Event('selectionchange'));
    })()`);
    await waitFor(`document.querySelector('.annotation-add')`);
    await click(".annotation-add");
    await fill(".annotation-editor textarea", "跨段落的批注也保留原文位置。");
    await click('.annotation-editor button[type="submit"]');
    assert.equal(await sentCount(), 3);
    await waitFor(
      `document.querySelectorAll('.annotation-draft-marker').length===1`,
    );
    await screenshot("after-multiline-marker");
    await fill('textarea[aria-label="消息"]', "统一补充这两段。");
    await evaluate(`annotationFixture.setRunning(true)`);
    await click(".annotation-draft-marker");
    await fill(".annotation-editor textarea", "运行中也统一提交当前编辑内容。");
    await key("Enter", 2);
    await waitFor(`!document.querySelector('.annotation-attachment')`);
    const steer = await evaluate(
      `annotationFixture.requests.filter(r=>r.method==='turn/steer').at(-1)`,
    );
    assert.equal(steer.params.expectedTurnId, "turn");
    assert(
      steer.params.input[0].text.includes("运行中也统一提交当前编辑内容。") &&
        steer.params.input[0].text.endsWith("统一补充这两段。"),
    );
    assert.equal(await sentCount(), 4);
    await select("完成后说明修改内容及验证依据");
    await click('.annotation-editor button[aria-label="移除批注"]');
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.annotation-attachment').length`,
      ),
      0,
    );
    assert.equal(await sentCount(), 4);
    await writeFile(
      join(output, "results.json"),
      JSON.stringify(
        {
          passed: true,
          build: buildInfo,
          data: "生产构建与隔离 WebSocket 模拟历史；独立 Chromium 配置目录",
          layouts,
          surface,
          sent,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ passed: true, output, layouts: layouts.length }),
    );
  }
}
try {
  await runScenario();
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
