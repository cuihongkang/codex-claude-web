import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { createWebApplication } from "../src/application.mjs";
import { createAuthentication } from "../src/auth.mjs";
import { readConfig } from "../src/config.mjs";
import {
  authenticationFixture,
  httpsFetch,
} from "../../tests/helpers/auth.mjs";

test("应用实例隔离资源缓存，关闭后释放监听与后端连接", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-web-application-"));
  const backend = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(backend, "listening");
  let connections = 0;
  backend.on("connection", (socket) => {
    connections++;
    socket.on("message", (bytes) => {
      const message = JSON.parse(bytes);
      if (message.method === "initialize")
        socket.send(JSON.stringify({ id: message.id, result: {} }));
    });
  });
  const apps = [];
  t.after(async () => {
    await Promise.all(apps.map((app) => app.close()));
    for (const socket of backend.clients) socket.terminate();
    await new Promise((resolve) => backend.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const auth = await authenticationFixture(directory);
  const request = httpsFetch(auth.tls.cert, auth.cookie);
  async function application(name, port = 0) {
    const staticDir = join(directory, name);
    await mkdir(staticDir);
    await writeFile(join(staticDir, "file-panel.js"), name);
    const config = readConfig({
      CODEX_HOME: directory,
      HOST: "127.0.0.1",
      PORT: String(port),
      STATIC_DIR: staticDir,
      CODEX_APP_SERVER_URL: `ws://127.0.0.1:${backend.address().port}`,
    });
    const app = createWebApplication({
      config,
      tls: auth.tls,
      authentication: await createAuthentication(config),
      version: { displayVersion: "fixture" },
    });
    apps.push(app);
    await app.start();
    return app;
  }
  const first = await application("first");
  const second = await application("second");
  const url = (app) => `https://127.0.0.1:${app.server.address().port}`;
  for (const [app, name] of [
    [first, "first"],
    [second, "second"],
  ]) {
    const response = await request(url(app) + "/file-panel.js", {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
    assert.equal(await response.text(), name);
  }
  await assert.rejects(application("conflict", first.server.address().port), {
    code: "EADDRINUSE",
  });
  const beforeClose = connections;
  assert.equal(beforeClose, 2);
  const closedUrl = url(first);
  await first.close();
  await second.close();
  await assert.rejects(request(closedUrl + "/file-panel.js"));
  await delay(2100);
  assert.equal(backend.clients.size, 0);
  assert.equal(connections, beforeClose);
});
