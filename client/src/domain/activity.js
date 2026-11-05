import { commandDescription } from "./command-description.js";
export const labels = {
  commandExecution: "执行命令",
  fileChange: "修改文件",
  webSearch: "搜索网页",
  mcpToolCall: "调用工具",
  dynamicToolCall: "调用工具",
  functionCallOutput: "工具结果",
  imageView: "查看图片",
  imageGeneration: "生成图片",
  sleep: "等待",
  contextCompaction: "整理上下文",
  plan: "计划",
  hookPrompt: "运行指令",
  enteredReviewMode: "开始代码审查",
  exitedReviewMode: "代码审查完成",
};
export const toolActions = {
  search: "搜索",
  search_query: "搜索网页",
  web_search: "搜索网页",
  fetch: "读取内容",
  read_file: "读取文件",
  readFile: "读取文件",
  read_resource: "读取资源",
  list_resources: "列出资源",
  list_files: "列出文件",
  view_image: "查看图片",
  open_image: "查看图片",
  imagegen: "生成图片",
  exec_command: "执行命令",
  write_stdin: "读取或输入终端",
  apply_patch: "修改文件",
};
export function queries(item) {
  const action = item.action || {};
  return [
    ...new Set(
      [...(action.queries || []), action.query || item.query].filter(
        (value) => typeof value === "string" && value.trim(),
      ),
    ),
  ];
}
export function activityLabel(item) {
  if (item.type === "commandExecution") return commandDescription(item.command);
  if (item.type === "webSearch") {
    const action = item.action || {};
    if (["openPage", "open_page"].includes(action.type))
      return "打开网页 · " + (action.url || item.query || "网页");
    if (["findInPage", "find_in_page"].includes(action.type))
      return "在网页中查找 · " + (action.pattern || item.query || "文字");
    const terms = queries(item);
    return "搜索网页" + (terms.length ? " · " + terms.join("；") : "");
  }
  if (
    ["mcpToolCall", "dynamicToolCall", "functionCallOutput"].includes(item.type)
  ) {
    const tool = item.tool || item.name;
    const action = toolActions[tool?.split(/__|\./).at(-1)];
    const args = item.arguments;
    const target =
      args && typeof args === "object"
        ? args.query || args.path || args.url
        : "";
    return (
      (action || labels[item.type] || "调用工具") +
      (tool
        ? " · " +
          (action && typeof target === "string" && target
            ? target
            : [item.server || item.namespace, tool].filter(Boolean).join(" / "))
        : "")
    );
  }
  if (item.type === "imageView")
    return "查看图片" + (item.path ? " · " + item.path.split("/").at(-1) : "");
  if (item.type === "sleep")
    return `等待 ${Number((item.durationMs / 1000).toFixed(2))} 秒`;
  return labels[item.type] || "工具记录";
}
export function activityHasImage(item) {
  if (["imageView", "imageGeneration"].includes(item.type)) return true;
  const content = item.contentItems || item.result?.content || item.output;
  return (
    Array.isArray(content) &&
    content.some(
      (value) =>
        ["image", "inputImage", "input_image"].includes(value?.type) ||
        value?.resource?.mimeType?.startsWith("image/"),
    )
  );
}
