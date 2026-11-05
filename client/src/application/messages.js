import { createMessageEditing } from "./message-editing.js";
import { resolveServiceTier } from "../domain/service-tier.js";
import { inputRequestItem } from "../domain/question-state.js";
import { annotationMessage } from "../domain/annotations.js";
import { isCompacting } from "../domain/compaction.js";
import {
  readAnnotationDrafts,
  removeSentAnnotations,
} from "../infrastructure/annotation-drafts.js";

import { uid } from "../domain/format.js";
export function createMessages({
  get,
  set,
  rpc,
  transport,
  navigation,
  catalog,
  records,
  models,
  report,
}) {
  const editing = createMessageEditing({ get, set, rpc, navigation });
  function put(item) {
    const index = get().items.findIndex((i) => i.id === item.id);
    const items = get().items.slice();
    if (index >= 0 && item.type === "userMessage") {
      const content = [
        ...(items[index].content || []),
        ...(item.content || []),
      ];
      item = {
        ...item,
        content: [
          ...new Map(content.map((c) => [JSON.stringify(c), c])).values(),
        ],
      };
    }
    if (index < 0) items.push(item);
    else items[index] = { ...items[index], ...item };
    set({ items });
  }
  function recordInputRequest(request, answers) {
    if (
      request.method !== "item/tool/requestUserInput" ||
      request.params.threadId !== get().current?.id
    )
      return;
    const item = inputRequestItem(request, answers);
    const previous = get().items.find((entry) => entry.id === item.id);
    put({ ...item, answers: answers || previous?.answers });
  }
  function respond(request, result, error) {
    try {
      if (
        !get().connected ||
        transport.connection.readyState !== WebSocket.OPEN
      )
        throw new Error("连接尚未就绪，请等待重连后提交回答。");
      if (!get().questions.some((q) => String(q.id) === String(request.id)))
        throw new Error("此请求已结束，请查看最新消息。");
      transport.connection.send(
        JSON.stringify({ id: request.id, ...(error ? { error } : { result }) }),
      );
      recordInputRequest(request, error ? undefined : result?.answers);
      set({
        questions: get().questions.filter(
          (q) => String(q.id) !== String(request.id),
        ),
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }
  function setDraft(draft) {
    set({ draft });
    localStorage.setItem("cx-draft-" + (get().current?.id || "new"), draft);
  }
  async function sendMessage(
    text = get().draft,
    attachments = get().attachments,
    {
      clearDraft = true,
      questionId,
      questionAnswers,
      annotations = [],
      replace,
    } = {},
  ) {
    if (
      (!text.trim() && !attachments.length && !annotations.length) ||
      get().busy ||
      get().loading ||
      isCompacting(get().compactions[get().current?.id]) ||
      (get().threadAccess &&
        get().threadAccess.threadId === get().current?.id &&
        get().threadAccess.status !== "ready")
    )
      return false;
    const epoch = navigation.opening;
    const attachmentDraft = navigation.getAttachmentDraft();
    set({ busy: true, error: "" });
    let thread;
    try {
      if (replace && get().current?.id !== replace.threadId) return false;
      thread = await navigation.ensureThread();
      if (replace) await editing.prepare(replace);
      const input = [
        ...(text.trim() || annotations.length
          ? [
              {
                type: "text",
                text: annotations.length
                  ? annotationMessage(annotations, text)
                  : text,
                text_elements: [],
              },
            ]
          : []),
        ...attachments.map((a) => a.input),
      ];
      const running = get().active[thread.id];
      put({
        id: "optimistic-" + uid(),
        type: "userMessage",
        turnId: running,
        content: input,
        optimistic: true,
        ...(questionId ? { questionId } : {}),
      });
      const params = {
        threadId: thread.id,
        input,
        model: get().model || undefined,
        effort: get().effort || undefined,
        serviceTier: resolveServiceTier(
          get().serviceTier,
          get().models.find((m) => m.model === get().model),
        ),
        collaborationMode: {
          mode: get().mode,
          settings: {
            model: get().model,
            reasoning_effort: get().effort || null,
          },
        },
      };
      if (!running) models.rememberModelSelection();
      const startedAt = Date.now() / 1000;
      if (get().compactions[thread.id]?.status === "completed") {
        const compactions = { ...get().compactions };
        delete compactions[thread.id];
        set({ compactions });
      }
      const r = await rpc(
        running ? "turn/steer" : "turn/start",
        running
          ? { threadId: thread.id, expectedTurnId: running, input }
          : params,
      );
      if (r.turn) {
        const turn = {
          ...r.turn,
          startedAt:
            r.turn.startedAt ??
            get().turnTimings[thread.id]?.[r.turn.id]?.startedAt ??
            startedAt,
        };
        records.recordTurnTimings(thread.id, [turn]);
        records.recordThreadActivity(thread.id, turn);
      }
      if (clearDraft) {
        const draftKey = "cx-draft-" + thread.id;
        if (localStorage.getItem(draftKey) === text)
          localStorage.removeItem(draftKey);
        if (get().current?.id === thread.id)
          set({
            ...(get().draft === text ? { draft: "" } : {}),
          });
        navigation.updateAttachmentDraft(attachmentDraft, (entries) =>
          entries.filter((entry) => !attachments.includes(entry)),
        );
      }
      if (annotations.length && !replace) {
        removeSentAnnotations(thread.id, annotations);
        if (
          get().annotationEditor?.threadId === thread.id &&
          !readAnnotationDrafts(thread.id).some(
            (entry) => entry.id === get().annotationEditor.id,
          )
        )
          set({ annotationEditor: null });
      }
      if (questionId && get().current?.id === thread.id) {
        const question = get().items.find((item) => item.id === questionId);
        if (question) put({ ...question, questionAnswers });
      }
      if (r.turn?.status === "inProgress")
        set({ active: { ...get().active, [thread.id]: r.turn.id } });
      if (get().current?.id === thread.id)
        set({ threadAccess: { threadId: thread.id, status: "ready" } });
      if (replace) editing.finish(replace);
      catalog.loadThreads().catch(() => {});
      return true;
    } catch (e) {
      if (get().current?.id === thread?.id)
        set({ items: get().items.filter((i) => !i.optimistic) });
      if (/already has an active writer/i.test(e.message)) {
        if (get().current?.id === thread?.id)
          set({
            threadAccess: { threadId: thread.id, status: "blocked" },
            error: "",
          });
      } else if (epoch === navigation.opening) report(e);
      return false;
    } finally {
      if (replace) editing.release(replace);
      set({ busy: false });
    }
  }
  async function stop() {
    const id = get().current?.id;
    if (id && get().active[id])
      await rpc("turn/interrupt", { threadId: id, turnId: get().active[id] });
  }
  async function review() {
    if (isCompacting(get().compactions[get().current?.id]))
      throw new Error("正在整理上下文，完成后可继续审查。");
    const t = await navigation.ensureThread();
    await rpc("review/start", {
      threadId: t.id,
      target: { type: "uncommittedChanges" },
    });
  }
  function addAttachment(a) {
    set({ attachments: [...get().attachments, a] });
  }
  async function attachFile(file) {
    const draft = navigation.getAttachmentDraft();
    const add = (attachment) =>
      navigation.updateAttachmentDraft(draft, (entries) => [
        ...entries,
        attachment,
      ]);
    if (file.type.startsWith("image/")) {
      const url = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      add({
        id: uid(),
        name: file.name,
        preview: url,
        input: { type: "image", url },
      });
    } else {
      const text = await file.text();
      add({
        id: uid(),
        name: file.name,
        input: {
          type: "text",
          text: `附件 ${file.name}\n\n${text}`,
          text_elements: [],
        },
      });
    }
  }
  return {
    put,
    recordInputRequest,
    respond,
    setDraft,
    sendMessage,
    stop,
    review,
    addAttachment,
    attachFile,
    handleReverted: editing.handleReverted,
    cancelMessageEdit(edit) {
      if (edit.retainedIds != null) {
        editing.finish(edit);
        if (get().current?.id === edit.threadId)
          navigation.loadHistory().catch(report);
      }
    },
  };
}
