import test from "node:test";
import assert from "node:assert/strict";
import {
  createThreadOrdering,
  projectGroups,
  sortThreads,
  threadTime,
  threadGroupPath,
  PROJECTLESS_SOURCE,
} from "../src/domain/thread-order.js";

test("完成时间决定对话顺序与同类项目初始顺序，固定项目优先显示", () => {
  const threads = [
    { id: "opened", cwd: "/a", createdAt: 1, updatedAt: 999, completedAt: 10 },
    { id: "done", cwd: "/b", createdAt: 2, updatedAt: 20, completedAt: 20 },
    { id: "pinned", cwd: "/c", createdAt: 3, updatedAt: 30, completedAt: 30 },
    { id: "new", cwd: "/b", createdAt: 15, updatedAt: 888, completedAt: null },
  ];
  assert.deepEqual(
    sortThreads(threads).map((t) => t.id),
    ["pinned", "done", "new", "opened"],
  );
  assert.deepEqual(
    projectGroups(threads, ["/empty", "/a", "/b"], ["pinned"]).map(
      ([path, list]) => [path, list.map((t) => t.id)],
    ),
    [
      ["/b", ["done", "new"]],
      ["/a", ["opened"]],
      ["/empty", []],
      ["/c", []],
      ["", []],
    ],
  );
  assert.equal(threadTime(threads[3]), 15);
  assert.equal(threads[0].id, "opened");
});

test("固定项目优先于活动与快照顺序，空项目和仅含置顶对话的项目继续置前", () => {
  const threads = [
    { id: "new", cwd: "/recent", createdAt: 300 },
    { id: "old", cwd: "/pinned", createdAt: 10 },
    { id: "top", cwd: "/top-only", createdAt: 5 },
    { id: "none", createdAt: 999 },
  ];
  const projects = ["/empty", "/pinned", "/top-only"];
  const paths = (order) =>
    projectGroups(threads, projects, ["top"], {}, "", order).map(
      ([path]) => path,
    );
  assert.deepEqual(paths([]), [
    "/pinned",
    "/top-only",
    "/empty",
    "/recent",
    "",
  ]);
  assert.deepEqual(paths(["/recent", "/pinned", "/empty", "/top-only", ""]), [
    "/pinned",
    "/empty",
    "/top-only",
    "/recent",
    "",
  ]);
});

test("固定与取消固定立即重新分组，同类项目保留快照顺序", () => {
  const threads = [
    { id: "a", cwd: "/a", createdAt: 300 },
    { id: "b", cwd: "/b", createdAt: 200 },
  ];
  const order = ["/a", "/b", "/empty", ""];
  const paths = (projects) =>
    projectGroups(threads, projects, [], {}, "", order).map(([path]) => path);
  assert.deepEqual(paths(["/empty"]), ["/empty", "/a", "/b", ""]);
  assert.deepEqual(paths(["/empty", "/b"]), ["/b", "/empty", "/a", ""]);
  assert.deepEqual(paths(["/b"]), ["/b", "/a", "/empty", ""]);
  assert.deepEqual(paths([]), order);
});

test("首次加载后沿用项目顺序，归档、恢复和完成时间变化仅更新组内对话", () => {
  const threads = [
    { id: "a-new", cwd: "/a", completedAt: 100 },
    { id: "b", cwd: "/b", completedAt: 90 },
    { id: "a-old", cwd: "/a", completedAt: 10 },
  ];
  const order = projectGroups(threads, [], []).map(([path]) => path);
  const groups = (list, pins = []) =>
    projectGroups(list, [], pins, {}, "", order).map(([path, items]) => [
      path,
      items.map((thread) => thread.id),
    ]);
  assert.deepEqual(order, ["/a", "/b", ""]);
  assert.deepEqual(groups(threads.slice(1)), [
    ["/a", ["a-old"]],
    ["/b", ["b"]],
    ["", []],
  ]);
  assert.deepEqual(groups([threads[1]]), [
    ["/a", []],
    ["/b", ["b"]],
    ["", []],
  ]);
  assert.deepEqual(groups([]), [
    ["/a", []],
    ["/b", []],
    ["", []],
  ]);
  assert.deepEqual(groups(threads, ["a-new"]), [
    ["/a", ["a-old"]],
    ["/b", ["b"]],
    ["", []],
  ]);
  const updated = threads.map((thread) => ({
    ...thread,
    completedAt: thread.id === "b" ? 200 : thread.completedAt,
  }));
  assert.deepEqual(groups(updated), [
    ["/a", ["a-new", "a-old"]],
    ["/b", ["b"]],
    ["", []],
  ]);
  assert.deepEqual(
    projectGroups(updated, [], []).map(([path]) => path),
    ["/b", "/a", ""],
  );
  assert.deepEqual(
    groups([...updated, { id: "new", cwd: "/new", completedAt: 300 }]),
    [
      ["/new", ["new"]],
      ["/a", ["a-new", "a-old"]],
      ["/b", ["b"]],
      ["", []],
    ],
  );
});

test("客户端自动目录合并到未分类，CLI 与外部对话保留实际目录并参与排序", () => {
  const scratch = "/documents/Codex/2026-10-26";
  const threads = [
    { id: "desktop-a", cwd: scratch + "/mu-q", completedAt: 20 },
    { id: "desktop-b", cwd: scratch + "/x", completedAt: 40 },
    { id: "cli", cwd: "/code/x", source: "cli", completedAt: 30 },
    { id: "external", cwd: "/code/mu-q", completedAt: 10 },
    { id: "missing-cwd", completedAt: 5 },
    { id: "pinned", cwd: scratch + "/pin", completedAt: 50 },
  ];
  assert.deepEqual(
    projectGroups(threads, [], ["pinned"], {
      "desktop-a": scratch + "/mu-q",
      "desktop-b": scratch + "/x",
      pinned: scratch + "/pin",
    }).map(([path, list]) => [path, list.map((t) => t.id)]),
    [
      ["/code/x", ["cli"]],
      ["/code/mu-q", ["external"]],
      ["", ["desktop-b", "desktop-a", "missing-cwd"]],
    ],
  );
});

test("未分类始终位于末尾，保留其他项目快照顺序", () => {
  const threads = [
    { id: "unclassified", createdAt: 999 },
    { id: "project", cwd: "/a", createdAt: 1 },
  ];
  for (const order of [[], ["", "/empty", "/a"], ["/empty", "", "/a"]]) {
    const groups = projectGroups(threads, ["/empty"], [], {}, "", order);
    assert.equal(groups.at(-1)[0], "");
    assert.deepEqual(
      groups.at(-1)[1].map((t) => t.id),
      ["unclassified"],
    );
    if (order.length)
      assert.deepEqual(
        groups.map(([path]) => path),
        ["/empty", "/a", ""],
      );
  }
});

test("明确项目归属、改变后的目录和未被记录的相似目录保持文件夹分组", () => {
  const scratch = "/documents/Codex/2026-10-26";
  const threads = [
    { id: "assigned", cwd: scratch + "/a", projectId: "project", createdAt: 5 },
    { id: "added", cwd: scratch + "/b", createdAt: 4 },
    { id: "moved", cwd: "/code/work", createdAt: 3 },
    { id: "nested", cwd: scratch + "/c/work/repo", createdAt: 2 },
    { id: "lookalike", cwd: scratch + "/d", source: "cli", createdAt: 1 },
  ];
  const directories = {
    assigned: scratch + "/a",
    added: scratch + "/b",
    moved: scratch + "/c",
    nested: scratch + "/c",
  };
  assert.deepEqual(
    projectGroups(threads, [scratch + "/b"], [], directories).map(
      ([path]) => path,
    ),
    [threads[1].cwd, threads[0].cwd, ...threads.slice(2).map((t) => t.cwd), ""],
  );
  assert.deepEqual(projectGroups([], [], [], directories), [["", []]]);
});

test("网页新建的无项目对话通过持久来源和独立目录分组，明确归属继续优先", () => {
  const root = "/custom/claudex-web/workspaces";
  const thread = {
    id: "web",
    cwd: root + "/chat-ABC123",
    threadSource: PROJECTLESS_SOURCE,
  };
  assert.equal(threadGroupPath(thread, [], {}, root), "");
  assert.equal(
    threadGroupPath({ ...thread, projectId: "assigned" }, [], {}, root),
    thread.cwd,
  );
  assert.equal(threadGroupPath(thread, [thread.cwd], {}, root), thread.cwd);
  for (const cwd of ["/code/project", thread.cwd + "/repo"]) {
    assert.equal(threadGroupPath({ ...thread, cwd }, [], {}, root), cwd);
  }
  assert.equal(
    threadGroupPath(
      { ...thread, threadSource: null, source: "cli" },
      [],
      {},
      root,
    ),
    thread.cwd,
  );
  assert.equal(threadGroupPath(thread, [], {}, "/different-root"), thread.cwd);
});

test("列表缺少无项目来源时通过网页创建者与自动目录恢复分类，明确归属继续优先", () => {
  const root = "/custom/claudex-web/workspaces";
  for (const threadSource of [null, undefined]) {
    const thread = {
      id: "web-list",
      cwd: root + "/chat-ABC123",
      originator: "claudex_web",
      source: "vscode",
      threadSource,
    };
    assert.equal(threadGroupPath(thread, [], {}, root), "");
    assert.deepEqual(projectGroups([thread], [], [], {}, root), [
      ["", [thread]],
    ]);
    assert.equal(
      threadGroupPath({ ...thread, projectId: "assigned" }, [], {}, root),
      thread.cwd,
    );
    assert.equal(threadGroupPath(thread, [thread.cwd], {}, root), thread.cwd);
    for (const cwd of [
      "/code/project",
      thread.cwd + "/repo",
      root + "/project",
      root + "/chat-ABC1234",
      root + "-other/chat-ABC123",
    ]) {
      assert.equal(threadGroupPath({ ...thread, cwd }, [], {}, root), cwd);
    }
    for (const originator of ["codex_cli_rs", "vscode", null, undefined]) {
      assert.equal(
        threadGroupPath({ ...thread, originator }, [], {}, root),
        thread.cwd,
      );
    }
    assert.equal(
      threadGroupPath(
        { ...thread, threadSource: "other-source" },
        [],
        {},
        root,
      ),
      thread.cwd,
    );
    assert.equal(
      threadGroupPath(thread, [], {}, "/different-root"),
      thread.cwd,
    );
  }
});

test("跨对话页、轮次页读取完成时间，忽略运行中轮次并缓存；刷新元数据保留实际顺序", async () => {
  let updatedAt = 999;
  const requests = [];
  const ordering = createThreadOrdering(async (method, params) => {
    requests.push({ method, params });
    if (method === "thread/list")
      return params.cursor
        ? {
            data: [{ id: "recent", createdAt: 1, updatedAt: 100 }],
            nextCursor: null,
          }
        : {
            data: [{ id: "opened", createdAt: 2, updatedAt }],
            nextCursor: "second",
          };
    assert.equal(params.itemsView, "notLoaded");
    if (params.threadId === "recent")
      return { data: [{ status: "completed", completedAt: 100 }] };
    return params.cursor
      ? {
          data: [
            { status: "completed", completedAt: 10 },
            { status: "failed", completedAt: null },
          ],
        }
      : {
          data: [{ status: "inProgress", completedAt: 1000 }],
          nextCursor: "older",
        };
  });
  assert.deepEqual(
    (await ordering.list({ archived: false })).map((t) => [
      t.id,
      t.completedAt,
    ]),
    [
      ["recent", 100],
      ["opened", 10],
    ],
  );
  assert.equal(
    requests.filter((r) => r.method === "thread/turns/list").length,
    3,
  );
  await ordering.list({ archived: false });
  assert.equal(
    requests.filter((r) => r.method === "thread/turns/list").length,
    3,
  );
  updatedAt++;
  assert.equal((await ordering.list({ archived: false }))[0].id, "recent");
  assert.equal(
    requests.filter((r) => r.method === "thread/turns/list").length,
    5,
  );
  assert(
    requests
      .filter((r) => r.method === "thread/list")
      .every((r) => r.params.sortKey === "created_at"),
  );
  ordering.observe("opened", { status: "completed", completedAt: 200 });
  assert.deepEqual(
    (await ordering.list({ archived: false })).map((t) => t.id),
    ["opened", "recent"],
  );
});

test("读取失败以已有完成时间或创建时间兜底，后续刷新重试", async () => {
  let failed = true;
  const ordering = createThreadOrdering(async () => {
    if (failed) throw new Error("暂时不可读");
    return { data: [{ status: "interrupted", completedAt: 50 }] };
  });
  const thread = { id: "a", createdAt: 5, updatedAt: 999 };
  assert.equal(threadTime((await ordering.hydrate([thread]))[0]), 5);
  failed = false;
  assert.equal(threadTime((await ordering.hydrate([thread]))[0]), 50);
  failed = true;
  assert.equal(
    threadTime((await ordering.hydrate([{ ...thread, updatedAt: 1000 }]))[0]),
    50,
  );
});

test("读取期间收到完成事件时采用后端完成时间，重建读取器仍从历史恢复", async () => {
  let finish;
  const ordering = createThreadOrdering(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = ordering.hydrate([{ id: "a", createdAt: 5, updatedAt: 999 }]);
  ordering.observe("a", { status: "completed", completedAt: 80 });
  finish({ data: [{ status: "completed", completedAt: 20 }] });
  assert.equal((await pending)[0].completedAt, 80);
  const fresh = createThreadOrdering(async () => ({
    data: [{ status: "completed", completedAt: 80 }],
  }));
  assert.equal(
    (await fresh.hydrate([{ id: "a", createdAt: 5, updatedAt: 999 }]))[0]
      .completedAt,
    80,
  );
});

test("运行中的新轮次按开始时间参与排序，更晚结束的对话仍排在前面", async () => {
  const threads = [
    { id: "running", cwd: "/project", createdAt: 1, updatedAt: 9999 },
    { id: "finished", cwd: "/project", createdAt: 2, updatedAt: 2 },
  ];
  const rpc = async (_, { threadId }) => ({
    data:
      threadId === "running"
        ? [
            { status: "inProgress", startedAt: 120 },
            { status: "completed", startedAt: 5, completedAt: 10 },
          ]
        : [{ status: "completed", startedAt: 20, completedAt: 100 }],
  });
  const ordering = createThreadOrdering(rpc);
  const initial = await ordering.hydrate(threads);
  assert.deepEqual(
    initial.map((t) => t.id),
    ["running", "finished"],
  );
  assert.equal(initial[0].completedAt, 10);
  assert.equal(threadTime(initial[0]), 120);
  assert.deepEqual(
    projectGroups(initial, [], [])[0][1].map((t) => t.id),
    ["running", "finished"],
  );
  ordering.observe("finished", { status: "completed", completedAt: 130 });
  assert.deepEqual(
    (await ordering.hydrate(threads)).map((t) => t.id),
    ["finished", "running"],
  );
  assert.deepEqual(
    (await createThreadOrdering(rpc).hydrate(threads)).map((t) => t.id),
    ["running", "finished"],
    "完整刷新从后端开始时间恢复顺序",
  );
});

test("读取期间的新轮次开始、迟到完成及旧历史响应保持最新活动时间", async () => {
  let finish;
  const ordering = createThreadOrdering(
    () => new Promise((resolve) => (finish = resolve)),
  );
  const thread = { id: "active", createdAt: 1, updatedAt: 1 };
  const pending = ordering.hydrate([thread]);
  ordering.observe(thread.id, { status: "inProgress", startedAt: 200 });
  ordering.observe(thread.id, { status: "completed", completedAt: 100 });
  finish({ data: [{ status: "completed", completedAt: 50 }] });
  const [result] = await pending;
  assert.equal(threadTime(result), 200);
  assert.equal(result.completedAt, 100);
  ordering.forget(thread.id);
  assert.equal(threadTime(ordering.apply(thread)), 1);
});

test("升级后的分组同时识别新旧自动目录，固定目录和其他创建者继续独立分组", () => {
  const roots = ["/web/workspaces", "/native/claudex-web/workspaces"];
  for (const root of roots) {
    const thread = {
      id: root,
      cwd: root + "/chat-ABC123",
      originator: "claudex_web",
    };
    assert.equal(threadGroupPath(thread, [], {}, roots), "");
    assert.equal(threadGroupPath(thread, [thread.cwd], {}, roots), thread.cwd);
    assert.equal(
      threadGroupPath({ ...thread, originator: "codex_cli_rs" }, [], {}, roots),
      thread.cwd,
    );
    assert.equal(
      threadGroupPath({ ...thread, cwd: thread.cwd + "/repo" }, [], {}, roots),
      thread.cwd + "/repo",
    );
  }
});

test("更名后兼容旧来源标记与创建者，既有未分类目录继续恢复", () => {
  const root = "/tmp/legacy-web/workspaces";
  for (const metadata of [
    { threadSource: "codex-web-projectless" },
    { originator: "codex_lan_web" },
    { threadSource: PROJECTLESS_SOURCE },
    { originator: "claudex_web" },
  ]) {
    assert.equal(
      threadGroupPath(
        { id: "legacy", cwd: root + "/chat-ABC123", ...metadata },
        [],
        {},
        ["/tmp/new/workspaces", root],
      ),
      "",
    );
  }
});
