import {
  authenticationFixture,
  httpsFetch,
} from "../../tests/helpers/auth.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { readVersion } from "../src/version.mjs";

function messageFrom(socket, matches) {
  return new Promise((resolve) => {
    function receive(bytes) {
      const message = JSON.parse(bytes);
      if (!matches(message)) return;
      socket.off("message", receive);
      resolve(message);
    }
    socket.on("message", receive);
  });
}

test(
  "桥接服务提供资源、隔离请求 ID，并恢复和同步提问状态",
  { timeout: 15000 },
  async (t) => {
    const files = await mkdtemp(join(tmpdir(), "codex-web-test-"));
    const version = readVersion();
    const auth = await authenticationFixture(files);
    const fetch = httpsFetch(auth.tls.cert, auth.cookie);
    await writeFile(join(files, "index.html"), "<h1>Codex Web test</h1>");
    await writeFile(
      join(files, "mermaid.core.js"),
      "export const diagram = 1;",
    );
    await writeFile(join(files, "diagram-theme.css"), "svg { color: black; }");
    const icons = [
      ["favicon.ico", "image/x-icon"],
      ["favicon.png", "image/png"],
      ["apple-touch-icon.png", "image/png"],
    ];
    for (const [name] of icons)
      await writeFile(
        join(files, name),
        await readFile(new URL(`../../client/public/${name}`, import.meta.url)),
      );
    const desktopStatePath = join(files, ".codex-global-state.json");
    const scratch = join(files, "documents", "2026-10-26", "scratch");
    await writeFile(
      desktopStatePath,
      JSON.stringify({
        "projectless-thread-ids": ["fixture-projectless", "fixture-cli"],
        "thread-projectless-output-directories": {
          "fixture-projectless": join(scratch, "outputs"),
        },
        "thread-workspace-root-hints": {
          "fixture-projectless": join(files, "documents"),
        },
      }),
    );
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(upstream, "listening");
    let clientVersion, backend;
    const agentParentPath = join(files, "agent-parent.jsonl");
    const agentChildPath = join(files, "agent-child.jsonl");
    await writeFile(
      agentParentPath,
      [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            namespace: "collaboration",
            name: "spawn_agent",
            call_id: "fixture-spawn",
            arguments: JSON.stringify({ message: "检查隔离测试接口" }),
          },
        },
        {
          type: "event_msg",
          payload: {
            item: {
              type: "SubAgentActivity",
              id: "fixture-spawn",
              kind: "started",
              agent_thread_id: "agent-message-child",
            },
          },
        },
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    await writeFile(
      agentChildPath,
      [
        {
          type: "response_item",
          payload: {
            type: "agent_message",
            id: "incoming",
            author: "/root",
            recipient: "/root/check",
            internal_chat_message_metadata_passthrough: {
              turn_id: "agent-turn",
            },
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "item_completed",
            turn_id: "agent-turn",
            item: { id: "agent-answer" },
          },
        },
      ]
        .map(JSON.stringify)
        .join("\n"),
    );
    const answers = [],
      backendMethods = [];
    upstream.on("connection", (socket) => {
      backend = socket;
      socket.on("message", (bytes) => {
        const request = JSON.parse(bytes);
        if (!request.method) {
          answers.push(request);
          return;
        }
        if (request.method === "initialize")
          clientVersion = request.params.clientInfo.version;
        backendMethods.push(request.method);
        if (
          request.method === "thread/read" &&
          ["agent-message-child", "agent-message-parent"].includes(
            request.params.threadId,
          )
        ) {
          const child = request.params.threadId === "agent-message-child";
          socket.send(
            JSON.stringify({
              id: request.id,
              result: {
                thread: child
                  ? {
                      id: "agent-message-child",
                      path: agentChildPath,
                      parentThreadId: "agent-message-parent",
                      source: {
                        subAgent: {
                          thread_spawn: { agent_path: "/root/check" },
                        },
                      },
                    }
                  : { id: "agent-message-parent", path: agentParentPath },
              },
            }),
          );
          return;
        }
        if (
          request.method === "thread/read" &&
          request.params.threadId === "undo-fixture"
        ) {
          socket.send(
            JSON.stringify({
              id: request.id,
              result: {
                thread: {
                  id: "undo-fixture",
                  name: "撤销测试",
                  cwd: files,
                  turns: [
                    {
                      id: "undo-turn",
                      status: "completed",
                      items: [
                        {
                          type: "fileChange",
                          status: "completed",
                          changes: [
                            {
                              path: "edited.txt",
                              kind: { type: "update" },
                              diff: "--- a/edited.txt\n+++ b/edited.txt\n@@ -1 +1 @@\n-before\n+after\n",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            }),
          );
          return;
        }
        if (request.id !== undefined)
          socket.send(
            JSON.stringify({
              id: request.id,
              result: request.method === "initialize" ? {} : request.params,
            }),
          );
      });
    });
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../src/server.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "0",
          STATIC_DIR: files,
          DEFAULT_CWD: files,
          CODEX_HOME: files,
          CODEX_APP_SERVER_URL: `ws://127.0.0.1:${upstream.address().port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const sockets = [];
    t.after(async () => {
      for (const socket of sockets) socket.terminate();
      const exit = once(child, "exit");
      child.kill();
      await exit;
      for (const socket of upstream.clients) socket.terminate();
      await new Promise((resolve) => upstream.close(resolve));
      await rm(files, { recursive: true, force: true });
    });
    const url = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.on("data", (bytes) => {
        const match = bytes.toString().match(/https:\/\/127\.0\.0\.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    async function connect(onState = () => {}) {
      const socket = new WebSocket(url.replace("https:", "wss:") + "/rpc", {
        ca: auth.tls.cert,
        headers: { Cookie: auth.cookie, Origin: url },
      });
      sockets.push(socket);
      await new Promise((resolve) =>
        socket.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          if (message.method === "lan/state" && message.params.ready) {
            assert.equal(message.params.defaultCwd, files);
            assert.equal(
              message.params.projectlessRoot,
              join(files, "codex-web", "workspaces"),
            );
            assert.deepEqual(message.params.version, version);
            onState(message.params);
            resolve();
          }
        }),
      );
      return socket;
    }
    const [first, second] = await Promise.all([connect(), connect()]);
    const agentMessages = messageFrom(first, (m) => m.id === "agent-messages");
    first.send(
      JSON.stringify({
        id: "agent-messages",
        method: "lan/agents/messages",
        params: {
          threadId: "agent-message-child",
          parentId: "forged-parent",
          path: "/forged-path",
        },
      }),
    );
    const restoredMessages = (await agentMessages).result.messages;
    assert.equal(restoredMessages[0].content[0].text, "检查隔离测试接口");
    assert.equal(restoredMessages[0].turnId, "agent-turn");
    assert.equal(restoredMessages[0].beforeItemId, "agent-answer");
    assert(!backendMethods.includes("lan/agents/messages"));
    const projectUpdate = messageFrom(
      second,
      (m) => m.method === "lan/projectModels/updated",
    );
    const savedModel = messageFrom(first, (m) => m.id === "save-project-model");
    first.send(
      JSON.stringify({
        id: "save-project-model",
        method: "lan/projectModels/set",
        params: { cwd: files, model: "fixture-model", effort: "high" },
      }),
    );
    const expectedProjectModels = {
      [files]: { model: "fixture-model", effort: "high" },
    };
    assert.deepEqual((await savedModel).result.projects, expectedProjectModels);
    assert.deepEqual(
      (await projectUpdate).params.projects,
      expectedProjectModels,
    );
    const readModels = messageFrom(
      second,
      (m) => m.id === "read-project-models",
    );
    second.send(
      JSON.stringify({
        id: "read-project-models",
        method: "lan/projectModels/read",
      }),
    );
    assert.deepEqual((await readModels).result.projects, expectedProjectModels);
    assert.deepEqual(
      JSON.parse(
        await readFile(join(files, "codex-web", "project-models.json"), "utf8"),
      ),
      expectedProjectModels,
    );
    assert.equal(
      backendMethods.some((method) => method.startsWith("lan/projectModels/")),
      false,
    );
    await writeFile(join(files, "edited.txt"), "after\n");
    let undoSequence = 0;
    async function undo(path = join(files, "edited.txt")) {
      const id = "undo-" + undoSequence++;
      const response = messageFrom(first, (m) => m.id === id);
      first.send(
        JSON.stringify({
          id,
          method: "lan/files/undo",
          params: {
            threadId: "undo-fixture",
            turnId: "undo-turn",
            path,
            changes: [{ path: "index.html", diff: "forged" }],
          },
        }),
      );
      return response;
    }
    assert.match(
      (await undo(join(files, "index.html"))).error.message,
      /没有可撤销/,
    );
    assert.equal(
      await readFile(join(files, "index.html"), "utf8"),
      "<h1>Codex Web test</h1>",
    );
    const started = messageFrom(first, (m) => m.method === "turn/started");
    backend.send(
      JSON.stringify({
        method: "turn/started",
        params: {
          threadId: "undo-fixture",
          turn: { id: "running", status: "inProgress" },
        },
      }),
    );
    await started;
    assert.match((await undo()).error.message, /任务正在运行/);
    const completed = messageFrom(first, (m) => m.method === "turn/completed");
    backend.send(
      JSON.stringify({
        method: "turn/completed",
        params: {
          threadId: "undo-fixture",
          turn: { id: "running", status: "completed" },
        },
      }),
    );
    await completed;
    const undone = [first, second].map((socket) =>
      messageFrom(socket, (m) => m.method === "lan/files/undone"),
    );
    assert.equal((await undo()).result.path, join(files, "edited.txt"));
    for (const message of await Promise.all(undone))
      assert.deepEqual(message.params, {
        threadId: "undo-fixture",
        turnId: "undo-turn",
        path: join(files, "edited.txt"),
      });
    assert.equal(await readFile(join(files, "edited.txt"), "utf8"), "before\n");
    assert.equal((await undo()).result.path, join(files, "edited.txt"));
    assert.equal(await readFile(join(files, "edited.txt"), "utf8"), "before\n");
    await connect((state) =>
      assert.deepEqual(state.undoneFiles, [
        {
          threadId: "undo-fixture",
          turnId: "undo-turn",
          path: join(files, "edited.txt"),
        },
      ]),
    );
    assert.ok(!backendMethods.includes("lan/files/undo"));
    function echo(socket, label) {
      return new Promise((resolve) => {
        socket.on("message", (bytes) => {
          const message = JSON.parse(bytes);
          if (message.id === 1) resolve(message.result.label);
        });
        socket.send(
          JSON.stringify({ id: 1, method: "test/echo", params: { label } }),
        );
      });
    }
    assert.deepEqual(
      await Promise.all([echo(first, "first"), echo(second, "second")]),
      ["first", "second"],
    );
    let projectlessSequence = 0;
    async function projectless(method = "lan/projectless/read") {
      const id = "projectless-" + projectlessSequence++;
      const response = messageFrom(first, (m) => m.id === id);
      first.send(
        JSON.stringify({
          id,
          method,
        }),
      );
      return (await response).result;
    }
    assert.deepEqual(await projectless(), {
      directories: { "fixture-projectless": scratch },
    });
    await writeFile(desktopStatePath, "{}");
    assert.deepEqual(await projectless(), { directories: {} });
    assert.ok(!backendMethods.includes("lan/projectless/read"));
    const workspaces = await Promise.all([
      projectless("lan/projectless/prepare"),
      projectless("lan/projectless/prepare"),
    ]);
    assert.notEqual(workspaces[0].cwd, workspaces[1].cwd);
    for (const workspace of workspaces) {
      assert.equal(workspace.root, join(files, "codex-web", "workspaces"));
      assert.ok(workspace.cwd.startsWith(workspace.root + "/chat-"));
      assert.ok((await stat(workspace.cwd)).isDirectory());
    }
    assert.ok(!backendMethods.includes("lan/projectless/prepare"));
    const translation = await fetch(url + "/api/translate");
    assert.equal(translation.status, 405);
    const invalidTranslation = await fetch(url + "/api/translate", {
      method: "POST",
      body: JSON.stringify({ texts: [] }),
    });
    assert.equal(invalidTranslation.status, 400);
    const health = await fetch(url + "/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), {
      ready: true,
      version,
      claude: { enabled: true, busy: false },
    });
    const videoPath = join(files, "preview.MP4");
    await writeFile(videoPath, Buffer.from([0, 1, 2, 3, 4]));
    const video = await fetch(
      url + "/api/media?" + new URLSearchParams({ path: videoPath }),
      { headers: { Range: "bytes=1-3" } },
    );
    assert.equal(video.status, 206);
    assert.equal(video.headers.get("content-type"), "video/mp4");
    assert.equal(video.headers.get("content-range"), "bytes 1-3/5");
    assert.deepEqual(
      Buffer.from(await video.arrayBuffer()),
      Buffer.from([1, 2, 3]),
    );
    const audioPath = join(files, "sound.wav");
    await writeFile(audioPath, Buffer.from([0, 4, 5, 6]));
    const audio = await fetch(
      url + "/api/files?" + new URLSearchParams({ path: audioPath }),
    );
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/wav");
    assert(audio.headers.get("content-disposition").startsWith("inline;"));
    assert.deepEqual(
      Buffer.from(await audio.arrayBuffer()),
      Buffer.from([0, 4, 5, 6]),
    );
    assert.equal(clientVersion, version.displayVersion);
    assert.equal(await (await fetch(url)).text(), "<h1>Codex Web test</h1>");
    await writeFile(join(files, "index.html"), "<h1>Updated build</h1>");
    assert.equal(await (await fetch(url)).text(), "<h1>Updated build</h1>");
    assert.equal((await fetch(url + "/missing")).status, 404);
    const diagramScript = await fetch(url + "/mermaid.core.js");
    assert.equal(diagramScript.status, 200);
    assert.equal(
      diagramScript.headers.get("content-type"),
      "text/javascript; charset=utf-8",
    );
    assert.equal(diagramScript.headers.get("cache-control"), "no-store");
    assert.equal(await diagramScript.text(), "export const diagram = 1;");
    await writeFile(
      join(files, "mermaid.core.js"),
      "export const diagram = 2;",
    );
    assert.equal(
      await (await fetch(url + "/mermaid.core.js")).text(),
      "export const diagram = 2;",
    );
    const diagramStyle = await fetch(url + "/diagram-theme.css");
    assert.equal(diagramStyle.status, 200);
    assert.equal(
      diagramStyle.headers.get("content-type"),
      "text/css; charset=utf-8",
    );
    assert.equal(await diagramStyle.text(), "svg { color: black; }");
    for (const [name, type] of icons) {
      const icon = await fetch(url + "/" + name, {
        headers: { "Accept-Encoding": "gzip" },
      });
      assert.equal(icon.status, 200, name);
      assert.equal(icon.headers.get("content-type"), type, name);
      assert.equal(icon.headers.get("content-encoding"), "gzip", name);
      assert.equal(icon.headers.get("cache-control"), "no-store", name);
      assert.deepEqual(
        Buffer.from(await icon.arrayBuffer()),
        await readFile(join(files, name)),
        name,
      );
    }
    await rm(join(files, "mermaid.core.js"));
    await rm(join(files, "favicon.ico"));
    for (const path of [
      "/mermaid.core.js",
      "/favicon.ico",
      "/nested/favicon.png",
      "/missing.png",
      "/missing.js",
      "/%2e%2e%2foutside.js",
      "/nested/chunk.js",
      "/.codex-global-state.json",
    ])
      assert.equal((await fetch(url + path)).status, 404, path);

    const question = {
      id: "pending-question",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "fixture-thread",
        turnId: "fixture-turn",
        itemId: "fixture-item",
        isBlocking: false,
        autoResolutionMs: null,
        questions: [
          {
            id: "deployment",
            header: "部署方式",
            question: "如何部署？",
            isOther: true,
            isSecret: false,
            options: [{ label: "npm", description: "安装预构建包" }],
          },
        ],
      },
    };
    const firstQuestion = messageFrom(first, (m) => m.id === question.id);
    const secondQuestion = messageFrom(second, (m) => m.id === question.id);
    backend.send(JSON.stringify(question));
    assert.deepEqual(await firstQuestion, question);
    assert.deepEqual(await secondQuestion, question);
    let restored;
    const reconnected = await connect((state) => (restored = state.questions));
    assert.deepEqual(restored, [question]);

    const result = { answers: { deployment: { answers: ["容器部署"] } } };
    const answer = messageFrom(
      backend,
      (m) => m.id === question.id && !m.method,
    );
    const resolved = [first, second, reconnected].map((socket) =>
      messageFrom(socket, (m) => m.method === "lan/questionResolved"),
    );
    first.send(JSON.stringify({ id: question.id, result }));
    assert.deepEqual(await answer, { id: question.id, result });
    for (const message of await Promise.all(resolved))
      assert.deepEqual(message.params, { id: question.id });
    second.send(JSON.stringify({ id: question.id, result }));
    await echo(second, "barrier");
    assert.equal(answers.length, 1);
    await connect((state) => assert.deepEqual(state.questions, []));

    const expired = { ...question, id: 37 };
    const pending = messageFrom(first, (m) => m.id === expired.id);
    backend.send(JSON.stringify(expired));
    await pending;
    const cleared = messageFrom(
      first,
      (m) => m.method === "serverRequest/resolved",
    );
    backend.send(
      JSON.stringify({
        method: "serverRequest/resolved",
        params: { threadId: "fixture-thread", requestId: "37" },
      }),
    );
    await cleared;
    await connect((state) => assert.deepEqual(state.questions, []));
  },
);
