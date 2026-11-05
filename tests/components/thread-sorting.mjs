import assert from "node:assert/strict";
import { act } from "react";

export async function testThreadSorting(app, fixture) {
  const { requests } = fixture;
  const history = Array.from({ length: 65 }, (_, i) => ({
    id: `sort-${i}`,
    cwd: i === 1 ? "/older-project" : `/project-${i % 2}`,
    createdAt: 100 - i,
    updatedAt: 100 - i,
  }));
  const completions = new Map(history.map((thread, i) => [thread.id, i + 200]));
  let projectlessDirectories = { "sort-0": "/project-0" };
  let projectlessUnavailable = false;
  fixture.responseFor = ({ method, params }) => {
    if (method === "lan/projectless/read")
      return projectlessUnavailable
        ? { error: { message: "分组元数据暂不可用" } }
        : { directories: projectlessDirectories };
    if (method === "thread/list")
      return {
        data: params.cursor ? history.slice(60) : history.slice(0, 60),
        nextCursor: params.cursor ? null : "page-two",
      };
    if (method === "thread/turns/list")
      return {
        data: [
          {
            id: "turn",
            status: "completed",
            completedAt: completions.get(params.threadId),
          },
        ],
        nextCursor: null,
      };
    if (method === "thread/resume" || method === "thread/read") {
      const thread = history.find((t) => t.id === params.threadId);
      thread.updatedAt = 9999;
      return { thread: { ...thread }, cwd: thread.cwd };
    }
    if (method === "thread/items/list") return { data: [], nextCursor: null };
    return {};
  };
  app.set({
    current: null,
    threads: [],
    active: {},
    archived: false,
    search: "",
    projects: [],
    projectOrder: null,
  });
  await app.loadThreads();
  assert.deepEqual(app.get().projectlessDirectories, projectlessDirectories);
  assert.equal(app.get().threads.length, 65);
  assert.equal(app.get().threads[0].id, "sort-64");
  assert.deepEqual(app.get().projectOrder, [
    "/project-0",
    "/project-1",
    "/older-project",
    "",
  ]);
  await app.openThread("sort-0");
  assert.equal(app.get().current.completedAt, 200);
  projectlessDirectories = {};
  await app.loadThreads();
  assert.deepEqual(app.get().projectlessDirectories, {});
  projectlessUnavailable = true;
  await app.loadThreads();
  assert.deepEqual(app.get().projectlessDirectories, {});
  assert.equal(app.get().threads[0].id, "sort-64");
  assert.equal(app.get().threads.at(-1).id, "sort-0");
  await fixture.socket.emit("turn/started", {
    threadId: "sort-0",
    turn: { id: "new-turn", status: "inProgress", startedAt: 400 },
  });
  assert.equal(app.get().threads[0].id, "sort-0");
  assert.equal(app.get().current.activityAt, 400);
  await app.loadThreads();
  assert.equal(app.get().threads[0].id, "sort-0", "旧历史响应保留实时开始时间");
  completions.set("sort-64", 450);
  await fixture.socket.emit("turn/completed", {
    threadId: "sort-64",
    turn: { id: "other-turn", status: "completed", completedAt: 450 },
  });
  assert.equal(
    app.get().threads[0].id,
    "sort-64",
    "较晚结束的对话超过运行中的对话",
  );
  assert.equal(app.get().active["sort-0"], "new-turn");
  completions.set("sort-0", 500);
  await act(async () =>
    fixture.socket.emit("turn/completed", {
      threadId: "sort-0",
      turn: { id: "new-turn", status: "completed", completedAt: 500 },
    }),
  );
  assert.equal(app.get().threads[0].id, "sort-0");
  assert.equal(app.get().current.completedAt, 500);
  assert.equal(
    (await app.listThreads({ archived: true, searchTerm: "排序" }))[0].id,
    "sort-0",
  );
  assert(
    requests.some(
      (r) =>
        r.method === "thread/list" &&
        r.params.archived &&
        r.params.searchTerm === "排序",
    ),
  );
  console.log(
    "PASS 活动时间全局排序、分页、打开旧对话顺序稳定、开始与完成事件重排及搜索排序",
  );
}
