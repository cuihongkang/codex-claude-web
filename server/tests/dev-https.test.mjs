import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import WebSocket, { WebSocketServer } from "ws";
import {
  authenticationFixture,
  httpsFetch,
} from "../../tests/helpers/auth.mjs";

test(
  "Vite 通过已验证的 HTTPS/WSS 代理保留登录 Cookie 与来源",
  { timeout: 15000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "codex-web-dev-tls-"));
    await authenticationFixture(directory);
    const certificate = join(directory, "domain.pem"),
      key = join(directory, "domain-key.pem");
    execFileSync(
      "/usr/bin/openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=web.example.test",
        "-addext",
        "subjectAltName=DNS:web.example.test",
        "-out",
        certificate,
        "-keyout",
        key,
      ],
      { stdio: "ignore" },
    );
    const tls = { cert: await readFile(certificate), key: await readFile(key) };
    const requests = [];
    const backend = https.createServer(tls, (request, response) => {
      requests.push({
        path: request.url,
        host: request.headers.host,
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        encrypted: request.socket.encrypted,
      });
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ authenticated: false }));
    });
    backend.listen(0, "127.0.0.1");
    await once(backend, "listening");
    const sockets = new WebSocketServer({ server: backend });
    sockets.on("connection", (socket, request) =>
      socket.send(
        JSON.stringify({
          cookie: request.headers.cookie,
          origin: request.headers.origin,
          host: request.headers.host,
          encrypted: request.socket.encrypted,
        }),
      ),
    );
    const old = {
      PORT: process.env.PORT,
      CODEX_HOME: process.env.CODEX_HOME,
      CODEX_WEB_CONFIG_DIR: process.env.CODEX_HOME,
      TLS_CERT: process.env.TLS_CERT,
      TLS_KEY: process.env.TLS_KEY,
    };
    Object.assign(process.env, {
      PORT: String(backend.address().port),
      CODEX_HOME: directory,
      CODEX_WEB_CONFIG_DIR: directory,
      TLS_CERT: certificate,
      TLS_KEY: key,
    });
    let vite;
    t.after(async () => {
      await vite?.close();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise((resolve) => sockets.close(resolve));
      await new Promise((resolve) => backend.close(resolve));
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    });
    vite = await createServer({
      optimizeDeps: { noDiscovery: true, include: [], entries: [] },
      root: fileURLToPath(new URL("../../client", import.meta.url)),
      server: { host: "127.0.0.1", port: 0 },
      logLevel: "error",
    });
    await vite.listen();
    const origin = `https://127.0.0.1:${vite.httpServer.address().port}`;
    const response = await httpsFetch(tls.cert)(origin + "/api/auth/session", {
      headers: { Origin: origin, Cookie: "fixture-cookie" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false });
    assert.deepEqual(requests, [
      {
        path: "/api/auth/session",
        host: new URL(origin).host,
        origin,
        cookie: "fixture-cookie",
        encrypted: true,
      },
    ]);
    const socket = new WebSocket(origin.replace("https:", "wss:") + "/rpc", {
      ca: tls.cert,
      servername: "web.example.test",
      headers: { Origin: origin, Cookie: "fixture-cookie" },
    });
    const [bytes] = await once(socket, "message");
    assert.deepEqual(JSON.parse(bytes), {
      cookie: "fixture-cookie",
      origin,
      host: new URL(origin).host,
      encrypted: true,
    });
    socket.terminate();
  },
);
