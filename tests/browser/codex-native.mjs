import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  copyFile,
  chmod,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import { readConfig } from "../../server/src/config.mjs";
import { createAuthentication } from "../../server/src/auth.mjs";
import { createWebApplication } from "../../server/src/application.mjs";
import { authenticationFixture } from "../helpers/auth.mjs";
import { testBrowserZoom } from "./browser-zoom.mjs";

const source = process.env.CODEX_VALIDATION_HOME;
if (!source)
  throw new Error(
    "请通过 CODEX_VALIDATION_HOME 指定已配置模型与认证的 Codex 目录。",
  );
const executable = process.env.CODEX_EXECUTABLE || "codex";
const version = execFileSync(executable, ["--version"], {
  encoding: "utf8",
}).trim();
const { chromium } = await import(
  pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
);
const directory = await mkdtemp(join(tmpdir(), "codex-native-browser-"));
const home = join(directory, "home"),
  cwd = join(directory, "workspace");
const artifacts = ".cache/backend-acceptance/codex-browser";
await mkdir(artifacts, { recursive: true });
await mkdir(home, { mode: 0o700 });
await mkdir(cwd);
for (const name of ["config.toml", "auth.json"]) {
  try {
    await copyFile(join(source, name), join(home, name));
    await chmod(join(home, name), 0o600);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const reserve = createServer();
reserve.listen(0, "127.0.0.1");
await once(reserve, "listening");
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const upstream = `ws://127.0.0.1:${port}`;
const child = spawn(executable, ["app-server", "--listen", upstream], {
  env: { ...process.env, CODEX_HOME: home },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stdout.resume();
child.stderr.on("data", (bytes) => {
  stderr = (stderr + bytes).slice(-100000);
});
let app, browser, page;
const frames = [],
  errors = [];
let socketSequence = 0;
async function completed(text) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const sent = frames.findLast(
      (frame) =>
        frame.direction === "sent" &&
        frame.message.method === "turn/start" &&
        frame.message.params.input?.some((part) => part.text === text),
    );
    const response =
      sent &&
      frames.find(
        (frame) =>
          frame.socket === sent.socket &&
          frame.direction === "received" &&
          frame.message.id === sent.message.id &&
          !frame.message.method,
      )?.message;
    if (response?.error) throw new Error(response.error.message);
    const turn = response?.result?.turn;
    const done =
      turn &&
      frames.find(
        (frame) =>
          frame.message.method === "turn/completed" &&
          frame.message.params.turn.id === turn.id,
      )?.message.params.turn;
    if (done) {
      assert.equal(done.status, "completed", JSON.stringify(done));
      return done;
    }
    await delay(25);
  }
  throw new Error("真实 Codex 网页轮次等待超时");
}
async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Codex app-server退出：${stderr}`);
    const connected = await new Promise((resolve) => {
      const socket = new WebSocket(upstream);
      socket.once("open", () => {
        socket.close();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
    if (connected) return;
    await delay(50);
  }
  throw new Error("真实Codex app-server启动超时");
}
try {
  await waitForServer();
  const auth = await authenticationFixture(home);
  const config = readConfig({
    CODEX_HOME: home,
    CLAUDEX_WEB_CONFIG_DIR: home,
    HOST: "127.0.0.1",
    PORT: "0",
    DEFAULT_CWD: cwd,
    CODEX_APP_SERVER_URL: upstream,
    AUTH_PAMTESTER: auth.pamtester,
  });
  app = createWebApplication({
    config,
    tls: auth.tls,
    authentication: await createAuthentication(config),
    version: { version: "3.1.1", displayVersion: "3.1.1" },
  });
  await app.start();
  const context = await chromium.launchPersistentContext(
    join(directory, "browser-profile"),
    {
      executablePath: process.env.CHROME_PATH,
      headless: true,
      args: ["--no-sandbox"],
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 900 },
    },
  );
  browser = context;
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    const id = ++socketSequence;
    for (const [event, direction] of [
      ["framesent", "sent"],
      ["framereceived", "received"],
    ])
      socket.on(event, ({ payload }) =>
        frames.push({ socket: id, direction, message: JSON.parse(payload) }),
      );
  });
  await page.goto(`https://127.0.0.1:${app.server.address().port}`);
  await page.getByLabel("用户名", { exact: true }).fill(auth.session.username);
  await page.getByLabel("密码", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const selector = page.getByLabel("模型", { exact: true });
  await page.waitForFunction(() =>
    [
      ...(document.querySelector('select[aria-label="模型"]')?.options || []),
    ].some((option) => option.value.startsWith('["codex"')),
  );
  const options = await selector.evaluate((element) =>
    [...element.options].map((option) => ({
      value: option.value,
      label: option.label,
    })),
  );
  const selectedValue = await selector.inputValue();
  const selected = process.env.CODEX_MODEL
    ? options.find(
        (option) => JSON.parse(option.value)[2] === process.env.CODEX_MODEL,
      )
    : options.find((option) => option.value === selectedValue);
  const choice = selected || options[0];
  assert.ok(choice);
  await selector.selectOption(choice.value);
  const model = JSON.parse(choice.value)[2];
  const input = () => page.locator(".markdown-composer .ProseMirror");
  if (process.env.CODEX_BROWSER_ZOOM_ONLY === "1") {
    const report = await testBrowserZoom({
      context,
      page,
      artifacts: join(artifacts, "browser-zoom"),
    });
    assert.equal(
      frames.filter(({ message }) => message.method === "turn/start").length,
      0,
    );
    console.log(
      JSON.stringify({
        browserPageZoom: true,
        modelTurns: 0,
        cases: report.results.length,
      }),
    );
  } else {
    const first =
      "仅在当前目录执行验证：创建 proof.txt，内容精确为 native-browser-proof 加换行，然后读取确认；只回复 NATIVE_BROWSER_FIRST_DONE。";
    await input().fill(first);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await completed(first);
    assert.equal(
      await readFile(join(cwd, "proof.txt"), "utf8"),
      "native-browser-proof\n",
    );
    await page
      .getByText("NATIVE_BROWSER_FIRST_DONE", { exact: true })
      .waitFor();
    await page.reload();
    await page.getByText(first, { exact: true }).waitFor();
    await page
      .getByText("NATIVE_BROWSER_FIRST_DONE", { exact: true })
      .waitFor();
    await input().fill("@proof");
    await input().press("End");
    const reference = page
      .getByRole("listbox", { name: "引用建议" })
      .getByRole("option")
      .filter({ hasText: "proof.txt" });
    await reference.waitFor();
    await reference.click();
    await input().fill("/files");
    await input().press("Control+Enter");
    await page.locator(".tree-row").filter({ hasText: "proof.txt" }).click();
    await page
      .locator(".cm-content")
      .filter({ hasText: "native-browser-proof" })
      .waitFor();
    await page.screenshot({
      path: join(artifacts, "native-file-panel.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "收起对话详情", exact: true })
      .click();
    await input().fill("独立底部草稿");
    const edited =
      "仅在当前目录执行验证：创建或覆盖 proof.txt，内容精确为 native-browser-edited 加换行，然后读取确认；只回复 NATIVE_BROWSER_EDIT_DONE。";
    await page
      .getByRole("button", { name: "编辑上一条消息", exact: true })
      .click();
    await page.locator(".user-message-editor .ProseMirror").fill(edited);
    await page
      .locator(".user-message-editor")
      .getByRole("button", { name: "发送", exact: true })
      .click();
    await completed(edited);
    await page.getByText("NATIVE_BROWSER_EDIT_DONE", { exact: true }).waitFor();
    assert.equal(
      await readFile(join(cwd, "proof.txt"), "utf8"),
      "native-browser-edited\n",
    );
    assert.equal(await input().innerText(), "独立底部草稿");
    await page.reload();
    await page.getByText(edited, { exact: true }).waitFor();
    await page.getByText("NATIVE_BROWSER_EDIT_DONE", { exact: true }).waitFor();
    assert.equal(await page.getByText(first, { exact: true }).count(), 0);
    assert.equal(await input().innerText(), "独立底部草稿");
    await page.screenshot({
      path: join(artifacts, "native-edited-history.png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    const report = {
      version,
      model,
      pamLogin: true,
      nativeCodexAppServer: true,
      realModelFileWrite: true,
      completed: true,
      refreshHistory: true,
      nativeFuzzyReference: true,
      nativeFilePanel: true,
      editRegeneration: true,
      draftPreserved: true,
      pageErrors: errors,
    };
    await writeFile(
      join(artifacts, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report));
  }
} catch (error) {
  await page
    ?.screenshot({ path: join(artifacts, "failure.png"), fullPage: true })
    .catch(() => {});
  if (page)
    await writeFile(
      join(artifacts, "failure-body.txt"),
      await page.locator("body").innerText(),
    );
  await writeFile(
    join(artifacts, "failure.json"),
    JSON.stringify({ error: error.stack, errors, frames, stderr }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  await app?.close();
  if (child.exitCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
