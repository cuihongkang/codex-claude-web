import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serveDemoSession } from "../helpers/browser-session.mjs";
import { backendFixture } from "../helpers/backend-browser-fixture.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.UI_BEFORE === "1";
const build = process.env.UI_BUILD_DIR || join(root, "client/dist");
const output = join(root, ".cache/backend-toggle", before ? "before" : "after");
await mkdir(output, { recursive: true });
const data = {
  main: false,
  markdown: "后端启停与对话列表",
  providerModelNames: false,
  claudeItems: [
    {
      id: "claude-user",
      type: "userMessage",
      turnId: "claude-turn",
      content: [{ type: "text", text: "Claude 示例对话正文" }],
    },
  ],
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
const profile = await mkdtemp(join(tmpdir(), "backend-toggle-"));
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
  const settings = page.getByRole("button", { name: "设置", exact: true });
  const closeSettings = page.getByRole("button", {
    name: "关闭窗口",
    exact: true,
  });
  const claudeToggle = page.getByRole("checkbox", {
    name: "启用 Claude Code",
    exact: true,
  });
  const claudeStatus = page
    .locator(".backend-card")
    .filter({ has: page.locator("strong", { hasText: /^Claude Code$/ }) });
  const claudeThread = page
    .locator(".thread-row")
    .filter({ hasText: "Claude 原生消息归属" });
  const codexThread = page
    .locator(".thread-row")
    .filter({ hasText: "旧版未分类与 Markdown" });
  async function expandGroup(label) {
    const heading = page
      .locator(".project-heading button")
      .filter({ hasText: label });
    await heading.waitFor();
    if ((await heading.getAttribute("aria-expanded")) !== "true")
      await heading.click();
  }
  async function expandGroups() {
    await expandGroup("未分类");
    await expandGroup("project");
  }
  async function setTheme(name) {
    await page.getByRole("button", { name, exact: true }).click();
  }
  async function toggleClaude() {
    await settings.click();
    await claudeToggle.click();
  }
  async function expectDisabled() {
    await claudeStatus.getByText("已停用", { exact: true }).waitFor();
  }
  async function expectEnabled() {
    await claudeStatus.getByText("已连接", { exact: true }).waitFor();
  }

  await expandGroups();
  await claudeThread.waitFor();
  assert.equal(await claudeThread.isVisible(), true);
  assert.equal(await codexThread.isVisible(), true);
  await page.screenshot({ path: join(output, "01-sidebar-enabled-light.png") });

  await page.evaluate(() => (window.__noReload = true));
  await toggleClaude();
  await expectDisabled();
  await page.screenshot({
    path: join(output, "02-settings-disabled-light.png"),
  });
  await setTheme("深色");
  await closeSettings.click();
  if (before) {
    await claudeThread.waitFor();
    assert.equal(await claudeThread.isVisible(), true);
  } else {
    await claudeThread.waitFor({ state: "detached" });
    assert.equal(await codexThread.isVisible(), true);
  }
  await page.screenshot({
    path: join(output, "03-sidebar-disabled-dark.png"),
  });
  await settings.click();
  await setTheme("浅色");
  await closeSettings.click();
  if (before) {
    await claudeThread.waitFor();
    assert.equal(await claudeThread.isVisible(), true);
  } else {
    assert.equal(await claudeThread.count(), 0);
    assert.equal(await codexThread.isVisible(), true);
    assert.equal(await page.evaluate(() => window.__noReload === true), true);
  }
  await page.screenshot({
    path: join(output, "04-sidebar-disabled-light.png"),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const openSidebar = page.getByRole("button", {
    name: "显示侧栏",
    exact: true,
  });
  if (!(await page.locator(".sidebar.mobile-open").count()))
    await openSidebar.click();
  await page.locator(".sidebar.mobile-open").waitFor();
  if (before) {
    await claudeThread.waitFor();
    assert.equal(await claudeThread.isVisible(), true);
  } else {
    assert.equal(await claudeThread.count(), 0);
    assert.equal(await codexThread.isVisible(), true);
  }
  await page.screenshot({
    path: join(output, "05-sidebar-disabled-mobile.png"),
  });
  await page.locator(".sidebar-backdrop.visible").click();
  await page.setViewportSize({ width: 1440, height: 1000 });

  await toggleClaude();
  await expectEnabled();
  await closeSettings.click();
  await expandGroups();
  await claudeThread.waitFor();
  assert.equal(await claudeThread.isVisible(), true);
  await page.screenshot({
    path: join(output, "06-sidebar-restored-light.png"),
  });

  await claudeThread.click();
  await page.getByText("Claude 示例对话正文", { exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "07-conversation-open.png"),
  });
  await toggleClaude();
  await expectDisabled();
  await closeSettings.click();
  if (before) {
    await page.getByText("Claude 示例对话正文", { exact: true }).waitFor();
    assert.equal(await page.locator(".welcome").count(), 0);
  } else {
    await page.locator(".welcome").waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("cx-current")),
      null,
    );
    assert.equal(await claudeThread.count(), 0);
  }
  await page.screenshot({
    path: join(output, "08-conversation-closed.png"),
  });

  if (!before) {
    await settings.click();
    const codexToggle = page.getByRole("checkbox", {
      name: "启用 Codex",
      exact: true,
    });
    await codexToggle.click();
    await page
      .locator(".backend-card")
      .filter({ has: codexToggle })
      .getByText("已停用", { exact: true })
      .waitFor();
    await closeSettings.click();
    assert.equal(await page.locator(".thread-row").count(), 0);
    await settings.click();
    await codexToggle.click();
    await page
      .locator(".backend-card")
      .filter({ has: codexToggle })
      .getByText("已连接", { exact: true })
      .waitFor();
    await closeSettings.click();
    await expandGroup("未分类");
    await codexThread.waitFor();
    assert.equal(await claudeThread.count(), 0);
    assert.equal(await page.evaluate(() => window.__noReload), true);
  }

  console.log(
    before
      ? "PASS 复现停用后对话列表与当前对话保留到刷新"
      : "PASS 停用后端后对话列表与当前对话立即更新",
  );
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
