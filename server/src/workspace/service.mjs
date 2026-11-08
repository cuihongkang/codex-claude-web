import { workspaceMethods } from "../../../shared/product-contract.mjs";
import { fileRequest } from "./files.mjs";
import { executeCommand } from "./commands.mjs";
import { createTerminals } from "./terminals.mjs";

// 网页交互终端和主机文件操作由服务持有，原生搜索由所属后端提供。
export function createWorkspace({ broadcast }) {
  const terminals = createTerminals(broadcast);
  const methods = new Set(workspaceMethods);
  return {
    handles: (method) => methods.has(method),
    request(method, params) {
      if (method.startsWith("fs/")) return fileRequest(method, params);
      if (method === "command/exec" && !params.tty)
        return executeCommand(params);
      if (
        method.startsWith("command/exec") ||
        method.startsWith("lan/terminal/")
      )
        return terminals.request(method, params);
      throw new Error(`未知工作区操作：${method}`);
    },
    snapshot: terminals.snapshot,
    close: terminals.close,
  };
}
