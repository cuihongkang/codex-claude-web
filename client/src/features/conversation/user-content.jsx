import { InlineReference } from "../../ui/inline-reference.jsx";
import { inlineReference } from "../../domain/inline-references.js";
import { openThread } from "../../store.js";
import { textReferences } from "../../domain/inline-references.js";
import { pathIcon } from "../../ui/path-icon.jsx";
import React from "react";
import { RichText } from "../markdown/rich-text.jsx";
import { FileCode, Paperclip, Folder, Sparkles } from "lucide-react";
import { set } from "../../store.js";
import { MessageImage } from "../markdown/message-image.jsx";
import { UserAnnotations } from "../annotations/message-annotations.jsx";
import { planApprovalLabel } from "../../domain/plans.js";
import { parseUserMessage } from "../../domain/user-message.js";
export function Content({ content, cwd }) {
  const parsed = parseUserMessage(content);
  parsed.text = planApprovalLabel(parsed.text);
  return (
    <>
      {(parsed.text || parsed.references.length > 0) && (
        <div className="user-text">
          <RichText
            text={parsed.text}
            cwd={cwd}
            references={parsed.references}
            renderReference={FileReference}
          />
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
        ) : c.type === "mention" &&
          c.path?.startsWith("thread://") &&
          !textReferences(parsed.text).some(
            (ref) => ref.kind === "thread" && ref.path === c.path,
          ) ? (
          <InlineReference
            key={i}
            reference={inlineReference(c.path, c.name)}
            onOpen={() => openThread(c.path.slice(9))}
          />
        ) : c.type === "skill" &&
          !textReferences(parsed.text).some(
            (ref) => ref.kind === "skill" && ref.path === c.path,
          ) ? (
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
  const Icon = file.directory ? Folder : pathIcon(file.path, { literal: true });
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
