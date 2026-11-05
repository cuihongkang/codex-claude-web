export function messageEditingFixture() {
  localStorage.setItem("cx-current", "edit-thread");
  localStorage.setItem("cx-projects", JSON.stringify(["/demo/project"]));
  const thread = {
    id: "edit-thread",
    name: "消息编辑验证",
    cwd: "/demo/project",
    createdAt: 1,
  };
  const initial = [
    {
      id: "first",
      status: "completed",
      startedAt: 1,
      completedAt: 2,
      items: [
        {
          id: "first-user",
          type: "userMessage",
          content: [{ type: "text", text: "第一条消息" }],
        },
        {
          id: "first-answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "第一条回答",
        },
      ],
    },
    {
      id: "last",
      status: "completed",
      startedAt: 3,
      completedAt: 4,
      items: [
        {
          id: "last-user",
          type: "userMessage",
          content: [
            { type: "text", text: "原消息：检查 **路径规划**。" },
            {
              type: "text",
              text: "引用本机文件：/demo/project/planner.js\n请根据任务按需读取。",
            },
          ],
        },
        {
          id: "last-answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "原消息的回答",
        },
      ],
    },
  ];
  let turns = JSON.parse(
    sessionStorage.getItem("edit-turns") || JSON.stringify(initial),
  );
  const data = (window.editFixture = {
    requests: [],
    failRevert: false,
    failSend: false,
    holdRevert: false,
    release: null,
  });
  const save = () =>
    sessionStorage.setItem("edit-turns", JSON.stringify(turns));
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      setTimeout(
        () =>
          this.emit("lan/state", {
            ready: true,
            defaultCwd: thread.cwd,
            activeTurns: {},
            questions: [],
          }),
        0,
      );
    }
    emit(method, params) {
      this.onmessage({ data: JSON.stringify({ method, params }) });
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
      if (method === "thread/revert") {
        if (data.failRevert) error = { message: "模拟回退失败" };
        else {
          turns = turns.slice(
            0,
            turns.findIndex((turn) => turn.id === params.beforeTurnId),
          );
          save();
          result = {
            thread: { ...thread, turns: [] },
            turnsBackwardsCursor: null,
            itemsBackwardsCursor: null,
          };
          this.emit("thread/reverted", { threadId: thread.id });
        }
      }
      if (method === "turn/start") {
        if (data.failSend) error = { message: "模拟发送失败" };
        else {
          const turn = {
            id: "replacement",
            status: "completed",
            startedAt: 5,
            completedAt: 6,
            items: [
              {
                id: "replacement-user",
                type: "userMessage",
                content: params.input,
              },
              {
                id: "replacement-answer",
                type: "agentMessage",
                phase: "final_answer",
                text: "修改后的回答",
              },
            ],
          };
          turns.push(turn);
          save();
          result = { turn };
          setTimeout(() => {
            this.emit("turn/started", {
              threadId: thread.id,
              turn: { ...turn, status: "inProgress" },
            });
            for (const item of turn.items)
              this.emit("item/completed", {
                threadId: thread.id,
                turnId: turn.id,
                item,
              });
            this.emit("turn/completed", { threadId: thread.id, turn });
          }, 0);
        }
      }
      const respond = () =>
        this.onmessage({
          data: JSON.stringify({
            id: request.id,
            ...(error ? { error } : { result }),
          }),
        });
      if (method === "thread/revert" && data.holdRevert) data.release = respond;
      else setTimeout(respond, 0);
    }
    close() {
      this.readyState = 3;
    }
  };
}
