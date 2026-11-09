import { serveDemoSession } from "../helpers/browser-session.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { imageBase64, toolActivities } from "../fixtures/tool-activities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const build = before
  ? join(root, ".cache/tool-activities-before/dist")
  : join(root, "client/dist");
const output = join(
  root,
  ".cache/tool-activities-browser",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      before
        ? ".cache/tool-activities-before/build-info.json"
        : "build-info.json",
    ),
    "utf8",
  ),
);

function fixture(activities, image) {
  localStorage.clear();
  const thread = {
    id: "tool-display-fixture",
    name: "工具记录展示验证",
    cwd: "/fixture/project",
    createdAt: 1,
    completedAt: 2,
  };
  const items = [
    {
      id: "user",
      type: "userMessage",
      content: [{ type: "text", text: "搜索规划论文、查找正文并查看图片。" }],
    },
    ...activities,
    {
      id: "answer",
      type: "agentMessage",
      phase: "final_answer",
      text: "已完成论文与图片检查。",
    },
  ];
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  window.toolFixture = { requests: [] };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      window.toolFixture.socket = this;
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
      window.toolFixture.requests.push(m);
      let result = {};
      if (m.method === "thread/list")
        result = { data: [thread], nextCursor: null };
      if (["thread/read", "thread/resume"].includes(m.method))
        result = { thread, cwd: thread.cwd };
      if (m.method === "thread/turns/list")
        result = {
          data: [{ id: "turn", status: "completed" }],
          nextCursor: null,
        };
      if (m.method === "thread/items/list")
        result = {
          data: [...items].reverse().map((item) => ({ turnId: "turn", item })),
          nextCursor: null,
        };
      if (m.method === "model/list") result = { data: [] };
      if (m.method === "skills/list") result = { data: [] };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      if (m.method === "fs/readFile") result = { dataBase64: image };
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
        0,
      );
    }
  };
}

const server = http.createServer(async (req, res) => {
  if (serveDemoSession(req, res)) return;
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    let content = await readFile(
      join(build, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace(
          "<head>",
          `<head><script>(${fixture.toString()})(${JSON.stringify(toolActivities)},${JSON.stringify(imageBase64)})</script>`,
        );
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
const profile = await mkdtemp(join(tmpdir(), "claudex-web-tools-"));
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
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor("document.querySelector('.process-history > summary')");
  await click(".process-history > summary");
  await waitFor("document.querySelectorAll('.activity').length >= 12");
  for (let i = 0; i < 4; i++) {
    const selector = `.activity:nth-child(${i + 1}) > button`;
    if (
      await evaluate(
        `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')==='false'`,
      )
    )
      await click(selector);
  }
  if (before) {
    assert(
      await evaluate(
        "document.querySelector('.tool-web-details').textContent.includes('fixture-search-0')",
      ),
    );
    assert(
      await evaluate(
        "document.querySelector('.tool-web-details').textContent.includes('搜索结果摘要')",
      ),
    );
  } else {
    await waitFor("document.querySelector('.activity img')?.naturalWidth > 0");
    assert.equal(
      await evaluate("document.querySelectorAll('.activity-body pre').length"),
      0,
    );
    assert(
      await evaluate(
        "document.querySelector('.process-content').textContent.includes('在网页中查找')",
      ),
    );
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('.tool-web-details .tool-section a')].map(e=>({text:e.textContent,href:e.getAttribute('href')}))",
      ),
      [
        { text: "Planning Algorithms", href: "https://lavalle.pl/planning/" },
        {
          text: "https://arxiv.org/abs/1105.1186",
          href: "https://arxiv.org/abs/1105.1186",
        },
      ],
    );
    assert(
      await evaluate(
        "[...document.querySelectorAll('.tool-web-details .tool-section li')].every(e=>e.children.length===1 && e.firstElementChild.tagName==='A') && !/搜索结果摘要|搜索结果说明|text_result|domain|ref id|fixture-search/.test(document.querySelector('.tool-web-details').textContent)",
      ),
    );
    await click(".activity:first-child > button");
    assert(
      await evaluate(
        "!document.querySelector('.activity:first-child .tool-web-details')",
      ),
    );
    await click(".activity:first-child > button");
    await waitFor(
      "document.querySelectorAll('.tool-web-details .tool-section a').length===2",
    );
  }
  await evaluate(
    "document.querySelector('.conversation').scrollTo({top:0,behavior:'instant'})",
  );
  await screenshot("desktop-light");
  await screenshot("search-results", ".activity:first-child");
  if (!before) {
    await click(".activity .message-image-button");
    await waitFor("document.querySelector('dialog[open]')");
    await screenshot("image-preview");
    await click(".image-viewer-toolbar button[aria-pressed]");
    assert(
      await evaluate(
        "!!document.querySelector('.image-viewer-canvas.original-size')",
      ),
    );
    for (const type of ["keyDown", "keyUp"])
      await page("Input.dispatchKeyEvent", {
        type,
        key: "Escape",
        code: "Escape",
      });
    await waitFor("!document.querySelector('dialog')");
    assert(
      await evaluate(
        "document.activeElement.classList.contains('message-image-button')",
      ),
    );
    for (const selector of [
      ".activity:nth-child(5) > button",
      ".activity:nth-child(7) > button",
      ".activity:nth-child(12) > button",
    ])
      await click(selector);
    await screenshot("tool-results");
    await waitFor(
      "document.querySelector('.process-content').textContent.includes('读取超时，请稍后重试。')",
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.activity-body pre').length"),
      0,
    );
    await screenshot("tool-results");
    const layouts = [];
    for (const theme of ["light", "dark"]) {
      for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
        await page("Emulation.setDeviceMetricsOverride", {
          width: Math.round(1200 / zoom),
          height: Math.round(1050 / zoom),
          deviceScaleFactor: zoom,
          mobile: false,
        });
        await evaluate(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('.conversation').scrollTo({top:0,behavior:'instant'})`,
        );
        await waitFor(
          "document.querySelector('.activity img')?.naturalWidth>0",
        );
        layouts.push(
          await evaluate(
            `({theme:${JSON.stringify(theme)},zoom:${zoom},width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,images:[...document.querySelectorAll('.activity img')].map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))})`,
          ),
        );
        await screenshot(`${theme}-${zoom}`);
      }
    }
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(
      "document.querySelector('.conversation').scrollTo({top:0,behavior:'instant'})",
    );
    await screenshot("mobile-dark");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth>innerWidth"),
      false,
    );
    assert(layouts.every((layout) => !layout.overflow));
    await writeFile(
      join(output, "layouts.json"),
      JSON.stringify(layouts, null, 2),
    );
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        buildInfo,
        fixture: "tests/fixtures/tool-activities.mjs",
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
