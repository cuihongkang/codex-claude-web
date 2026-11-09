import { testThreadFolderDragBrowser } from "./thread-folder-drag.mjs";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { testSidebarDensity } from "./sidebar-density.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const visibilityBefore = process.env.PIN_VISIBILITY_BEFORE === "1";
const threadDrag = process.env.THREAD_FOLDER_DRAG === "1";
const density = process.env.SIDEBAR_DENSITY === "1";
const densityBefore = process.env.SIDEBAR_DENSITY_BEFORE === "1";
const compactSidebar = !before && !visibilityBefore && !densityBefore;
const buildSource = join(
  root,
  densityBefore
    ? ".cache/sidebar-density-before/dist"
    : visibilityBefore
      ? ".cache/project-pin-visibility-before/dist"
      : before
        ? ".cache/project-pins-before/dist"
        : "client/dist",
);
const buildDirectory = await mkdtemp(
  join(tmpdir(), "claudex-web-project-pins-build-"),
);
await cp(buildSource, buildDirectory, { recursive: true });
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      densityBefore
        ? ".cache/sidebar-density-before/build-info.json"
        : visibilityBefore
          ? ".cache/project-pin-visibility-before/build-info.json"
          : before
            ? ".cache/project-pins-before/build-info.json"
            : "build-info.json",
    ),
    "utf8",
  ),
);
const output = join(
  root,
  density ? ".cache/sidebar-density-browser" : ".cache/project-pins-browser",
  densityBefore
    ? "before"
    : visibilityBefore
      ? "visibility-before"
      : before
        ? "before"
        : "after",
);
const evidenceDirectory = output;
await mkdir(output, { recursive: true });
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
function fixture(density, threadDrag) {
  if (!localStorage.getItem("pins-fixture")) {
    localStorage.clear();
    localStorage.setItem("cx-theme", JSON.stringify("light"));
    localStorage.setItem("pins-fixture", "1");
    if (density)
      localStorage.setItem("cx-projects", JSON.stringify(["/demo/Atlas"]));
  }
  const threads = [
    {
      id: "atlas-a",
      cwd: "/demo/Atlas",
      name: "完善快速开始文档",
      createdAt: 3,
    },
    { id: "atlas-b", cwd: "/demo/Atlas", name: "检查项目结构", createdAt: 2 },
    { id: "beacon", cwd: "/demo/Beacon", name: "整理本周笔记", createdAt: 1 },
  ];
  if (threadDrag)
    threads.push({
      id: "backend:claude:atlas-c",
      cwd: "/demo/Atlas",
      name: "Claude 项目迁移",
      createdAt: 0,
    });
  if (density) {
    threads[0].createdAt = 3000;
    threads[1].createdAt = 2999;
    threads[2].createdAt = 2000;
    threads.push(
      ...Array.from({ length: 65 }, (_, index) => ({
        id: "atlas-old-" + index,
        cwd: "/demo/Atlas",
        name: "Atlas 历史对话 " + (index + 1),
        createdAt: 1000 - index,
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        id: "beacon-old-" + index,
        cwd: "/demo/Beacon",
        name: "Beacon 历史对话 " + (index + 1),
        createdAt: -index - 1,
      })),
      { id: "unclassified", cwd: "", name: "未分类最新对话", createdAt: 10000 },
    );
  }
  const assignments = JSON.parse(
    localStorage.getItem("fixture-folders") || "{}",
  );
  for (const thread of threads) Object.assign(thread, assignments[thread.id]);
  const archived = new Set(
    JSON.parse(localStorage.getItem("fixture-archived") || "[]"),
  );
  window.pinRequests = [];
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
                defaultCwd: "/demo/Atlas",
                activeTurns: {},
                questions: [],
                terminals: {},
              },
            }),
          }),
        0,
      );
    }
    send(raw) {
      const m = JSON.parse(raw);
      window.pinRequests.push(m);
      let result = { data: [] };
      if (m.method === "thread/list")
        result = {
          data: threads.filter((t) => archived.has(t.id) === m.params.archived),
        };
      if (density && m.method === "thread/list") {
        const visible = result.data;
        result = {
          data: m.params.cursor ? visible.slice(60) : visible.slice(0, 60),
          nextCursor:
            !m.params.cursor && visible.length > 60 ? "density-next" : null,
        };
      }
      if (threadDrag && m.method === "lan/thread/move") {
        const thread = threads.find((t) => t.id === m.params.threadId);
        Object.assign(thread, {
          folderPath: m.params.folderPath,
          cwd: m.params.folderPath || thread.cwd,
          folderRevision: (thread.folderRevision || 0) + 1,
        });
        assignments[thread.id] = {
          folderPath: thread.folderPath,
          cwd: thread.cwd,
          folderRevision: thread.folderRevision,
        };
        localStorage.setItem("fixture-folders", JSON.stringify(assignments));
        result = { thread };
      }
      if (m.method === "lan/projectless/read") result = { directories: {} };
      if (m.method === "thread/archive" || m.method === "thread/unarchive") {
        if (m.method === "thread/archive") archived.add(m.params.threadId);
        else archived.delete(m.params.threadId);
        localStorage.setItem("fixture-archived", JSON.stringify([...archived]));
      }
      if (["thread/read", "thread/resume"].includes(m.method))
        result = { thread: threads.find((t) => t.id === m.params.threadId) };
      if (m.method === "model/list")
        result = {
          data: [
            {
              id: "demo-model",
              model: "demo-model",
              displayName: "Codex",
              supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
            },
          ],
        };
      if (m.method === "config/read")
        result = {
          config: { model: "demo-model", model_reasoning_effort: "medium" },
        };
      if (m.method === "account/read") result = { account: null };
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
  if (serveDemoSession(request, response)) return;
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
          `<head><script>(${fixture.toString()})(${JSON.stringify(density)}, ${JSON.stringify(threadDrag)})</script>`,
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
const profile = await mkdtemp(join(tmpdir(), "claudex-web-readme-browser-"));
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
  let { sessionId } = await call("Target.attachToTarget", {
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
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await pause(180);
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

  const screenshot = async (name, directory = output, clip) => {
    const { data } = await page("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip } : {}),
    });
    await writeFile(
      join(directory, name + ".png"),
      Buffer.from(data, "base64"),
    );
  };

  const evidence = [];
  const group =
    '.project-group:has(.project-heading > button[title="/demo/Atlas"])';
  const paths = () =>
    evaluate(
      "[...document.querySelectorAll('.project-heading > button:first-child')].map(e=>e.title)",
    );
  const inspect = async (name) => {
    await pause(300);
    const layout = await evaluate(
      "(()=>{const g=document.querySelector(" +
        JSON.stringify(group) +
        ");const buttons=[...g.querySelectorAll('.project-heading button')].map(e=>{const r=e.getBoundingClientRect();return{title:e.title,pressed:e.getAttribute('aria-pressed'),x:r.x,right:r.right,width:r.width,opacity:getComputedStyle(e).opacity}});return {buttons,overflow:document.documentElement.scrollWidth>innerWidth,paths:[...document.querySelectorAll('.project-heading > button:first-child')].map(e=>e.title)}})()",
    );
    assert(!layout.overflow);
    assert(layout.buttons.every((b) => b.width > 0));
    for (let i = 1; i < layout.buttons.length; i++)
      assert(layout.buttons[i].x >= layout.buttons[i - 1].right - 1);
    evidence.push({ name, ...layout });
    await screenshot(name);
  };
  if (threadDrag) {
    await testThreadFolderDragBrowser({
      call,
      page,
      evaluate,
      click,
      waitFor,
      screenshot,
      server,
      ws,
    });
  } else if (density) {
    await testSidebarDensity({
      page,
      evaluate,
      click,
      waitFor,
      screenshot,
      pause,
      server,
      evidence,
      before: densityBefore,
    });
  } else {
    await page("Page.enable", {});
    await page("Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const url = "http://127.0.0.1:" + server.address().port + "/";
    await page("Page.navigate", { url });
    await waitFor(
      "document.querySelectorAll('.project-heading').length===3 && document.querySelector('[aria-label=消息]') && !document.querySelector('[aria-label=消息]').disabled",
    );
    await evaluate("document.querySelector('[aria-label=消息]').focus()");
    await page("Input.insertText", { text: "固定项目时保留的草稿" });
    const initial = await paths();
    if (compactSidebar) {
      await click('.project-heading > button[title="/demo/Atlas"]');
      await click('.project-heading > button[title="/demo/Beacon"]');
    }
    await click('.project-heading > button[title="/demo/Atlas"]');
    await click('.project-heading > button[title="/demo/Atlas"]');
    await inspect("desktop-before-pin");
    if (!before) {
      await click('[aria-label="固定 Atlas"]');
      await waitFor(
        "document.querySelector('[aria-label=\"取消固定 Atlas\"]')?.getAttribute('aria-pressed')==='true'",
      );
      assert.deepEqual(await paths(), initial, "固定保留顺序");
      assert.equal(
        await evaluate("document.querySelector('[aria-label=消息]').value"),
        "固定项目时保留的草稿",
      );
      assert.deepEqual(
        await evaluate("JSON.parse(localStorage.getItem('cx-projects'))"),
        ["/demo/Atlas"],
      );
      await inspect("desktop-pinned");
      await page("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 700,
        y: 400,
      });
      await pause(300);
      const pinnedIdle = await evaluate(
        "[...document.querySelectorAll('.project-heading:has([aria-label=\"取消固定 Atlas\"]) > .icon-button')].map(b=>({label:b.getAttribute('aria-label'),opacity:getComputedStyle(b).opacity}))",
      );
      assert.deepEqual(
        pinnedIdle.map((b) => b.opacity),
        ["1", visibilityBefore ? "1" : "0"],
        "固定状态仅常显图钉，鼠标移开隐藏加号",
      );
      evidence.push({ name: "pinned-mouse-away", buttons: pinnedIdle });
      await screenshot("pinned-mouse-away", output, {
        x: 0,
        y: 185,
        width: 240,
        height: 230,
        scale: 1,
      });
      await click('[aria-label="取消固定 Atlas"]');
      await page("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 700,
        y: 400,
      });
      await pause(300);
      const unpinned = await evaluate(
        "[...document.querySelectorAll('.project-heading:has([aria-label=\"固定 Atlas\"]) > .icon-button')].map(b=>({label:b.getAttribute('aria-label'),opacity:getComputedStyle(b).opacity,focused:document.activeElement===b,focusVisible:b.matches(':focus-visible')}))",
      );
      assert.equal(unpinned.length, 2);
      assert(
        unpinned.every((b) => b.opacity === (visibilityBefore ? "1" : "0")),
        "鼠标移开后隐藏取消固定的图钉与加号",
      );
      evidence.push({ name: "unpin-mouse-away", buttons: unpinned });
      const conversationPoint = await evaluate(
        "(()=>{const r=document.querySelector(" +
          JSON.stringify(group + " .thread-link") +
          ").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
      );
      await page("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...conversationPoint,
      });
      assert(
        await evaluate(
          "[...document.querySelectorAll('.project-heading:has([aria-label=\"固定 Atlas\"]) > .icon-button')].every(b=>getComputedStyle(b).opacity==='" +
            (visibilityBefore ? "1" : "0") +
            "')",
        ),
        "悬浮对话正文时文件夹操作入口保持隐藏",
      );
      await page("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 700,
        y: 400,
      });
      await screenshot("unpin-mouse-away", output, {
        x: 0,
        y: 185,
        width: 240,
        height: 230,
        scale: 1,
      });
      await page("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      await page("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Tab",
        code: "Tab",
        windowsVirtualKeyCode: 9,
      });
      assert(
        await evaluate(
          "document.activeElement.getAttribute('aria-label')==='在 Atlas 中新建对话' && document.activeElement.matches(':focus-visible')",
        ),
      );
      assert(
        await evaluate(
          "[...document.querySelectorAll('.project-heading:has([aria-label=\"固定 Atlas\"]) > .icon-button')].every(b=>getComputedStyle(b).opacity==='1')",
        ),
        "键盘聚焦时显示操作入口",
      );
      await screenshot("unpin-keyboard-focus", output, {
        x: 0,
        y: 185,
        width: 240,
        height: 230,
        scale: 1,
      });
      await click('[aria-label="固定 Atlas"]');
    } else
      assert.equal(
        await evaluate(
          "!!document.querySelector('[aria-label=\"固定 Atlas\"]')",
        ),
        false,
      );
    for (let i = 0; i < 2; i++) {
      await click(group + " .thread-actions button:first-child");
      await waitFor(
        "document.querySelectorAll(" +
          JSON.stringify(group + " .thread-row") +
          ").length===" +
          (1 - i),
      );
    }
    await inspect("all-archived-in-session");
    await page("Page.reload", {});
    await waitFor(
      `document.querySelectorAll('.thread-row').length===${compactSidebar ? 0 : 1} && document.querySelector('[aria-label=消息]') && !document.querySelector('[aria-label=消息]').disabled`,
    );
    if (before) {
      assert(
        !(await paths()).includes("/demo/Atlas"),
        "旧构建重新打开后文件夹消失",
      );
      await screenshot("empty-folder-disappears");
      await screenshot("empty-folder-sidebar", output, {
        x: 0,
        y: 185,
        width: 240,
        height: 210,
        scale: 1,
      });
    } else {
      assert((await paths()).includes("/demo/Atlas"));
      assert.equal(
        await evaluate(
          "document.querySelectorAll(" +
            JSON.stringify(group + " .thread-row") +
            ").length",
        ),
        0,
      );
      await inspect("empty-folder-after-reload");
      const reopened = await call("Target.createTarget", {
        url: "about:blank",
      });
      const attached = await call("Target.attachToTarget", {
        targetId: reopened.targetId,
        flatten: true,
      });
      sessionId = attached.sessionId;
      await call("Target.closeTarget", { targetId });
      await page("Page.enable", {});
      await page("Emulation.setDeviceMetricsOverride", {
        width: 1200,
        height: 850,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page("Page.navigate", { url });
      await waitFor(
        "document.querySelector('[aria-label=\"取消固定 Atlas\"]') && document.querySelector('[aria-label=消息]') && !document.querySelector('[aria-label=消息]').disabled",
      );
      await inspect("empty-folder-after-reopen");
      await screenshot("empty-folder-sidebar", output, {
        x: 0,
        y: 185,
        width: 240,
        height: 210,
        scale: 1,
      });
      await click('[aria-label="在 Atlas 中新建对话"]');
      await page("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 700,
        y: 400,
      });
      await pause(300);
      const afterNewChat = await evaluate(
        "[...document.querySelectorAll('.project-heading:has([aria-label=\"取消固定 Atlas\"]) > .icon-button')].map(b=>({label:b.getAttribute('aria-label'),opacity:getComputedStyle(b).opacity}))",
      );
      assert.deepEqual(
        afterNewChat.map((b) => b.opacity),
        ["1", visibilityBefore ? "1" : "0"],
        "固定文件夹中新建对话后鼠标移开仍隐藏加号",
      );
      evidence.push({
        name: "pinned-new-chat-mouse-away",
        buttons: afterNewChat,
      });
      await screenshot("pinned-new-chat-mouse-away", output, {
        x: 0,
        y: 185,
        width: 240,
        height: 230,
        scale: 1,
      });
      assert.equal(
        await evaluate("JSON.parse(localStorage.getItem('cx-cwd'))"),
        "/demo/Atlas",
      );
      for (const theme of ["dark", "light"]) {
        await evaluate(
          "localStorage.setItem('cx-theme',JSON.stringify(" +
            JSON.stringify(theme) +
            "))",
        );
        await page("Page.reload", {});
        await waitFor(
          "document.querySelector('[aria-label=\"取消固定 Atlas\"]') && document.querySelector('[aria-label=消息]') && !document.querySelector('[aria-label=消息]').disabled",
        );
        await inspect("empty-folder-" + theme);
      }
      await page("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await page("Emulation.setTouchEmulationEnabled", { enabled: true });
      await click('.topbar button[title="显示侧栏"]');
      await waitFor("document.querySelector('.sidebar.mobile-open')");
      await inspect("mobile-empty-pinned");
      await click('[aria-label="取消固定 Atlas"]');
      await waitFor(
        "document.querySelector('[aria-label=\"固定 Atlas\"]')?.getAttribute('aria-pressed')==='false'",
      );
      assert(
        (await paths()).includes("/demo/Atlas"),
        "取消固定后沿用页面内快照",
      );
      await page("Page.reload", {});
      await waitFor(
        "document.querySelector('.project-heading > button[title=\"/demo/Beacon\"]') && document.querySelector('[aria-label=消息]') && !document.querySelector('[aria-label=消息]').disabled",
      );
      assert(
        !(await paths()).includes("/demo/Atlas"),
        "取消固定的空文件夹在重新加载时移除",
      );
      await click('.topbar button[title="显示侧栏"]');
      await click('[aria-label="固定 Beacon"]');
      await evaluate(
        "document.querySelector('[aria-label=\"取消固定 Beacon\"]').focus()",
      );
      await page("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        text: "\r",
      });
      await page("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      });
      await waitFor("document.querySelector('[aria-label=\"固定 Beacon\"]')");
      assert(
        (await paths()).includes("/demo/Beacon"),
        "有活跃对话的文件夹取消固定后继续显示",
      );
      assert.equal(
        await evaluate(
          "document.querySelectorAll('.project-group:has(.project-heading > button[title=\"未指定项目的对话\"]) [aria-pressed]').length",
        ),
        0,
      );
    }
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        build: buildInfo,
        data: "独立浏览器配置、Atlas/Beacon 模拟对话及归档状态",
        evidence,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, before, output }));
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
