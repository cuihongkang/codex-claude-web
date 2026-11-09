export function plansFixture() {
  localStorage.setItem("cx-current", "plan-demo");
  localStorage.setItem("cx-projects", JSON.stringify(["/demo/project"]));
  const thread = {
    id: "plan-demo",
    name: "计划功能验证",
    cwd: "/demo/project",
    createdAt: 1,
  };
  let turns = JSON.parse(sessionStorage.getItem("plan-turns") || "null") || [
    {
      id: "proposal-turn",
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      items: [
        {
          id: "request",
          type: "userMessage",
          content: [{ type: "text", text: "请先制定计划" }],
        },
        {
          id: "investigation",
          type: "agentMessage",
          phase: "commentary",
          text: "正在检查项目入口。",
        },
        {
          id: "proposal",
          type: "plan",
          text: "# 改进计划\n\n## 实施步骤\n\n1. 检查入口和状态归属。\n2. 实现新的计划交互，保留已有草稿。\n3. 验证刷新、重连和失败恢复。\n\n## 验收\n\n- [ ] 计划正文始终可读\n- [ ] 批准后开始执行\n\n| 场景 | 结果 |\n| --- | --- |\n| 刷新 | 恢复计划 |\n| 发送失败 | 允许重试 |",
        },
      ],
    },
  ];
  const data = (window.planFixture = {
    requests: [],
    fail: false,
    hold: false,
    release: null,
  });
  const save = () =>
    sessionStorage.setItem("plan-turns", JSON.stringify(turns));
  data.emit = (method, params) =>
    data.socket.onmessage({ data: JSON.stringify({ method, params }) });
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      data.socket = this;
      setTimeout(
        () =>
          data.emit("lan/state", {
            ready: true,
            defaultCwd: thread.cwd,
            activeTurns: {},
            questions: [],
            terminals: {},
          }),
        0,
      );
    }
    send(raw) {
      const request = JSON.parse(raw);
      data.requests.push(request);
      const { method, params } = request;
      let result = { data: [], nextCursor: null },
        error;
      if (method === "thread/list")
        result = {
          data: [thread, { ...thread, id: "other", name: "另一条对话" }],
          nextCursor: null,
        };
      if (["thread/read", "thread/resume"].includes(method))
        result = {
          thread: { ...thread, id: params.threadId },
          cwd: thread.cwd,
        };
      if (method === "config/read") result = { config: {} };
      if (method === "lan/projectless/read") result = { directories: {} };
      if (method === "account/read") result = { account: null };
      if (method === "model/list")
        result = {
          data: [
            {
              id: "fixture",
              model: "fixture",
              displayName: "测试模型",
              isDefault: true,
              supportedReasoningEfforts: [],
            },
          ],
        };
      if (method === "thread/turns/list")
        result = {
          data:
            params.threadId === "other"
              ? []
              : params.sortDirection === "asc"
                ? turns
                : turns.toReversed(),
          nextCursor: null,
        };
      if (method === "thread/items/list")
        result = {
          data:
            params.threadId === "other"
              ? []
              : turns
                  .flatMap((turn) =>
                    turn.items.map((item) => ({ item, turnId: turn.id })),
                  )
                  .reverse(),
          nextCursor: null,
        };
      if (method === "turn/start") {
        if (data.fail) error = { message: "模拟执行失败" };
        else {
          const turn = {
            id: `next-${turns.length}`,
            status: "completed",
            startedAt: 3,
            completedAt: 4,
            items: [
              {
                id: `user-${turns.length}`,
                type: "userMessage",
                content: params.input,
              },
              params.collaborationMode.mode === "plan"
                ? {
                    id: `revised-${turns.length}`,
                    type: "plan",
                    text: "# 修订计划\n\n补充浏览器验收，再开始实施。",
                  }
                : {
                    id: `answer-${turns.length}`,
                    type: "agentMessage",
                    phase: "final_answer",
                    text: "已开始实施批准的计划。",
                  },
            ],
          };
          const complete = () => {
            turns.push(turn);
            save();
            data.emit("turn/started", {
              threadId: thread.id,
              turn: { ...turn, status: "inProgress" },
            });
            for (const item of turn.items)
              data.emit("item/completed", {
                threadId: thread.id,
                turnId: turn.id,
                item,
              });
            data.emit("turn/completed", { threadId: thread.id, turn });
            this.onmessage({
              data: JSON.stringify({ id: request.id, result: { turn } }),
            });
          };
          if (data.hold) data.release = complete;
          else setTimeout(complete, 0);
          return;
        }
      }
      setTimeout(
        () =>
          this.onmessage({
            data: JSON.stringify({
              id: request.id,
              ...(error ? { error } : { result }),
            }),
          }),
        0,
      );
    }
    close() {
      this.readyState = 3;
    }
  };
}
