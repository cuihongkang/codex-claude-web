import { serveDemoSession } from "../helpers/browser-session.mjs";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const before = process.env.BROWSER_BEFORE === "1";
const source = before ? ".cache/account-usage-compact-before" : ".";
const build = join(root, before ? source + "/dist" : "client/dist");
const output = join(
  root,
  ".cache/account-usage-compact-browser",
  before ? "before" : "after",
);
await mkdir(output, { recursive: true });
const buildInfo = JSON.parse(
  await readFile(join(root, source, "build-info.json"), "utf8"),
);

function fixture() {
  localStorage.clear();
  localStorage.setItem("cx-theme", JSON.stringify("light"));
  const threads = ["整理项目文档", "检查代码变更", "完善页面交互"].map(
    (name, i) => ({
      id: "quota-demo-" + i,
      name,
      cwd: "/demo/claudex-web",
      createdAt: 1,
      completedAt: 2,
    }),
  );
  const data = (window.quotaFixture = {
    requests: [],
    poll: false,
    fail: false,
    plan: "pro",
    snapshot: {
      rateLimits: {
        limitId: "codex",
        planType: "pro",
        primary: {
          usedPercent: 41,
          windowDurationMins: 10080,
          resetsAt: Math.floor(Date.now() / 1000) + 345600,
        },
        secondary: null,
        credits: { hasCredits: true, unlimited: false, balance: "1250.756789" },
      },
    },
    emit(method, params) {
      this.socket.onmessage({ data: JSON.stringify({ method, params }) });
    },
    changePlan(plan) {
      this.plan = plan;
      this.snapshot = {
        rateLimits: {
          limitId: "codex",
          planType: plan,
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: "1250.756789",
          },
          primary:
            plan === "plus"
              ? {
                  usedPercent: 28,
                  windowDurationMins: 300,
                  resetsAt: Math.floor(Date.now() / 1000) + 7200,
                }
              : {
                  usedPercent: 41,
                  windowDurationMins: 10080,
                  resetsAt: Math.floor(Date.now() / 1000) + 345600,
                },
          secondary:
            plan === "plus"
              ? {
                  usedPercent: 41,
                  windowDurationMins: 10080,
                  resetsAt: Math.floor(Date.now() / 1000) + 345600,
                }
              : null,
        },
      };
      this.snapshot.rateLimitsByLimitId = { codex: this.snapshot.rateLimits };
      this.emit("account/updated", { authMode: "chatgpt", planType: plan });
    },
  });
  const interval = window.setInterval;
  window.setInterval = (callback, milliseconds, ...args) => {
    if (milliseconds === 30000) data.countdownTick = callback;
    return interval(
      () => {
        if (milliseconds !== 60000 || data.poll) callback(...args);
      },
      milliseconds === 60000 ? 200 : milliseconds,
    );
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      data.socket = this;
      setTimeout(
        () =>
          data.emit("lan/state", {
            ready: true,
            defaultCwd: "/demo/claudex-web",
            activeTurns: {},
            questions: [],
            terminals: {},
          }),
        0,
      );
    }
    send(raw) {
      const m = JSON.parse(raw);
      data.requests.push(m);
      let result = {};
      if (m.method === "account/read")
        result = {
          account: {
            type: "chatgpt",
            email: "alex@example.test",
            planType: data.plan,
          },
        };
      if (m.method === "account/rateLimits/read")
        result = structuredClone(data.snapshot);
      if (m.method === "model/list")
        result = {
          data: [
            {
              id: "demo-model",
              model: "demo-model",
              displayName: "GPT-6.1-Sol",
              isDefault: true,
            },
          ],
        };
      if (m.method === "config/read") result = { config: {} };
      if (m.method === "thread/list")
        result = { data: threads, nextCursor: null };
      if (m.method === "skills/list") result = { data: [] };
      if (m.method === "lan/projectless/read") result = { directories: {} };
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              id: m.id,
              ...(m.method === "account/rateLimits/read" && data.fail
                ? { error: { message: "模拟额度读取失败" } }
                : { result }),
            }),
          }),
        0,
      );
    }
  };
  data.snapshot.rateLimitsByLimitId = { codex: data.snapshot.rateLimits };
}

const server = http.createServer(async (req, res) => {
  if (serveDemoSession(req, res)) return;
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    let content = await readFile(
      join(build, path === "/" ? "index.html" : path),
    );
    if (path === "/")
      content = content
        .toString()
        .replace("<head>", `<head><script>(${fixture.toString()})()</script>`);
    res
      .writeHead(200, {
        "Content-Type":
          {
            ".js": "text/javascript",
            ".css": "text/css",
            ".html": "text/html",
          }[extname(path === "/" ? "index.html" : path)] ||
          "application/octet-stream",
      })
      .end(content);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
assert(process.env.CHROME_PATH, "通过 CHROME_PATH 指定 Chromium 可执行文件");
const profile = await mkdtemp(join(tmpdir(), "claudex-web-quota-"));
const child = spawn(
  process.env.CHROME_PATH,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--no-proxy-server",
    "--remote-debugging-port=0",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error("浏览器启动超时")), 10000);
    child.stderr.on("data", (data) => {
      log += data;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("error", reject);
  });
  ws = new WebSocket(endpoint);
  await new Promise((resolve) =>
    ws.addEventListener("open", resolve, { once: true }),
  );
  let sequence = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (!m.id) return;
    const request = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) request.reject(Error(JSON.stringify(m.error)));
    else request.resolve(m.result);
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const page = (method, params) => call(method, params, sessionId);
  const evaluate = async (expression) => {
    const result = await page("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw Error(
      "等待超时：" +
        expression +
        "\n" +
        (await evaluate("document.body.innerText")),
    );
  };
  const click = async (selector) => {
    const point = await evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ["mousePressed", "mouseReleased"])
      await page("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        ...point,
      });
    await new Promise((resolve) => setTimeout(resolve, 60));
  };
  const key = async (key, code, windowsVirtualKeyCode) => {
    for (const type of ["keyDown", "keyUp"])
      await page("Input.dispatchKeyEvent", {
        type,
        key,
        code,
        windowsVirtualKeyCode,
        ...(type === "keyDown" && key === "Enter"
          ? { text: "\r", unmodifiedText: "\r" }
          : {}),
        ...(type === "keyDown" && key === " "
          ? { text: " ", unmodifiedText: " " }
          : {}),
      });
  };
  const assertResetLine = async () => {
    const lines = await evaluate(
      "[...document.querySelectorAll('.quota-reset')].map(e=>{const a=e.firstElementChild.getBoundingClientRect(),b=e.querySelector('time').getBoundingClientRect(),panel=e.closest('.account-quota')||e.closest('.settings-body');return {text:e.textContent,top:a.top,absoluteTop:b.top,right:b.right,panelRight:panel.getBoundingClientRect().right}})",
    );
    assert(
      lines.length > 0 &&
        lines.every(
          (line) =>
            Math.abs(line.top - line.absoluteTop) < 1 &&
            line.right <= line.panelRight - 1,
        ),
      JSON.stringify(lines),
    );
  };
  const ensureSidebar = async () => {
    if (
      await evaluate(
        "(()=>{const e=document.querySelector('.sidebar'),button=document.querySelector('.topbar button[title=\"显示侧栏\"]');return button.getClientRects().length>0 && !e.classList.contains('mobile-open')})()",
      )
    ) {
      await waitFor(
        "document.querySelector('.sidebar').getBoundingClientRect().right<=0.5",
      );
      await click('.topbar button[title="显示侧栏"]');
    }
    try {
      await waitFor(
        "getComputedStyle(document.querySelector('.sidebar')).transform==='none' && document.querySelector('.sidebar').getBoundingClientRect().left>=-0.1",
      );
    } catch (error) {
      await screenshot("sidebar-failure");
      throw Error(
        error.message +
          "\n" +
          JSON.stringify(
            await evaluate(
              "(()=>{const e=document.querySelector('.sidebar'),b=document.querySelector('.topbar button[title=\"显示侧栏\"]'),r=b.getBoundingClientRect();return {classes:e.className,rect:e.getBoundingClientRect().toJSON(),transform:getComputedStyle(e).transform,button:r.toJSON(),buttonDisplay:getComputedStyle(b).display,atButton:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML,viewport:[innerWidth,innerHeight]}})()",
            ),
          ),
      );
    }
  };
  const screenshot = async (name, selector) => {
    await page("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    await evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
    );
    const clip = selector
      ? await evaluate(
          `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`,
        )
      : undefined;
    const { data } = await page("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip } : {}),
    });
    await writeFile(join(output, name + ".png"), Buffer.from(data, "base64"));
  };
  await page("Emulation.setTimezoneOverride", { timezoneId: "Asia/Shanghai" });
  await page("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.navigate", {
    url: `http://127.0.0.1:${server.address().port}`,
  });
  await waitFor(
    "document.querySelector('.account-button')?.textContent.includes('alex')",
  );
  if (before) {
    await waitFor(
      "document.querySelector('.sidebar-footer progress')?.value===59",
    );
    assert(
      await evaluate(
        "document.querySelector('.account-card').getBoundingClientRect().height>120",
      ),
    );
    await screenshot("desktop-pro-light");
    await screenshot("account-pro", ".account-card");
    await evaluate("quotaFixture.changePlan('plus')");
    await waitFor(
      "document.querySelectorAll('.sidebar-footer progress').length===2",
    );
    await screenshot("account-plus", ".account-card");
    await click(".account-button");
    await waitFor("document.querySelector('.settings-account')");
    await screenshot("settings-plus", ".modal-settings");
  } else {
    const values =
      "[...document.querySelectorAll('.quota-summary[role=progressbar]')].map(e=>e.getAttribute('aria-valuenow')).join(',')";
    await waitFor(`${values}==='59'`);
    assert(
      await evaluate(
        "document.querySelector('.quota-toggle').getAttribute('aria-expanded')==='false' && !document.querySelector('.account-quota')",
      ),
    );
    const foldedHeight = await evaluate(
      "document.querySelector('.account-card').getBoundingClientRect().height",
    );
    assert(foldedHeight < 60);
    await screenshot("desktop-pro-light");
    await screenshot("account-pro", ".account-card");
    await click(".quota-toggle");
    await waitFor("document.querySelector('.account-quota time')");
    assert(
      await evaluate(
        "/后重置/.test(document.querySelector('.quota-reset > span').textContent) && /月/.test(document.querySelector('.quota-reset time').textContent)",
      ),
    );
    assert.equal(
      await evaluate("document.querySelector('.quota-credits b')?.textContent"),
      "1,250.76",
    );
    await screenshot("account-pro-expanded", ".account-quota");
    await assertResetLine();
    await click(".quota-toggle");
    await waitFor("!document.querySelector('.account-quota')");
    await evaluate("document.querySelector('.quota-toggle').focus()");
    await key("Enter", "Enter", 13);
    await waitFor("document.querySelector('.account-quota')");
    await key("Escape", "Escape", 27);
    await waitFor("!document.querySelector('.account-quota')");
    assert(
      await evaluate(
        "document.activeElement.classList.contains('quota-toggle')",
      ),
    );
    await evaluate("document.documentElement.dataset.theme='dark'");
    await screenshot("desktop-pro-dark");
    await evaluate(
      "quotaFixture.emit('account/rateLimits/updated',{rateLimits:{limitId:null,primary:{usedPercent:50},planType:null}})",
    );
    await waitFor(`${values}==='50'`);
    await evaluate(
      "quotaFixture.snapshot.rateLimits.primary.usedPercent=65;quotaFixture.poll=true",
    );
    await waitFor(`${values}==='35'`);
    await evaluate(
      "quotaFixture.poll=false;quotaFixture.fail=true;window.dispatchEvent(new Event('focus'))",
    );
    await waitFor("document.querySelector('.quota-toggle[data-stale=true]')");
    assert.equal(await evaluate(values), "35");
    await screenshot("account-stale", ".account-card");
    await evaluate(
      "quotaFixture.fail=false;quotaFixture.snapshot.rateLimits.primary.usedPercent=45;window.dispatchEvent(new Event('focus'))",
    );
    await waitFor(
      `${values}==='55' && !document.querySelector('.quota-toggle[data-stale=true]')`,
    );
    await evaluate(
      "quotaFixture.changePlan('plus');document.documentElement.dataset.theme='light'",
    );
    await waitFor(`${values}==='72,59'`);
    await click(".welcome h1");
    assert.equal(
      await evaluate(
        "document.querySelector('.account-card').getBoundingClientRect().height",
      ),
      foldedHeight,
    );
    await screenshot("desktop-plus-light");
    await screenshot("account-plus", ".account-card");
    await click(".quota-toggle");
    await waitFor(
      "document.querySelectorAll('.account-quota time').length===2",
    );
    await screenshot("account-plus-expanded", ".account-quota");
    await assertResetLine();
    const beforeCountdown = await evaluate("quotaFixture.requests.length");
    const absoluteBefore = await evaluate(
      "document.querySelector('.quota-reset time').textContent",
    );
    await evaluate(
      "quotaFixture.originalNow=Date.now;Date.now=()=>quotaFixture.originalNow()+61*60000;quotaFixture.countdownTick()",
    );
    await waitFor(
      "document.querySelector('.quota-reset > span').textContent.includes('59 分钟后重置')",
    );
    assert.equal(
      await evaluate("quotaFixture.requests.length"),
      beforeCountdown,
    );
    assert.equal(
      await evaluate("document.querySelector('.quota-reset time').textContent"),
      absoluteBefore,
    );
    await evaluate(
      "Date.now=quotaFixture.originalNow;quotaFixture.countdownTick()",
    );
    await click(".welcome h1");
    await waitFor("!document.querySelector('.account-quota')");
    await click(".quota-toggle");
    await key(" ", "Space", 32);
    await waitFor("!document.querySelector('.account-quota')");
    await click(".account-button");
    await waitFor("document.querySelector('.modal-settings')");
    assert(
      await evaluate(
        "!document.querySelector('.settings-account') && !document.querySelector('.settings-body progress') && !document.querySelector('.settings-body').textContent.includes('账户与用量') && ['外观','快捷键','关于'].every(text=>document.querySelector('.settings-body').textContent.includes(text))",
      ),
    );
    await screenshot("settings-plus");
    await click('.modal-heading button[title="关闭窗口"]');

    const layouts = [];
    for (const theme of ["light", "dark", "system"]) {
      await page("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "dark" }],
      });
      for (const zoom of [0.8, 1, 1.25, 1.5, 2]) {
        await page("Emulation.setDeviceMetricsOverride", {
          width: Math.round(1440 / zoom),
          height: Math.round(900 / zoom),
          deviceScaleFactor: zoom,
          mobile: false,
        });
        await evaluate(
          `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
        );
        await evaluate(
          "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        );
        await ensureSidebar();
        const layout = await evaluate(
          `(()=>{const card=document.querySelector('.account-card'), r=card.getBoundingClientRect();return {theme:${JSON.stringify(theme)},zoom:${zoom},width:r.width,height:r.height,bottom:r.bottom,viewport:innerHeight,clipped:card.scrollWidth>card.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,progress:[...card.querySelectorAll('.quota-ring')].map(e=>e.getBoundingClientRect().width),background:getComputedStyle(document.querySelector('.sidebar')).backgroundColor}})()`,
        );
        layouts.push(layout);
        assert(
          !layout.clipped &&
            !layout.overflow &&
            layout.bottom <= layout.viewport + 1 &&
            layout.progress.every((width) => width > 0),
          JSON.stringify(layout),
        );
        await screenshot(`${theme}-${zoom}`);
        await click(".quota-toggle");
        await waitFor("document.querySelector('.account-quota')");
        assert(
          await evaluate(
            "(()=>{const e=document.querySelector('.account-quota'),r=e.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && e.scrollWidth===e.clientWidth})()",
          ),
        );
        assert.equal(
          await evaluate(
            "document.querySelector('.quota-credits b')?.textContent",
          ),
          "1,250.76",
        );
        await screenshot(`${theme}-${zoom}-expanded`);
        await assertResetLine();
        await click(".quota-toggle");
      }
    }
    const dark = layouts.find((r) => r.theme === "dark" && r.zoom === 1);
    const system = layouts.find((r) => r.theme === "system" && r.zoom === 1);
    assert.equal(dark.background, system.background);
    await page("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate("document.documentElement.dataset.theme='light'");
    await ensureSidebar();
    await screenshot("mobile-plus-light");
    await click(".quota-toggle");
    await screenshot("mobile-plus-expanded");
    await assertResetLine();
    await evaluate("document.documentElement.style.fontSize='17px'");
    await ensureSidebar();
    await screenshot("mobile-large-font");
    assert(
      await evaluate(
        "(()=>{const row=document.querySelector('.account-row'),panel=document.querySelector('.account-quota'),r=panel.getBoundingClientRect();return row.scrollWidth===row.clientWidth && row.getBoundingClientRect().bottom<=innerHeight && panel.scrollWidth===panel.clientWidth && r.left>=0 && r.right<=innerWidth && r.top>=0})()",
      ),
    );
    await assertResetLine();
    await evaluate(
      "document.documentElement.style.fontSize='13px';quotaFixture.emit('account/rateLimits/updated',{rateLimits:{limitId:'codex',primary:{usedPercent:98},secondary:{usedPercent:100}}})",
    );
    await waitFor(`${values}==='2,0'`);
    await screenshot("mobile-low-quota");
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.quota-summary[data-level=low]').length",
      ),
      2,
    );
    for (const [credits, expected] of [
      [{ hasCredits: true, balance: "0" }, "0"],
      [{ hasCredits: false, balance: null }, "0"],
      [{ unlimited: true }, "无限额"],
      [{ hasCredits: true, balance: null }, "余额暂不可用"],
    ]) {
      await evaluate(
        `quotaFixture.snapshot={rateLimits:{limitId:'codex',credits:${JSON.stringify(credits)}}};window.dispatchEvent(new Event('focus'))`,
      );
      await waitFor(
        `document.querySelector('.quota-credits b')?.textContent===${JSON.stringify(expected)}`,
      );
      assert(await evaluate("!document.querySelector('.quota-empty')"));
    }
    await screenshot("mobile-credits-unavailable");
    await evaluate(
      "quotaFixture.fail=true;window.dispatchEvent(new Event('focus'))",
    );
    await waitFor("document.querySelector('.quota-stale')");
    assert.equal(
      await evaluate("document.querySelector('.quota-credits b').textContent"),
      "余额暂不可用",
    );
    await evaluate(
      "quotaFixture.fail=false;quotaFixture.snapshot={rateLimits:{limitId:'codex',credits:null}};window.dispatchEvent(new Event('focus'))",
    );
    await waitFor("!document.querySelector('.quota-credits')");
    await writeFile(
      join(output, "layouts.json"),
      JSON.stringify(layouts, null, 2),
    );
  }
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        passed: true,
        before,
        buildInfo,
        fixture: "tests/browser/account-usage.mjs:fixture",
        polling:
          "浏览器测试将 60 秒间隔缩短至 200 毫秒，默认暂停，按需开启验证自动读取",
        requests: await evaluate("quotaFixture.requests.map(r=>r.method)"),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, before, output }));
} finally {
  ws?.close();
  if (child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close");
    child.kill();
    await closed;
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}
