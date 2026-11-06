import { serveDemoSession } from "../helpers/browser-session.mjs";
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
const build = join(
  root,
  before ? ".cache/background-recovery-before/dist" : "client/dist",
);
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      before
        ? ".cache/background-recovery-before/build-info.json"
        : "build-info.json",
    ),
    "utf8",
  ),
);
const output = join(
  root,
  ".cache/background-recovery-browser",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
function fixture() {
  localStorage.clear();
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  const thread = {
    id: "background-demo",
    name: "核对后台恢复体验",
    cwd: "/demo/project",
    createdAt: 1,
  };
  const turnId = "demo-running-turn";
  const user = {
    id: "demo-user",
    type: "userMessage",
    content: [{ type: "text", text: "请持续检查项目，并报告当前进度。" }],
  };
  const command = {
    id: "demo-command",
    type: "commandExecution",
    command: "npm test",
    status: "inProgress",
    aggregatedOutput: "正在检查第 1 组用例。",
  };
  const answer = {
    id: "demo-answer",
    type: "agentMessage",
    phase: "final_answer",
    text: "已完成基础检查，正在继续处理后续内容。",
  };
  const earlier = Array.from({ length: 12 }, (_, index) => [
    {
      id: "earlier-user-" + index,
      type: "userMessage",
      content: [
        {
          type: "text",
          text: `第 ${index + 1} 项：核对页面恢复时的消息与阅读位置。`,
        },
      ],
    },
    {
      id: "earlier-answer-" + index,
      type: "agentMessage",
      phase: "final_answer",
      text: "已记录这项检查。继续保留历史记录，方便向上翻阅和核对前面的结果。",
    },
  ]).flat();
  localStorage.setItem("cx-current", thread.id);
  const data = (window.recoveryFixture = {
    requests: [],
    sockets: [],
    hold: false,
    pending: [],
    missing: false,
    snapshot() {
      return {
        ready: true,
        defaultCwd: thread.cwd,
        questions: [],
        activeTurns: { [thread.id]: turnId },
        terminals: {},
      };
    },
    emit(method, params) {
      this.socket.onmessage({ data: JSON.stringify({ method, params }) });
    },
    release() {
      this.hold = false;
      for (const respond of this.pending.splice(0)) respond();
    },
    disconnect() {
      this.hold = true;
      this.missing = true;
      this.socket.readyState = 3;
      this.socket.onclose();
    },
    stream(text) {
      this.emit("item/agentMessage/delta", {
        threadId: thread.id,
        turnId,
        itemId: answer.id,
        delta: text,
      });
    },
  });
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      data.socket = this;
      data.sockets.push(this);
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              method: "lan/state",
              params: data.snapshot(),
            }),
          }),
        0,
      );
    }
    send(raw) {
      const request = JSON.parse(raw);
      data.requests.push(request);
      const { method, params } = request;
      let result = {};
      if (method === "model/list")
        result = {
          data: [
            {
              id: "demo-model",
              model: "demo-model",
              displayName: "测试模型",
              isDefault: true,
            },
          ],
        };
      if (method === "config/read") result = { config: {} };
      if (method === "account/read") result = { account: null };
      if (method === "thread/list")
        result = { data: [thread], nextCursor: null };
      if (method === "lan/projectless/read") result = { directories: {} };
      if (method === "thread/read" || method === "thread/resume")
        result = { thread };
      if (method === "thread/turns/list")
        result = {
          data: [
            {
              id: turnId,
              status: "inProgress",
              startedAt: Date.now() / 1000 - 40,
            },
          ],
          nextCursor: null,
        };
      if (method === "thread/items/list")
        result = {
          data: [
            ...earlier,
            user,
            command,
            {
              ...answer,
              text: data.missing
                ? "断线期间完成的检查已补齐，正在继续处理后续内容。"
                : answer.text,
            },
          ]
            .reverse()
            .map((item) => ({
              item,
              turnId: item.id.startsWith("earlier-")
                ? "earlier-turn-" + item.id.split("-").at(-1)
                : turnId,
            })),
          nextCursor: null,
        };
      if (method === "skills/list") result = { data: [] };
      if (method === "fs/readDirectory") result = { entries: [] };
      const respond = () =>
        this.onmessage({ data: JSON.stringify({ id: request.id, result }) });
      if (
        data.hold &&
        (method === "thread/items/list" || method === "thread/resume")
      )
        data.pending.push(respond);
      else setTimeout(respond, 0);
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
        .replace("<head>", `<head><script>(${fixture.toString()})()</script>`);
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
const profile = await mkdtemp(join(tmpdir(), "claudex-web-quota-"));
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
          `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`,
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
  const { targetId: backgroundId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  for (const [name, width, height, mobile] of [
    ["desktop", 1440, 900, false],
    ["mobile", 390, 844, true],
  ]) {
    await page("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await page("Page.navigate", {
      url: `http://127.0.0.1:${server.address().port}`,
    });
    await call("Target.activateTarget", { targetId });
    await waitFor(
      "document.querySelector('.assistant-message') && document.querySelector('[aria-label=消息]')",
    );
    await click(".process-history > summary");
    await waitFor("document.querySelector('.process-history').open");
    await click('[aria-label="消息"]');
    await page("Input.insertText", { text: "恢复前后都要保留的草稿" });
    await evaluate(
      `window.originalMessage=[...document.querySelectorAll('.assistant-message')].at(-1); window.originalInput=document.querySelector('[aria-label=消息]'); window.originalProcess=document.querySelector('.process-history'); window.mark=performance.timeOrigin; window.removed=[]; window.observer=new MutationObserver(records=>{for(const r of records) for(const n of r.removedNodes) if(n===originalMessage || n.contains?.(originalMessage) || n===originalInput || n.contains?.(originalInput)) removed.push(n.nodeName)}); observer.observe(document.querySelector('main')||document.body,{childList:true,subtree:true});`,
    );
    await screenshot(name + "-initial");
    await call("Target.activateTarget", { targetId: backgroundId });
    await waitFor("document.visibilityState==='hidden'");
    await evaluate("recoveryFixture.stream(' 后台仍在更新。')");
    await call("Target.activateTarget", { targetId });
    await waitFor("document.visibilityState==='visible'");
    await evaluate("window.dispatchEvent(new Event('focus'))");
    await new Promise((resolve) => setTimeout(resolve, 1800));
    assert(
      await evaluate(
        "originalMessage===[...document.querySelectorAll('.assistant-message')].at(-1) && removed.length===0",
      ),
    );
    assert.equal(await evaluate("recoveryFixture.sockets.length"), 1);
    await screenshot(name + "-healthy-foreground");
    await call("Target.activateTarget", { targetId: backgroundId });
    await waitFor("document.visibilityState==='hidden'");
    await evaluate("recoveryFixture.disconnect()");
    await call("Target.activateTarget", { targetId });
    await waitFor("document.visibilityState==='visible'");
    await screenshot(name + "-returned");
    await waitFor("recoveryFixture.pending.length>0");
    await screenshot(name + "-synchronizing");
    const during = await evaluate(
      "({message:[...document.querySelectorAll('.assistant-message')].at(-1)?.textContent, input:originalInput===document.querySelector('[aria-label=消息]'), process:originalProcess===document.querySelector('.process-history'), expanded:document.querySelector('.process-history')?.open, loading:!!document.querySelector('.message-column > .loading'), timeOrigin:performance.timeOrigin===mark, removed:[...removed]})",
    );
    if (before) {
      assert(during.loading);
      assert(!during.message);
    } else {
      assert(during.message?.includes("后台仍在更新。"));
      assert(
        during.input &&
          during.process &&
          during.expanded &&
          !during.loading &&
          during.timeOrigin,
      );
      assert.deepEqual(during.removed, []);
      await click('[aria-label="消息"]');
      await page("Input.insertText", { text: "，同步时继续编辑" });
      assert(
        await evaluate(
          "document.querySelector('[aria-label=发送消息]').disabled",
        ),
      );
    }
    await evaluate("recoveryFixture.release()");
    await waitFor(
      "document.querySelector('[aria-label=消息]') && recoveryFixture.pending.length===0",
    );
    if (!before)
      await waitFor(
        "[...document.querySelectorAll('.assistant-message')].at(-1)?.textContent.includes('断线期间完成的检查已补齐')",
      );
    await screenshot(name + "-recovered");
    const after = await evaluate(
      "({message:[...document.querySelectorAll('.assistant-message')].at(-1)?.textContent, draft:(()=>{const input=document.querySelector('[aria-label=消息]');return input.isContentEditable?input.innerText.trim():input.value})(), input:originalInput===document.querySelector('[aria-label=消息]'), process:originalProcess===document.querySelector('.process-history'), expanded:document.querySelector('.process-history')?.open, removed:[...removed], sockets:recoveryFixture.sockets.length})",
    );
    if (!before) {
      assert(after.input && after.process && after.expanded);
      assert.equal(after.draft, "恢复前后都要保留的草稿，同步时继续编辑");
      assert.deepEqual(after.removed, []);
      const reading = await evaluate(
        "(()=>{const e=document.querySelector('.conversation'); e.scrollTop=180; e.dispatchEvent(new Event('scroll')); return e.scrollTop;})()",
      );
      assert(reading > 0);
      await evaluate("recoveryFixture.disconnect()");
      await waitFor("recoveryFixture.pending.length===2");
      assert.equal(
        await evaluate("document.querySelector('.conversation').scrollTop"),
        reading,
      );
      await evaluate("recoveryFixture.release()");
      await waitFor(
        "!document.querySelector('[aria-label=发送消息]').disabled",
      );
      assert.equal(
        await evaluate("document.querySelector('.conversation').scrollTop"),
        reading,
      );
      await screenshot(name + "-reading-preserved");
      after.readingPosition = reading;
    }
    proof.push({ name, during, after });
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
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}
