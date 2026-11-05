import { serveDemoSession } from "../helpers/browser-session.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createProjectModels } from "../../server/src/project-models.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const serverPersistence = process.env.PROJECT_MODEL_SERVER === "1";
const build = join(
  root,
  before
    ? serverPersistence
      ? ".cache/project-model-server-before/dist"
      : ".cache/project-model-before/dist"
    : "client/dist",
);
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      before
        ? serverPersistence
          ? ".cache/project-model-server-before/build-info.json"
          : ".cache/project-model-before/build-info.json"
        : "build-info.json",
    ),
    "utf8",
  ),
);
const output = join(
  root,
  serverPersistence
    ? ".cache/project-model-server-browser"
    : ".cache/project-model-browser",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
function fixture(serverPersistence) {
  if (!sessionStorage.getItem("project-model-fixture")) {
    localStorage.clear();
    localStorage.setItem("cx-current", "project-a");
    localStorage.setItem("cx-theme", JSON.stringify("light"));
    localStorage.setItem(
      "cx-projects",
      JSON.stringify(["/demo/Atlas", "/demo/Beacon"]),
    );
    sessionStorage.setItem("project-model-fixture", "1");
  }
  const models = [
    {
      id: "model-a",
      model: "model-a",
      displayName: "模型 A",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map(
        (reasoningEffort) => ({ reasoningEffort }),
      ),
    },
    {
      id: "model-b",
      model: "model-b",
      displayName: "模型 B",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map(
        (reasoningEffort) => ({ reasoningEffort }),
      ),
    },
    {
      id: "model-c",
      model: "model-c",
      displayName: "模型 C",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "high"].map((reasoningEffort) => ({
        reasoningEffort,
      })),
    },
  ];
  const threads = [
    {
      id: "project-a",
      cwd: "/demo/Atlas",
      name: "Atlas 项目的模型设置",
      model: "model-a",
      reasoningEffort: "medium",
      createdAt: 2,
    },
    {
      id: "project-b",
      cwd: "/demo/Beacon",
      name: "Beacon 项目的模型设置",
      model: "model-a",
      reasoningEffort: "medium",
      createdAt: 1,
    },
  ];
  const data = (window.projectFixture = { requests: [], threads });
  if (serverPersistence) {
    threads[0].model = "model-b";
    threads[0].reasoningEffort = "xhigh";
  }
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
                defaultCwd: threads[0].cwd,
                projectModels: serverPersistence,
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
      data.requests.push(m);
      if (
        serverPersistence &&
        ["lan/projectModels/read", "lan/projectModels/set"].includes(m.method)
      ) {
        fetch("/fixture/project-models", {
          method: m.method.endsWith("/set") ? "POST" : "GET",
          ...(m.method.endsWith("/set")
            ? { body: JSON.stringify(m.params) }
            : {}),
        })
          .then((response) => response.json())
          .then((result) =>
            this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
          );
        return;
      }
      const thread =
        threads.find((t) => t.id === m.params?.threadId) || threads[0];
      let result = { data: [] };
      if (m.method === "model/list") result = { data: models };
      if (m.method === "config/read")
        result = {
          config: { model: "model-a", model_reasoning_effort: "medium" },
        };
      if (m.method === "account/read") result = { account: null };
      if (m.method === "thread/list") result = { data: threads };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      if (["thread/read", "thread/resume"].includes(m.method))
        result = {
          thread,
          model: thread.model,
          reasoningEffort: thread.reasoningEffort,
        };
      if (m.method === "thread/items/list")
        result = {
          data: [
            {
              turnId: "old-turn",
              item: {
                id: "answer",
                type: "agentMessage",
                phase: "final_answer",
                text: "可以为每个项目选择模型与思考强度。",
              },
            },
          ],
        };
      if (m.method === "thread/start")
        result = { thread: { ...thread, id: "new-thread", cwd: m.params.cwd } };
      if (m.method === "fs/readDirectory") result = { entries: [] };
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
        0,
      );
    }
  };
}
const preferenceDirectory = await mkdtemp(
  join(tmpdir(), "codex-web-model-browser-"),
);
const projectModels = createProjectModels(preferenceDirectory);
const server = http.createServer(async (req, res) => {
  if (serveDemoSession(req, res)) return;
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    if (path === "/fixture/project-models") {
      let projects;
      if (req.method === "POST") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        projects = await projectModels.set(
          JSON.parse(Buffer.concat(chunks).toString()),
        );
      } else projects = await projectModels.read();
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ projects }));
      return;
    }
    let content = await readFile(
      join(build, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace(
          "<head>",
          `<head><script>(${fixture.toString()})(${serverPersistence})</script>`,
        );
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[extname(path === "/" ? "index.html" : path)] ||
          "application/octet-stream",
      })
      .end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
const profile = await mkdtemp(join(tmpdir(), "codex-web-quota-"));
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
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    const clip = selector
      ? await evaluate(
          `(()=>{const rs=[...document.querySelectorAll(${JSON.stringify(selector)})].map(e=>e.getBoundingClientRect());const x=Math.min(...rs.map(r=>r.x)),y=Math.min(...rs.map(r=>r.y));return {x,y,width:Math.max(...rs.map(r=>r.right))-x,height:Math.max(...rs.map(r=>r.bottom))-y,scale:1}})()`,
        )
      : undefined;
    const { data } = await page("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip } : {}),
    });
    await writeFile(join(output, name + ".png"), Buffer.from(data, "base64"));
  };
  const proof = [];
  await page("Page.enable", {});
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 850,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port,
  });
  await waitFor(
    "document.querySelector('[aria-label=调整思考强度]') && document.querySelector('[aria-label=模型]').options.length === 3 && !document.querySelector('[aria-label=消息]').disabled",
  );
  await waitFor(
    "projectFixture.requests.some(m=>m.method==='thread/resume') && document.querySelector('[aria-label=调整思考强度]')",
  );
  const effort = () =>
    evaluate("document.querySelector('[aria-label=调整思考强度]').title");
  const selectModel = async (value) => {
    await click("[aria-label=模型]");
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    // 原生选择框使用方向键与 Enter，触发浏览器自身的 change 事件。
    await evaluate("document.querySelector('[aria-label=模型]').focus()");
    const current = await evaluate(
      "document.querySelector('[aria-label=模型]').selectedIndex",
    );
    const target = ["model-a", "model-b", "model-c"].indexOf(value);
    for (let i = 0; i < Math.abs(target - current); i++) {
      const key = target > current ? "ArrowDown" : "ArrowUp";
      await page("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        windowsVirtualKeyCode: target > current ? 40 : 38,
      });
      await page("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        windowsVirtualKeyCode: target > current ? 40 : 38,
      });
    }
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await page("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await waitFor(
      "document.querySelector('[aria-label=模型]').value==='" + value + "'",
    );
  };
  const setEffort = async (value) => {
    if (
      !(await evaluate("Boolean(document.querySelector('input[type=range]'))"))
    )
      await click("[aria-label=调整思考强度]");
    await evaluate("document.querySelector('input[type=range]').focus()");
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Home",
      windowsVirtualKeyCode: 36,
    });
    for (let i = 0; i < value; i++)
      await page("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "ArrowRight",
        windowsVirtualKeyCode: 39,
      });
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      windowsVirtualKeyCode: 27,
    });
  };
  if (serverPersistence) {
    assert.equal(await effort(), "思考强度：极高");
    await click('[title="在当前目录新建对话"]');
    await click("[aria-label=调整思考强度]");
    await screenshot(
      "same-project-new-chat",
      ".composer, .reasoning-effort-popover",
    );
    assert.equal(await effort(), before ? "思考强度：中" : "思考强度：极高");
    assert.equal(
      await evaluate("document.querySelector('[aria-label=模型]').value"),
      before ? "model-a" : "model-b",
    );
    proof.push({ stage: "same-project-new-chat", effort: await effort() });
  }
  if (!serverPersistence || !before) {
    await setEffort(3);
    assert.equal(await effort(), "思考强度：极高");
    await selectModel("model-b");
    await click("[aria-label=调整思考强度]");
    await screenshot("desktop-model-switch");
    await screenshot(
      "desktop-model-switch-detail",
      ".composer, .reasoning-effort-popover",
    );
    if (!before) {
      assert.equal(
        await evaluate(
          "document.querySelector('.reasoning-effort-popover').innerText",
        ),
        "思考强度\n极高",
      );
      assert.equal(
        await evaluate(
          "document.querySelectorAll('.reasoning-effort-stops span').length",
        ),
        4,
      );
      const track = await evaluate(
        "(()=>{const r=document.querySelector('input[type=range]').getBoundingClientRect();return {x:r.x,y:r.y+r.height/2,width:r.width}})()",
      );
      await page("Input.dispatchMouseEvent", {
        type: "mousePressed",
        button: "left",
        clickCount: 1,
        x: track.x + track.width - 16,
        y: track.y,
      });
      await page("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        button: "left",
        buttons: 1,
        x: track.x + 16,
        y: track.y,
      });
      await page("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        button: "left",
        clickCount: 1,
        x: track.x + 16,
        y: track.y,
      });
      await waitFor("document.querySelector('output').textContent==='低'");
      for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
        await page("Emulation.setDeviceMetricsOverride", {
          width: Math.round(1200 / zoom),
          height: Math.round(850 / zoom),
          deviceScaleFactor: zoom,
          mobile: false,
        });
        const bounds = await evaluate(
          "(()=>{const r=document.querySelector('.reasoning-effort-popover').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()",
        );
        assert(
          bounds.left >= 0 &&
            bounds.right <= bounds.width &&
            bounds.top >= 0 &&
            bounds.bottom <= bounds.height,
          JSON.stringify({ zoom, ...bounds }),
        );
        await screenshot(
          `slider-zoom-${zoom * 100}`,
          ".composer, .reasoning-effort-popover",
        );
      }
      await page("Emulation.setDeviceMetricsOverride", {
        width: 1200,
        height: 850,
        deviceScaleFactor: 1,
        mobile: false,
      });
      proof.push({
        stage: "slider-style-and-drag",
        labels: "heading-only",
        stops: 4,
        zoom: [80, 100, 125, 150, 200],
      });
      await setEffort(3);
    }
    assert.equal(await effort(), before ? "思考强度：低" : "思考强度：极高");
    proof.push({ stage: "model-switch", effort: await effort() });
    if (!before) {
      await selectModel("model-c");
      assert.equal(await effort(), "思考强度：高");
      await click("[aria-label=调整思考强度]");
      await screenshot("desktop-nearest");
      await click('[title="在 Beacon 中新建对话"]');
      await selectModel("model-a");
      await setEffort(0);
      await click('[title="在 Atlas 中新建对话"]');
      assert.equal(
        await evaluate("document.querySelector('[aria-label=模型]').value"),
        "model-c",
      );
      assert.equal(await effort(), "思考强度：高");
      await page("Page.reload", {});
      await waitFor(
        "document.querySelector('[aria-label=调整思考强度]') && document.querySelector('[aria-label=模型]').options.length === 3 && !document.querySelector('[aria-label=消息]').disabled",
      );
      assert.equal(await effort(), "思考强度：高");
      assert.equal(
        await evaluate("document.querySelector('[aria-label=模型]').value"),
        "model-c",
      );
      await click("[aria-label=消息]");
      await page("Input.insertText", {
        text: "使用项目保存的模型与强度继续任务",
      });
      await click("[aria-label=发送消息]");
      await waitFor("projectFixture.requests.some(m=>m.method==='turn/start')");
      const params = await evaluate(
        "projectFixture.requests.findLast(m=>m.method==='turn/start').params",
      );
      assert.equal(params.model, "model-c");
      assert.equal(params.effort, "high");
      proof.push({
        stage: "refresh-and-send",
        model: params.model,
        effort: params.effort,
      });
      if (serverPersistence) {
        await waitFor(
          "Object.keys(JSON.parse(localStorage.getItem('cx-project-models-pending')||'{}')).length===0",
        );
        const disk = await createProjectModels(preferenceDirectory).read();
        assert.deepEqual(disk["/demo/Atlas"], {
          model: "model-c",
          effort: "high",
        });
        await evaluate("localStorage.clear();sessionStorage.clear()");
        await page("Page.reload", {});
        await waitFor(
          "projectFixture.requests.some(m=>m.method==='thread/resume') && document.querySelector('[aria-label=调整思考强度]')",
        );
        assert.equal(await effort(), "思考强度：高");
        assert.equal(
          await evaluate("document.querySelector('[aria-label=模型]').value"),
          "model-c",
        );
        await click("[aria-label=调整思考强度]");
        await screenshot(
          "cleared-browser-restored",
          ".composer, .reasoning-effort-popover",
        );
        proof.push({
          stage: "clear-browser-and-read-new-store",
          project: disk["/demo/Atlas"],
        });
        const { browserContextId } = await call("Target.createBrowserContext");
        try {
          const { targetId: isolatedTarget } = await call(
            "Target.createTarget",
            {
              url: "http://127.0.0.1:" + server.address().port,
              browserContextId,
            },
          );
          const { sessionId: isolatedSession } = await call(
            "Target.attachToTarget",
            { targetId: isolatedTarget, flatten: true },
          );
          let isolatedSelection;
          for (let attempt = 0; attempt < 150; attempt++) {
            const result = await call(
              "Runtime.evaluate",
              {
                expression:
                  "window.projectFixture?.requests.some(m=>m.method==='thread/resume') && document.querySelector('[aria-label=调整思考强度]') ? {model:document.querySelector('[aria-label=模型]').value,effort:document.querySelector('[aria-label=调整思考强度]').title}:null",
                returnByValue: true,
              },
              isolatedSession,
            );
            isolatedSelection = result.result?.value;
            if (isolatedSelection) break;
            await new Promise((resolve) => setTimeout(resolve, 40));
          }
          assert.deepEqual(isolatedSelection, {
            model: "model-c",
            effort: "思考强度：高",
          });
          proof.push({
            stage: "independent-browser-context",
            selection: isolatedSelection,
          });
        } finally {
          await call("Target.disposeBrowserContext", { browserContextId });
        }
      }
      await evaluate("localStorage.setItem('cx-theme',JSON.stringify('dark'))");
      await page("Page.reload", {});
      await waitFor("document.querySelector('[aria-label=调整思考强度]')");
      await click("[aria-label=调整思考强度]");
      await screenshot("desktop-dark");
      await page("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
      });
      await waitFor(
        "document.querySelector('.sidebar').getBoundingClientRect().right <= 1",
      );
      await screenshot("mobile-dark");
      await evaluate(
        "localStorage.setItem('cx-theme',JSON.stringify('light'))",
      );
      await page("Page.reload", {});
      await waitFor("document.querySelector('[aria-label=调整思考强度]')");
      await click("[aria-label=调整思考强度]");
      await screenshot("mobile-light");
    }
  }
  await writeFile(
    join(output, "proof.json"),
    JSON.stringify({ before, build, buildInfo, proof }, null, 2),
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
  await rm(preferenceDirectory, { recursive: true, force: true });
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}
