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
const queued = process.env.BROWSER_QUEUED_ENCRYPTED === "1";
const encrypted = queued || process.env.BROWSER_ENCRYPTED === "1";
const ciphertextBefore = process.env.BROWSER_CIPHERTEXT_BEFORE === "1";
const build = before
  ? join(root, ".cache/subagent-messages-before/dist")
  : join(root, "client/dist");
const output = join(
  root,
  queued
    ? ".cache/subagent-queued-browser"
    : encrypted
      ? ".cache/subagent-encryption-browser"
      : ".cache/subagent-messages-browser",
  before || ciphertextBefore ? "before" : "after",
);
await mkdir(output, { recursive: true });
const buildInfo = JSON.parse(
  await readFile(
    join(
      root,
      before
        ? ".cache/subagent-messages-before/build-info.json"
        : "build-info.json",
    ),
    "utf8",
  ),
);

function fixture(initialMessages) {
  localStorage.clear();
  const thread = {
    id: "agent-parent-fixture",
    name: "检查项目接口",
    cwd: "/fixture/project",
    createdAt: 1,
  };
  const activity = {
    id: "spawn",
    type: "subAgentActivity",
    kind: "started",
    agentThreadId: "agent-child-fixture",
    agentPath: "/root/review_contract",
  };
  const reply = {
    id: "answer",
    type: "agentMessage",
    phase: "final_answer",
    text: "已完成接口检查，参数与返回值一致。",
  };
  const incoming = {
    id: "parent-input-spawn",
    type: "userMessage",
    authorLabel: "主代理",
    turnId: "child-turn",
    beforeItemId: "answer",
    content: [
      {
        type: "text",
        text: "请检查控制与观测接口，列出一致的部分和需要调整的参数。",
      },
    ],
  };
  localStorage.setItem("cx-current", thread.id);
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  window.agentFixture = {
    requests: [],
    messages: initialMessages || [incoming],
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      window.agentFixture.socket = this;
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
      window.agentFixture.requests.push(m);
      let result = {};
      const child = m.params?.threadId === "agent-child-fixture";
      if (m.method === "thread/list") result = { data: [thread] };
      if (["thread/read", "thread/resume"].includes(m.method))
        result = {
          thread: child
            ? {
                id: "agent-child-fixture",
                cwd: thread.cwd,
                model: "fixture-model",
              }
            : thread,
          cwd: thread.cwd,
        };
      if (m.method === "thread/turns/list")
        result = {
          data: [
            { id: child ? "child-turn" : "parent-turn", status: "completed" },
          ],
        };
      if (m.method === "thread/items/list")
        result = {
          data: (child
            ? [reply]
            : [
                {
                  id: "parent-user",
                  type: "userMessage",
                  content: [
                    { type: "text", text: "请安排子代理检查项目接口。" },
                  ],
                },
                activity,
              ]
          ).map((item) => ({
            turnId: child ? "child-turn" : "parent-turn",
            item,
          })),
        };
      if (m.method === "lan/agents/messages")
        result = { messages: window.agentFixture.messages };
      if (["model/list", "skills/list"].includes(m.method))
        result = { data: [] };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      setTimeout(
        () => this.onmessage({ data: JSON.stringify({ id: m.id, result }) }),
        0,
      );
    }
  };
}

const ciphertext = "gAAAAA" + "isolated-encrypted-message_".repeat(40);
const packet = Buffer.alloc(57 + 16 * 64, 7);
packet[0] = 0x80;
packet.writeBigUInt64BE(1793544144n, 1);
const queuedCiphertext = packet.toString("base64url");
const messageCount = queued ? 2 : 1;
let initialMessages;
if (encrypted) {
  const directory = await mkdtemp(join(tmpdir(), "browser-agent-encryption-"));
  const parent = { id: "parent", path: join(directory, "parent.jsonl") };
  const child = {
    id: "child",
    parentThreadId: parent.id,
    path: join(directory, "child.jsonl"),
    source: {
      subAgent: { thread_spawn: { agent_path: "/root/review_contract" } },
    },
  };
  try {
    await writeFile(
      parent.path,
      [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            namespace: "collaboration",
            name: "spawn_agent",
            call_id: "spawn",
            arguments: JSON.stringify({ message: ciphertext }),
          },
        },
        {
          type: "event_msg",
          payload: {
            item: {
              type: "SubAgentActivity",
              id: "spawn",
              kind: "started",
              agent_thread_id: child.id,
            },
          },
        },
        ...(queued
          ? [
              {
                type: "response_item",
                payload: {
                  type: "function_call",
                  namespace: "collaboration",
                  name: "send_message",
                  call_id: "queued",
                  arguments: JSON.stringify({ message: queuedCiphertext }),
                },
              },
              {
                type: "event_msg",
                payload: {
                  item: {
                    type: "SubAgentActivity",
                    id: "queued",
                    kind: "interacted",
                    agent_thread_id: child.id,
                  },
                },
              },
            ]
          : []),
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    await writeFile(
      child.path,
      [
        {
          type: "response_item",
          payload: {
            type: "agent_message",
            id: "incoming",
            author: "/root",
            recipient: "/root/review_contract",
            content: [
              {
                type: "input_text",
                text: "Message Type: NEW_TASK\nPayload:\n",
              },
              { type: "encrypted_content", encrypted_content: ciphertext },
            ],
            internal_chat_message_metadata_passthrough: {
              turn_id: "child-turn",
            },
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "item_completed",
            turn_id: "child-turn",
            item: { id: "answer" },
          },
        },
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    const { readAgentMessages } = await import(
      ciphertextBefore
        ? queued
          ? "../../.cache/subagent-queued-before/agent-messages.mjs"
          : "../../.cache/subagent-encryption-before/agent-messages.mjs"
        : "../../server/src/agent-messages.mjs"
    );
    ({ messages: initialMessages } = await readAgentMessages(
      async (_, { threadId }) => ({
        thread: threadId === child.id ? child : parent,
      }),
      child.id,
    ));
    assert.equal(
      initialMessages[0].content[0].text,
      ciphertextBefore && !queued ? ciphertext : "消息内容已加密",
    );
    if (queued) {
      assert.equal(
        initialMessages[1].content[0].text,
        ciphertextBefore ? queuedCiphertext : "消息内容已加密",
      );
      assert.equal(initialMessages[1].turnId, undefined);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
          `<head><script>(${fixture.toString()})(${JSON.stringify(initialMessages)})</script>`,
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
const profile = await mkdtemp(join(tmpdir(), "claudex-web-agents-"));
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
          `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:Math.min(r.height,360),scale:1}})()`,
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
  await waitFor("document.querySelector('.context-tools')");
  await click('.context-tools button[aria-label="展开对话详情"]');
  await click(".context-agent-list button");
  await waitFor(
    "document.querySelector('.subagent-history')?.textContent.includes('已完成接口检查')",
  );
  await evaluate("document.querySelector('.subagent-history').scrollTop=0");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.subagent-history .user-message').length",
    ),
    before ? 0 : messageCount,
  );
  assert(
    !(
      await evaluate("document.querySelector('.subagent-meta').textContent")
    ).includes("只读"),
  );
  assert(
    !(
      await evaluate("document.querySelector('.subagent-meta').textContent")
    ).includes("/root/"),
  );
  await screenshot("desktop-light");
  await screenshot("detail-light", ".context-workspace");
  if (encrypted)
    assert.equal(
      await evaluate(
        `document.querySelector('.subagent-history').textContent.includes(${JSON.stringify(queued ? queuedCiphertext : ciphertext)})`,
      ),
      ciphertextBefore,
    );
  if (!before && !ciphertextBefore) {
    assert(
      await evaluate(
        `document.querySelector('.subagent-history').textContent.indexOf('${encrypted ? "消息内容已加密" : "请检查控制"}')>=0 && document.querySelector('.subagent-history').textContent.indexOf('${encrypted ? "消息内容已加密" : "请检查控制"}')<document.querySelector('.subagent-history').textContent.indexOf('已完成接口检查')`,
      ),
    );
    await evaluate(
      `(()=>{const f=window.agentFixture;f.messages.push({id:'parent-input-followup',type:'userMessage',authorLabel:'主代理',content:[{type:'text',text:'请继续核对异常处理，并给出结论。'}]});f.socket.onmessage({data:JSON.stringify({method:'item/completed',params:{threadId:'agent-parent-fixture',turnId:'parent-turn',item:{id:'followup',type:'subAgentActivity',kind:'interacted',agentThreadId:'agent-child-fixture',agentPath:'/root/review_contract'}}})})})()`,
    );
    await waitFor(
      `document.querySelectorAll('.subagent-history .user-message').length===${messageCount + 1}`,
    );
    await click('button[aria-label="刷新子代理对话"]');
    await waitFor(
      `document.querySelectorAll('.subagent-history .user-message').length===${messageCount + 1}`,
    );
    if (queued)
      assert.deepEqual(
        await evaluate(
          "[...document.querySelectorAll('.subagent-history .user-message .user-text')].slice(0,2).map(e=>e.textContent.trim())",
        ),
        ["消息内容已加密", "消息内容已加密"],
      );
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.subagent-history button[title=\"编辑上一条消息\"]').length",
      ),
      0,
    );
    await screenshot("followup");
    await evaluate(
      "document.documentElement.dataset.theme='dark';document.querySelector('.subagent-history').scrollTop=0",
    );
    await screenshot("desktop-dark");
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await waitFor(
      "document.querySelector('.sidebar').getBoundingClientRect().right<=0",
    );
    await waitFor(
      "document.querySelector('.context-workspace').getBoundingClientRect().left>=0",
    );
    await screenshot("mobile-dark");
    await evaluate("document.documentElement.dataset.theme='light'");
    await screenshot("mobile-light");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth>innerWidth"),
      false,
    );
    assert(
      !(await evaluate(
        "window.agentFixture.requests.some(r=>['turn/start','turn/steer'].includes(r.method))",
      )),
    );
  }

  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        encrypted,
        queued,
        ciphertextBefore,
        buildInfo,
        fixture: "tests/browser/subagent-messages.mjs",
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
