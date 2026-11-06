import { fixture } from "../fixtures/commands.mjs";
import { runCommandScenarios } from "./command-scenarios.mjs";
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
        `JSON.stringify({text:document.body.innerText.slice(-1000),draft:document.querySelector('.composer [aria-label="消息"]')?.value,requests:window.commandFixture?.requests.slice(-8),sendDisabled:document.querySelector('.send-button')?.disabled,active:document.activeElement?.tagName,width:innerWidth,scale:visualViewport.scale})`,
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
    await click('.composer [aria-label="消息"]');
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
        `(()=>{const input=document.querySelector('.composer [aria-label="消息"]');return input.isContentEditable?input.innerText.trim():input.value})()`,
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
    `document.querySelector('.composer [aria-label="消息"]') && document.querySelector('.breadcrumb > span')?.textContent==='核对快捷命令'`,
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
  const layouts = await runCommandScenarios({
    page,
    call,
    targetId,
    evaluate,
    waitFor,
    pause,
    click,
    clickText,
    type,
    submit,
    close,
    screenshot,
    beforeDismiss,
  });
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
