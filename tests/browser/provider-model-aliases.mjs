import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { backendFixture } from "../helpers/backend-browser-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const main = process.env.UI_MAIN === "1";
const before = process.env.UI_BEFORE === "1";
const build = process.env.UI_BUILD_DIR || join(root, "client/dist");
const output = join(
  root,
  ".cache/provider-model-aliases",
  before ? "before" : main ? "main" : "dual",
);
await mkdir(output, { recursive: true });
const data = {
  main,
  markdown: "模型别名测试",
  claudeItems: [],
  providerModelNames: true,
};
const server = http.createServer(async (req, res) => {
  if (serveDemoSession(req, res)) return;
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    let bytes = await readFile(join(build, path === "/" ? "index.html" : path));
    if (path === "/")
      bytes = bytes
        .toString()
        .replace(
          "<head>",
          `<head><script>(${backendFixture.toString()})(${JSON.stringify(data)})</script>`,
        );
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
          }[extname(path)] || "text/html",
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const profile = await mkdtemp(join(tmpdir(), "backend-ui-"));
const context = await chromium.launchPersistentContext(profile, {
  viewport: { width: 1440, height: 1000 },
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
try {
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".composer .ProseMirror").waitFor();
  await page
    .getByRole("button", { name: /^新对话/ })
    .first()
    .click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("模型与服务配置", { exact: true }).click();
  await page.getByText("供应商与模型", { exact: true }).click();
  await page
    .locator(".backend-heading")
    .filter({ hasText: "示例供应商" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  assert.equal(await page.locator(".provider-model-name[open]").count(), 0);
  await page.screenshot({ path: join(output, "collapsed.png") });
  await page.locator(".provider-model-name summary").click();
  const alias = page.getByLabel("显示别名", { exact: true });
  await alias.fill("日常模型");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      await page.evaluate(
        (zoom) => (document.documentElement.style.zoom = zoom),
        zoom,
      );
      await alias.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(output, theme + "-" + zoom + ".png"),
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    }
  }
  await page.evaluate(() => (document.documentElement.style.zoom = 1));
  await page.setViewportSize({ width: 390, height: 844 });
  await alias.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, "mobile.png") });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByRole("button", { name: "保存供应商", exact: true }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[aria-label="模型"] option')].some((o) =>
      o.textContent.includes("日常模型"),
    ),
  );
  const saved = await page.evaluate(
    () =>
      fixtureRequests.findLast((r) => r.method === "lan/providers/save").params,
  );
  assert.equal(saved.modelAliases[saved.models[0]], "日常模型");
  assert.equal(
    saved.models[0],
    "provider/team/very-long-custom-model-identifier-for-alias-testing",
  );
  await page
    .locator(".backend-heading")
    .filter({ hasText: "示例供应商" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.locator(".provider-model-name summary").click();
  assert.equal(await alias.inputValue(), "日常模型");
  await alias.fill("");
  await page.getByRole("button", { name: "保存供应商", exact: true }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[aria-label="模型"] option')].some((o) =>
        o.textContent.includes("日常模型"),
      ),
  );
  console.log(
    "PASS 供应商模型别名编辑、保存、重新读取、清空、原始 ID、主题与缩放",
  );
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
