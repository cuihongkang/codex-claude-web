import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { browserDriver } from "../helpers/browser-driver.mjs";
import { providerFixture } from "../fixtures/providers.mjs";
import { serveDemoSession } from "../helpers/browser-session.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, ".cache/providers-browser");
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    let body = await readFile(
      join(root, "client/dist", path === "/" ? "index.html" : path),
    );
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>(${providerFixture.toString()})()</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[extname(path === "/" ? "index.html" : path)] ||
          "application/octet-stream",
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const browser = await browserDriver();
const { page, evaluate, waitFor, click } = browser;
const proof = [];
try {
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: "http://127.0.0.1:" + server.address().port,
  });
  await waitFor(
    "document.querySelector('[aria-label=供应商]') && document.querySelector('.ProseMirror')",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[aria-label=模型]').options.length",
    ),
    1,
  );
  await click("[aria-label=供应商]");
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowDown",
    windowsVirtualKeyCode: 40,
  });
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await waitFor(
    "document.querySelector('[aria-label=供应商]').value==='open-model'",
  );
  await click(".ProseMirror");
  await page("Input.insertText", { text: "继续原对话，使用所选供应商。" });
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    windowsVirtualKeyCode: 13,
    modifiers: 2,
  });
  await waitFor("providerRequests.some(m=>m.method==='turn/start')");
  assert.equal(
    await evaluate(
      "providerRequests.find(m=>m.method==='turn/start').params.providerId",
    ),
    "open-model",
  );
  await browser.screenshot(join(output, "desktop-provider-selected.png"));
  await page("Page.reload");
  await waitFor(
    "document.querySelector('[aria-label=供应商]')?.value==='open-model' && document.querySelector('.ProseMirror')",
  );
  proof.push("同名模型隔离、实际键盘切换、消息发送身份与刷新恢复");
  await click('[title="设置"]');
  await waitFor("document.querySelector('.provider-settings')");
  await browser.screenshot(join(output, "settings-light.png"));
  const buttons = await evaluate(
    "[...document.querySelectorAll('.provider-settings button')].map(b=>b.textContent)",
  );
  assert(buttons.includes("编辑"));
  await click(".provider-row button");
  await waitFor("document.querySelector('.provider-form')");
  assert.equal(
    await evaluate("document.querySelector('input[type=password]').value"),
    "",
  );
  await browser.screenshot(join(output, "settings-edit.png"));
  assert.equal(
    await evaluate("document.documentElement.scrollWidth > innerWidth"),
    false,
  );
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await browser.screenshot(join(output, "settings-mobile.png"));
  assert.equal(
    await evaluate("document.documentElement.scrollWidth > innerWidth"),
    false,
  );
  proof.push("凭据掩码编辑、桌面与手机表单排版");
  await click(".provider-actions button[type=button]:nth-last-child(2)");
  await click(".provider-settings > button");
  await waitFor("document.querySelector('.provider-form')");
  async function fill(selector, text) {
    await click(selector);
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await page("Input.insertText", { text });
  }
  await fill(".provider-form > label:first-child input", "第三方供应商 B");
  await fill(
    ".provider-form input[type=url]",
    "https://api.vendor-b.example/v1",
  );
  await fill(".provider-form input[type=password]", "fixture-vendor-b-key");
  await fill(".provider-form fieldset > label input", "shared-model");
  await click(".provider-actions button[type=submit]");
  await waitFor(
    "document.querySelector('.provider-settings').textContent.includes('第三方供应商 B') && !document.querySelector('.provider-form')",
  );
  assert.equal(
    await evaluate(
      "providerRequests.filter(m=>m.method==='lan/providers/set').at(-1).params.baseUrl",
    ),
    "https://api.vendor-b.example/v1",
  );
  await click(".theme-options button:nth-child(2)");
  await browser.screenshot(join(output, "settings-dark-mobile.png"));
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await browser.screenshot(join(output, "settings-dark.png"));
  proof.push("用户自行添加不同供应商、独立接口与凭据、同名模型、深色主题");
  await click(".provider-row button");
  await waitFor("document.querySelector('.provider-form')");
  await click(".provider-actions button:first-child");
  await waitFor(
    "document.querySelector('.provider-actions button:first-child').textContent.includes('确认删除')",
  );
  await click(".provider-actions button:first-child");
  await waitFor(
    "!document.querySelector('.provider-form') && !document.querySelector('.provider-settings').textContent.includes('第三方供应商 A')",
  );
  await click('[title="关闭窗口"]');
  await waitFor(
    "document.querySelector('[aria-label=供应商]') && document.querySelector('[aria-label=发送消息]').disabled",
  );
  await browser.screenshot(join(output, "removed-provider.png"));
  await click("[aria-label=供应商]");
  for (let i = 0; i < 2; i++)
    await page("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await waitFor(
    "document.querySelector('[aria-label=供应商]').value==='added'",
  );
  await click(".ProseMirror");
  await page("Input.insertText", { text: "选择另一个供应商继续。" });
  await page("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    windowsVirtualKeyCode: 13,
    modifiers: 2,
  });
  await waitFor(
    "providerRequests.filter(m=>m.method==='turn/start').at(-1)?.params.providerId==='added'",
  );
  proof.push("删除确认、保留对话、明确选择其他供应商后继续发送");
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ status: "passed", proof }, null, 2),
  );
  console.log("PASS " + proof.join("；"));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
