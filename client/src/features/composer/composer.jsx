import { ModelSelect } from "./model-select.jsx";
import { InputQueue } from "./input-queue.jsx";
import { backendReady, backendCapability } from "../../domain/backends.js";
import React, { useRef, useState } from "react";

import {
  ArrowUp,
  Square,
  Plus,
  X,
  ChevronDown,
  LoaderCircle,
  Paperclip,
  Folder,
  ListChecks,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import {
  useStore,
  useDraft,
  set,
  setDraft,
  refreshThreadAccess,
  stop,
  report,
  attachFile,
  basename,
} from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
import { useComposerShortcuts } from "../commands/shortcuts.jsx";
import { submitComposer } from "../commands/composer-commands.js";
import { ServiceTierToggle } from "./service-tier-toggle.jsx";
import { ReasoningEffortControl } from "./reasoning-effort.jsx";
import { ComposerAnnotations } from "../annotations/message-annotations.jsx";
import { useAnnotationDrafts } from "../annotations/annotation-drafts.js";
import { isCompacting } from "../../domain/compaction.js";
import { CompactionStatus } from "./compaction-status.jsx";
import { MarkdownEditor } from "./markdown-editor.jsx";
import { AttachmentPreview } from "./attachment-preview.jsx";
export function Composer() {
  const [preview, setPreview] = useState(null);
  const s = useStore(),
    draft = useDraft(),
    area = useRef(),
    files = useRef();
  const annotationDrafts = useAnnotationDrafts(s.current?.id);
  const shortcuts = useComposerShortcuts(area);
  const active = s.active[s.current?.id];
  const compaction = s.compactions[s.current?.id];
  const compacting = isCompacting(compaction);
  function submit() {
    shortcuts.close();
    return submitComposer();
  }
  function add(files) {
    return Promise.all(
      Array.from(files, (file) => attachFile(file).catch(report)),
    );
  }
  const token = s.tokenUsage[s.current?.id];
  const usage = token?.last?.totalTokens;
  const windowSize = token?.modelContextWindow;
  const access = s.threadAccess;
  const checking = s.loading || access?.status === "checking";
  const unavailable =
    s.loading ||
    (access && access.status !== "ready" && !(checking && access.background));
  return (
    <div className="composer-wrap">
      <InputQueue />
      {compaction && (
        <CompactionStatus
          key={s.current?.id + compaction.id}
          entry={compaction}
        />
      )}
      {!unavailable && shortcuts.popup}
      {unavailable ? (
        <div
          className="composer-access"
          role="status"
          aria-live="polite"
          aria-busy={checking}
        >
          {checking ? (
            <LoaderCircle size={20} className="spin" />
          ) : (
            <AlertCircle size={20} />
          )}
          <div className="composer-access-content">
            <strong>
              {checking
                ? "正在检查对话状态…"
                : access?.status === "blocked"
                  ? "此对话由另一端使用"
                  : "暂时无法连接此对话"}
            </strong>
            {!checking && access?.status !== "blocked" && access?.message && (
              <p>{access.message}</p>
            )}
          </div>
          <button
            className="secondary"
            aria-label="重试连接对话"
            disabled={!s.connected || checking}
            onClick={() => refreshThreadAccess()}
          >
            <RefreshCw size={14} />
            {checking ? "正在检查…" : "重试"}
          </button>
        </div>
      ) : (
        <div
          className="composer"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            add(e.dataTransfer.files);
          }}
        >
          <ComposerAnnotations />
          {preview && s.attachments.includes(preview) && (
            <AttachmentPreview
              attachment={preview}
              onClose={() => setPreview(null)}
            />
          )}
          {s.attachments.length > 0 && (
            <div className="attachment-list">
              {s.attachments.map((a) => (
                <div className="attachment" key={a.id}>
                  <button
                    type="button"
                    className="attachment-preview"
                    aria-label={"预览 " + a.name}
                    onClick={() => setPreview(a)}
                  >
                    {a.preview ? (
                      <img src={a.preview} />
                    ) : (
                      <Paperclip size={17} />
                    )}
                    <span>{a.name}</span>
                  </button>
                  <IconButton
                    icon={X}
                    title={"移除 " + a.name}
                    onClick={() =>
                      set({
                        attachments: s.attachments.filter((x) => x.id !== a.id),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <MarkdownEditor
            key={s.current?.id || "new-" + s.backendId}
            inputRef={area}
            theme={s.theme}
            rows={2}
            expanded={shortcuts.open}
            activeId={shortcuts.open ? shortcuts.activeId : undefined}
            placeholder={
              compacting
                ? "正在整理上下文…"
                : active
                  ? backendCapability(s, "inputMode") === "queue"
                    ? "输入后排队执行…"
                    : "补充说明，或等待任务完成…"
                  : "描述任务，@ 引用文件，/ 使用命令…"
            }
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              shortcuts.detect(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) =>
              shortcuts.detect(e.target.value, e.target.selectionStart)
            }
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
                shortcuts.detect(e.target.value, e.target.selectionStart);
            }}
            onPaste={(e) => {
              const images = [...e.clipboardData.files].filter((f) =>
                f.type.startsWith("image/"),
              );
              if (images.length) {
                e.preventDefault();
                add(images);
              }
            }}
            onKeyDown={(e) => {
              if (shortcuts.keydown(e)) return;
              if (
                e.key === "Enter" &&
                e.ctrlKey &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <input
                type="file"
                ref={files}
                multiple
                hidden
                onChange={(e) => {
                  add(e.target.files);
                  e.target.value = "";
                }}
              />
              <IconButton
                icon={Plus}
                title="添加图片或文本附件"
                onClick={() => files.current.click()}
              />
              <ModelSelect />
              <ReasoningEffortControl />
              <ServiceTierToggle />
              <IconButton
                icon={ListChecks}
                title="计划模式"
                aria-pressed={s.mode === "plan"}
                active={s.mode === "plan"}
                onClick={() =>
                  set({ mode: s.mode === "plan" ? "default" : "plan" })
                }
              />
            </div>
            <div className="send-controls">
              {s.mode === "plan" && <span className="mode-badge">计划</span>}
              {active && (
                <button
                  className="stop-button"
                  aria-label="停止任务"
                  title="停止任务"
                  onClick={() => stop().catch(report)}
                >
                  <Square size={13} fill="currentColor" />
                </button>
              )}
              <button
                className="send-button"
                aria-label="发送消息"
                title="发送消息"
                disabled={
                  !s.connected ||
                  !backendReady(s) ||
                  checking ||
                  compacting ||
                  s.busy ||
                  (!draft.trim() &&
                    !s.attachments.length &&
                    !annotationDrafts.length)
                }
                onClick={submit}
              >
                {s.busy ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <ArrowUp size={19} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="composer-meta">
        <button
          title={s.projectless ? "未指定项目；可选择文件夹" : s.cwd}
          onClick={() => set({ modal: { type: "directory" } })}
        >
          <Folder size={13} />
          <span>{s.projectless ? "未分类" : basename(s.cwd)}</span>
          <ChevronDown size={11} />
        </button>
        <span className="context-info">
          {usage != null ? (
            <>
              上下文 {usage.toLocaleString()} /{" "}
              {windowSize?.toLocaleString() ?? "—"} tokens
              {windowSize > 0 &&
                `（${Math.round((usage / windowSize) * 100)}%）`}
            </>
          ) : unavailable ? null : (
            "Ctrl + Enter 发送"
          )}
        </span>
      </div>
    </div>
  );
}
