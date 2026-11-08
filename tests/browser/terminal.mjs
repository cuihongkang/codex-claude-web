import { verifyTerminalHeight } from "./terminal-height.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { createTerminals } from "../../server/src/workspace/terminals.mjs";
import { serveDemoSession } from "../helpers/browser-session.mjs";

const before = process.env.BROWSER_BEFORE === "1";
const previousShell = process.env.SHELL;
const previousZdotdir = process.env.ZDOTDIR;
const build = process.env.UI_BUILD_DIR || "client/dist";
const output =
  process.env.BROWSER_OUTPUT_DIR || ".cache/terminal-appearance/after";
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "claudex-terminal-browser-"));
const directory = join(root, "project-a");
const otherDirectory = join(root, "project-b");
await mkdir(directory);
await mkdir(otherDirectory);
await writeFile(join(directory, ".zshrc"), 'PS1="❯ "\n');
process.env.SHELL = "/bin/zsh";
process.env.ZDOTDIR = directory;
const threads = [
  { id: "terminal-a", name: "项目 A 对话", cwd: directory, createdAt: 3 },
  {
    id: "terminal-a-same",
    name: "项目 A 另一对话",
    cwd: directory,
    createdAt: 2,
  },
  { id: "terminal-b", name: "项目 B 对话", cwd: otherDirectory, createdAt: 1 },
];
const sockets = new Set();
const requests = [];
const terminals = createTerminals((message) => {
  if (
    process.env.TERMINAL_METADATA_OLD === "1" &&
    message.method === "lan/terminalStarted"
  ) {
    message = { ...message, params: { ...message.params } };
    delete message.params.cwd;
  }
  for (const socket of sockets)
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
});
const server = http.createServer(async (request, response) => {
  if (serveDemoSession(request, response)) return;
  try {
    const path = new URL(request.url, "http://fixture").pathname;
    const bytes = await readFile(
      join(build, path === "/" ? "index.html" : path),
    );
    response.writeHead(200, {
      "Content-Type":
        {
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        }[extname(path)] || "text/html",
    });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
const wss = new WebSocketServer({ server });
wss.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.send(
    JSON.stringify({
      method: "lan/state",
      params: {
        ready: true,
        defaultCwd: directory,
        activeTurns: {},
        questions: [],
        terminals: terminals.snapshot(),
      },
    }),
  );
  socket.on("message", async (raw) => {
    const message = JSON.parse(raw);
    requests.push(message);
    let result = {};
    try {
      if (
        message.method.startsWith("command/exec") ||
        message.method.startsWith("lan/terminal/")
      ) {
        const params = { ...message.params };
        if (message.method === "command/exec")
          params.env = { ...params.env, SHELL: "/bin/zsh", ZDOTDIR: directory };
        result = await terminals.request(message.method, params);
      } else if (message.method === "thread/list")
        result = { data: threads, nextCursor: null };
      else if (["thread/read", "thread/resume"].includes(message.method)) {
        const thread = threads.find(
          (thread) => thread.id === message.params.threadId,
        );
        result = { thread, cwd: thread.cwd };
      } else if (
        message.method === "thread/list" ||
        message.method.endsWith("/list")
      )
        result = { data: [], nextCursor: null };
      else if (message.method === "config/read") result = { config: {} };
      else if (message.method === "lan/projectless/read")
        result = { directories: {} };
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ id: message.id, result }));
    } catch (error) {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({ id: message.id, error: { message: error.message } }),
        );
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ["--no-sandbox", "--no-proxy-server"],
});
const results = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 850 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("cx-theme", JSON.stringify("light"));
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor() {
        super(location.origin.replace("http:", "ws:") + "/rpc");
      }
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".app-shell").waitFor();
  const openThread = async (name) => {
    const link = page.locator(".thread-link").filter({ hasText: name });
    if (!(await link.isVisible())) {
      for (const heading of await page
        .locator(".project-heading > button:first-child")
        .all()) {
        await heading.click();
        if (await link.isVisible()) break;
      }
    }
    await link.click();
    await page.waitForFunction(
      (name) =>
        document.querySelector(".breadcrumb")?.textContent.includes(name),
      name,
    );
  };
  await openThread("项目 A 对话");
  await page.keyboard.press("Control+Backquote");
  const panel = page.locator(".terminal-panel");
  await panel.waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".xterm-rows")?.textContent.includes("❯"),
  );
  await panel.screenshot({ path: join(output, "single.png") });
  if (process.env.TERMINAL_EOF_ONLY === "1") {
    await page
      .locator(".terminal-view:not([hidden]) .xterm-helper-textarea")
      .focus();
    await page.keyboard.press("Control+d");
    await page.waitForFunction(() => !document.querySelector(".terminal-view"));
    await page.screenshot({ path: join(output, "shell-eof.png") });
    assert.equal(
      await panel.count(),
      process.env.TERMINAL_EOF_BEFORE === "1" ? 1 : 0,
    );
    assert(
      Object.values(terminals.snapshot()).every(
        (terminal) => !terminal.running,
      ),
    );
    console.log(
      process.env.TERMINAL_EOF_BEFORE === "1"
        ? "PASS 已复现：shell 退出后遗留空面板"
        : "PASS 真实 zsh Ctrl+D 退出后面板折叠",
      {
        oldMetadata: process.env.TERMINAL_METADATA_OLD === "1",
      },
    );
    await context.close();
  } else {
    if (!before) await verifyTerminalHeight({ page, panel, output, requests });
    if (process.env.TERMINAL_HEIGHT_BEFORE !== "1") {
      if (!before)
        assert.equal(await page.locator(".terminal-list").count(), 0);
      for (let index = 0; index < 4; index++)
        await page.getByTitle("新建终端", { exact: true }).click();
      assert.equal(
        await page.locator(".terminal-list button[aria-pressed]").count(),
        5,
      );
      const input = page.locator(
        ".terminal-view:not([hidden]) .xterm-helper-textarea",
      );
      await input.focus();
      await page.keyboard.type("python3 -q");
      await page.keyboard.press("Enter");
      if (!before)
        await page
          .getByRole("button", { name: "Python", exact: true })
          .waitFor();
      await panel.screenshot({ path: join(output, "five-python.png") });
      if (before) {
        await openThread("项目 B 对话");
        assert.equal(
          await page.locator(".terminal-list button[aria-pressed]").count(),
          5,
        );
        await page.screenshot({ path: join(output, "folder-b-inherited.png") });
      }
      if (!before) {
        assert.equal(await page.locator(".terminal-process-icon").count(), 1);
        await input.focus();
        await page.keyboard.press("Control+d");
        await page.waitForFunction(
          () => !document.querySelector(".terminal-process-icon"),
        );
        await page.getByTitle("隐藏终端", { exact: true }).click();
        await page.keyboard.press("Control+Backquote");
        await panel.waitFor();
        assert.equal(
          requests.filter((request) => request.method === "lan/terminal/create")
            .length,
          5,
        );
        await page.locator(".terminal-tab").first().click();
        await page.locator(".terminal-row").first().hover();
        await panel.screenshot({ path: join(output, "five-zsh-hover.png") });
        assert.equal(
          await page.locator(".terminal-tab[aria-pressed=true]").count(),
          1,
        );
        const sidebar = page.getByRole("separator", {
          name: "调整终端列表宽度",
          exact: true,
        });
        const listWidth = () =>
          page
            .locator(".terminal-list-container")
            .evaluate((node) => node.getBoundingClientRect().width);
        const initialWidth = await listWidth();
        assert(initialWidth < 130);
        const box = await sidebar.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + 40);
        await page.mouse.down();
        await page.mouse.move(box.x - 70, box.y + 40, { steps: 5 });
        await page.mouse.up();
        const draggedWidth = await listWidth();
        assert(draggedWidth > initialWidth + 60);
        await panel.screenshot({ path: join(output, "list-resized.png") });
        await sidebar.dblclick();
        assert(Math.abs((await listWidth()) - initialWidth) < 1);
        await sidebar.focus();
        await page.keyboard.press("ArrowLeft");
        assert((await listWidth()) > initialWidth);
        const preferredWidth = await listWidth();
        const aIds = Object.keys(terminals.snapshot()).filter(
          (id) => terminals.snapshot()[id].cwd === directory,
        );
        await openThread("项目 B 对话");
        assert.equal(await panel.count(), 0);
        assert(aIds.every((id) => terminals.snapshot()[id].running));
        await page.screenshot({ path: join(output, "folder-b-hidden.png") });
        await page.keyboard.press("Control+Backquote");
        await panel.waitFor();
        await page.waitForFunction(() =>
          document.querySelector(".xterm-rows")?.textContent.includes("❯"),
        );
        assert.equal(await page.locator(".terminal-list").count(), 0);
        const bId = Object.keys(terminals.snapshot()).find(
          (id) => terminals.snapshot()[id].cwd === otherDirectory,
        );
        assert(bId);
        await openThread("项目 A 另一对话");
        await panel.waitFor();
        assert.equal(await page.locator(".terminal-tab").count(), 5);
        assert(Math.abs((await listWidth()) - preferredWidth) < 1);
        const createsBeforeSameFolder = requests.filter(
          (request) => request.method === "lan/terminal/create",
        ).length;
        await openThread("项目 A 对话");
        assert.equal(
          requests.filter((request) => request.method === "lan/terminal/create")
            .length,
          createsBeforeSameFolder,
        );
        await terminals.request("lan/terminal/terminate", { processId: bId });
        await page.waitForTimeout(100);
        assert.equal(await panel.count(), 1);
        await sidebar.dblclick();
        await panel.screenshot({ path: join(output, "folder-a-restored.png") });
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 850 });
          if (width === 390) {
            await page.getByTitle("显示侧栏", { exact: true }).click();
            await page.getByTitle("收起侧栏", { exact: true }).click();
            await page.waitForFunction(
              () =>
                getComputedStyle(document.querySelector(".sidebar"))
                  .visibility === "hidden",
            );
          }
          for (const theme of ["light", "dark"]) {
            await page.evaluate(
              (theme) => (document.documentElement.dataset.theme = theme),
              theme,
            );
            const metrics = await panel.evaluate((node) => {
              const rect = node.getBoundingClientRect();
              const list = node
                .querySelector(".terminal-list")
                .getBoundingClientRect();
              const tab = node.querySelector(".terminal-tab");
              return {
                width: rect.width,
                listWidth: list.width,
                listRight: list.right,
                right: rect.right,
                textAlign: getComputedStyle(tab).textAlign,
                overflow: node.scrollWidth > node.clientWidth,
              };
            });
            assert.equal(metrics.textAlign, "left");
            assert.equal(metrics.overflow, false);
            assert(metrics.listRight <= metrics.right + 1);
            await panel.screenshot({
              path: join(output, `${theme}-${width}.png`),
            });
            results.push({ theme, width, ...metrics });
          }
        }
        await page.setViewportSize({ width: 1280, height: 850 });
        await page.evaluate(
          () => (document.documentElement.dataset.theme = "light"),
        );
        for (let remaining = 4; remaining >= 0; remaining--) {
          await page
            .locator(".terminal-view:not([hidden]) .xterm-helper-textarea")
            .focus();
          await page.keyboard.press("Control+d");
          await page.waitForFunction(
            (remaining) =>
              document.querySelectorAll(".terminal-view").length === remaining,
            remaining,
          );
          assert.equal(await panel.count(), remaining ? 1 : 0);
        }
        await page.screenshot({ path: join(output, "all-shells-exited.png") });
        for (const scale of [0.8, 1.25, 1.5, 2]) {
          const profile = await mkdtemp(join(tmpdir(), "terminal-zoom-"));
          await mkdir(join(profile, "Default"));
          await writeFile(
            join(profile, "Default", "Preferences"),
            JSON.stringify({
              partition: {
                default_zoom_level: { x: Math.log(scale) / Math.log(1.2) },
              },
            }),
          );
          const zoomContext = await chromium.launchPersistentContext(profile, {
            executablePath: process.env.CHROME_PATH,
            headless: true,
            viewport: { width: 1280, height: 850 },
            args: ["--no-sandbox", "--no-proxy-server"],
          });
          try {
            await zoomContext.addInitScript(() => {
              const NativeSocket = window.WebSocket;
              window.WebSocket = class extends NativeSocket {
                constructor() {
                  super(location.origin.replace("http:", "ws:") + "/rpc");
                }
              };
            });
            const zoomPage = await zoomContext.newPage();
            await zoomPage.goto(`http://127.0.0.1:${server.address().port}`);
            await zoomPage.locator(".app-shell").waitFor();
            await zoomPage.locator(".markdown-composer .ProseMirror").waitFor();
            await zoomPage.keyboard.press("Control+Backquote");
            const zoomPanel = zoomPage.locator(".terminal-panel");
            await zoomPanel.waitFor();
            for (const width of [1280, 390]) {
              await zoomPage.setViewportSize({ width, height: 850 });
              if (await zoomPage.locator(".sidebar.mobile-open").count()) {
                await zoomPage.keyboard.press("Escape");
              }
              const metrics = await zoomPanel.evaluate((node) => ({
                dpr: devicePixelRatio,
                innerWidth,
                width: node.getBoundingClientRect().width,
                overflow: node.scrollWidth > node.clientWidth,
              }));
              assert(
                Math.abs(metrics.dpr - scale) < 0.02,
                `实际 DPR ${metrics.dpr} 与页面缩放 ${scale} 不符`,
              );
              assert.equal(metrics.overflow, false);
              await zoomPanel.screenshot({
                path: join(output, `zoom-${scale}-${width}.png`),
                animations: "disabled",
              });
              results.push({ scale, viewport: width, ...metrics });
            }
          } finally {
            await zoomContext.close();
            await rm(profile, { recursive: true, force: true });
          }
        }
      }
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        build,
        buildInfo: JSON.parse(
          await readFile(
            process.env.UI_BUILD_INFO || "build-info.json",
            "utf8",
          ),
        ),
        before: before || process.env.TERMINAL_HEIGHT_BEFORE === "1",
        results,
        requests: requests.map(({ method }) => method),
        fixture: "隔离目录、真实 node-pty / zsh 与 Python，模拟目录和账户 RPC",
      },
      null,
      2,
    ),
  );
  console.log(
    process.env.TERMINAL_EOF_ONLY === "1"
      ? "PASS EOF 浏览器专项验证"
      : before || process.env.TERMINAL_HEIGHT_BEFORE === "1"
        ? "PASS 修改前隔离浏览器截图"
        : "PASS 终端调高与调宽、真实进程切换、文件夹隔离、尺寸恢复、深浅主题、窄屏和实际页面缩放",
  );
} finally {
  await browser.close();
  terminals.close();
  for (const socket of sockets) socket.terminate();
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve) => server.close(resolve));
  if (previousShell === undefined) delete process.env.SHELL;
  else process.env.SHELL = previousShell;
  if (previousZdotdir === undefined) delete process.env.ZDOTDIR;
  else process.env.ZDOTDIR = previousZdotdir;
  await rm(root, { recursive: true, force: true });
}
