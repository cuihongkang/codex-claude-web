import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, stat, open } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import {
  authenticationFixture,
  httpsFetch,
} from "../../tests/helpers/auth.mjs";
import { readConfig } from "../src/config.mjs";
import { authenticateSystemUser } from "../src/system-auth.mjs";

async function appFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-auth-"));
  const auth = await authenticationFixture(directory);
  await writeFile(join(directory, "index.html"), "<h1>Login shell</h1>");
  await writeFile(join(directory, "private.txt"), "protected file");
  const backend = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(backend, "listening");
  const requests = [];
  let running = false;
  backend.on("connection", (socket) =>
    socket.on("message", (bytes) => {
      const request = JSON.parse(bytes);
      requests.push(request);
      if (request.method === "initialize")
        socket.send(JSON.stringify({ id: request.id, result: {} }));
      else if (request.method === "turn/start") {
        running = true;
        socket.send(
          JSON.stringify({
            method: "turn/started",
            params: {
              threadId: "fixture-thread",
              turn: { id: "fixture-turn" },
            },
          }),
        );
        socket.send(
          JSON.stringify({
            id: request.id,
            result: { turn: { id: "fixture-turn", status: "inProgress" } },
          }),
        );
      } else if (request.method === "thread/resume")
        socket.send(
          JSON.stringify({
            id: request.id,
            result: {
              thread: {
                id: request.params.threadId,
                status: { type: running ? "active" : "idle" },
              },
            },
          }),
        );
      else if (request.id !== undefined)
        socket.send(JSON.stringify({ id: request.id, result: {} }));
    }),
  );
  let child,
    exited,
    url,
    log = "";
  const sockets = [];
  const start = async () => {
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../src/server.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          CODEX_HOME: directory,
          STATIC_DIR: directory,
          AUTH_PAMTESTER: auth.pamtester,
          AUTH_SESSION_DAYS: "30",
          CODEX_APP_SERVER_URL: `ws://127.0.0.1:${backend.address().port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    exited = once(child, "exit");
    child.stderr.on("data", (bytes) => {
      log += bytes;
    });
    url = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`服务提前退出 ${code}: ${log}`)),
      );
      child.stdout.on("data", (bytes) => {
        const match = String(bytes).match(/https:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    for (let i = 0; i < 100; i++) {
      if ((await httpsFetch(auth.tls.cert)(url + "/healthz")).status === 200)
        break;
      await delay(10);
    }
  };
  const stop = async () => {
    if (child?.exitCode === null) {
      child.kill();
      await exited;
    }
  };
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await stop();
    for (const socket of backend.clients) socket.terminate();
    await new Promise((resolve) => backend.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await start();
  return {
    auth,
    directory,
    requests,
    start,
    stop,
    log: () => log,
    url: () => url,
    request(path, options = {}, cookie = "") {
      return httpsFetch(auth.tls.cert, cookie)(url + path, options);
    },
    async login(password = "fixture-password", cookie = "") {
      return this.request(
        "/api/auth/login",
        {
          method: "POST",
          headers: {
            Origin: url,
            "X-Codex-Web-Request": "1",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username: userInfo().username, password }),
        },
        cookie,
      );
    },
    connect(cookie = auth.cookie, path = "/rpc", headers = { Origin: url }) {
      const socket = new WebSocket(url.replace("https:", "wss:") + path, {
        ca: auth.tls.cert,
        headers: { Cookie: cookie, ...headers },
      });
      sockets.push(socket);
      return socket;
    },
  };
}
test("未登录可下载当前公开证书并核对指纹，其他方法及业务数据保持受限", async (t) => {
  const app = await appFixture(t);
  const info = await (await app.request("/api/tls/info")).json();
  const expected = new X509Certificate(app.auth.tls.cert);
  assert.deepEqual(info, {
    fingerprint: expected.fingerprint256,
    validTo: expected.validTo,
    selfSigned: true,
  });
  const response = await app.request("/api/tls/certificate");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pkix-cert");
  assert.match(
    response.headers.get("content-disposition"),
    /attachment; filename="codex-web.cer"/,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.deepEqual(bytes, expected.raw);
  assert.equal(new X509Certificate(bytes).fingerprint256, info.fingerprint);
  const head = await app.request("/api/tls/certificate", { method: "HEAD" });
  assert.equal(await head.text(), "");
  assert.equal(Number(head.headers.get("content-length")), bytes.length);
  for (const path of ["/api/tls/info", "/api/tls/certificate"]) {
    const denied = await app.request(path, { method: "POST" });
    assert.equal(denied.status, 405);
    assert.equal(denied.headers.get("allow"), "GET, HEAD");
  }
  assert.equal((await app.request("/api/files?path=/etc/passwd")).status, 401);
});

function state(socket) {
  return new Promise((resolve, reject) => {
    socket.on("error", reject);
    socket.on("message", (bytes) => {
      const message = JSON.parse(bytes);
      if (message.method === "lan/state" && message.params.ready)
        resolve(message.params);
    });
  });
}
function rejected(socket) {
  return new Promise((resolve) => {
    socket.on("unexpected-response", (_, response) => {
      response.resume();
      socket.terminate();
      resolve(response.statusCode);
    });
    socket.on("error", () => {});
  });
}

test(
  "HTTPS 默认保护业务、阻止明文、跨站和无会话 WebSocket",
  { timeout: 15000 },
  async (t) => {
    const app = await appFixture(t);
    assert.equal((await app.request("/")).status, 200);
    assert.deepEqual(await (await app.request("/api/auth/session")).json(), {
      authenticated: false,
    });
    for (const path of [
      "/api/files?path=" +
        encodeURIComponent(join(app.directory, "private.txt")),
      "/api/media?path=/etc/passwd",
      "/api/translate",
    ])
      for (const method of ["GET", "HEAD", "POST"])
        assert.equal((await app.request(path, { method })).status, 401);
    assert.equal(await rejected(app.connect("")), 401);
    assert.equal(await rejected(app.connect("", "/claude/rpc")), 401);
    assert.equal(
      await rejected(
        app.connect(app.auth.cookie, "/rpc", {
          Origin: "https://evil.example",
        }),
      ),
      401,
    );
    assert.equal(await rejected(app.connect(app.auth.cookie, "/rpc", {})), 401);
    await assert.rejects(
      new Promise((resolve, reject) =>
        http
          .get(app.url().replace("https:", "http:") + "/", resolve)
          .on("error", reject),
      ),
    );
    const cross = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "X-Codex-Web-Request": "1",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(cross.status, 403);
    assert.equal(
      (
        await app.request(
          "/api/auth/logout",
          { method: "POST" },
          app.auth.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request(
          "/api/files?path=/etc/passwd",
          { headers: { Origin: "https://evil.example" } },
          app.auth.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await app.request("/api/auth/login", {
          method: "POST",
          headers: {
            Origin: app.url(),
            "X-Codex-Web-Request": "1",
            "Content-Type": "application/json",
          },
          body: "{",
        })
      ).status,
      400,
    );
  },
);

test(
  "密码验证、持久 Cookie、服务重启恢复及注销立即撤销多个连接",
  { timeout: 20000 },
  async (t) => {
    const app = await appFixture(t);
    assert.equal((await app.login("wrong")).status, 401);
    assert.equal((await app.login("unavailable")).status, 503);
    const login = await app.login();
    assert.equal(login.status, 200);
    const header = login.headers.get("set-cookie");
    for (const value of [
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Path=/",
      "Max-Age=2592000",
    ])
      assert(header.includes(value));
    assert(!header.includes("fixture-password"));
    const cookie = header.split(";")[0];
    const session = await login.json();
    assert(session.expiresAt > Date.now() + 29 * 86400000);
    assert.equal(
      (await (await app.request("/api/auth/session", {}, cookie)).json())
        .authenticated,
      true,
    );
    const stored = await readFile(
      join(app.auth.authDirectory, "sessions.json"),
      "utf8",
    );
    assert(!stored.includes(cookie.split("=")[1]));
    assert(!stored.includes("fixture-password"));
    assert.equal(
      (await stat(join(app.auth.authDirectory, "sessions.json"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      await (
        await app.request(
          "/api/files?path=" +
            encodeURIComponent(join(app.directory, "private.txt")),
          {},
          cookie,
        )
      ).text(),
      "protected file",
    );
    await app.stop();
    await app.start();
    assert.equal(
      (await (await app.request("/api/auth/session", {}, cookie)).json())
        .authenticated,
      true,
    );
    const first = app.connect(cookie),
      second = app.connect(cookie);
    await Promise.all([state(first), state(second)]);
    const turned = new Promise((resolve) =>
      first.on("message", (bytes) => {
        const m = JSON.parse(bytes);
        if (m.id === 7) resolve(m);
      }),
    );
    first.send(
      JSON.stringify({
        id: 7,
        method: "turn/start",
        params: {
          threadId: "fixture-thread",
          input: [{ type: "text", text: "isolated task" }],
        },
      }),
    );
    await turned;
    const closed = Promise.all([once(first, "close"), once(second, "close")]);
    const logout = await app.request(
      "/api/auth/logout",
      {
        method: "POST",
        headers: { Origin: app.url(), "X-Codex-Web-Request": "1" },
      },
      cookie,
    );
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
    assert.deepEqual(
      (await closed).map((result) => result[0]),
      [4401, 4401],
    );
    assert.equal(
      (await app.request("/api/files?path=/etc/passwd", {}, cookie)).status,
      401,
    );
    assert.equal(await rejected(app.connect(cookie)), 401);
    assert(
      !app.requests.some((request) =>
        ["turn/interrupt", "command/exec/terminate"].includes(request.method),
      ),
    );
    const monitor = app.connect("", "/maintenance", {
      Authorization: "Bearer fixture-maintenance-token",
    });
    const active = await state(monitor);
    assert.equal(active.activeTurns["fixture-thread"], "fixture-turn");
    assert(!Object.hasOwn(active, "defaultCwd"));
    const monitorClosed = once(monitor, "close");
    monitor.send(JSON.stringify({ method: "thread/list" }));
    assert.equal((await monitorClosed)[0], 1008);
    await app.stop();
    await app.start();
    assert.equal(
      (await (await app.request("/api/auth/session", {}, cookie)).json())
        .authenticated,
      false,
    );
    assert(!app.log().includes("fixture-password"));
  },
);

test(
  "过期会话关闭 WSS，超长 Cookie 有效期不会造成计时器溢出",
  { timeout: 15000 },
  async (t) => {
    const app = await appFixture(t);
    await app.stop();
    await writeFile(
      join(app.auth.authDirectory, "sessions.json"),
      JSON.stringify([
        [app.auth.id, { ...app.auth.session, expiresAt: Date.now() + 1200 }],
      ]),
    );
    await app.start();
    const socket = app.connect();
    await state(socket);
    assert.equal((await once(socket, "close"))[0], 4401);
    assert.equal(
      (await app.request("/api/files?path=/etc/passwd", {}, app.auth.cookie))
        .status,
      401,
    );
    const response = await app.login();
    const long = app.connect(response.headers.get("set-cookie").split(";")[0]);
    await state(long);
    await delay(50);
    assert.equal(long.readyState, WebSocket.OPEN);
    assert(!app.log().includes("TimeoutOverflowWarning"));
  },
);

test(
  "登录限流、账户拒绝及验证程序缺失保持拒绝访问",
  { timeout: 15000 },
  async (t) => {
    const app = await appFixture(t);
    for (let index = 0; index < 10; index++)
      assert.equal((await app.login("wrong")).status, 401);
    const response = await app.login();
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "900");
    assert.equal(
      await authenticateSystemUser("other-user", "fixture-password", {
        pamtesterPath: app.auth.pamtester,
        pamService: "login",
      }),
      false,
    );
    assert.equal(
      await authenticateSystemUser(userInfo().username, "", {
        pamtesterPath: app.auth.pamtester,
        pamService: "login",
      }),
      false,
    );
    assert.equal(
      await authenticateSystemUser(userInfo().username, "a\nb", {
        pamtesterPath: app.auth.pamtester,
        pamService: "login",
      }),
      false,
    );
    await assert.rejects(
      authenticateSystemUser(userInfo().username, "test", {
        pamtesterPath: join(app.directory, "missing"),
        pamService: "login",
      }),
      /登录暂不可用/,
    );
  },
);

test("HTTPS 与登录配置校验", () => {
  assert.equal(readConfig({}).sessionDays, 30);
  for (const value of ["0", "91", "1.5", "no"])
    assert.throws(
      () => readConfig({ AUTH_SESSION_DAYS: value }),
      /AUTH_SESSION_DAYS/,
    );
  assert.throws(() => readConfig({ TLS_CERT: "cert.pem" }), /TLS_CERT/);
  assert.throws(
    () => readConfig({ AUTH_PAM_SERVICE: "../login" }),
    /AUTH_PAM_SERVICE/,
  );
  assert.throws(
    () => readConfig({ CODEX_APP_SERVER_URL: "ws://192.0.2.10:8765" }),
    /wss/,
  );
  assert.equal(
    readConfig({ CODEX_APP_SERVER_URL: "wss://backend.example" }).upstreamUrl,
    "wss://backend.example",
  );
});

test(
  "退出立即撤销进行中的文件传输，并拒绝超长登录请求",
  { timeout: 15000 },
  async (t) => {
    const app = await appFixture(t);
    const file = join(app.directory, "large.bin");
    const handle = await open(file, "w");
    await handle.truncate(64 * 1024 * 1024);
    await handle.close();
    const response = await new Promise((resolve, reject) => {
      const request = https.get(
        app.url() + "/api/files?path=" + encodeURIComponent(file),
        { ca: app.auth.tls.cert, headers: { Cookie: app.auth.cookie } },
        resolve,
      );
      request.on("error", reject);
      t.after(() => request.destroy());
    });
    assert.equal(response.statusCode, 200);
    response.pause();
    const ended = new Promise((resolve) => {
      response.on("aborted", () => resolve("aborted"));
      response.on("end", () => resolve("end"));
      response.on("error", () => {});
    });
    assert.equal(
      (
        await app.request(
          "/api/auth/logout",
          {
            method: "POST",
            headers: { Origin: app.url(), "X-Codex-Web-Request": "1" },
          },
          app.auth.cookie,
        )
      ).status,
      200,
    );
    response.resume();
    assert.equal(await ended, "aborted");
    const oversized = await app.request("/api/auth/login", {
      method: "POST",
      headers: {
        Origin: app.url(),
        "X-Codex-Web-Request": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "demo", password: "x".repeat(9000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await app.request("/healthz")).status, 200);
  },
);
