import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { browserDriver } from "../helpers/browser-driver.mjs";
import { providerFixture } from "../fixtures/providers.mjs";
import { serveDemoSession } from "../helpers/browser-session.mjs";

if (!process.env.PROVIDER_EVENTS)
  throw new Error("通过 PROVIDER_EVENTS 指定原生 Codex 推理事件");
const events = JSON.parse(await readFile(process.env.PROVIDER_EVENTS, "utf8"));
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, ".cache/reasoning-browser");
await mkdir(output, { recursive: true });
const translations = [];
function historyFixture() {
  const Base = window.WebSocket;
  window.WebSocket = class extends Base {
    send(raw) {
      const m = JSON.parse(raw);
      if (m.method !== "thread/items/list") return super.send(raw);
      const records = JSON.parse(
        localStorage.getItem("reasoning-history") || "[]",
      );
      setTimeout(
        () =>
          this.onmessage?.({
            data: JSON.stringify({
              id: m.id,
              result: {
                data:
                  m.params.sortDirection === "asc"
                    ? records
                    : records.toReversed(),
                nextCursor: null,
              },
            }),
          }),
        5,
      );
    }
  };
}
const server = createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/api/translate") {
    let raw = "";
    for await (const bytes of request) raw += bytes;
    const { texts } = JSON.parse(raw);
    translations.push(texts);
    response.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        translations: texts.map((t) =>
          t
            .replaceAll("Inspecting the calculation.", "检查计算过程。")
            .replaceAll("Checking the final result.", "核对最终结果。"),
        ),
      }),
    );
    return;
  }
  try {
    let body = await readFile(
      join(root, "client/dist", path === "/" ? "index.html" : path),
    );
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>(${providerFixture.toString()})();(${historyFixture.toString()})();</script>`,
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
try {
  const { page, evaluate, waitFor, click } = browser;
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor("document.querySelector('.ProseMirror')");
  const reasoningIds = new Set(
    events
      .filter(
        (e) =>
          e.method === "item/started" && e.params.item?.type === "reasoning",
      )
      .map((e) => e.params.item.id),
  );
  const initial = events.filter(
    (e) =>
      e.method === "turn/started" ||
      (e.method === "item/started" && reasoningIds.has(e.params.item.id)) ||
      e.method === "item/reasoning/textDelta",
  );
  for (const event of initial)
    await evaluate(
      `providerSocket.emit(${JSON.stringify(event.method)},${JSON.stringify({ ...event.params, threadId: "provider-demo" })})`,
    );
  await waitFor(
    "document.querySelector('.reasoning-text')?.textContent.includes('核对最终结果。')",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.reasoning-text > summary').textContent.trim()",
    ),
    "思考过程",
  );
  await browser.screenshot(join(output, "streaming.png"));
  const records = events
    .filter((e) => e.method === "item/completed")
    .map((e) => ({ item: e.params.item, turnId: e.params.turnId }));
  await evaluate(
    `localStorage.setItem('reasoning-history',${JSON.stringify(JSON.stringify(records))})`,
  );
  for (const event of events.filter(
    (e) => e.method === "item/completed" || e.method === "turn/completed",
  ))
    await evaluate(
      `providerSocket.emit(${JSON.stringify(event.method)},${JSON.stringify({ ...event.params, threadId: "provider-demo" })})`,
    );
  await click(".process-history > summary");
  await waitFor(
    "document.querySelector('.reasoning-text')?.textContent.includes('核对最终结果。')",
  );
  const translatedCount = translations.length;
  await page("Page.reload");
  await waitFor("document.querySelector('.process-history')");
  await click(".process-history > summary");
  await waitFor(
    "document.querySelector('.reasoning-text')?.textContent.includes('核对最终结果。')",
  );
  assert.equal(translations.length, translatedCount, "刷新后复用会话译文");
  assert.equal(
    await evaluate(
      "document.querySelector('.assistant-message')?.closest('.process-history') === null",
    ),
    true,
    "最终回答保持在工作过程外",
  );
  await browser.screenshot(join(output, "restored.png"));
  for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
    await evaluate(`document.documentElement.style.zoom=${zoom}`);
    assert.equal(
      await evaluate("document.documentElement.scrollWidth>innerWidth"),
      false,
      `缩放 ${zoom}`,
    );
  }
  await browser.screenshot(join(output, "zoom-200.png"));
  await evaluate("document.documentElement.style.zoom=1");
  await click('[title="设置"]');
  await click(".theme-options button:nth-child(2)");
  await click('[title="关闭窗口"]');
  await click('[title="收起侧栏"]');
  await page("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await page("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await evaluate(
    "window.scrollTo(0,0); document.querySelector('.reasoning-text').scrollIntoView({block:'center',inline:'nearest'})",
  );
  assert.equal(
    await evaluate("document.documentElement.scrollWidth>innerWidth"),
    false,
  );
  await browser.screenshot(join(output, "dark-mobile.png"));
  const report = {
    status: "passed",
    nativeEvents: true,
    streamingTranslation: true,
    historyRestored: true,
    sessionCache: true,
    zoom: [80, 100, 125, 150, 200],
    darkMobile: true,
  };
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
