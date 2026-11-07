import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendConfiguration } from "../src/backends/configuration.mjs";
import {
  networkProxyEnvironment,
  validateNetworkProxy,
} from "../src/backends/network-proxy.mjs";
import {
  providerRuntimeEnvironment,
  providerSettingsEnvironment,
} from "../src/backends/claude/provider-environment.mjs";

test("代理配置跨实例恢复，启停保留配置，无效保存保留旧值", async (t) => {
  const configDir = await mkdtemp(join(tmpdir(), "network-proxy-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const config = {
    configDir,
    codexHome: configDir,
    claudeHome: configDir,
    upstreamUrl: "ws://127.0.0.1:1",
  };
  const settings = createBackendConfiguration(config);
  const proxy = { mode: "http", host: "proxy.example", port: 8080 };
  await settings.save({ id: "claude", type: "claude", proxy });
  await settings.save({ id: "claude", type: "claude", enabled: false });
  const read = async () =>
    (await createBackendConfiguration(config).read()).backends.find(
      (b) => b.id === "claude",
    );
  assert.deepEqual((await read()).proxy, proxy);
  assert.equal((await read()).enabled, false);
  for (const invalid of [
    { ...proxy, port: 0 },
    { ...proxy, port: 65536 },
    { ...proxy, port: 1.5 },
    { ...proxy, host: "proxy.example/path" },
    { ...proxy, mode: "socks5" },
    null,
  ]) {
    await assert.rejects(
      settings.save({ id: "claude", type: "claude", proxy: invalid }),
      /代理/,
    );
    assert.deepEqual((await read()).proxy, proxy);
  }
  await settings.save({ id: "claude", type: "claude", proxy: { mode: "off" } });
  assert.deepEqual((await read()).proxy, { mode: "off" });
  assert.deepEqual(
    validateNetworkProxy({ mode: "https", host: "[::1]", port: 443 }),
    { mode: "http", host: "[::1]", port: 443 },
  );
});

test("显式代理覆盖大小写环境，关闭清除继承值，跟随环境保留原值", (t) => {
  const previous = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = "http://inherited.example:9000";
  t.after(() => {
    if (previous === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previous;
  });
  const backend = {
    dataDir: join(tmpdir(), "claude"),
    proxy: { mode: "https", host: "proxy.example", port: 8443 },
  };
  const provider = {
    models: ["model"],
    baseUrl: "http://127.0.0.1:1234",
    apiKey: "test",
  };
  const env = providerRuntimeEnvironment(provider, backend);
  assert.equal(env.HTTPS_PROXY, "http://proxy.example:8443");
  assert.equal(env.https_proxy, env.HTTPS_PROXY);
  assert.equal(env.ALL_PROXY, "");
  assert.equal(env.NO_PROXY, "localhost,127.0.0.1,::1");
  assert.equal(env.NODE_USE_ENV_PROXY, "1");
  assert.equal(
    providerSettingsEnvironment(provider, backend).HTTPS_PROXY,
    env.HTTPS_PROXY,
  );
  backend.proxy = { mode: "off" };
  const direct = providerRuntimeEnvironment(null, backend);
  assert.equal(direct.HTTPS_PROXY, "");
  assert.equal(direct.https_proxy, "");
  assert.equal(direct.NODE_USE_ENV_PROXY, "0");
  backend.proxy = { mode: "system" };
  assert.equal(
    providerRuntimeEnvironment(null, backend).HTTPS_PROXY,
    "http://inherited.example:9000",
  );
  assert.deepEqual(networkProxyEnvironment(undefined), {});
});

test("旧 HTTPS 配置读取为 HTTP CONNECT，保存时写入新格式", async (t) => {
  const configDir = await mkdtemp(join(tmpdir(), "legacy-proxy-"));
  t.after(() => rm(configDir, { recursive: true, force: true }));
  const file = join(configDir, "backends.json");
  const bytes = JSON.stringify({
    backends: [
      {
        id: "claude",
        type: "claude",
        proxy: {
          mode: "https",
          host: "127.0.0.1",
          port: 7897,
        },
      },
    ],
    providers: [],
  });
  await writeFile(file, bytes);
  const configuration = createBackendConfiguration({
    configDir,
    codexHome: configDir,
    claudeHome: configDir,
    upstreamUrl: "ws://127.0.0.1:1",
  });
  const backend = (await configuration.read()).backends.find(
    (b) => b.id === "claude",
  );
  assert.deepEqual(backend.proxy, {
    mode: "http",
    host: "127.0.0.1",
    port: 7897,
  });
  assert.equal(await readFile(file, "utf8"), bytes);
  await configuration.save(backend);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(
    saved.backends.find((b) => b.id === "claude").proxy.mode,
    "http",
  );
});

test("旧 HTTPS 选项在真实 Node 子进程中通过普通 HTTP 代理发出请求", async (t) => {
  const requests = [];
  const proxy = http.createServer((request, response) => {
    requests.push(request.url);
    response.end("proxy reached");
  });
  proxy.on("connect", (request, socket) => {
    requests.push(request.url);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const upstream = net.connect(proxy.address().port, "127.0.0.1");
    socket.pipe(upstream).pipe(socket);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    proxy.closeAllConnections();
    proxy.close();
  });
  const env = networkProxyEnvironment({
    mode: "https",
    host: "127.0.0.1",
    port: proxy.address().port,
  });
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'console.log(await (await fetch("http://proxy-test.invalid/page")).text())',
    ],
    { env: { ...process.env, ...env }, timeout: 5000 },
  );
  assert.equal(stdout.trim(), "proxy reached");
  assert.deepEqual(requests, ["proxy-test.invalid:80", "/page"]);
});
