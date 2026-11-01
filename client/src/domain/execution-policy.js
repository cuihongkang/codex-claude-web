// 网页请求统一使用完全访问，并在新建、恢复和分支时覆盖历史权限配置。
export function fullAccessParams(method, params) {
  if (["thread/start", "thread/resume", "thread/fork"].includes(method)) {
    const result = {
      ...params,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    };
    delete result.permissions;
    return result;
  }
  if (method === "turn/start" || method === "command/exec") {
    const result = { ...params, sandboxPolicy: { type: "dangerFullAccess" } };
    if (method === "turn/start") {
      result.approvalPolicy = "never";
      delete result.permissions;
    } else delete result.permissionProfile;
    return result;
  }
  return params;
}
