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
  ".cache/settings-layout",
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
  if (before) {
    await page.getByText("模型与服务配置", { exact: true }).click();
    await page.getByText("供应商与模型", { exact: true }).click();
    await page.screenshot({ path: join(output, "desktop.png") });
  } else {
    assert.equal(await page.locator("details.backend-settings").count(), 0);
    assert.equal(
      await page.getByText("供应商与模型", { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByText("快捷键", { exact: true }).count(), 0);
    await page
      .getByRole("button", { name: "添加供应商", exact: true })
      .waitFor();
    const settings = await context.newPage();
    await settings.goto("chrome://settings/appearance");
    const zoom = settings.locator("#zoomLevel");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"]) {
        for (const scale of [0.8, 1, 1.25, 1.5, 2]) {
          await zoom.selectOption(String(scale));
          await page.reload();
          await page.locator(".composer .ProseMirror").waitFor();
          const openSidebar = page.getByRole("button", {
            name: "显示侧栏",
            exact: true,
          });
          if (await openSidebar.isVisible()) await openSidebar.click();
          await page.getByRole("button", { name: "设置", exact: true }).click();
          await page
            .getByRole("button", { name: "添加供应商", exact: true })
            .waitFor();
          await page.getByText("示例供应商", { exact: true }).waitFor();
          await page.evaluate((theme) => {
            document.documentElement.dataset.theme = theme;
          }, theme);
          const metrics = await page
            .locator(".settings-body")
            .evaluate((el) => ({
              width: el.clientWidth,
              scroll: el.scrollWidth,
              zoom: getComputedStyle(document.documentElement).zoom,
              dpr: devicePixelRatio,
            }));
          assert.equal(metrics.zoom, "1");
          assert.ok(Math.abs(metrics.dpr - scale) < 0.02);
          assert.ok(
            metrics.scroll <= metrics.width + 1,
            JSON.stringify({ width, theme, scale, metrics }),
          );
          await page.screenshot({
            path: join(output, width + "-" + theme + "-" + scale + ".png"),
          });
        }
      }
    }
    await zoom.selectOption("1");
    await settings.close();
  }
  console.log(
    "PASS 设置页结构、供应商直接展示、实际浏览器缩放、深浅主题与窄屏",
  );
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
