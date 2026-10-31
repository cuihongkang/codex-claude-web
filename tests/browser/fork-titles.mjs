import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const build = before
  ? join(root, ".cache/fork-titles-before/dist")
  : join(root, "client/dist");
const output = join(
  root,
  ".cache/fork-titles-browser",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      before ? ".cache/fork-titles-before/build-info.json" : "build-info.json",
    ),
    "utf8",
  ),
);

function fixture() {
  const now = Math.floor(Date.now() / 1000);
  const root = {
    id: "fork-demo-root",
    name: "汇总最新训练进展",
    cwd: "/fixture/training",
    createdAt: now - 100,
    completedAt: now - 50,
  };
  const records = JSON.parse(sessionStorage.getItem("fork-records")) || [
    root,
    {
      ...root,
      id: "fork-demo-client",
      name: root.name + " (2)",
      forkedFromId: root.id,
      completedAt: now - 60,
    },
  ];
  if (!sessionStorage.getItem("fork-records")) {
    localStorage.clear();
    localStorage.setItem("cx-current", root.id);
    localStorage.setItem("cx-theme", JSON.stringify("light"));
  }
  const items = [
    {
      id: "question",
      type: "userMessage",
      content: [{ type: "text", text: "汇总最新训练进展" }],
    },
    {
      id: "answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "训练进展已整理。可以从这里创建分支，继续讨论不同的训练方案。",
    },
  ];
  window.forkFixture = { records, requests: [], socket: null };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      window.forkFixture.socket = this;
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              method: "lan/state",
              params: {
                ready: true,
                defaultCwd: root.cwd,
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
      window.forkFixture.requests.push(m);
      let result = {};
      if (m.method === "thread/list")
        result = { data: m.params.archived ? [] : records, nextCursor: null };
      if (m.method === "thread/fork") {
        const thread = {
          ...root,
          name: null,
          id: "fork-demo-created-" + records.length,
          forkedFromId: m.params.threadId,
          completedAt: now + records.length,
        };
        records.push(thread);
        result = { thread };
      }
      if (m.method === "thread/name/set")
        records.find((t) => t.id === m.params.threadId).name = m.params.name;
      if (["thread/read", "thread/resume"].includes(m.method))
        result = {
          thread: records.find((t) => t.id === m.params.threadId),
          cwd: root.cwd,
        };
      if (m.method === "thread/turns/list")
        result = {
          data: [{ id: "turn", status: "completed", completedAt: now }],
          nextCursor: null,
        };
      if (m.method === "thread/items/list")
        result = {
          data: [...items].reverse().map((item) => ({ turnId: "turn", item })),
          nextCursor: null,
        };
      if (["model/list", "skills/list"].includes(m.method))
        result = { data: [] };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      sessionStorage.setItem("fork-records", JSON.stringify(records));
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
        0,
      );
    }
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    let content = await readFile(
      join(build, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace("<head>", `<head><script>(${fixture.toString()})()</script>`);
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[extname(path)] || "text/html",
      })
      .end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const profile = await mkdtemp(join(tmpdir(), "codex-web-forks-"));
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
const child = spawn(
  process.env.CHROME_PATH,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--no-proxy-server",
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
    const timer = setTimeout(() => reject(Error("浏览器启动超时")), 10000);
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
    const m = JSON.parse(event.data);
    if (!m.id) return;
    const request = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) request.reject(Error(JSON.stringify(m.error)));
    else request.resolve(m.result);
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
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
    const result = await page("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw Error(
      "等待超时：" +
        expression +
        "\n" +
        (await evaluate("document.body.innerText")),
    );
  };
  const click = async (selector) => {
    const point = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await page("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        ...point,
      });
    await new Promise((resolve) => setTimeout(resolve, 60));
  };
  const screenshot = async (name, selector) => {
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    await evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const clip = selector
      ? await evaluate(
          `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`,
        )
      : undefined;
    const { data } = await page("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip } : {}),
    });
    await writeFile(join(output, name + ".png"), Buffer.from(data, "base64"));
  };
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor("document.querySelector('[title=\"从这里创建分支\"]')");
  const edge = await evaluate(
    "(()=>{const r=document.querySelector('.sidebar-resizer').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
  );
  await page("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...edge,
  });
  await page("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    button: "left",
    buttons: 1,
    x: 420,
    y: edge.y,
  });
  await page("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    x: 420,
    y: edge.y,
  });
  await screenshot("initial-client-number");
  for (let number = 3; number <= (before ? 4 : 10); number++) {
    await click('[title="从这里创建分支"]');
    await waitFor(
      `window.forkFixture.records.length === ${number} && window.forkFixture.records.at(-1).name && !document.querySelector('.thread-loading') && document.querySelector('[title="从这里创建分支"]')`,
    );
    const name = await evaluate("window.forkFixture.records.at(-1).name");
    if (before) assert(name.endsWith(" (分支)".repeat(number - 2)));
    else assert.equal(name, `汇总最新训练进展 (${number})`);
    await waitFor(
      `document.querySelector('.thread-row.selected .thread-link > span:last-of-type')?.textContent === ${JSON.stringify(name)}`,
    );
    if (number === 4) {
      await screenshot("sequential-forks-light");
      await screenshot("sequential-sidebar-light", ".project-group");
    }
  }
  if (!before) {
    await screenshot("double-digit-light");
    await evaluate("document.documentElement.dataset.theme='dark'");
    await screenshot("double-digit-dark");
    await page("Page.reload");
    await waitFor(
      "document.querySelector('.thread-row.selected .thread-link > span:last-of-type')?.textContent==='汇总最新训练进展 (10)'",
    );
    await waitFor("document.querySelector('[title=\"从这里创建分支\"]')");
    await click(".thread-row.selected .thread-actions button:last-child");
    await waitFor("document.querySelector('[role=menu]')");
    const menuIndex = await evaluate(
      "[...document.querySelectorAll('[role=menu] button')].findIndex(e=>e.textContent.includes('创建分支'))",
    );
    await click(`[role=menu] button:nth-child(${menuIndex + 1})`);
    await waitFor(
      "window.forkFixture.records.at(-1).name==='汇总最新训练进展 (11)'",
    );
    await waitFor(
      "document.querySelector('.thread-row.selected .thread-link > span:last-of-type')?.textContent==='汇总最新训练进展 (11)' && document.querySelector('[title=\"从这里创建分支\"]')",
    );
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitFor("document.querySelector('[title=\"显示侧栏\"]')");
    await waitFor(
      "innerWidth===390 && document.querySelector('.sidebar').getBoundingClientRect().right<=1",
    );
    await click('[title="显示侧栏"]');
    await waitFor("document.querySelector('.sidebar.mobile-open')");
    await screenshot("mobile-sidebar");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth > innerWidth"),
      false,
    );
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        buildInfo,
        fixture: "tests/browser/fork-titles.mjs",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, before, output }));
} finally {
  ws?.close();
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.kill();
    await closed;
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}
