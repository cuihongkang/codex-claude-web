import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const source = before ? ".cache/composer-performance-before/" : "";
const output = join(
  root,
  ".cache/composer-performance",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const build = await mkdtemp(join(tmpdir(), "codex-web-input-build-"));
await cp(join(root, source, before ? "dist" : "client/dist"), build, {
  recursive: true,
});
const buildInfo = JSON.parse(
  await readFile(join(root, source, "build-info.json"), "utf8"),
);

function fixture() {
  if (!sessionStorage.getItem("input-fixture")) {
    localStorage.clear();
    localStorage.setItem("cx-current", "input-history");
    localStorage.setItem("cx-theme", JSON.stringify("light"));
    sessionStorage.setItem("input-fixture", "true");
  }
  const thread = {
    id: "input-history",
    name: "长对话输入性能验证",
    cwd: "/fixture/input",
    createdAt: 1,
    completedAt: 2,
  };
  const turns = Array.from({ length: 60 }, (_, i) => ({
    id: "turn-" + i,
    status: "completed",
    completedAt: i + 10,
  }));
  const items = turns.flatMap((turn, i) => [
    {
      id: "user-" + i,
      type: "userMessage",
      turnId: turn.id,
      content: [
        {
          type: "text",
          text: `第 ${i + 1} 次讨论：检查输入框、历史阅读和草稿恢复。`,
        },
      ],
    },
    {
      id: "answer-" + i,
      type: "agentMessage",
      turnId: turn.id,
      phase: "final_answer",
      text:
        "已检查输入与恢复流程。\n\n" +
        "支持 **长段文字**、普通输入及组合输入，保留草稿和原来的阅读位置。\n\n".repeat(
          4,
        ) +
        "```js\nconst message = '输入性能验证';\nconsole.log(message);\n```",
    },
  ]);
  window.inputFixture = {
    requests: [],
    samples: [],
    commits: [],
    fail: false,
    delay: 0,
    turns,
    items,
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    inject: () => 1,
    onCommitFiberRoot(id, root) {
      const sample = { functions: 0, history: 0 };
      function visit(fiber) {
        if (fiber.tag === 0 && fiber.flags & 1) sample.functions++;
        if (fiber.memoizedProps?.className === "conversation") {
          let owner = fiber.return;
          while (owner && owner.tag !== 0) owner = owner.return;
          if (owner?.flags & 1) sample.history++;
        }
        if (fiber.child) visit(fiber.child);
        if (fiber.sibling) visit(fiber.sibling);
      }
      visit(root.current);
      window.inputFixture.commits.push(sample);
    },
    onCommitFiberUnmount() {},
  };
  document.addEventListener(
    "input",
    (event) => {
      if (event.target.getAttribute("aria-label") !== "消息") return;
      const start = performance.now();
      const sample = {
        length: event.target.value.length,
        type: event.inputType,
        composing: event.isComposing,
        elapsed: 0,
      };
      window.inputFixture.samples.push(sample);
      requestAnimationFrame(() => {
        sample.elapsed = performance.now() - start;
      });
    },
    true,
  );
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
      window.inputFixture.requests.push(m);
      let result = {};
      let error;
      if (m.method === "thread/list")
        result = {
          data: m.params.archived
            ? []
            : [
                thread,
                ...Array.from({ length: 30 }, (_, i) => ({
                  ...thread,
                  id: "other-" + i,
                  name: "隔离对话 " + (i + 1),
                })),
              ],
          nextCursor: null,
        };
      if (["thread/read", "thread/resume", "thread/start"].includes(m.method))
        result = {
          thread: { ...thread, id: m.params.threadId || "created-input" },
          cwd: thread.cwd,
        };
      if (m.method === "thread/turns/list")
        result = { data: [...turns].reverse(), nextCursor: null };
      if (m.method === "thread/items/list")
        result = {
          data: [...items]
            .reverse()
            .map((item) => ({ turnId: item.turnId, item })),
          nextCursor: null,
        };
      if (["model/list", "skills/list"].includes(m.method))
        result = { data: [] };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      if (["turn/start", "turn/steer"].includes(m.method)) {
        if (window.inputFixture.fail) error = { message: "模拟发送失败" };
        else result = { turn: { id: "sent-turn", status: "completed" } };
      }
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              id: m.id,
              ...(error ? { error } : { result }),
            }),
          }),
        m.method === "turn/start" ? window.inputFixture.delay : 0,
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
const profile = await mkdtemp(join(tmpdir(), "codex-web-input-browser-"));
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
  await once(ws, "open");
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
    for (let i = 0; i < 200; i++) {
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
  const frame = () =>
    evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
  const click = async (selector) => {
    const point = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await page("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        ...point,
      });
  };
  const screenshot = async (name) => {
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await frame();
    const { data } = await page("Page.captureScreenshot", { format: "png" });
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
  await waitFor(
    "document.querySelectorAll('.user-message').length === 60 && document.querySelector('textarea[aria-label=消息]')",
  );
  await frame();
  await click('textarea[aria-label="消息"]');
  await evaluate(
    "window.inputFixture.samples=[];window.inputFixture.commits=[]",
  );
  const speech =
    "这是一段模拟语音输入的文字，用来检查长对话中一次提交大段内容的响应速度，同时核对输入内容、草稿保存和发送行为。".repeat(
      80,
    );
  await page("Input.insertText", { text: speech });
  await frame();
  for (const text of [
    "继续",
    "补充",
    "细节",
    "。",
    "第一点",
    "第二点",
    "第三点",
    "完成",
  ]) {
    await page("Input.insertText", { text });
    await frame();
  }
  const performance = await evaluate(
    "({samples:window.inputFixture.samples,commits:window.inputFixture.commits})",
  );
  const latencies = performance.samples
    .map((sample) => sample.elapsed)
    .sort((a, b) => a - b);
  const historyRenders = performance.commits.reduce(
    (total, commit) => total + commit.history,
    0,
  );
  if (before) assert(historyRenders >= 9, "旧实现每次输入重新渲染历史");
  else assert.equal(historyRenders, 0, "输入草稿保持历史渲染稳定");
  const draft = speech + "继续补充细节。第一点第二点第三点完成";
  assert.equal(
    await evaluate("document.querySelector('textarea[aria-label=消息]').value"),
    draft,
  );
  assert.equal(
    await evaluate("localStorage.getItem('cx-draft-input-history')"),
    draft,
  );
  await screenshot("long-input-light");

  if (!before) {
    await page("Page.reload");
    await waitFor(
      `document.querySelector('textarea[aria-label=消息]')?.value === ${JSON.stringify(draft)}`,
    );
    await click('textarea[aria-label="消息"]');
    await evaluate(
      "document.querySelector('textarea[aria-label=消息]').select()",
    );
    const composed = "语音组合输入需要保留完整文字";
    await page("Input.imeSetComposition", {
      text: composed,
      selectionStart: composed.length,
      selectionEnd: composed.length,
    });
    assert.equal(
      await evaluate(
        "document.querySelector('textarea[aria-label=消息]').value",
      ),
      composed,
    );
    await page("Input.insertText", { text: composed });
    await frame();
    assert.equal(
      await evaluate(
        "document.querySelector('textarea[aria-label=消息]').value",
      ),
      composed,
    );
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      windowsVirtualKeyCode: 13,
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
    });
    await waitFor(
      `document.querySelector('textarea[aria-label=消息]').value === ${JSON.stringify(composed + "\n")}`,
    );
    assert.equal(
      await evaluate(
        "window.inputFixture.requests.filter(m=>m.method==='turn/start').length",
      ),
      0,
    );
    await evaluate("window.inputFixture.fail=true");
    await click('[aria-label="发送消息"]');
    await waitFor(
      "document.querySelector('.error-banner')?.textContent.includes('模拟发送失败')",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('textarea[aria-label=消息]').value",
      ),
      composed + "\n",
    );
    await evaluate(
      "window.inputFixture.fail=false;window.inputFixture.delay=500",
    );
    await click('[aria-label="发送消息"]');
    await click('textarea[aria-label="消息"]');
    await page("Input.insertText", { text: "后续草稿" });
    await waitFor("!document.querySelector('[aria-label=发送消息]').disabled");
    assert.equal(
      await evaluate(
        "document.querySelector('textarea[aria-label=消息]').value",
      ),
      composed + "\n后续草稿",
    );
    await screenshot("composition-and-later-draft");
    await evaluate("document.documentElement.dataset.theme='dark'");
    await screenshot("long-input-dark");
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitFor(
      "innerWidth === 390 && document.querySelector('.sidebar').getBoundingClientRect().right <= 1",
    );
    await screenshot("mobile-input");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth > innerWidth"),
      false,
    );
  }
  const result = {
    passed: true,
    before,
    buildInfo,
    fixture:
      "60 轮 Markdown 历史、31 个侧栏对话、一次输入 " +
      speech.length +
      " 字后连续补充",
    historyRenders,
    medianMs: latencies[Math.floor(latencies.length / 2)],
    maxMs: latencies.at(-1),
    ...performance,
  };
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      before,
      output,
      historyRenders,
      medianMs: result.medianMs,
      maxMs: result.maxMs,
    }),
  );
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
  await rm(build, { recursive: true, force: true });
}
