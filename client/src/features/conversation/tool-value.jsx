import React from "react";
import { defaultUrlTransform } from "react-markdown";
import { MessageImage } from "../markdown/message-image.jsx";
import { MessageLink } from "../markdown/message-link.jsx";
import { messageUrlTransform } from "../../domain/image-source.js";
import { RichText } from "../markdown/rich-text.jsx";

export const fields = {
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
export const statuses = {
  completed: "已完成",
  inProgress: "进行中",
  running: "进行中",
  failed: "失败",
  declined: "已拒绝",
  cancelled: "已取消",
};
export function Image({ src, alt, cwd }) {
  return (
    <MessageImage
      src={messageUrlTransform(src || "", "src", { tagName: "img" })}
      alt={alt || "工具返回的图片"}
      cwd={cwd}
    />
  );
}
export function ResourceLink({ href, children, cwd }) {
  const safe = defaultUrlTransform(href || "");
  return safe ? (
    <MessageLink href={safe} cwd={cwd}>
      {children || href}
    </MessageLink>
  ) : (
    <span>{children || "资源地址不可用"}</span>
  );
}
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
export function Section({ title, value, cwd }) {
  if (value === null || value === undefined) return null;
  return (
    <section className="tool-section">
      <small>{title}</small>
      <ToolValue value={value} cwd={cwd} />
    </section>
  );
}
