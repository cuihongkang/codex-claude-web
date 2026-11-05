import assert from "node:assert/strict";

import {
  PROJECTLESS_SOURCE,
  projectGroups,
} from "../../client/src/domain/thread-order.js";
export async function testProjectlessCreation(app, fixture) {
  const { requests } = fixture;
  {
    const root = "/codex/codex-web/workspaces";
    const thread = {
      id: "new-projectless",
      cwd: root + "/chat-ABC123",
      threadSource: PROJECTLESS_SOURCE,
      originator: "codex_lan_web",
      source: "vscode",
      createdAt: 1,
      updatedAt: 1,
    };
    let prepareFails = true,
      startFails = true,
      preparations = 0;
    fixture.responseFor = ({ method }) => {
      if (method === "lan/projectless/prepare") {
        preparations++;
        return prepareFails
          ? { error: { message: "目录不可写" } }
          : { cwd: thread.cwd, root };
      }
      if (method === "thread/start")
        return startFails ? { error: { message: "创建暂时失败" } } : { thread };
      if (method === "thread/resume" || method === "thread/read")
        return { thread, cwd: thread.cwd };
      if (method === "thread/list")
        return { data: [{ ...thread, threadSource: null }] };
      if (method === "thread/turns/list" || method === "thread/items/list")
        return { data: [] };
      if (method === "lan/projectless/read") return { directories: {} };
      if (method === "turn/start")
        return { turn: { id: "projectless-turn", status: "inProgress" } };
      return {};
    };
    app.set({
      connected: true,
      model: "fixture-model",
      projects: [],
      threads: [],
      archived: false,
      search: "",
      active: {},
    });
    app.newChat("");
    app.newChat(undefined, { reuseDirectory: true });
    assert.equal(app.get().projectless, true);
    assert.equal(app.get().projectlessCwd, null);
    assert.equal(app.get().cwd, "/default");
    app.setDraft("创建无项目对话");
    const startCount = requests.filter(
      (r) => r.method === "thread/start",
    ).length;
    assert.equal(await app.sendMessage(), false);
    assert.equal(
      requests.filter((r) => r.method === "thread/start").length,
      startCount,
    );
    assert.equal(app.get().draft, "创建无项目对话");
    assert.equal(localStorage.getItem("cx-draft-new"), "创建无项目对话");
    prepareFails = false;
    assert.equal(await app.sendMessage(), false);
    assert.equal(app.get().projectlessCwd, thread.cwd);
    assert.equal(localStorage.getItem("cx-draft-new"), "创建无项目对话");
    startFails = false;
    assert.equal(await app.sendMessage(), true);
    assert.equal(app.get().draft, "");
    assert.equal(localStorage.getItem("cx-draft-new"), null);
    assert.equal(preparations, 2);
    const start = requests.findLast((r) => r.method === "thread/start");
    assert.equal(start.params.cwd, thread.cwd);
    assert.equal(start.params.threadSource, PROJECTLESS_SOURCE);
    assert.equal(start.params.approvalPolicy, "never");
    assert.equal(start.params.sandbox, "danger-full-access");
    assert.equal(app.get().cwd, thread.cwd);
    await app.loadThreads();
    assert.equal(app.get().threads[0].threadSource, null);
    assert.deepEqual(
      projectGroups(app.get().threads, [], [], {}, root).map(([path]) => path),
      [""],
    );
    app.set({ current: null, projectless: false });
    await app.openThread(thread.id);
    assert.equal(app.get().projectless, true);
    assert.equal(
      projectGroups(
        app.get().threads,
        [],
        [],
        app.get().projectlessDirectories,
        root,
      )[0][0],
      "",
    );
    app.newChat();
    assert.equal(app.get().draft, "");
    assert.equal(app.get().projectless, true);
    assert.equal(app.get().projectlessCwd, null);
    await app.openThread(thread.id);
    const previousPreparations = preparations;
    app.newChat(undefined, { reuseDirectory: true });
    assert.equal(app.get().current, null);
    assert.equal(app.get().cwd, thread.cwd);
    assert.equal(app.get().projectless, true);
    assert.equal(app.get().projectlessCwd, thread.cwd);
    app.newChat(undefined, { reuseDirectory: true });
    assert.equal(app.get().cwd, thread.cwd);
    assert.equal(app.get().projectlessCwd, thread.cwd);
    await app.ensureThread();
    assert.equal(preparations, previousPreparations);
    const reused = requests.findLast((r) => r.method === "thread/start");
    assert.equal(reused.params.cwd, thread.cwd);
    assert.equal(reused.params.threadSource, PROJECTLESS_SOURCE);
    app.newChat("/code/x");
    app.set({ threads: [], active: {}, error: "", model: "" });
    fixture.responseFor = (m) =>
      m.method === "thread/list" ? { data: [] } : {};
    requests.length = 0;
    console.log(
      "PASS 未分类新建的独立目录、失败重试与草稿保留、统一权限、重新加载归类及当前目录复用",
    );
  }
}
