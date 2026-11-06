import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { plansFixture } from "../fixtures/plans.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const buildDirectory =
  process.env.BROWSER_BUILD_DIR || join(root, "client/dist");
const output = join(
  root,
  before ? ".cache/plans-before/browser" : ".cache/plans-browser",
);
await mkdir(output, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    let body = await readFile(
      join(buildDirectory, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      body = body
        .toString()
        .replace(
          "<head>",
          `<head><script>(${plansFixture.toString()})()</script>`,
        );
    response
      .writeHead(200, {
        "Content-Type":
          mime[extname(path === "/" ? "index.html" : path)] ||
          "application/octet-stream",
      })
      .end(body);
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
const errors = [],
  layouts = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if (before) {
    await page.locator(".process-history").waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "改进计划" }).count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "批准并执行", exact: true })
        .count(),
      0,
    );
    await page.screenshot({ path: join(output, "collapsed.png") });
    await page.locator(".process-history > summary").click();
    await page.screenshot({ path: join(output, "expanded-process.png") });
    console.log("PASS 旧版复现：计划正文收入工作过程且缺少批准入口");
  } else {
    const approve = page.getByRole("button", {
      name: "批准并执行",
      exact: true,
    });
    const plan = page.getByRole("article", { name: "计划方案" }).last();
    await approve.waitFor();
    const body = plan.locator(".plan-message-body");
    const expand = plan.locator(".plan-message-expand button");
    assert.equal(await expand.getAttribute("aria-expanded"), "false");
    const preview = await body.evaluate((el) => ({
      height: el.clientHeight,
      full: el.scrollHeight,
    }));
    assert(preview.height > 0 && preview.height < preview.full);
    await expand.click();
    assert.equal(
      await body.evaluate((el) => el.clientHeight >= el.scrollHeight),
      true,
    );
    await page.screenshot({ path: join(output, "expanded.png") });
    await plan.getByRole("button", { name: "收起计划", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await expand.getAttribute("aria-expanded"), "false");
    await expand.focus();
    await page.keyboard.press("Space");
    await plan.getByRole("button", { name: "收起计划", exact: true }).click();
    assert.equal(await plan.locator("details").count(), 0);
    for (const theme of ["light", "dark"]) {
      for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
        await page.evaluate(
          ({ theme, zoom }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.zoom = zoom;
          },
          { theme, zoom },
        );
        await approve.scrollIntoViewIfNeeded();
        const box = await approve.boundingBox();
        assert(box.width > 60 && box.height > 20);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        assert.equal(overflow, false);
        layouts.push({ theme, zoom, button: box });
        await page.screenshot({ path: join(output, `${theme}-${zoom}.png`) });
      }
    }
    await page.evaluate(() => (document.documentElement.style.zoom = 1));
    await page.setViewportSize({ width: 390, height: 844 });
    await approve.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: join(output, "mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const composer = page.locator('.composer [role="textbox"]');
    await composer.waitFor();
    await page.getByRole("button", { name: "修改计划", exact: true }).click();
    await composer.fill("请补充浏览器验收");
    await composer.press("Control+Enter");
    await page.getByRole("heading", { name: "修订计划" }).waitFor();
    await approve.waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.planFixture.requests
            .filter((r) => r.method === "turn/start")
            .at(-1).params.collaborationMode.mode,
      ),
      "plan",
    );
    await page.reload();
    await approve.waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "修订计划" }).count(),
      1,
    );
    assert.equal(
      await plan
        .locator(".plan-message-expand button")
        .getAttribute("aria-expanded"),
      "false",
    );
    await composer.waitFor();
    await composer.fill("下一条消息的草稿");
    await page.evaluate(() => (window.planFixture.fail = true));
    await approve.click();
    await page.getByText("模拟执行失败", { exact: true }).waitFor();
    await approve.waitFor({ state: "visible" });
    assert((await composer.innerText()).includes("下一条消息的草稿"));
    await page.screenshot({ path: join(output, "retry.png") });
    await page.evaluate(() => (window.planFixture.fail = false));
    await approve.click();
    await page.getByText("已开始实施批准的计划。", { exact: true }).waitFor();
    assert.equal(await approve.count(), 0);
    assert.equal(await page.locator(".mode-badge").count(), 0);
    const sent = await page.evaluate(() =>
      window.planFixture.requests
        .filter((r) => r.method === "turn/start")
        .at(-1),
    );
    assert.equal(sent.params.collaborationMode.mode, "default");
    assert(sent.params.input[0].text.includes("补充浏览器验收，再开始实施。"));
    assert((await composer.innerText()).includes("下一条消息的草稿"));
    await page.screenshot({ path: join(output, "executing.png") });
    await page.reload();
    await page.getByText("已开始实施批准的计划。", { exact: true }).waitFor();
    assert.equal(await approve.count(), 0);
    assert.equal(
      await page.getByRole("article", { name: "计划方案" }).count(),
      2,
    );
    assert.deepEqual(errors, []);
    await writeFile(
      join(output, "results.json"),
      JSON.stringify(
        {
          layouts,
          sent,
          errors,
          build: JSON.parse(
            await readFile(join(root, "build-info.json"), "utf8"),
          ),
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS 计划正文、修改计划、刷新恢复、失败重试、批准后默认模式执行、草稿保留、深浅主题、80%～200% 缩放和窄屏",
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
