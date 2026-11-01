import React from "react";
import { defaultUrlTransform } from "react-markdown";
import { MessageImage } from "./message-image";
import { MessageLink } from "./message-link";
import { messageUrlTransform } from "./image-source";
import { RichText } from "./rich-text";
import { commandDescription } from "./command-description";

const labels = {
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
const fields = {
  query: "搜索词",
  queries: "搜索词",
  url: "链接",
  uri: "资源",
  path: "路径",
  title: "标题",
  name: "名称",
  description: "说明",
  snippet: "摘要",
  summary: "摘要",
  text: "内容",
  content: "内容",
  results: "结果",
  result: "结果",
  output: "输出",
  message: "说明",
  error: "错误",
  code: "代码",
  type: "类型",
  count: "数量",
  total: "总数",
  success: "成功",
  status: "状态",
  command: "命令",
  cmd: "命令",
  cwd: "工作目录",
  pattern: "查找文字",
  line: "行号",
  start_line: "起始行",
  end_line: "结束行",
  files: "文件",
  items: "条目",
  data: "数据",
  checks: "检查项",
  prompt: "提示词",
  durationMs: "耗时（毫秒）",
  duration_ms: "耗时（毫秒）",
  exitCode: "退出码",
  exit_code: "退出码",
  stdout: "标准输出",
  stderr: "错误输出",
  arguments: "参数",
  reason: "原因",
  review: "审查结果",
  progress: "进度",
  total_count: "总数",
};
const statuses = {
  completed: "已完成",
  inProgress: "进行中",
  running: "进行中",
  failed: "失败",
  declined: "已拒绝",
  cancelled: "已取消",
};
const toolActions = {
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

function queries(item) {
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

function Image({ src, alt, cwd }) {
  return (
    <MessageImage
      src={messageUrlTransform(src || "", "src", { tagName: "img" })}
      alt={alt || "工具返回的图片"}
      cwd={cwd}
    />
  );
}

function ResourceLink({ href, children, cwd }) {
  const safe = defaultUrlTransform(href || "");
  return safe ? (
    <MessageLink href={safe} cwd={cwd}>
      {children || href}
    </MessageLink>
  ) : (
    <span>{children || "资源地址不可用"}</span>
  );
}

// 工具内容可能是结构化对象、JSON 文本或 MCP 内容块，统一保留可阅读的实际内容。
export function ToolValue({ value, cwd, field }) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    if (/^\s*[\[{]/.test(value)) {
      try {
        return <ToolValue value={JSON.parse(value)} cwd={cwd} field={field} />;
      } catch {
        /* 流式或普通文本保留完整原文。 */
      }
    }
    if (
      ["url", "uri", "path"].includes(field) ||
      /^https?:\/\/\S+$/.test(value)
    )
      return <ResourceLink href={value} cwd={cwd} />;
    if (["command", "cmd", "code", "stdout", "stderr"].includes(field))
      return <pre>{value}</pre>;
    return (
      <RichText
        text={field === "status" ? statuses[value] || value : value}
        cwd={cwd}
      />
    );
  }
  if (typeof value !== "object")
    return (
      <span>
        {typeof value === "boolean" ? (value ? "是" : "否") : String(value)}
      </span>
    );
  if (Array.isArray(value))
    return value.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        [
          "text",
          "inputText",
          "input_text",
          "image",
          "inputImage",
          "input_image",
          "audio",
          "inputAudio",
          "input_audio",
          "resource",
          "resource_link",
          "resourceLink",
        ].includes(entry.type),
    ) ? (
      <div className="tool-content">
        {value.map((entry, index) => (
          <div key={index}>
            <ToolValue value={entry} cwd={cwd} />
          </div>
        ))}
      </div>
    ) : (
      <ul className="tool-values">
        {value.map((entry, index) => (
          <li key={index}>
            <ToolValue value={entry} cwd={cwd} field={field} />
          </li>
        ))}
      </ul>
    );
  if (["text", "inputText", "input_text"].includes(value.type))
    return <ToolValue value={value.text} cwd={cwd} />;
  if (["image", "inputImage", "input_image"].includes(value.type))
    return (
      <Image
        src={
          value.imageUrl ||
          value.image_url ||
          value.url ||
          value.path ||
          (value.data &&
            `data:${value.mimeType || "image/png"};base64,${value.data}`)
        }
        alt={value.title || value.alt}
        cwd={cwd}
      />
    );
  if (["audio", "inputAudio", "input_audio"].includes(value.type)) {
    const src =
      value.audioUrl ||
      value.audio_url ||
      (value.data &&
        `data:${value.mimeType || "audio/wav"};base64,${value.data}`);
    return src && /^(https?:|data:audio\/)/.test(src) ? (
      <audio controls src={src} aria-label="工具返回的音频" />
    ) : (
      <span>音频内容暂无法预览</span>
    );
  }
  if (value.type === "resource")
    return <ToolValue value={value.resource} cwd={cwd} />;
  if (value.type === "resource_link" || value.type === "resourceLink")
    return (
      <ResourceLink href={value.uri} cwd={cwd}>
        {value.title || value.name || value.uri}
      </ResourceLink>
    );
  if (value.mimeType?.startsWith("image/") && value.blob)
    return (
      <Image
        src={`data:${value.mimeType};base64,${value.blob}`}
        alt={value.uri}
        cwd={cwd}
      />
    );
  if (value.blob)
    return (
      <ResourceLink href={value.uri} cwd={cwd}>
        {value.name || value.uri || "附件"}
      </ResourceLink>
    );
  if (value.type === "encrypted_content") return <span>加密内容</span>;
  if (Array.isArray(value.results))
    return (
      <>
        <ToolValue value={value.results} cwd={cwd} />
        <ToolValue
          value={Object.fromEntries(
            Object.entries(value).filter(([key]) => key !== "results"),
          )}
          cwd={cwd}
        />
      </>
    );
  if (value.url && (value.title || value.name))
    return (
      <div className="tool-result">
        <ResourceLink href={value.url} cwd={cwd}>
          {value.title || value.name}
        </ResourceLink>
        <ToolValue
          value={value.snippet || value.description || value.summary}
          cwd={cwd}
        />
        <ToolValue
          value={Object.fromEntries(
            Object.entries(value).filter(
              ([key]) =>
                ![
                  "url",
                  "title",
                  "name",
                  "snippet",
                  "description",
                  "summary",
                ].includes(key),
            ),
          )}
          cwd={cwd}
        />
      </div>
    );
  const entries = Object.entries(value).filter(
    ([key, entry]) =>
      !["_meta", "annotations"].includes(key) &&
      entry !== null &&
      entry !== undefined &&
      entry !== "",
  );
  return (
    <dl className="tool-fields">
      {entries.map(([key, entry]) => (
        <div key={key}>
          <dt>
            {fields[key] ||
              key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}
          </dt>
          <dd>
            <ToolValue value={entry} cwd={cwd} field={key} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({ title, value, cwd }) {
  if (value === null || value === undefined) return null;
  return (
    <section className="tool-section">
      <small>{title}</small>
      <ToolValue value={value} cwd={cwd} />
    </section>
  );
}

function searchResultLinks(value) {
  if (typeof value === "string") {
    try {
      return searchResultLinks(JSON.parse(value));
    } catch {
      return /^https?:\/\/\S+$/.test(value) ? [{ url: value }] : [];
    }
  }
  if (Array.isArray(value)) return value.flatMap(searchResultLinks);
  if (!value || typeof value !== "object") return [];
  const url = value.url || value.uri;
  if (typeof url === "string" && defaultUrlTransform(url))
    return [{ url, title: value.title || value.name }];
  return [
    "results",
    "result",
    "output",
    "content",
    "structuredContent",
    "text",
  ].flatMap((key) => searchResultLinks(value[key]));
}

export function ActivityContent({ item, cwd }) {
  if (item.type === "imageView")
    return (
      <Image
        src={item.path}
        alt={item.path?.split("/").at(-1) || "查看图片"}
        cwd={cwd}
      />
    );
  if (item.type === "imageGeneration")
    return (
      <>
        {item.failure ? (
          <ToolValue value={item.failure} cwd={cwd} />
        ) : item.savedPath || item.result ? (
          <Image
            src={
              item.savedPath ||
              (/^(data:|https?:|\/)/.test(item.result)
                ? item.result
                : `data:image/png;base64,${item.result}`)
            }
            alt="生成的图片"
            cwd={cwd}
          />
        ) : (
          <p>正在生成图片…</p>
        )}
      </>
    );
  if (item.type === "webSearch") {
    const action = item.action || {};
    const results = searchResultLinks(
      item.results || item.result || item.output,
    );
    return (
      <div className="tool-web-details">
        {["openPage", "open_page"].includes(action.type) ? (
          <ResourceLink href={action.url || item.query} cwd={cwd} />
        ) : ["findInPage", "find_in_page"].includes(action.type) ? (
          <>
            <p>
              查找文字：<mark>{action.pattern || item.query}</mark>
            </p>
            {action.url && <ResourceLink href={action.url} cwd={cwd} />}
          </>
        ) : queries(item).length ? (
          <ul className="tool-values">
            {queries(item).map((query) => (
              <li key={query}>{query}</li>
            ))}
          </ul>
        ) : (
          <p>搜索网页</p>
        )}
        {results.length > 0 && (
          <section className="tool-section">
            <small>搜索结果</small>
            <ul className="tool-values">
              {results.map((result, index) => (
                <li key={index}>
                  <ResourceLink href={result.url} cwd={cwd}>
                    {result.title || result.url}
                  </ResourceLink>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Section title="错误" value={item.error} cwd={cwd} />
      </div>
    );
  }
  if (
    ["mcpToolCall", "dynamicToolCall", "functionCallOutput"].includes(item.type)
  ) {
    const result = item.result;
    const output =
      item.contentItems ??
      (result && typeof result === "object" && "content" in result
        ? result.content?.length
          ? result.content
          : result.structuredContent
        : result) ??
      item.output;
    const hasOutput =
      output !== null &&
      output !== undefined &&
      (!Array.isArray(output) || output.length > 0);
    return (
      <>
        <Section title="参数" value={item.arguments} cwd={cwd} />
        {hasOutput ? (
          <Section title="结果" value={output} cwd={cwd} />
        ) : (
          !item.error && (
            <p>
              {["inProgress", "running"].includes(item.status)
                ? "正在执行…"
                : item.success === false ||
                    ["failed", "declined"].includes(item.status)
                  ? "工具执行失败"
                  : "暂无返回内容"}
            </p>
          )
        )}
        <Section title="错误" value={item.error} cwd={cwd} />
      </>
    );
  }
  if (["enteredReviewMode", "exitedReviewMode"].includes(item.type))
    return <RichText text={item.review || labels[item.type]} cwd={cwd} />;
  if (item.type === "contextCompaction")
    return (
      <p>
        {["inProgress", "running"].includes(item.status)
          ? "正在整理上下文…"
          : item.status === "failed"
            ? "上下文整理失败"
            : "上下文整理已完成"}
      </p>
    );
  if (item.type === "sleep") return <p>{activityLabel(item)}</p>;
  if (item.type === "hookPrompt")
    return (
      <ToolValue
        value={item.fragments?.map((fragment) => fragment.text)}
        cwd={cwd}
      />
    );
  const value =
    item.result ??
    item.output ??
    item.action ??
    Object.fromEntries(
      Object.entries(item).filter(
        ([key]) => !["id", "type", "turnId", "status"].includes(key),
      ),
    );
  return value !== null &&
    value !== undefined &&
    (typeof value !== "object" || Object.keys(value).length > 0) ? (
    <ToolValue value={value} cwd={cwd} />
  ) : (
    <p>{statuses[item.status] || "暂无详细内容"}</p>
  );
}
