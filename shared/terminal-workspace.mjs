// 文件夹归属固定为启动目录；shell 内的 cd 不改变该终端的所属工作区。
export function terminalWorkspace(cwd = "") {
  const parts = [];
  for (const part of cwd.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return cwd ? "/" + parts.join("/") : "";
}

export const terminalSelectionKey = (cwd) =>
  "cx-terminal:" + encodeURIComponent(terminalWorkspace(cwd));

export function workspaceTerminalIds(terminals, cwd) {
  const workspace = terminalWorkspace(cwd);
  return Object.keys(terminals).filter((id) => {
    const terminal = terminals[id];
    return (
      terminal.running &&
      terminal.owner === "workspace" &&
      terminal.cwd !== undefined &&
      terminalWorkspace(terminal.cwd) === workspace
    );
  });
}
