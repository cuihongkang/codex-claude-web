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
  backendInstallations: {
    codex: {
      installed: true,
      currentVersion: "0.162.1",
      latestVersion: "0.167.0",
      checking: false,
    },
    claude: {
      installed: false,
      currentVersion: "",
      latestVersion: "2.1.318",
      checking: false,
    },
  },
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
  if (process.env.PROXY_BEFORE === "1") {
    await page.screenshot({ path: join(output, "proxy-before.png") });
  } else if (before) {
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
    const codex = page
      .locator(".backend-card")
      .filter({ has: page.locator("strong", { hasText: /^Codex$/ }) });
    const claude = page
      .locator(".backend-card")
      .filter({ has: page.locator("strong", { hasText: /^Claude Code$/ }) });
    assert.match(
      await codex.textContent(),
      /当前版本：0.162.1.*最新版本：0.167.0/,
    );
    assert.match(await claude.textContent(), /未安装.*最新版本：2.1.318/s);
    assert.equal(await page.getByText("执行程序", { exact: true }).count(), 0);
    assert.equal(
      await page.getByRole("button", { name: "检查连接", exact: true }).count(),
      0,
    );
    await codex
      .getByRole("checkbox", { name: "启用 Codex", exact: true })
      .click();
    await codex.getByText("已停用", { exact: true }).waitFor();
    await codex
      .getByRole("checkbox", { name: "启用 Codex", exact: true })
      .click();
    await claude.getByRole("button", { name: "一键安装", exact: true }).click();
    await claude.getByText(/当前版本：2.1.318/).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "重新检测" }).count(),
      0,
    );
    assert.equal(await page.getByText(/已是最新/).count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          window.fixtureRequests.filter(
            (r) => r.method === "lan/backends/versions",
          ).length,
      ),
      0,
    );
    assert.equal(
      await claude
        .getByRole("button", { name: "一键更新", exact: true })
        .count(),
      1,
    );
    const writes = await page.evaluate(() =>
      window.fixtureRequests.filter((r) => r.method === "lan/backends/save"),
    );
    assert.deepEqual(Object.keys(writes[0].params).sort(), [
      "enabled",
      "id",
      "type",
    ]);
    const proxy = page.getByRole("form", { name: "Claude Code 网络代理" });
    const protocol = proxy.getByLabel("网络代理", { exact: true });
    assert.equal(
      await proxy
        .getByText("用于服务器上的 Claude Code 联网，本机连接直接访问。", {
          exact: true,
        })
        .count(),
      0,
    );
    await protocol.selectOption("http");
    await proxy.getByLabel("代理地址").fill("proxy.example");
    await proxy.getByLabel("代理端口").fill("8080");
    const row = await proxy
      .locator(".proxy-row")
      .evaluate((el) =>
        [...el.querySelectorAll("select,input,button")].map(
          (control) => control.getBoundingClientRect().top,
        ),
      );
    assert.ok(
      Math.max(...row) - Math.min(...row) < 3,
      "桌面代理控件保持同一行",
    );
    const spacing = await proxy.evaluate((el) => {
      const row = el.querySelector(".proxy-row").getBoundingClientRect();
      const providers = el.nextElementSibling.getBoundingClientRect();
      return {
        gap: providers.top - row.bottom,
        indent: row.left - providers.left,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
      };
    });
    assert.ok(spacing.gap <= spacing.fontSize, JSON.stringify(spacing));
    assert.ok(Math.abs(spacing.indent) < 1, JSON.stringify(spacing));
    await page.evaluate(() => {
      const original = window.backendSocket.send.bind(window.backendSocket);
      window.backendSocket.send = (raw) => {
        const request = JSON.parse(raw);
        if (request.method === "lan/backends/save" && request.params.proxy) {
          window.backendSocket.send = original;
          window.backendSocket.onmessage({
            data: JSON.stringify({
              id: request.id,
              error: {
                code: -1,
                message: "请等待此后端的任务结束后修改配置。",
              },
            }),
          });
        } else original(raw);
      };
    });
    await proxy.getByRole("button", { name: "保存代理" }).click();
    await proxy.getByRole("alert").filter({ hasText: "任务结束" }).waitFor();
    assert.equal(await proxy.getByLabel("代理端口").inputValue(), "8080");
    await proxy.getByRole("button", { name: "保存代理" }).click();
    await proxy.getByText("代理配置已保存", { exact: true }).waitFor();
    const proxyWrite = await page.evaluate(() =>
      window.fixtureRequests.filter((r) => r.params?.proxy).at(-1),
    );
    assert.deepEqual(proxyWrite.params.proxy, {
      mode: "http",
      host: "proxy.example",
      port: 8080,
    });
    await protocol.selectOption("off");
    await proxy.getByRole("button", { name: "保存代理" }).click();
    await proxy.getByText("代理配置已保存", { exact: true }).waitFor();
    assert.equal(await proxy.getByLabel("代理端口").count(), 0);
    const disabledWrite = await page.evaluate(() =>
      window.fixtureRequests.filter((r) => r.params?.proxy).at(-1),
    );
    assert.deepEqual(disabledWrite.params.proxy, { mode: "off" });
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
          const proxy = page.getByRole("form", {
            name: "Claude Code 网络代理",
          });
          await proxy
            .getByLabel("网络代理", { exact: true })
            .selectOption("http");
          await proxy.getByLabel("代理端口").fill("8080");
          await page
            .locator(".theme-options")
            .getByRole("button", {
              name: theme === "dark" ? "深色" : "浅色",
              exact: true,
            })
            .click();
          await proxy.scrollIntoViewIfNeeded();
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
            animations: "disabled",
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
