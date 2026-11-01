import assert from "node:assert/strict";
import React, { act } from "react";
import { create } from "react-test-renderer";

import { projectGroups } from "../../client/src/domain/thread-order.js";
export async function testProjectSnapshot(app, fixture) {
  const { requests } = fixture;
  {
    const original = app.get();
    const previousResponse = fixture.responseFor;
    const threads = [
      { id: "stable-a-new", cwd: "/stable-a", completedAt: 100 },
      { id: "stable-b", cwd: "/stable-b", completedAt: 90 },
      { id: "stable-a-old", cwd: "/stable-a", completedAt: 10 },
    ].map((thread) => ({ ...thread, createdAt: 1, updatedAt: 1 }));
    const archived = new Set();
    fixture.responseFor = ({ method, params }) => {
      if (method === "lan/projectless/read") return { directories: {} };
      if (method === "thread/archive") archived.add(params.threadId);
      if (method === "thread/unarchive") archived.delete(params.threadId);
      if (method === "thread/list")
        return {
          data: threads.filter(
            (thread) => archived.has(thread.id) === params.archived,
          ),
        };
      if (method === "thread/turns/list")
        return {
          data: [
            {
              status: "completed",
              completedAt: threads.find(
                (thread) => thread.id === params.threadId,
              ).completedAt,
            },
          ],
        };
      if (method === "thread/resume" || method === "thread/read")
        return {
          thread: threads.find((thread) => thread.id === params.threadId),
        };
      if (method === "thread/items/list") return { data: [] };
      return {};
    };
    const paths = () => {
      const s = app.get();
      return projectGroups(
        s.threads,
        s.projects,
        s.pins,
        s.projectlessDirectories,
        s.projectlessRoot,
        s.projectOrder,
      ).map(([path]) => path);
    };
    try {
      app.set({
        current: null,
        threads: [],
        projects: [],
        projectOrder: null,
        pins: [],
        archived: false,
        search: "",
      });
      await app.loadThreads();
      const initial = ["/stable-a", "/stable-b", ""];
      assert.deepEqual(paths(), initial);
      await app.archive(threads[0]);
      assert.deepEqual(paths(), initial);
      await app.archive(threads[2]);
      assert.deepEqual(paths(), initial);
      assert(!app.get().threads.some((thread) => thread.cwd === "/stable-a"));
      let emptyProject;
      await act(async () => {
        emptyProject = create(
          React.createElement(app.ProjectGroup, { path: "/stable-a" }),
        );
      });
      await act(async () =>
        emptyProject.root
          .findByProps({ title: "在 stable-a 中新建对话" })
          .props.onClick(),
      );
      assert.equal(app.get().cwd, "/stable-a");
      assert.equal(app.get().current, null);
      await act(async () => emptyProject.unmount());
      app.set({ archived: true });
      await app.loadThreads();
      assert.deepEqual(paths(), initial);
      await app.archive(threads[0]);
      assert.equal(app.get().archived, false);
      assert.deepEqual(paths(), initial);
      app.addProject("/aaa-new");
      await app.loadThreads();
      assert.deepEqual(paths(), ["/aaa-new", ...initial]);
      threads[1].completedAt = 200;
      threads[1].updatedAt++;
      await act(async () =>
        fixture.socket.emit("turn/completed", {
          threadId: threads[1].id,
          turn: { id: "stable-turn", status: "completed", completedAt: 200 },
        }),
      );
      assert.equal(app.get().threads[0].id, "stable-b");
      assert.deepEqual(paths(), ["/aaa-new", ...initial]);
      threads.push({
        id: "stable-external",
        cwd: "/external-new",
        createdAt: 1,
        updatedAt: 1,
        completedAt: 5,
      });
      await app.loadThreads();
      assert.deepEqual(paths(), ["/external-new", "/aaa-new", ...initial]);
      app.set({ projectOrder: null });
      await app.loadThreads();
      assert.deepEqual(paths(), [
        "/stable-b",
        "/stable-a",
        "/external-new",
        "/aaa-new",
        "",
      ]);
      const beforeArchive = paths();
      for (const thread of threads.filter((thread) => !archived.has(thread.id)))
        await app.archive(thread);
      assert.equal(app.get().threads.length, 0);
      assert.deepEqual(paths(), beforeArchive);
      await app.loadThreads();
      assert.deepEqual(paths(), beforeArchive);
      app.set({ projectOrder: null });
      await app.loadThreads();
      assert.deepEqual(paths(), ["/aaa-new", ""]);
    } finally {
      app.set(original);
      fixture.responseFor = previousResponse;
    }
    console.log(
      "PASS 项目初始快照、全部归档保留空项目与新建入口、恢复保序、新增项目置前、重载重算",
    );
  }
}
