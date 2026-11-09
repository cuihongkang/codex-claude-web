import { serveDemoSession } from "../helpers/browser-session.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { findSharedBridge } from "../../server/src/claude-shared-client.mjs";
import https from "node:https";
import { readTls } from "../../server/src/tls.mjs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { attachClaude } from "../../server/src/claude-web.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const root = fileURLToPath(new URL("../../", import.meta.url));
const output =
  process.env.BROWSER_OUTPUT_DIR || join(root, ".cache/claude-browser");
await mkdir(output, { recursive: true });
const home = await mkdtemp(join(tmpdir(), "claude-browser-"));
const normal = randomUUID(),
  external = randomUUID(),
  long = randomUUID();
const project = join(home, "projects", "demo");
await mkdir(project, { recursive: true });
const rec = (type, text, cwd = home) => ({
  type,
  uuid: randomUUID(),
  cwd,
  message: { content: [{ type: "text", text }] },
});
await writeFile(
  join(project, normal + ".jsonl"),
  [
    rec("user", "实现图片上传功能"),
    {
      ...rec(
        "user",
        "自动上下文摘要：" + "历史工具命令与任务记录。".repeat(100),
      ),
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    },
    {
      ...rec("user", "自动系统说明：" + "工具与技能说明。".repeat(100)),
      isMeta: true,
    },
    rec(
      "assistant",
      "已完成上传组件和文件类型校验。\n\n- 支持 PNG、JPEG\n- 上传失败可重试\n- 单元测试全部通过",
    ),
    { type: "custom-title", customTitle: "图片上传 · Claude" },
  ]
    .map(JSON.stringify)
    .join("\n") + "\n",
);
await writeFile(
  join(project, external + ".jsonl"),
  [
    rec("user", "检查相机坐标变换"),
    rec("assistant", "正在 VS Code 中继续处理。"),
    { type: "custom-title", customTitle: "坐标变换 · VS Code" },
  ]
    .map(JSON.stringify)
    .join("\n") + "\n",
);
await writeFile(
  join(project, long + ".jsonl"),
  Array.from({ length: 420 }, (_, i) => {
    const message = rec(
      i % 2 ? "assistant" : "user",
      "history-" + String(i).padStart(3, "0"),
    );
    message.timestamp = new Date(1700000000000 + i * 1000).toISOString();
    if (i % 2)
      message.message.content.push({
        type: "tool_use",
        id: randomUUID(),
        name: "Bash",
        input: {
          typingProbe: true,
          command: "echo isolated-browser-fixture\n".repeat(100),
        },
      });
    if (i === 40)
      return {
        type: "attachment",
        uuid: randomUUID(),
        cwd: home,
        timestamp: message.timestamp,
        renderedRole: "system",
        attachment: {
          type: "queued_command",
          source_uuid: message.uuid,
          commandMode: "prompt",
          prompt: message.message.content,
          timestamp: message.timestamp,
        },
      };
    return message;
  })
    .map(JSON.stringify)
    .join("\n") + "\n",
);
await mkdir(join(home, "sessions"));
await writeFile(
  join(home, "sessions", "owner.json"),
  JSON.stringify({
    pid: process.pid,
    sessionId: external,
    entrypoint: "claude-vscode",
  }),
);
let spawned = 0;
function launch() {
  spawned++;
  const p = new EventEmitter();
  p.pid = 99999999;
  p.stdin = new PassThrough();
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  let buffer = "",
    request;
  const emit = (m) => p.stdout.write(JSON.stringify(m) + "\n");
  const reply = (text) => {
    emit({
      type: "assistant",
      uuid: randomUUID(),
      message: { content: [{ type: "text", text }] },
    });
    emit({ type: "result", is_error: false });
  };
  p.stdin.on("data", (chunk) => {
    buffer += chunk;
    let pos;
    while ((pos = buffer.indexOf("\n")) >= 0) {
      const m = JSON.parse(buffer.slice(0, pos));
      buffer = buffer.slice(pos + 1);
      if (m.type === "control_request") {
        emit({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: m.request_id,
            response: {},
          },
        });
        if (m.request.subtype === "interrupt")
          reply("已停止，可以继续发送消息。");
      }
      if (m.type === "user") {
        emit(m);
        const text = m.message.content;
        if (text.includes("approval")) {
          request = randomUUID();
          emit({
            type: "control_request",
            request_id: request,
            request: {
              subtype: "can_use_tool",
              tool_name: "Bash",
              input: { command: "echo browser-test" },
            },
          });
        } else if (text.includes("keep running")) {
          emit({
            type: "stream_event",
            event: { type: "message_start", message: { id: randomUUID() } },
          });
          emit({
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "正在检查代码与测试结果…" },
            },
          });
        } else setTimeout(() => reply("已收到：" + text), 30);
      }
      if (m.type === "control_response" && m.response.request_id === request)
        reply(
          m.response.response.behavior === "allow"
            ? "授权成功，工具已完成。"
            : "已拒绝该工具。",
        );
    }
  });
  p.stdin.on("finish", () => queueMicrotask(() => p.emit("close", 0)));
  p.kill = () => p.emit("close", null, "SIGTERM");
  return p;
}
const server = https.createServer(
  await readTls({ codexHome: home, configDir: join(home, "web-config") }),
  async (req, res) => {
    if (serveDemoSession(req, res)) return;
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (process.env.DEBUG_BROWSER) console.log("HTTP", path);
      const file = path === "/" ? "index.html" : path.slice(1);
      if (file.includes("..")) throw Error();
      const body = await readFile(
        join(process.env.STATIC_TEST_DIR || join(root, "client/dist"), file),
      );
      res.setHeader(
        "content-type",
        extname(file) === ".js"
          ? "text/javascript"
          : extname(file) === ".css"
            ? "text/css"
            : "text/html",
      );
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  },
);
let historyRequests = 0;
const manager = attachClaude(
  server,
  { defaultCwd: home },
  {
    home,
    stateFile: join(home, "web.json"),
    executable: process.execPath,
    launch,
  },
);
const originalOpen = manager.open.bind(manager);
let historyDelay = 0;
manager.open = async (...args) => {
  historyRequests++;
  if (historyDelay)
    await new Promise((resolve) => setTimeout(resolve, historyDelay));
  return originalOpen(...args);
};
const codex = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/rpc")
    codex.handleUpgrade(req, socket, head, (s) => codex.emit("connection", s));
});
const thread = {
  id: "codex-fixture",
  cwd: "/demo/web-project",
  name: "接口重构 · Codex",
  createdAt: 1,
  updatedAt: 2,
  completedAt: 2,
};
codex.on("connection", (s) => {
  s.send(
    JSON.stringify({
      method: "lan/state",
      params: {
        ready: true,
        defaultCwd: "/demo/web-project",
        activeTurns: {},
        compactions: {},
        questions: [],
      },
    }),
  );
  s.on("message", (bytes) => {
    const m = JSON.parse(bytes);
    if (process.env.DEBUG_BROWSER) console.log("RPC", m.method);
    let result = {};
    switch (m.method) {
      case "model/list":
        result = {
          data: [
            {
              id: "demo",
              model: "demo",
              displayName: "Demo model",
              isDefault: true,
              supportedReasoningEfforts: [],
            },
          ],
        };
        break;
      case "account/read":
        result = { account: null };
        break;
      case "config/read":
        result = { config: {} };
        break;
      case "thread/list":
        result = { data: [thread], nextCursor: null };
        break;
      case "thread/read":
      case "thread/resume":
        result = { thread: { ...thread, turns: [] } };
        break;
      case "thread/items/list":
      case "thread/turns/list":
        result = { data: [], nextCursor: null };
        break;
      case "skills/list":
        result = { data: [] };
        break;
      case "lan/projectless/read":
        result = { directories: {} };
        break;
    }
    s.send(JSON.stringify({ id: m.id, result }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let sharedHost;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-proxy-server",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-zygote",
  ],
  executablePath: process.env.CHROME_PATH,
});
try {
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  if (process.env.NOTIFICATIONS_ONLY)
    await page.addInitScript(() => {
      window.notificationLog = [];
      window.notificationHidden = false;
      Object.defineProperty(document, "visibilityState", {
        get: () => (window.notificationHidden ? "hidden" : "visible"),
      });
      Object.defineProperty(navigator, "serviceWorker", {
        value: undefined,
        configurable: true,
      });
      window.Notification = class {
        static permission = "default";
        static async requestPermission() {
          this.permission = "granted";
          return "granted";
        }
        constructor(title, options) {
          this.title = title;
          this.options = options;
          window.notificationLog.push(this);
        }
        close() {}
      };
    });
  await page.addInitScript(() =>
    localStorage.setItem("cx-projects", JSON.stringify(["/demo/web-project"])),
  );
  let blockClaude = false;
  await page.routeWebSocket("**/claude/rpc", (ws) => {
    if (!blockClaude) ws.connectToServer();
  });
  const errors = [];
  page.on("requestfailed", (r) =>
    console.error("Request failed", r.url(), r.failure()?.errorText),
  );
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGEERROR", e.message);
  });
  await page.goto(`https://127.0.0.1:${server.address().port}`, {
    waitUntil: "domcontentloaded",
  });
  if (process.env.NOTIFICATIONS_ONLY) {
    const { testNotifications } = await import("./notifications.mjs");
    await testNotifications({
      page,
      manager,
      codex,
      thread,
      output,
      baseline: !!process.env.BASELINE_ONLY,
    });
    assert.deepEqual(errors, []);
  } else if (process.env.BASELINE_ONLY) {
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: join(output, "before-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
  } else {
    await page
      .getByRole("button", { name: "新建 Claude 对话", exact: true })
      .first()
      .waitFor();
    await page
      .getByRole("button")
      .filter({ hasText: "图片上传 · Claude" })
      .click();
    await page.getByText("单元测试全部通过", { exact: false }).waitFor();
    if (process.env.DEBUG_BROWSER) {
      await page.waitForTimeout(1500);
      console.log("SIDEBAR", await page.locator(".sidebar").innerText());
      console.log(
        "STORAGE",
        await page.evaluate(() => localStorage.getItem("cx-projects")),
      );
    }
    await page.getByText("接口重构 · Codex", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("接口重构 · Codex", { exact: true }).count(),
      1,
    );
    await page.screenshot({
      path: join(output, "desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    for (const name of ["上下文整理摘要", "系统消息"]) {
      const summary = page
        .locator(".claude-system-message")
        .filter({ has: page.locator("summary", { hasText: name }) });
      assert.equal(await summary.count(), 1);
      assert.equal(await summary.evaluate((el) => el.open), false);
    }
    assert.equal(
      await page.locator(".claude-user").count(),
      1,
      "only the actual user prompt belongs on the right",
    );
    await page.getByText("上下文整理摘要", { exact: true }).click();
    await page.getByText("自动上下文摘要：", { exact: false }).waitFor();
    await page.getByText("上下文整理摘要", { exact: true }).click();
    await page.reload();
    await page.getByText("上下文整理摘要", { exact: true }).waitFor();
    assert.equal(await page.locator(".claude-user").count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: join(output, "system-messages-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Pagination maintains chronological order across all pages.
    await page.getByRole("button").filter({ hasText: "history-000" }).click();
    await page.getByText("history-419", { exact: true }).waitFor();
    const texts = await page.locator(".claude-message").allTextContents();
    assert.equal(texts.length, 420);
    assert(texts[0].includes("history-000"));
    assert(texts[419].includes("history-419"));
    assert(
      texts[40].includes("history-040"),
      "mid-turn queued input belongs in its original timeline position",
    );
    // Desktop and phone: jump to the actual bottom and restore following.
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.locator(".claude-messages").evaluate((el) => {
        el.scrollTop = 0;
      });
      const latest = page.getByRole("button", {
        name: "回到最新消息",
        exact: true,
      });
      await latest.waitFor();
      await page.screenshot({
        path: join(output, `scroll-bottom-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await latest.click();
      await page.waitForFunction(() => {
        const el = document.querySelector(".claude-messages");
        return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
      });
      assert.equal(await latest.count(), 0);
      await page.locator(".claude-messages > div").evaluate((el) => {
        const spacer = document.createElement("div");
        spacer.style.height = "300px";
        spacer.dataset.scrollProbe = "true";
        el.append(spacer);
      });
      await page.waitForFunction(() => {
        const el = document.querySelector(".claude-messages");
        return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
      });
      await page.locator("[data-scroll-probe]").evaluate((el) => el.remove());
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Measure repeated history work and disk writes while typing.
    await page.evaluate(() => {
      window.typingProbe = {
        historySerializations: 0,
        draftWrites: 0,
        durations: [],
      };
      const stringify = JSON.stringify;
      JSON.stringify = function (value, ...args) {
        if (value?.typingProbe) window.typingProbe.historySerializations++;
        return stringify.call(this, value, ...args);
      };
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "claude-drafts") window.typingProbe.draftWrites++;
        return setItem.call(this, key, value);
      };
      document.addEventListener(
        "input",
        () => {
          const start = performance.now();
          requestAnimationFrame(() =>
            window.typingProbe.durations.push(performance.now() - start),
          );
        },
        true,
      );
    });
    const longInput = page.getByRole("textbox", {
      name: "发送给 Claude",
      exact: true,
    });
    await longInput.pressSequentially("typing into long history", {
      delay: 15,
    });
    await page.keyboard.insertText(" 中文输入正常");
    assert.equal(
      await longInput.inputValue(),
      "typing into long history 中文输入正常",
    );
    await page.waitForTimeout(600);
    const typing = await page.evaluate(() => window.typingProbe);
    await writeFile(
      join(output, "typing.json"),
      JSON.stringify(typing, null, 2),
    );
    await page.screenshot({
      path: join(output, "typing-long-history.png"),
      fullPage: true,
    });
    if (process.env.TYPING_BASELINE) {
      assert(typing.historySerializations > 0);
      assert(typing.draftWrites > 10);
    } else {
      assert.equal(
        typing.historySerializations,
        0,
        "typing must not rerender history",
      );
      assert(typing.draftWrites <= 2, "typing must batch draft persistence");
    }
    console.log("Typing metrics", JSON.stringify(typing));
    await longInput.dispatchEvent("compositionstart");
    await longInput.dispatchEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    await longInput.dispatchEvent("compositionend", { data: "中文" });
    assert.equal(spawned, 0, "IME confirmation must not send");
    await page
      .getByRole("button")
      .filter({ hasText: "图片上传 · Claude" })
      .click();
    await longInput.fill("separate conversation draft");
    await page.getByRole("button").filter({ hasText: "history-000" }).click();
    assert.equal(
      await longInput.inputValue(),
      "typing into long history 中文输入正常",
    );
    await page.getByText("history-419", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() =>
      sessionStorage.setItem("probe-history-restore", "1"),
    );
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("probe-history-restore")) return;
      sessionStorage.removeItem("probe-history-restore");
      window.restoreFrames = [];
      const end = performance.now() + 6000;
      const sample = () => {
        const pane = document.querySelector(".claude-messages");
        const messages = document.querySelectorAll(".claude-message");
        if (pane && messages.length)
          window.restoreFrames.push({
            last: messages[messages.length - 1].textContent.slice(0, 11),
            gap: pane.scrollHeight - pane.scrollTop - pane.clientHeight,
            count: messages.length,
          });
        if (performance.now() < end) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    historyDelay = 400;
    // Reload before the debounce expires: pagehide must flush the last edit.
    await longInput.fill("刷新前最后输入 中文");
    await page.reload();
    await page.getByText("history-419", { exact: true }).waitFor();
    assert.equal(await longInput.inputValue(), "刷新前最后输入 中文");
    await page.waitForTimeout(700);
    await page.screenshot({
      path: join(output, "mobile-refresh-sync.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".claude-message").length === 420,
    );
    const frames = await page.evaluate(() => window.restoreFrames);
    assert(frames.length > 0);
    assert(
      frames.every((frame) => frame.last === "history-419"),
      "cache sync must never append old pages after the latest message",
    );
    assert(
      frames.every((frame) => frame.gap < 2),
      "refresh must paint at bottom without replaying history scroll",
    );
    const restoredTexts = await page
      .locator(".claude-message")
      .allTextContents();
    assert(restoredTexts[40].includes("history-040"));
    assert(restoredTexts.at(-1).includes("history-419"));
    historyDelay = 0;
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page
      .getByRole("button")
      .filter({ hasText: "坐标变换 · VS Code" })
      .click();
    await page.getByText("此会话正由", { exact: false }).waitFor();
    assert.equal(
      await page.locator('textarea[aria-label="发送给 Claude"]').count(),
      0,
    );
    await page.getByText("检查相机坐标变换", { exact: true }).waitFor();
    const beforeRetry = historyRequests;
    await page.evaluate(() => {
      window.retryMessage = document.querySelector(".claude-message");
    });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(historyRequests, beforeRetry, "retry must not read history");
    assert(
      await page.evaluate(
        () => window.retryMessage === document.querySelector(".claude-message"),
      ),
    );
    await page.screenshot({
      path: join(output, "retry-preserved.png"),
      fullPage: true,
      animations: "disabled",
    });
    sharedHost = spawn(
      process.execPath,
      [
        join(root, "bin/claude-shared.mjs"),
        process.execPath,
        join(root, "tests/fixtures/claude-shared-fake.mjs"),
        "--input-format",
        "stream-json",
        "--resume",
        external,
      ],
      {
        env: { ...process.env, CLAUDE_CONFIG_DIR: home },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const hostMessages = [];
    createInterface({ input: sharedHost.stdout }).on("line", (line) =>
      hostMessages.push(JSON.parse(line)),
    );
    sharedHost.stdin.write(
      JSON.stringify({
        type: "control_request",
        request_id: "init",
        request: { subtype: "initialize" },
      }) + "\n",
    );
    let bridge;
    for (let n = 0; n < 100; n++) {
      bridge = await findSharedBridge(home, external);
      if (bridge) break;
      await page.waitForTimeout(30);
    }
    assert(bridge);
    await writeFile(
      join(home, "sessions", "owner.json"),
      JSON.stringify({
        pid: bridge.childPid,
        sessionId: external,
        entrypoint: "claude-vscode",
      }),
    );
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByText("与插件共享", { exact: true }).waitFor();
    for (const socket of codex.clients) socket.terminate();
    await page.waitForTimeout(2600);
    assert.equal(
      await page.locator(".claude-workspace").count(),
      1,
      "Codex 重连不切走 Claude 会话",
    );
    await page.getByText("与插件共享", { exact: true }).waitFor();
    assert.equal(historyRequests, beforeRetry);
    await page
      .locator('textarea[aria-label="发送给 Claude"]')
      .fill("shared phone message");
    await page
      .getByRole("button", { name: "发送给 Claude", exact: true })
      .click();
    await page
      .getByText("received shared phone message", { exact: true })
      .waitFor();
    assert(
      hostMessages.some(
        (m) =>
          m.type === "user" && m.message.content === "shared phone message",
      ),
    );
    await page.screenshot({
      path: join(output, "shared-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "新建 Claude 对话", exact: true })
      .first()
      .click();
    const input = page.locator('textarea[aria-label="发送给 Claude"]');
    await page
      .getByLabel("Claude 模型", { exact: true })
      .selectOption("sonnet");
    await page
      .getByRole("combobox", { name: "Claude 思考强度", exact: true })
      .selectOption("high");
    assert.equal(await page.getByLabel("Claude 权限模式").inputValue(), "auto");
    await input.fill("hello from phone");
    await page
      .getByRole("button", { name: "发送给 Claude", exact: true })
      .click();
    await page.getByText("已收到：hello from phone", { exact: true }).waitFor();
    await page.getByLabel("Claude 模型", { exact: true }).selectOption("opus");
    await page
      .getByRole("combobox", { name: "Claude 思考强度", exact: true })
      .selectOption("low");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Claude 模型"]').value === "opus" &&
        !document.querySelector('[aria-label="Claude 模型"]').disabled,
    );
    const configured = [...manager.sessions.values()].find(
      (s) => s.title === "hello from phone",
    );
    assert.equal(configured.model, "opus");
    assert.equal(configured.effort, "low");
    assert.equal(configured.permissionMode, "auto");
    await page.getByLabel("Claude 权限模式").selectOption("default");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Claude 权限模式"]').disabled,
    );
    assert.equal(configured.permissionMode, "default");
    await input.fill("approval");
    await page
      .getByRole("button", { name: "发送给 Claude", exact: true })
      .click();
    await page.getByRole("button", { name: "允许本次" }).click();
    await page.getByText("授权成功，工具已完成。", { exact: true }).waitFor();
    await input.fill("keep running");
    await page
      .getByRole("button", { name: "发送给 Claude", exact: true })
      .click();
    await page.getByRole("button", { name: "停止 Claude 任务" }).waitFor();
    // Second browser observes the same running process, then stops it.
    const second = await browser.newPage({ ignoreHTTPSErrors: true });
    await second.goto(page.url());
    await second
      .getByRole("button")
      .filter({ hasText: "hello from phone" })
      .click();
    await second.getByRole("button", { name: "停止 Claude 任务" }).click();
    await page
      .getByText("已停止，可以继续发送消息。", { exact: true })
      .waitFor();
    assert.equal(spawned, 1);
    await second.close();
    await input.fill("draft survives reload");
    await page.waitForTimeout(600);
    await page.evaluate(() => sessionStorage.setItem("seed-stale-cache", "1"));
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seed-stale-cache")) return;
      sessionStorage.removeItem("seed-stale-cache");
      const cache = JSON.parse(localStorage.getItem("claude-history-v1"));
      cache.messages.push({
        id: "stale-cache-only",
        role: "assistant",
        content: [{ type: "text", text: "缓存占位：等待后台校准" }],
      });
      localStorage.setItem("claude-history-v1", JSON.stringify(cache));
    });
    blockClaude = true;
    await page.reload();
    await page.getByText("已收到：hello from phone", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("textbox", { name: "发送给 Claude", exact: true })
        .inputValue(),
      "draft survives reload",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    if (
      await page
        .locator(".sidebar")
        .evaluate((el) => el.getBoundingClientRect().right > 1)
    )
      await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    await page.getByText("缓存占位：等待后台校准", { exact: true }).waitFor();
    await page.screenshot({
      path: join(output, "mobile-cached-offline.png"),
      fullPage: true,
    });
    blockClaude = false;
    await page.reload();
    await page.getByText("已收到：hello from phone", { exact: true }).waitFor();
    await page
      .getByText("缓存占位：等待后台校准", { exact: true })
      .waitFor({ state: "detached" });
    await page.locator('textarea[aria-label="发送给 Claude"]').waitFor();
    assert.equal(
      await page.locator('textarea[aria-label="发送给 Claude"]').inputValue(),
      "draft survives reload",
    );
    await page
      .getByText("已停止，可以继续发送消息。", { exact: true })
      .waitFor();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.screenshot({
      path: join(output, "desktop-dark.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar").getBoundingClientRect().right < 1,
    );
    await page.getByLabel("Claude 模型", { exact: true }).selectOption("haiku");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Claude 模型"]').disabled,
    );
    assert.equal(configured.model, "haiku");
    await page.getByLabel("Claude 权限模式").selectOption("auto");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Claude 权限模式"]').disabled,
    );
    assert.equal(configured.permissionMode, "auto");
    await page
      .getByLabel("Claude 模型", { exact: true })
      .selectOption("custom");
    await page.getByLabel("Claude 自定义模型").fill("vendor-custom-model");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Claude 模型"]').disabled,
    );
    assert.equal(configured.model, "vendor-custom-model");
    await page.screenshot({
      path: join(output, "mobile-custom-model.png"),
      fullPage: true,
    });
    await page.getByLabel("Claude 模型", { exact: true }).selectOption("opus");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Claude 模型"]').disabled,
    );
    await page.screenshot({
      path: join(output, "mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.getByRole("button", { name: "显示侧栏" }).click();
    await page
      .getByRole("combobox", { name: "筛选会话入口" })
      .selectOption("workspace");
    await page
      .getByRole("button")
      .filter({ hasText: "接口重构 · Codex" })
      .click();
    await page.locator(".claude-workspace").waitFor({ state: "detached" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS unified sidebar, pagination, external ownership, send, permissions, two clients, interruption, reload, mobile and Codex switching",
    );
  }
} finally {
  await browser.close();
  if (sharedHost) {
    const closed = new Promise((r) => sharedHost.once("close", r));
    sharedHost.stdin.end();
    await closed;
  }
  for (const s of codex.clients) s.terminate();
  codex.close();
  manager.close();
  await new Promise((r) => server.close(r));
  await rm(home, { recursive: true, force: true });
}
