import React, { useEffect, useRef, useState } from "react";
import { Copy, Pencil } from "lucide-react";
import { copy, sendMessage, cancelMessageEdit, useStore } from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
import {
  parseUserMessage,
  fileReferenceInput,
  userMessageText,
} from "../../domain/user-message.js";
import { isCompacting } from "../../domain/compaction.js";
import { Content } from "./user-content.jsx";
import { MarkdownEditor } from "../composer/markdown-editor.jsx";

function MessageEditor({ item, threadId, onCancel }) {
  const s = useStore();
  const [parsed] = useState(() => parseUserMessage(item.content));
  const [text, setText] = useState(parsed.text);
  const [attachments, setAttachments] = useState(() => [
    ...parsed.references.map((file) => ({
      name: file.name,
      input: fileReferenceInput(file),
    })),
    ...parsed.attachments.map((input) => ({
      name: input.name || input.path?.split("/").at(-1) || "图片附件",
      input,
    })),
  ]);
  const [annotations, setAnnotations] = useState(parsed.annotations);
  const [pending, setPending] = useState(false);
  const input = useRef();
  const edit = useRef({ item, threadId });
  const disabled =
    pending ||
    s.busy ||
    s.loading ||
    !s.connected ||
    !!s.active[threadId] ||
    isCompacting(s.compactions[threadId]) ||
    (s.threadAccess?.threadId === threadId &&
      s.threadAccess.status !== "ready");
  useEffect(() => {
    input.current?.focus();
  }, []);
  async function submit(event) {
    event?.preventDefault();
    if (
      disabled ||
      (!text.trim() && !attachments.length && !annotations.length)
    )
      return;
    setPending(true);
    const sent = await sendMessage(text, attachments, {
      clearDraft: false,
      annotations,
      replace: edit.current,
    });
    setPending(false);
    if (sent) onCancel();
  }
  function cancel() {
    if (pending) return;
    // 回退已落盘时，取消只关闭本地编辑占位；重新读取以展示真实历史。
    cancelMessageEdit(edit.current);
    onCancel();
  }
  return (
    <form
      className="user-message-editor"
      aria-label="编辑上一条消息"
      onSubmit={submit}
      onKeyDownCapture={(event) => {
        if (
          event.nativeEvent?.isComposing ||
          event.isComposing ||
          event.keyCode === 229
        )
          return;
        if (event.key === "Enter" && event.ctrlKey) submit(event);
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <div inert={pending}>
        <MarkdownEditor
          value={text}
          inputRef={input}
          theme={s.theme}
          aria-label="编辑消息"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      {attachments.length > 0 && (
        <div className="inline-edit-attachments">
          {attachments.map((entry, index) => (
            <button
              type="button"
              key={index}
              title={`移除 ${entry.name}`}
              disabled={pending}
              onClick={() =>
                setAttachments(attachments.filter((_, i) => i !== index))
              }
            >
              {entry.name} ×
            </button>
          ))}
        </div>
      )}
      {annotations.map((entry, index) => (
        <label className="inline-edit-annotation" key={index}>
          批注 {index + 1}
          <textarea
            aria-label={`编辑批注 ${index + 1}`}
            value={entry.annotation}
            disabled={pending}
            onChange={(event) =>
              setAnnotations(
                annotations.map((value, i) =>
                  i === index
                    ? { ...value, annotation: event.target.value }
                    : value,
                ),
              )
            }
          />
        </label>
      ))}
      <div className="inline-edit-actions">
        <button type="button" onClick={cancel} disabled={pending}>
          取消
        </button>
        <button
          type="submit"
          disabled={
            disabled ||
            (!text.trim() && !attachments.length && !annotations.length)
          }
        >
          {pending ? "发送中…" : "发送"}
        </button>
      </div>
    </form>
  );
}

export function UserMessage({ item, readOnly, editable, cwd }) {
  const s = useStore();
  const [editing, setEditing] = useState(false);
  const threadId = s.current?.id;
  useEffect(() => {
    if (
      editable &&
      s.messageEditRequest?.threadId === threadId &&
      s.messageEditRequest.itemId === item.id
    )
      setEditing(true);
  }, [editable, threadId, item.id, s.messageEditRequest]);
  return (
    <article
      className="message user-message"
      data-message-id={item.id}
      tabIndex={-1}
    >
      {editing ? (
        <MessageEditor
          item={item}
          threadId={threadId}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="user-bubble">
            {item.authorLabel && (
              <small className="message-author">{item.authorLabel}</small>
            )}
            <Content content={item.content} cwd={cwd} />
          </div>
          {!readOnly && (
            <div className="message-actions">
              <IconButton
                icon={Copy}
                title="复制消息"
                onClick={() => copy(userMessageText(item.content))}
              />
              {editable && (
                <IconButton
                  icon={Pencil}
                  title="编辑上一条消息"
                  disabled={
                    s.busy ||
                    s.loading ||
                    !s.connected ||
                    !!s.active[threadId] ||
                    isCompacting(s.compactions[threadId])
                  }
                  onClick={() => setEditing(true)}
                />
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}
