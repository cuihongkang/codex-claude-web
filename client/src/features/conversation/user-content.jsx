import React from "react";
import { FileCode, Paperclip, Folder, Sparkles } from "lucide-react";
import { set } from "../../store.js";
import { MessageImage } from "../markdown/message-image.jsx";
import { UserAnnotations } from "../annotations/message-annotations.jsx";
import { planApprovalLabel } from "../../domain/plans.js";
import { parseUserMessage } from "../../domain/user-message.js";
export function Content({ content, cwd }) {
  const parsed = parseUserMessage(content);
  parsed.text = planApprovalLabel(parsed.text);
  const used = new Set();
  const parts = [];
  let offset = 0;
  const references = [...parsed.references].sort(
    (a, b) => b.name.length - a.name.length,
  );
  for (let index = 0; (index = parsed.text.indexOf("@", index)) !== -1;) {
    const file = references.find((file) =>
      parsed.text.startsWith("@" + file.name, index),
    );
    if (!file) {
      index++;
      continue;
    }
    parts.push(parsed.text.slice(offset, index));
    parts.push(<FileReference key={index} file={file} />);
    used.add(file.path);
    offset = index + file.name.length + 1;
    index = offset;
  }
  parts.push(parsed.text.slice(offset));
  return (
    <>
      {parsed.text && <div className="user-text">{parts}</div>}
      {parsed.references.some((file) => !used.has(file.path)) && (
        <div className="user-reference-list">
          {parsed.references
            .filter((file) => !used.has(file.path))
            .map((file, index) => (
              <FileReference key={index} file={file} />
            ))}
        </div>
      )}
      <UserAnnotations annotations={parsed.annotations} />
      {parsed.attachments.map((c, i) =>
        c.type === "image" || c.type === "localImage" ? (
          <div key={i} className="message-image">
            {c.url || c.path ? (
              <MessageImage src={c.url || c.path} alt="图片附件" cwd={cwd} />
            ) : (
              <span>
                <Paperclip size={14} />
                {c.path || "图片附件"}
              </span>
            )}
          </div>
        ) : c.type === "skill" ? (
          <span key={i} className="skill-tag">
            <Sparkles size={14} />
            {c.name}
          </span>
        ) : null,
      )}
    </>
  );
}
export function FileReference({ file }) {
  const Icon = file.directory ? Folder : FileCode;
  const label = (
    <>
      <Icon size={14} aria-hidden="true" />
      <span>{file.name}</span>
    </>
  );
  return (
    <a
      className="user-file-reference"
      href={file.path}
      title={file.path}
      onClick={(event) => {
        event.preventDefault();
        set({
          panel: "files",
          panelFile: file.directory
            ? { path: file.path, view: "directory" }
            : file.path,
        });
      }}
    >
      {label}
    </a>
  );
}
