import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { providerSession } from "../integration/provider-session.mjs";
import { browserDriver } from "../helpers/browser-driver.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const output = join(
  root,
  ".cache/provider-switch-browser",
  before ? "before" : "after",
);
// 截图使用演示账户资料；模型请求、历史、供应商选择与轮次事件继续走真实桥接。
function demoAccount() {
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    send(data) {
      const message = JSON.parse(data);
      if (message.method === "turn/start")
        window.__providerBrowserRequestId = message.id;
      return super.send(data);
    }
    set onmessage(callback) {
      super.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (
          message.id === window.__providerBrowserRequestId &&
          message.result?.turn
        )
          window.__providerBrowserTurnId = message.result.turn.id;
        if (message.result?.account)
          message.result.account = {
            type: "chatgpt",
            email: "demo@example.com",
            planType: "plus",
          };
        if (message.result?.rateLimits) {
          message.result.rateLimits = null;
          message.result.rateLimitsByLimitId = null;
        }
        callback(
          new MessageEvent("message", { data: JSON.stringify(message) }),
        );
      };
    }
  };
}
await mkdir(output, { recursive: true });
const upstream = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const marker = body.match(/SWITCH-[a-z0-9]+/)?.[0];
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of [
    { reasoning_content: "Checking the marker before switching providers." },
    { content: marker || "已记住验证标记。" },
  ])
    response.write(
      "data: " +
        JSON.stringify({ id: "chat", choices: [{ index: 0, delta }] }) +
        "\n\n",
    );
  response.end(
    'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  );
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
let session, browser;
try {
  const application = before
    ? (
        await import(
          pathToFileURL(
            join(
              root,
              ".cache/provider-switch-before-source/server/src/application.mjs",
            ),
          )
        )
      ).createWebApplication
    : undefined;
  session = await providerSession(() => {}, application);
  await session.call("lan/providers/set", {
    id: "reasoning",
    name: "第三方推理模型",
    protocol: "chat",
    baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
    models: [
      { id: "reasoning-model", contextWindow: 196608, maxOutputTokens: 2048 },
    ],
  });
  const local = { providerId: "reasoning", model: "reasoning-model" };
  const { thread } = await session.call("thread/start", {
    ...local,
    cwd: session.home,
    baseInstructions: "Answer briefly. Do not use tools.",
    config: { "features.shell_tool": false },
  });
  await session.call("thread/name/set", {
    threadId: thread.id,
    name: "携带思考历史直接切换供应商",
  });
  const marker = "SWITCH-" + Math.random().toString(36).slice(2, 10);
  await session.turn(thread.id, `请记住验证标记 ${marker}。`, local);
  browser = await browserDriver();
  const { page, waitFor, click, evaluate } = browser;
  await page("Security.setIgnoreCertificateErrors", { ignore: true });
  await page("Network.enable");
  const equals = session.cookie.indexOf("=");
  await page("Network.setCookie", {
    name: session.cookie.slice(0, equals),
    value: session.cookie.slice(equals + 1),
    url: session.origin,
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  });
  await page("Page.addScriptToEvaluateOnNewDocument", {
    source: `localStorage.setItem('cx-current', ${JSON.stringify(thread.id)});(${demoAccount.toString()})();`,
  });
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", { url: session.origin });
  await waitFor(
    "document.querySelector('.ProseMirror') && document.querySelector('[aria-label=供应商]')?.value==='reasoning'",
  );
  const key = async (key) => {
    await page("Input.dispatchKeyEvent", { type: "keyDown", key });
    await page("Input.dispatchKeyEvent", { type: "keyUp", key });
  };
  await click('[aria-label="供应商"]');
  await key("Home");
  await key("Enter");
  await waitFor(
    "document.querySelector('[aria-label=供应商]')?.value==='codex'",
  );
  const model = process.env.GPT_MODEL || "gpt-6.1-terra";
  const modelIndex = await evaluate(
    `Array.from(document.querySelector('[aria-label=模型]').options).findIndex(o=>o.value===${JSON.stringify(model)})`,
  );
  assert.ok(modelIndex >= 0, "GPT 型号存在于实际后端列表");
  await click('[aria-label="模型"]');
  await key("Home");
  for (let i = 0; i < modelIndex; i++) await key("ArrowDown");
  await key("Enter");
  await waitFor(
    `document.querySelector('[aria-label=模型]')?.value===${JSON.stringify(model)}`,
  );
  await click(".ProseMirror");
  await page("Input.insertText", { text: "请只回复刚才记住的验证标记。" });
  const mark = session.events.length;
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    windowsVirtualKeyCode: 13,
    modifiers: 2,
  });
  await waitFor("typeof window.__providerBrowserTurnId === 'string'", 180000);
  const actualTurnId = await evaluate("window.__providerBrowserTurnId");
  const ended = await session.event(
    "turn/completed",
    (p) => p.threadId === thread.id && p.turn.id === actualTurnId,
    mark,
  );
  if (before) {
    assert.equal(ended.turn.status, "failed");
    assert.match(ended.turn.error.message, /array_above_max_length/);
    await waitFor("document.body.innerText.includes('array_above_max_length')");
  } else {
    assert.equal(
      ended.turn.status,
      "completed",
      JSON.stringify(ended.turn.error),
    );
    await waitFor(
      `Array.from(document.querySelectorAll('.assistant-message')).at(-1)?.innerText.includes(${JSON.stringify(marker)}) && document.querySelector('.ProseMirror')?.innerText.trim()===''`,
    );
    assert.equal(
      await evaluate(
        "document.body.innerText.includes('array_above_max_length')",
      ),
      false,
    );
  }
  await browser.screenshot(join(output, "desktop.png"));
  await page("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 932,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await key("Escape");
  await waitFor(
    "document.querySelector('.sidebar').getBoundingClientRect().right<=1",
  );
  await browser.screenshot(join(output, "mobile.png"));
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        expected: before ? "failed" : "completed",
        actual: ended.turn.status,
        build: JSON.parse(
          await readFile(join(root, "build-info.json"), "utf8"),
        ),
        source: before ? "HEAD bridge snapshot" : "working tree bridge",
        data: "isolated Codex backend, simulated reasoning provider and account display, real GPT, temporary session",
        interaction:
          "mouse and keyboard provider/model selection, typing, Ctrl+Enter",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      status: "passed",
      before,
      turnStatus: ended.turn.status,
      output,
    }),
  );
} finally {
  await browser?.close();
  await session?.close();
  await new Promise((resolve) => upstream.close(resolve));
}
