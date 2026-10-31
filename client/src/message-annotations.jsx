import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { Check, MessageSquare, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { set, uid, useStore } from "./store";
import { submitComposer } from "./composer-commands";
import {
  useAnnotationDrafts,
  readAnnotationDrafts,
  writeAnnotationDrafts,
  migrateAnnotationDraft,
} from "./annotation-drafts";

export const AnnotationContext = createContext([]);
export function AnnotationReference({ index }) {
  const annotation = useContext(AnnotationContext)[Number(index) - 1];
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="annotation-reference">
      <button
        type="button"
        className="annotation-marker"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <MessageSquare size={12} />
        注释 {index}
      </button>
      {open && (
        <span id={id} role="note" className="annotation-note">
          {annotation ? (
            <>
              <strong>选中的原文</strong>
              <span>{annotation.text}</span>
              {annotation.annotation && (
                <>
                  <strong>你的注释</strong>
                  <span>{annotation.annotation}</span>
                </>
              )}
            </>
          ) : (
            <span>加载包含此注释的用户消息后可查看原文与批注。</span>
          )}
        </span>
      )}
    </span>
  );
}

export function UserAnnotations({ annotations }) {
  return (
    <>
      {annotations.map((entry, index) => (
        <details className="annotation-card" key={index}>
          <summary>
            <MessageSquare size={14} />
            <span>注释 {index + 1}</span>
            <span className="annotation-card-label">
              {entry.annotation || entry.text}
            </span>
          </summary>
          <blockquote>{entry.text}</blockquote>
        </details>
      ))}
    </>
  );
}

// 选区偏移与持久化来源都按渲染后的 UTF-16 文本计数。
function sourceRange(root, entry) {
  if (!root) return null;
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const nodes = [];
  let node,
    text = "";
  while ((node = walker.nextNode())) {
    nodes.push({ node, start: text.length });
    text += node.textContent;
  }
  const normalized = entry.text.replace(/\s/g, "");
  let start = entry.source?.startOffset;
  let end = entry.source?.endOffset;
  if (
    start == null ||
    end == null ||
    text.slice(start, end).replace(/\s/g, "") !== normalized
  ) {
    const characters = [...text.matchAll(/\S/g)];
    const index = characters
      .map(([character]) => character)
      .join("")
      .indexOf(normalized);
    if (index < 0 || !normalized) return null;
    start = characters[index].index;
    end = characters[index + normalized.length - 1].index + 1;
  }
  const first = nodes.find(
    ({ node, start: offset }) => offset + node.textContent.length > start,
  );
  const last = nodes.find(
    ({ node, start: offset }) => offset + node.textContent.length >= end,
  );
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function annotationRoot(messageId) {
  return [...document.querySelectorAll("[data-annotation-message]")].find(
    (node) => node.dataset.annotationMessage === messageId,
  );
}

function viewportScale() {
  return (
    document.body.getBoundingClientRect().width / document.body.offsetWidth
  );
}

export function MessageAnnotations({ item, children }) {
  const s = useStore();
  const threadId = s.current?.id;
  const entries = useAnnotationDrafts(threadId);
  const content = useRef();
  const [selection, setSelection] = useState(null);
  const [markers, setMarkers] = useState([]);
  useEffect(() => {
    migrateAnnotationDraft(threadId, item.id);
  }, [threadId, item.id]);
  useEffect(() => {
    const doc = content.current?.ownerDocument;
    if (!doc) return;
    const selectText = () => {
      const selected = window.getSelection();
      if (!selected?.rangeCount || selected.isCollapsed) {
        setSelection(null);
        return;
      }
      const range = selected.getRangeAt(0);
      if (
        !content.current.contains(range.startContainer) ||
        !content.current.contains(range.endContainer) ||
        !selected.toString().trim()
      ) {
        setSelection(null);
        return;
      }
      const text = selected.toString();
      const before = range.cloneRange();
      before.selectNodeContents(content.current);
      before.setEnd(range.startContainer, range.startOffset);
      const startOffset = before.toString().length;
      const rect = range.getBoundingClientRect();
      const scale = viewportScale();
      setSelection({
        text,
        source: {
          messageId: item.id,
          startOffset,
          endOffset: startOffset + range.toString().length,
        },
        anchor: {
          left:
            Math.max(8, Math.min(rect.left, window.innerWidth - 160 * scale)) /
            scale,
          top:
            Math.max(
              8,
              Math.min(rect.bottom + 8, window.innerHeight - 44 * scale),
            ) / scale,
        },
      });
    };
    doc.addEventListener("selectionchange", selectText);
    doc.addEventListener("scroll", selectText, true);
    return () => {
      doc.removeEventListener("selectionchange", selectText);
      doc.removeEventListener("scroll", selectText, true);
    };
  }, [threadId, item.id]);
  useEffect(() => {
    const root = content.current;
    if (!root?.ownerDocument?.createTreeWalker) return;
    if (!entries.some((entry) => entry.source?.messageId === item.id)) {
      setMarkers([]);
      return;
    }
    const position = () => {
      const scale = viewportScale();
      const container = root.closest(".conversation")?.getBoundingClientRect();
      const boundary =
        document.querySelector(".composer-wrap")?.getBoundingClientRect().top ??
        window.innerHeight;
      setMarkers(
        entries.flatMap((entry, index) => {
          if (entry.source?.messageId !== item.id) return [];
          const range = sourceRange(root, entry);
          const rect = range?.getClientRects()[0];
          if (
            !rect ||
            rect.bottom < (container?.top ?? 0) ||
            rect.top > boundary
          )
            return [];
          return [
            {
              entry,
              index,
              left:
                Math.max(12, Math.min(rect.right, window.innerWidth - 16)) /
                scale,
              top: Math.max(8, rect.top - 10) / scale,
            },
          ];
        }),
      );
    };
    position();
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    const observer = new ResizeObserver(position);
    observer.observe(root);
    return () => {
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      observer.disconnect();
    };
  }, [entries, item.id, item.text]);
  return (
    <>
      <div ref={content} data-annotation-message={item.id}>
        {children}
      </div>
      {selection &&
        createPortal(
          <button
            type="button"
            className="annotation-add"
            style={selection.anchor}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              const entry = {
                id: uid(),
                text: selection.text,
                source: selection.source,
                annotation: "",
              };
              writeAnnotationDrafts(threadId, [
                ...readAnnotationDrafts(threadId),
                entry,
              ]);
              set({
                annotationEditor: {
                  threadId,
                  id: entry.id,
                  point: selection.anchor,
                },
              });
              setSelection(null);
              window.getSelection()?.removeAllRanges?.();
            }}
          >
            <MessageSquare size={14} />
            注释选中文字
          </button>,
          document.body,
        )}
      {markers.map(({ entry, index, left, top }) =>
        createPortal(
          <button
            key={entry.id}
            type="button"
            className="annotation-draft-marker"
            style={{ left, top }}
            aria-label={`编辑批注 ${index + 1}`}
            title={entry.annotation || entry.text}
            onClick={() =>
              set({ annotationEditor: { threadId, id: entry.id } })
            }
          >
            {index + 1}
          </button>,
          document.body,
        ),
      )}
    </>
  );
}

export function ComposerAnnotations() {
  const s = useStore();
  const threadId = s.current?.id;
  const entries = useAnnotationDrafts(threadId);
  const editor =
    s.annotationEditor?.threadId === threadId ? s.annotationEditor : null;
  const entry = entries.find((entry) => entry.id === editor?.id);
  const remove = (id) => {
    writeAnnotationDrafts(
      threadId,
      entries.filter((entry) => entry.id !== id),
    );
    if (editor?.id === id) set({ annotationEditor: null });
  };
  if (!entries.length) return null;
  return (
    <>
      <div
        className="annotation-attachments"
        aria-label={`待发送批注（${entries.length}）`}
      >
        {entries.map((entry, index) => (
          <div className="annotation-attachment" key={entry.id}>
            <button
              type="button"
              title={entry.annotation || entry.text}
              aria-label={`打开批注 ${index + 1}`}
              onClick={() => {
                annotationRoot(entry.source?.messageId)?.scrollIntoView({
                  block: "nearest",
                });
                set({ annotationEditor: { threadId, id: entry.id } });
              }}
            >
              <MessageSquare size={13} />
              <span>
                {index + 1}. {entry.annotation || entry.text}
              </span>
            </button>
            <button
              type="button"
              aria-label={`移除批注 ${index + 1}`}
              onClick={() => remove(entry.id)}
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      {entry && (
        <AnnotationEditor
          key={`${threadId}-${entry.id}`}
          entry={entry}
          editor={editor}
          onRemove={() => remove(entry.id)}
        />
      )}
    </>
  );
}

function AnnotationEditor({ entry, editor, onRemove }) {
  const panel = useRef();
  const area = useRef();
  const [expanded, setExpanded] = useState(false);
  const [point, setPoint] = useState(editor.point || { left: 16, top: 80 });
  useLayoutEffect(() => {
    const field = area.current;
    const view = field?.ownerDocument.defaultView;
    if (!view) return;
    const lineHeight = parseFloat(view.getComputedStyle(field).lineHeight);
    field.style.width = expanded ? "calc(100% - 4.4615rem)" : "";
    field.style.height = "0px";
    const multiline = field.scrollHeight > lineHeight + 1;
    field.style.width = "";
    field.style.height = Math.min(field.scrollHeight, lineHeight * 5) + "px";
    setExpanded(multiline);
  }, [entry.annotation, expanded]);
  useLayoutEffect(() => {
    const position = () => {
      const root = annotationRoot(entry.source?.messageId);
      const range = sourceRange(root, entry);
      const rect = range?.getBoundingClientRect();
      const boundary =
        document.querySelector(".composer-wrap")?.getBoundingClientRect().top ??
        window.innerHeight;
      const box = panel.current.getBoundingClientRect();
      const scale = viewportScale();
      const bottom = Math.min(window.innerHeight - 8, boundary - 8);
      const top =
        rect && rect.top >= 0 && rect.top < bottom
          ? rect.bottom + box.height + 12 <= bottom
            ? rect.bottom + 8
            : rect.top - box.height - 8
          : bottom - box.height;
      setPoint({
        left:
          Math.max(
            8,
            Math.min(
              rect?.left ?? editor.point?.left ?? 16,
              window.innerWidth - box.width - 8,
            ),
          ) / scale,
        top: Math.max(8, Math.min(top, bottom - box.height)) / scale,
      });
    };
    position();
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    const observer = new ResizeObserver(position);
    observer.observe(panel.current);
    const root = annotationRoot(entry.source?.messageId);
    if (root) observer.observe(root);
    return () => {
      document.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      observer.disconnect();
    };
  }, [entry.text, entry.source, editor.point]);
  const close = () => {
    set({ annotationEditor: null });
    document.querySelector('textarea[aria-label="消息"]')?.focus();
  };
  const update = (text) =>
    writeAnnotationDrafts(
      editor.threadId,
      readAnnotationDrafts(editor.threadId).map((current) =>
        current.id === entry.id ? { ...current, annotation: text } : current,
      ),
    );
  return createPortal(
    <form
      ref={panel}
      className="annotation-editor"
      style={point}
      aria-label="编辑批注"
      aria-description={`引用原文：${entry.text}`}
      data-expanded={expanded}
      onSubmit={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
        if (
          event.key === "Enter" &&
          event.ctrlKey &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          submitComposer();
        }
      }}
    >
      <textarea
        ref={area}
        aria-label="批注内容"
        placeholder="添加批注…"
        autoFocus
        rows={1}
        value={entry.annotation || ""}
        onChange={(event) => update(event.target.value)}
      />
      <div className="annotation-editor-actions">
        <button
          type="button"
          className="annotation-editor-remove"
          aria-label="移除批注"
          title="移除批注"
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
        <button
          type="submit"
          className="annotation-editor-done"
          aria-label="完成批注"
          title="完成批注"
        >
          <Check size={16} strokeWidth={2.2} />
        </button>
      </div>
    </form>,
    document.body,
  );
}
