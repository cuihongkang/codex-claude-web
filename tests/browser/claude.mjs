import assert from "node:assert/strict";
import http from "node:http";
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
  Array.from({ length: 220 }, (_, i) =>
    rec(i % 2 ? "assistant" : "user", "history-" + String(i).padStart(3, "0")),
  )
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
const server = http.createServer(async (req, res) => {
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
});
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
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("requestfailed", (r) =>
    console.error("Request failed", r.url(), r.failure()?.errorText),
  );
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("PAGEERROR", e.message);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, {
    waitUntil: "domcontentloaded",
  });
  if (process.env.BASELINE_ONLY) {
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
    assert.equal(
      await page.getByText("接口重构 · Codex", { exact: true }).count(),
      1,
    );
    await page.screenshot({
      path: join(output, "desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    // Pagination maintains chronological order across all pages.
    await page.getByRole("button").filter({ hasText: "history-000" }).click();
    await page.getByText("history-219", { exact: true }).waitFor();
    const texts = await page.locator(".claude-message").allTextContents();
    assert.equal(texts.length, 220);
    assert(texts[0].includes("history-000"));
    assert(texts[219].includes("history-219"));
    await page
      .getByRole("button")
      .filter({ hasText: "坐标变换 · VS Code" })
      .click();
    await page.getByText("此会话正由", { exact: false }).waitFor();
    assert.equal(
      await page.locator('textarea[aria-label="发送给 Claude"]').count(),
      0,
    );
    await page
      .getByRole("button", { name: "新建 Claude 对话", exact: true })
      .first()
      .click();
    const input = page.locator('textarea[aria-label="发送给 Claude"]');
    await input.fill("hello from phone");
    await page
      .getByRole("button", { name: "发送给 Claude", exact: true })
      .click();
    await page.getByText("已收到：hello from phone", { exact: true }).waitFor();
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
    const second = await browser.newPage();
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
    await page.reload();
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
      .getByRole("combobox", { name: "筛选会话后端" })
      .selectOption("codex");
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
  for (const s of codex.clients) s.terminate();
  codex.close();
  manager.close();
  await new Promise((r) => server.close(r));
  await rm(home, { recursive: true, force: true });
}
