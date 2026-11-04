import { authenticationFixture, httpsFetch } from "./helpers/auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";

const root = fileURLToPath(new URL("../", import.meta.url));

test(
  "发布包可全局安装、读取用户配置并安装服务，保留现有后端",
  { timeout: 60000 },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "codex-web-package-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const [pack] = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--ignore-scripts", "--json", "--pack-destination", dir],
        { cwd: root, encoding: "utf8" },
      ),
    );
    const paths = pack.files.map((file) => file.path);
    for (const path of [
      "bin/codex-web.mjs",
      "client/dist/index.html",
      "client/dist/app.js",
      "client/dist/file-panel.js",
      "client/dist/terminal-panel.js",
      "client/dist/mermaid.core.js",
      "client/dist/style.css",
      "client/dist/document-editor.js",
      "client/dist/favicon.ico",
      "client/dist/favicon.png",
      "client/dist/apple-touch-icon.png",
      "build-info.json",
      "server/src/version.mjs",
      "server/src/bridge/create-bridge.mjs",
      "server/src/providers/gateway.mjs",
      "vendor/anyresponses/src/client/openai.js",
      "vendor/anyresponses/src/providers/openai/request.js",
      "vendor/pi-ai/LICENSE",
      "vendor/pi-ai/transcript.js",
      "vendor/README.md",
      "server/src/http/router.mjs",
      "shared/file-types.mjs",
      "shared/compaction-state.mjs",
      "shared/rpc-limits.mjs",
      "CHANGELOG.md",
      ".env.example",
    ])
      assert.ok(paths.includes(path), `安装包缺少 ${path}`);
    for (const prefix of ["flowDiagram-", "sequenceDiagram-"])
      assert.ok(
        paths.some((path) => path.startsWith("client/dist/" + prefix)),
        `安装包缺少 Mermaid 图表模块：${prefix}`,
      );
    assert.ok(
      paths.every((path) => !/(^|\/)(tests|node_modules|\.git)\//.test(path)),
    );
    assert.ok(!paths.includes(".env"));
    assert.ok(!paths.includes("client/src/main.jsx"));
    const prefix = join(dir, "prefix");
    execFileSync(
      "npm",
      [
        "install",
        "--global",
        "--prefix",
        prefix,
        "--prefer-offline",
        "--no-audit",
        "--no-fund",
        join(dir, pack.filename),
      ],
      { encoding: "utf8" },
    );
    const cli = join(prefix, "bin/codex-web");
    const configDir = join(dir, "user config");
    const env = {
      ...process.env,
      CODEX_WEB_CONFIG_DIR: configDir,
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_STATE_HOME: join(dir, "state"),
    };
    for (const key of [
      "PORT",
      "HOST",
      "CODEX_APP_SERVER_URL",
      "STATIC_DIR",
      "DEFAULT_CWD",
      "NODE_ENV",
    ])
      delete env[key];
    const run = (...args) =>
      execFileSync(cli, args, {
        cwd: dir,
        env,
        encoding: "utf8",
        stdio: "pipe",
      });
    assert.match(run("--help"), /service install/);
    const version = JSON.parse(run("version", "--json"));
    assert.equal(version.version, pack.version);
    assert.equal(run("--version").trim(), version.displayVersion);
    assert.deepEqual(
      version,
      JSON.parse(await readFile(join(root, "build-info.json"))),
    );
    assert.ok(Object.hasOwn(version, "revision"));
    assert.ok(version.builtAt);
    assert.throws(() => run("invalid"), /未知命令/);
    run("config", "init");

    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    t.after(async () => {
      for (const client of upstream.clients) client.terminate();
      await new Promise((resolve) => upstream.close(resolve));
    });
    upstream.on("connection", (socket) =>
      socket.on("message", (bytes) => {
        const message = JSON.parse(bytes);
        if (message.method === "initialize")
          socket.send(JSON.stringify({ id: message.id, result: {} }));
      }),
    );
    const config = `HOST=127.0.0.1\nPORT=0\nCODEX_APP_SERVER_URL=ws://127.0.0.1:${upstream.address().port}\n`;
    await writeFile(join(configDir, ".env"), config);
    await writeFile(join(dir, ".env"), "PORT=invalid\n");
    run("config", "init");
    assert.equal(await readFile(join(configDir, ".env"), "utf8"), config);
    const auth = await authenticationFixture(join(dir, "codex-home"));
    env.CODEX_HOME = join(dir, "codex-home");
    const fetch = httpsFetch(auth.tls.cert);
    const child = spawn(cli, [], {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(async () => {
      if (child.exitCode !== null) return;
      const exit = once(child, "exit");
      child.kill();
      await exit;
    });
    const url = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`网页进程提前退出：${code}`)),
      );
      child.stdout.on("data", (bytes) => {
        const match = bytes.toString().match(/https:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    let initialized;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(url + "/healthz");
      if (response.status === 200) {
        initialized = await response.json();
        break;
      }
      await delay(20);
    }
    assert.deepEqual(initialized, { ready: true, version });
    const html = await (await fetch(url)).text();
    assert.match(html, /<html/);
    for (const [name, type, size] of [
      ["favicon.ico", "image/x-icon", null],
      ["favicon.png", "image/png", 96],
      ["apple-touch-icon.png", "image/png", 180],
    ]) {
      assert.ok(html.includes(`href="/${name}"`), name);
      const icon = await fetch(url + "/" + name);
      assert.equal(icon.status, 200, name);
      assert.equal(icon.headers.get("content-type"), type, name);
      const bytes = Buffer.from(await icon.arrayBuffer());
      assert.deepEqual(
        bytes,
        await readFile(join(root, "client/public", name)),
      );
      if (size) {
        assert.equal(bytes.readUInt32BE(16), size, name);
        assert.equal(bytes.readUInt32BE(20), size, name);
      } else {
        assert.equal(bytes.readUInt16LE(2), 1);
        assert.equal(bytes.readUInt16LE(4), 3);
      }
    }
    const script = await fetch(url + "/app.js");
    assert.equal(script.status, 200);
    assert.ok((await script.text()).includes(version.version));
    assert.equal((await fetch(url + "/style.css")).status, 200);
    for (const path of paths.filter(
      (path) =>
        path === "client/dist/mermaid.core.js" ||
        path === "client/dist/document-editor.js" ||
        /^client\/dist\/(flowDiagram|sequenceDiagram)-.*\.js$/.test(path),
    )) {
      const resource = await fetch(url + path.slice("client/dist".length));
      assert.equal(resource.status, 200, path);
      assert.equal(
        resource.headers.get("content-type"),
        "text/javascript; charset=utf-8",
      );
      assert.ok((await resource.text()).length > 0);
    }

    const fakeBin = join(dir, "fake-bin");
    await mkdir(fakeBin);
    env.SERVICE_TEST_LOG = join(dir, "service.log");
    env.PATH = `${fakeBin}:${dirname(process.execPath)}:${process.env.PATH}`;
    for (const name of ["systemctl", "systemd-analyze", "codex"])
      await writeFile(
        join(fakeBin, name),
        '#!/bin/sh\nprintf "%s %s\\n" "$0" "$*" >> "$SERVICE_TEST_LOG"\n',
        { mode: 0o755 },
      );
    run("service", "install");
    const units = join(env.XDG_CONFIG_HOME, "systemd/user");
    const web = await readFile(join(units, "codex-lan-web.service"), "utf8");
    assert.ok(
      web.includes(
        join(prefix, "lib/node_modules/codex-web/bin/codex-web.mjs"),
      ),
    );
    assert.ok(web.includes(`CODEX_WEB_CONFIG_DIR=${configDir}`));
    assert.match(web, /Wants=codex-app-server.service/);
    const backendPath = join(units, "codex-app-server.service");
    const backend = await readFile(backendPath, "utf8");
    assert.ok(backend.includes(`ws://127.0.0.1:${upstream.address().port}`));
    assert.ok(backend.includes(join(fakeBin, "codex")));
    assert.match(backend, /-c thread_unload_delay_secs=0 app-server/);
    run("backend");
    await writeFile(backendPath, "# existing backend configuration\n");
    run("service", "install");
    assert.equal(
      await readFile(backendPath, "utf8"),
      "# existing backend configuration\n",
    );
    assert.equal(await readFile(join(configDir, ".env"), "utf8"), config);
    run("service", "status");
    const log = await readFile(env.SERVICE_TEST_LOG, "utf8");
    assert.match(log, /-c thread_unload_delay_secs=0 app-server --listen/);
    assert.match(
      log,
      /--user enable --now codex-app-server.service codex-lan-web.service/,
    );
    assert.ok(!log.includes(" restart "));

    const sourceConfig = join(dir, "source-config");
    execFileSync(
      process.execPath,
      [join(root, "scripts/install-services.mjs")],
      {
        cwd: dir,
        env: { ...env, XDG_CONFIG_HOME: sourceConfig },
        stdio: "pipe",
      },
    );
    const sourceWeb = await readFile(
      join(sourceConfig, "systemd/user/codex-lan-web.service"),
      "utf8",
    );
    assert.ok(sourceWeb.includes(join(root, "server/src/server.mjs")));
    assert.ok(!sourceWeb.includes("CODEX_WEB_CONFIG_DIR="));
  },
);
