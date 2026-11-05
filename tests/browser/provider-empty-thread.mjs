import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { bridge } from "../helpers/bridge.mjs";
import { browserDriver } from "../helpers/browser-driver.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const output =
  process.env.BROWSER_OUTPUT_DIR ||
  join(root, ".cache/provider-empty-thread", before ? "before" : "after");
process.env.DEFAULT_CWD = "/demo/Workspace";
await mkdir(output, { recursive: true });

test("浏览器新对话首次发送经过真实桥接及历史兼容检查", async (t) => {
  let thread;
  let materialized = false;
  const model = {
    id: "native-model",
    model: "native-model",
    displayName: "演示模型",
    isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: "high" }],
    defaultReasoningEffort: "high",
  };
  const app = await bridge(t, (request, socket) => {
    let result;
    const { method, params } = request;
    if (method === "model/list") result = { data: [model] };
    if (method === "account/read") result = { account: null };
    if (["thread/list", "skills/list"].includes(method)) result = { data: [] };
    if (method === "thread/start") {
      thread = {
        id: "empty-thread-fixture",
        cwd: "/demo/Workspace",
        modelProvider: params.modelProvider,
        model: params.model,
        createdAt: 1,
        status: { type: "idle" },
      };
      result = { thread };
    }
    if (["thread/read", "thread/resume"].includes(method))
      result = {
        thread: { ...thread, name: "首轮发送验证" },
        model: model.model,
      };
    if (method === "thread/turns/list") {
      if (!materialized) {
        socket.send(
          JSON.stringify({
            id: request.id,
            error: {
              code: -32600,
              message: `thread ${params.threadId} is not materialized yet; thread/turns/list is unavailable before first user message`,
            },
          }),
        );
        return true;
      }
      result = { data: [], nextCursor: null };
    }
    if (method === "turn/start") {
      materialized = true;
      result = { turn: { id: "first-turn", status: "inProgress" } };
    }
    if (result === undefined) return false;
    socket.send(JSON.stringify({ id: request.id, result }));
    return true;
  });
  const browser = await browserDriver();
  t.after(() => browser.close());
  const { page, evaluate, click, waitFor } = browser;
  await page("Security.setIgnoreCertificateErrors", { ignore: true });
  const [name, value] = app.cookie.split("=");
  await page("Network.setCookie", {
    name,
    value,
    url: app.origin,
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  });
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", { url: app.origin });
  await waitFor(
    "document.querySelector('.ProseMirror') && document.querySelector('[aria-label=模型]')",
  );
  await click(".ProseMirror");
  await page("Input.insertText", { text: "检查新对话首次发送。" });
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    windowsVirtualKeyCode: 13,
    modifiers: 2,
  });
  if (before) {
    await waitFor(
      "document.body.innerText.includes('is not materialized yet')",
    );
    assert.equal(
      app.requests.filter((r) => r.method === "turn/start").length,
      0,
    );
  } else {
    await waitFor(
      "document.querySelector('.user-message') && localStorage.getItem('cx-draft-empty-thread-fixture') === null",
    );
    assert.equal(
      app.requests.filter((r) => r.method === "turn/start").length,
      1,
    );
    assert.equal(
      await evaluate(
        "document.body.innerText.includes('is not materialized yet')",
      ),
      false,
    );
    assert.equal(
      await evaluate("localStorage.getItem('cx-draft-empty-thread-fixture')"),
      null,
    );
  }
  await browser.screenshot(join(output, "desktop.png"));
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitFor(
    "document.querySelector('.sidebar').getBoundingClientRect().right <= 1",
  );
  await browser.screenshot(join(output, "mobile.png"));
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        before,
        build: JSON.parse(
          await readFile(join(root, "build-info.json"), "utf8"),
        ),
        requests: app.requests.map(({ method, params }) => ({
          method,
          threadId: params?.threadId,
        })),
        body: await evaluate("document.body.innerText"),
      },
      null,
      2,
    ) + "\n",
  );
});
