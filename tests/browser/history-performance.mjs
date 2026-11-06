import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { historyPerformanceFixture } from "../fixtures/history-performance.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const buildRoot = before
  ? join(root, ".cache/history-performance-before")
  : root;
const build = join(buildRoot, before ? "dist" : "client/dist");
const output = join(
  root,
  ".cache/history-performance",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium");
assert(process.env.PLAYWRIGHT_MODULE, "通过 PLAYWRIGHT_MODULE 指定 Playwright");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let content = await readFile(
      join(build, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace(
          "<head>",
          `<head><script>(${historyPerformanceFixture.toString()})()</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[extname(path)] ||
          (path === "/" ? "text/html" : "application/octet-stream"),
      })
      .end(content);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
const evidence = [];
let page;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const device = await page.context().newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const longThread = page.getByRole("button", { name: /^超长对话性能验证/ });
  await longThread.waitFor();
  await page.evaluate(() => {
    window.historyFixture.started = performance.now();
  });
  await longThread.click();
  if (before)
    await page.screenshot({
      path: join(output, "switch-loading.png"),
      animations: "disabled",
    });
  await page.waitForFunction(() => window.historyFixture.firstPaint !== null);
  const firstPaint = await page.evaluate(
    () => window.historyFixture.firstPaint,
  );
  if (!before)
    await page.screenshot({
      path: join(output, "switch-first-page.png"),
      animations: "disabled",
    });
  await page.waitForFunction(
    () => document.querySelectorAll(".user-message").length === 15,
  );
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const fullMs = await page.evaluate(
    () => performance.now() - window.historyFixture.started,
  );
  const gap = () =>
    page
      .locator(".conversation")
      .evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop);
  assert((await gap()) < 2, "完整恢复保持真实底部");
  assert.equal(await page.locator(".assistant-message").count(), 15);
  if (before)
    await page.screenshot({
      path: join(output, "desktop-light.png"),
      animations: "disabled",
    });
  const parsed = await page.evaluate(
    () =>
      window.historyFixture.requests.filter(
        (r) => r.method === "thread/items/list" && r.params.threadId === "long",
      ).length,
  );
  assert.equal(parsed, 33, "自动读取全部 33 页");
  evidence.push({ scenario: "首次切换", firstPaint, fullMs, pages: parsed });
  const firstLoadRenders = await page.evaluate(
    () => window.historyFixture.richTextRenders,
  );
  await page.evaluate(() =>
    window.historyFixture.socket.onmessage({
      data: JSON.stringify({
        method: "lan/state",
        params: {
          ready: true,
          defaultCwd: "/demo/history",
          activeTurns: {},
          questions: [],
        },
      }),
    }),
  );
  await page.waitForTimeout(100);
  const unchangedRenders =
    (await page.evaluate(() => window.historyFixture.richTextRenders)) -
    firstLoadRenders;
  if (!before)
    assert.equal(
      unchangedRenders,
      0,
      "状态通知复用已有 Markdown，不重复解析全部回复",
    );
  evidence.push({
    scenario: "历史渲染复用",
    firstLoadRenders,
    unchangedRenders,
  });
  if (!before) {
    assert(firstPaint < fullMs / 2, "最近消息先显示，完整分页在后台继续");
    // 再次打开时暂停第二页，验证首屏可编辑、读位置和切换隔离。
    await page.getByRole("button", { name: /^简短对话/ }).click();
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await page.evaluate(() => {
      window.historyFixture.hold = true;
    });
    await longThread.click();
    const composer = page.locator(".composer .ProseMirror");
    await composer.waitFor();
    await composer.fill("后台读取期间保留草稿");
    assert.equal(await page.locator(".assistant-message").count(), 1);
    await page.locator(".conversation").evaluate((e) => {
      e.scrollTop = 0;
    });
    await page.waitForFunction(
      () => !!document.querySelector(".scroll-bottom"),
    );
    const position = await page
      .locator(".assistant-message")
      .evaluate((e) => e.getBoundingClientRect().top);
    await page.evaluate(() => window.historyFixture.release());
    await page.waitForFunction(
      () => document.querySelectorAll(".user-message").length === 15,
    );
    const after = await page
      .locator(".assistant-message")
      .last()
      .evaluate((e) => e.getBoundingClientRect().top);
    assert(
      Math.abs(position - after) < 3,
      `补齐早期历史保留阅读位置：${position} → ${after}`,
    );
    assert.equal(await composer.innerText(), "后台读取期间保留草稿");
    await page.getByRole("button", { name: "对话目录", exact: true }).click();
    await page
      .locator(".conversation-navigation-entries button")
      .first()
      .click();
    assert(
      await page
        .locator(".user-message")
        .first()
        .evaluate((e) => e.getBoundingClientRect().top > 0),
    );
    await page.getByTitle("回到最新消息").click();
    await page.waitForFunction(() => {
      const e = document.querySelector(".conversation");
      return e.scrollHeight - e.clientHeight - e.scrollTop < 2;
    });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({
        path: join(output, `desktop-${theme}.png`),
        animations: "disabled",
      });
    }
    for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
      await page.setViewportSize({
        width: Math.round(1440 / scale),
        height: Math.round(900 / scale),
      });
      await device.send("Emulation.setDeviceMetricsOverride", {
        width: Math.round(1440 / scale),
        height: Math.round(900 / scale),
        deviceScaleFactor: scale,
        mobile: false,
      });
      await page.waitForFunction(() => {
        const e = document.querySelector(".conversation");
        return e.scrollHeight - e.clientHeight - e.scrollTop < 2;
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      evidence.push({ scenario: "缩放布局", scale, gap: await gap() });
    }
    await device.send("Emulation.clearDeviceMetricsOverride");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const e = document.querySelector(".conversation");
      return e.scrollHeight - e.clientHeight - e.scrollTop < 2;
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar").getBoundingClientRect().right <= 1,
    );
    await page.screenshot({
      path: join(output, "mobile.png"),
      animations: "disabled",
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: /^简短对话/ }).click();
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    await page.evaluate(() => {
      window.historyFixture.hold = true;
    });
    await longThread.click();
    await composer.waitFor();
    await page.getByRole("button", { name: /^简短对话/ }).click();
    await composer.waitFor();
    const count = await page.evaluate(
      () =>
        window.historyFixture.requests.filter(
          (r) =>
            r.method === "thread/items/list" && r.params.threadId === "long",
        ).length,
    );
    await page.evaluate(() => window.historyFixture.release());
    await page.waitForTimeout(150);
    assert.equal(await page.locator(".assistant-message").count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          window.historyFixture.requests.filter(
            (r) =>
              r.method === "thread/items/list" && r.params.threadId === "long",
          ).length,
      ),
      count,
    );
    evidence.push({
      scenario: "草稿、阅读锚点、目录、快速切换及迟到分页隔离",
      passed: true,
    });
  }
  assert.deepEqual(errors, []);
  const metrics = await page.evaluate(() => ({
    richTextRenders: window.historyFixture.richTextRenders,
    longTasks: window.historyFixture.longTasks,
  }));
  const result = {
    passed: true,
    before,
    fixture: "15 轮、3210 条记录、33 页，每页 50ms 往返",
    evidence,
    ...metrics,
    buildInfo: JSON.parse(
      await readFile(join(buildRoot, "build-info.json"), "utf8"),
    ),
  };
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, "failure.png") });
    console.error(
      JSON.stringify({
        evidence,
        scroll: await page.locator(".conversation").evaluate((e) => ({
          top: e.scrollTop,
          height: e.scrollHeight,
          clientHeight: e.clientHeight,
        })),
      }),
    );
  }
  throw error;
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
