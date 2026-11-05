import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { authenticationFixture } from "../helpers/auth.mjs";

assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium");
assert(
  process.env.PLAYWRIGHT_MODULE,
  "通过 PLAYWRIGHT_MODULE 指定 Playwright 模块",
);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = join(root, ".cache/auth-browser");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "codex-web-auth-browser-"));
const auth = await authenticationFixture(directory);
const backend = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await once(backend, "listening");
const thread = {
  id: "login-demo",
  name: "登录保护与草稿恢复",
  cwd: "/demo/project",
  createdAt: 1,
  status: { type: "idle" },
};
const requests = [];
let denyResume = false;
const demoFiles = new Map();
for (const path of [
  "README.md",
  "client/src/assets/codex-web.svg",
  "docs/images/desktop-light.png",
  "docs/images/desktop-dark.png",
  "docs/images/mobile.png",
  "docs/images/mobile-sidebar.png",
])
  demoFiles.set(`/demo/project/${path}`, await readFile(join(root, path)));
backend.on("connection", (socket) =>
  socket.on("message", (bytes) => {
    const m = JSON.parse(bytes);
    requests.push(m);
    if (m.method === "thread/resume" && denyResume) {
      socket.send(
        JSON.stringify({
          id: m.id,
          error: {
            code: -32000,
            message: "thread already has an active writer",
          },
        }),
      );
      return;
    }
    let result = {};
    if (m.method === "skills/list") result = { data: [{ skills: [] }] };
    if (m.method === "plugin/installed")
      result = {
        marketplaces: [
          {
            plugins: [
              { id: "internal-plugin-id", name: "笔记", enabled: true },
            ],
          },
        ],
      };
    if (m.method === "mcpServerStatus/list")
      result = {
        data: [
          {
            name: "项目资料",
            tools: { search: {} },
            authStatus: "internal-auth-status",
          },
        ],
      };
    if (m.method === "thread/list")
      result = { data: [thread], nextCursor: null };
    if (["thread/read", "thread/resume"].includes(m.method))
      result = { thread, cwd: thread.cwd };
    if (m.method === "thread/turns/list")
      result = {
        data: [
          {
            id: "demo-turn",
            status: "completed",
            startedAt: 1,
            completedAt: 2,
          },
        ],
        nextCursor: null,
      };
    if (m.method === "thread/items/list")
      result = {
        data: [
          {
            turnId: "demo-turn",
            item: {
              id: "demo-answer",
              type: "agentMessage",
              phase: "final_answer",
              text: "工作空间已准备好，可以继续处理项目。",
            },
          },
          {
            turnId: "demo-turn",
            item: {
              id: "demo-user",
              type: "userMessage",
              content: [{ type: "text", text: "请准备工作空间。" }],
            },
          },
        ],
        nextCursor: null,
      };
    if (m.method === "model/list")
      result = {
        data: [
          {
            id: "demo-model",
            model: "demo-model",
            displayName: "Codex",
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
          },
        ],
      };
    if (m.method === "config/read")
      result = {
        config: { model: "demo-model", model_reasoning_effort: "medium" },
      };
    if (m.method === "account/read")
      result = {
        account: {
          type: "chatgpt",
          email: "demo@example.test",
          planType: "plus",
        },
      };
    if (m.method === "skills/list") result = { data: [] };
    if (m.method === "fs/readDirectory")
      result = { entries: [{ fileName: "README.md", isDirectory: false }] };
    if (m.method === "fs/readFile")
      result = {
        dataBase64: (
          demoFiles.get(m.params.path) || Buffer.from("演示文件")
        ).toString("base64"),
      };
    if (m.id !== undefined) socket.send(JSON.stringify({ id: m.id, result }));
  }),
);
let child, exited, url, browser;
const errors = [];
const start = async (before = false) => {
  child = spawn(
    process.execPath,
    [
      join(
        root,
        before
          ? ".cache/auth-before/server/src/server.mjs"
          : "server/src/server.mjs",
      ),
    ],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: "0",
        CODEX_HOME: directory,
        DEFAULT_CWD: "/demo/project",
        STATIC_DIR: join(
          root,
          before ? ".cache/auth-before/client/dist" : "client/dist",
        ),
        AUTH_PAMTESTER: auth.pamtester,
        CODEX_APP_SERVER_URL: `ws://127.0.0.1:${backend.address().port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  exited = once(child, "exit");
  child.stderr.on("data", (bytes) => errors.push(String(bytes)));
  url = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`服务退出 ${code}`)));
    child.stdout.on("data", (bytes) => {
      const match = String(bytes).match(/https?:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
  });
};
const stop = async () => {
  if (child?.exitCode === null) {
    child.kill();
    await exited;
  }
};
const evidence = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--no-proxy-server"],
  });
  if (process.env.BROWSER_BEFORE === "1") {
    await start(true);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url);
    await page.locator(".app-shell").waitFor();
    assert.equal(await page.locator('input[name="password"]').count(), 0);
    await page.screenshot({ path: join(output, "before-no-login.png") });
    await writeFile(
      join(output, "before-build.json"),
      await readFile(join(root, ".cache/auth-before/build-info.json")),
    );
    console.log("PASS main 对照：未验证时直接展示工作区");
  } else {
    await start();
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript(() => {
      window.passwordSaveRequests = [];
      const store = navigator.credentials.store;
      navigator.credentials.store = function (credential) {
        window.passwordSaveRequests.push({
          id: credential.id,
          type: credential.type,
        });
        return store.call(this, credential);
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator(".login-card form").waitFor();
    assert.equal(await page.locator(".app-shell").count(), 0);
    const screenshot = async (name) => {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: join(output, name + ".png"),
        fullPage: name.startsWith("certificate"),
      });
      evidence.push({
        name,
        url: new URL(page.url()).protocol,
        viewport: page.viewportSize(),
      });
    };
    await screenshot("login-light");
    assert.equal(
      await page.getByText("HTTPS 加密连接", { exact: true }).count(),
      0,
    );
    assert.equal(await page.getByText("使用运行服务的系统账户登录").count(), 0);
    await page.route("**/api/tls/info", (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await page.getByText("浏览器证书安装", { exact: true }).click();
    await page.getByText("证书信息读取失败。", { exact: false }).waitFor();
    await page.unroute("**/api/tls/info");
    await page
      .locator(".certificate-help")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await page.getByLabel("选择你的设备").waitFor();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载证书", exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), "codex-web.cer");
    const certificate = new X509Certificate(
      await readFile(await download.path()),
    );
    assert.equal(
      certificate.fingerprint256,
      new X509Certificate(auth.tls.cert).fingerprint256,
    );
    await page.getByText("核对证书", { exact: true }).click();
    assert(
      (await page.locator(".certificate-details").innerText()).includes(
        certificate.fingerprint256,
      ),
    );
    await screenshot("certificate-windows");
    await page.getByLabel("选择你的设备").selectOption("Ubuntu");
    const ubuntuSteps = await page
      .locator(".certificate-content ol")
      .innerText();
    for (const text of [
      "openssl x509 -inform DER",
      "sudo install -m 644",
      "sudo update-ca-certificates",
      "Chrome / Chromium",
      "Firefox",
    ])
      assert(ubuntuSteps.includes(text), text);
    await screenshot("certificate-ubuntu-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await screenshot("certificate-ubuntu-dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot("certificate-ubuntu-mobile-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await screenshot("certificate-ubuntu-mobile-light");
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
      await page.evaluate((value) => {
        document.body.style.zoom = value;
      }, zoom);
      await screenshot(`certificate-ubuntu-zoom-${zoom}`);
    }
    await page.evaluate(() => {
      document.body.style.zoom = "";
    });
    await page.getByLabel("选择你的设备").selectOption("macOS");
    assert(
      (await page.locator(".certificate-content ol").innerText()).includes(
        "钥匙串",
      ),
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await screenshot("certificate-macos-dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("选择你的设备").selectOption("iPhone / iPad");
    await screenshot("certificate-mobile");
    await page.getByLabel("选择你的设备").selectOption("Android");
    assert(
      (await page.locator(".certificate-content ol").innerText()).includes(
        "CA 证书",
      ),
    );
    await page.getByText("浏览器证书安装", { exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.emulateMedia({ colorScheme: "dark" });
    await screenshot("login-dark");
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot("login-mobile-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await screenshot("login-mobile");
    await page.setViewportSize({ width: 1280, height: 800 });
    // 密码管理器可以直接填写 DOM，提交不能依赖 React 的输入事件。
    await page.evaluate(() => {
      document.querySelector('input[name="username"]').value = "demo";
      document.querySelector('input[name="password"]').value = "wrong";
    });
    assert(
      await page.getByRole("button", { name: "登录", exact: true }).isEnabled(),
    );
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /用户名或密码错误/);
    assert.equal(
      await page.getByLabel("密码", { exact: true }).inputValue(),
      "",
    );
    assert.deepEqual(
      await page.evaluate(() => window.passwordSaveRequests),
      [],
    );
    await screenshot("login-error");
    const signIn = async (target = page) => {
      await target
        .getByLabel("用户名", { exact: true })
        .fill(userInfo().username);
      await target.getByLabel("密码", { exact: true }).fill("fixture-password");
      await target.getByRole("button", { name: "登录", exact: true }).click();
      await target.locator(".app-shell").waitFor();
      await target.waitForFunction(
        () => !document.querySelector(".connection-banner"),
      );
    };
    await signIn();
    assert.deepEqual(await page.evaluate(() => window.passwordSaveRequests), [
      { id: userInfo().username, type: "password" },
    ]);
    for (const mode of ["unsupported", "rejected"]) {
      const fallback = await browser.newContext({ ignoreHTTPSErrors: true });
      try {
        await fallback.addInitScript((mode) => {
          if (mode === "unsupported")
            Object.defineProperty(window, "PasswordCredential", {
              value: undefined,
            });
          else
            navigator.credentials.store = () =>
              Promise.reject(
                new DOMException("Saving disabled", "NotAllowedError"),
              );
        }, mode);
        const fallbackPage = await fallback.newPage();
        fallbackPage.on("pageerror", (error) => errors.push(error.message));
        await fallbackPage.goto(url);
        await signIn(fallbackPage);
        assert.equal(await fallbackPage.locator("#login-form").count(), 0);
      } finally {
        await fallback.close();
      }
    }
    for (const name of ["技能", "插件与连接"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await page
        .getByRole("button", { name: "关闭窗口", exact: true })
        .waitFor();
      if (name === "技能")
        await page.getByText("此目录没有可用技能", { exact: true }).waitFor();
      else {
        await page.getByText("项目资料", { exact: true }).waitFor();
        assert(
          !(await page.locator(".catalog-list").innerText()).includes(
            "internal-",
          ),
        );
      }
      await screenshot(name === "技能" ? "skills-clean" : "plugins-clean");
      await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    }
    await page.getByLabel("消息", { exact: true }).fill("/model");
    await page.getByLabel("消息", { exact: true }).press("Control+Enter");
    await page.getByRole("button", { name: "完成", exact: true }).waitFor();
    await screenshot("model-clean");
    await page.getByRole("button", { name: "完成", exact: true }).click();
    denyResume = true;
    await page.evaluate(
      (id) => localStorage.setItem("cx-current", id),
      thread.id,
    );
    await page.reload();
    await page.getByText("此对话由另一端使用", { exact: true }).waitFor();
    assert(
      !(await page.locator(".composer-wrap").innerText()).includes(
        "历史记录可",
      ),
    );
    await screenshot("blocked-clean");
    denyResume = false;
    await page
      .getByRole("button", { name: "重试连接对话", exact: true })
      .click();
    await page.getByLabel("消息", { exact: true }).waitFor();
    await page.getByRole("button", { name: "文件", exact: true }).click();
    await page.getByRole("button", { name: "README.md", exact: true }).click();
    await page.locator(".file-markdown-preview").waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".file-markdown-preview img")]
        .filter((image) => image.offsetHeight > 0)
        .every((image) => image.complete && image.naturalWidth > 0),
    );
    assert.match(
      await page.locator(".file-markdown-preview").innerText(),
      /证书/,
    );
    await screenshot("readme-light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() =>
      document
        .querySelector(".file-markdown-preview picture img")
        ?.currentSrc?.includes("data:"),
    );
    await screenshot("readme-dark");
    await page.locator(".file-markdown-preview summary").first().click();
    await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator(".file-markdown-preview details img")
      .first()
      .scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      [
        ...document.querySelectorAll(".file-markdown-preview details img"),
      ].every((image) => image.complete && image.naturalWidth > 0),
    );
    await screenshot("readme-mobile-expanded");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole("button", { name: "显示侧栏", exact: true }).click();
    await page
      .getByRole("button", { name: "折叠对话详情", exact: true })
      .first()
      .click();
    const cookies = await context.cookies();
    const session = cookies.find(
      (cookie) => cookie.name === "__Host-codex-web-session",
    );
    assert(session.secure && session.httpOnly && session.sameSite === "Strict");
    assert(session.expires > Date.now() / 1000 + 29 * 86400);
    await page.reload();
    await page.locator(".app-shell").waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".breadcrumb > span")?.textContent ===
          "登录保护与草稿恢复" && document.querySelector('[aria-label="消息"]'),
    );
    assert.equal(await page.locator(".login-card").count(), 0);
    await page
      .getByLabel("消息", { exact: true })
      .fill("登录退出后继续保留的草稿");
    await screenshot("authenticated-draft");
    const second = await context.newPage();
    await second.goto(url);
    await second.locator(".app-shell").waitFor();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const settingsText = await page.locator(".settings-body").innerText();
    for (const marker of [
      "桥接服务",
      "开发构建",
      "未提交",
      "构建时间",
      "app-server",
      "+dev.",
    ])
      assert(!settingsText.includes(marker));
    await screenshot("settings-clean");
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.locator(".login-card form").waitFor();
    await second.locator(".login-card form").waitFor();
    assert.equal(await page.locator(".app-shell").count(), 0);
    await page.getByLabel("用户名", { exact: true }).fill("");
    await screenshot("logged-out");
    await signIn();
    await page.waitForFunction(() => {
      const input = document.querySelector('[aria-label="消息"]');
      return (
        (input?.value ?? input?.textContent) === "登录退出后继续保留的草稿"
      );
    });
    await screenshot("draft-restored");
    const saved = await context.storageState();
    await context.close();
    const reopened = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: saved,
    });
    const restored = await reopened.newPage();
    await restored.goto(url);
    await restored.locator(".app-shell").waitFor();
    assert.equal(await restored.locator(".login-card").count(), 0);
    // 在隔离响应中缩短服务端返回的到期时间，验证页面计时器与草稿保留。
    await restored.waitForFunction(
      () =>
        document.querySelector(".breadcrumb > span")?.textContent ===
          "登录保护与草稿恢复" && document.querySelector('[aria-label="消息"]'),
    );
    await restored.getByLabel("消息", { exact: true }).fill("过期后保留的草稿");
    await restored.route("**/api/auth/session", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({
        response,
        json: { ...data, expiresAt: Date.now() + 250 },
      });
    });
    await restored.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent("pageshow")),
    );
    await restored.locator(".login-card form").waitFor();
    assert.equal(await restored.locator(".app-shell").count(), 0);
    await restored.screenshot({ path: join(output, "expired.png") });
    await restored.unroute("**/api/auth/session");
    await signIn(restored);
    await restored.waitForFunction(() => {
      const input = document.querySelector('[aria-label="消息"]');
      return (input?.value ?? input?.textContent) === "过期后保留的草稿";
    });
    assert(
      !requests.some((request) =>
        ["turn/interrupt", "command/exec/terminate"].includes(request.method),
      ),
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    await writeFile(
      join(output, "evidence.json"),
      JSON.stringify(
        {
          build: JSON.parse(await readFile(join(root, "build-info.json"))),
          checks: [
            "HTTPS/WSS",
            "拒绝未登录内容",
            "错误提示",
            "安全持久Cookie",
            "刷新恢复",
            "多标签页退出",
            "草稿恢复",
            "浏览器重开",
            "过期遮蔽",
            "无任务停止请求",
          ],
          screenshots: evidence,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS HTTPS 系统登录、持久 Cookie、刷新及重新打开、跨页面退出、到期与草稿恢复、深浅主题和手机布局",
    );
  }
} finally {
  await browser?.close();
  await stop();
  for (const socket of backend.clients) socket.terminate();
  await new Promise((resolve) => backend.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
