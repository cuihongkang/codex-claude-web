import test from "node:test";
import assert from "node:assert/strict";
import { fullAccessParams } from "../src/domain/execution-policy.js";

test("新建、恢复和分支统一覆盖旧的权限设置", () => {
  for (const method of ["thread/start", "thread/resume", "thread/fork"]) {
    const params = {
      threadId: "test",
      sandbox: "read-only",
      approvalPolicy: "on-request",
      permissions: "old-profile",
    };
    assert.deepEqual(fullAccessParams(method, params), {
      threadId: "test",
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
    assert.equal(params.sandbox, "read-only");
  }
});
test("任务与终端使用完全访问且清除冲突的权限配置", () => {
  assert.deepEqual(
    fullAccessParams("turn/start", {
      threadId: "test",
      permissions: "old-profile",
      approvalPolicy: "on-request",
    }),
    {
      threadId: "test",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    },
  );
  assert.deepEqual(
    fullAccessParams("command/exec", {
      command: ["pwd"],
      permissionProfile: "old-profile",
    }),
    {
      command: ["pwd"],
      sandboxPolicy: { type: "dangerFullAccess" },
    },
  );
});
test("查询与任务补充保持原协议参数", () => {
  for (const method of ["thread/list", "turn/steer", "command/exec/write"]) {
    const params = { threadId: "test" };
    assert.equal(fullAccessParams(method, params), params);
  }
});
