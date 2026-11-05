import React from "react";
import { Copy, GitBranch } from "lucide-react";
import { get, report, copy, fork } from "../../store.js";
import { IconButton } from "../../ui/primitives.jsx";
import { QuestionRecord } from "./user-input.jsx";
import { RichText } from "../markdown/rich-text.jsx";
import { MessageAnnotations } from "../annotations/message-annotations.jsx";
import { UserMessage } from "./user-message.jsx";
import { Activity, Reasoning } from "./activity.jsx";

import { AsyncQuestion } from "./questions.jsx";
export function Message({
  item,
  annotations,
  readOnly = false,
  editable = false,
  cwd,
}) {
  if (item.type === "reasoning") return <Reasoning item={item} cwd={cwd} />;
  if (item.type === "userInputRequest")
    return (
      <QuestionRecord
        questions={item.request.params.questions}
        answers={item.answers}
      />
    );
  if (readOnly && item.type === "agentMessage")
    return (
      <article
        className={
          "message " +
          (item.phase === "commentary"
            ? "process-message"
            : "assistant-message")
        }
      >
        {item.text?.trim() && (
          <RichText text={item.text} annotations={annotations} cwd={cwd} />
        )}
        {item.questions?.length > 0 && (
          <QuestionRecord
            questions={item.questions.map((question, index) => ({
              id: String(index),
              header: `问题 ${index + 1}`,
              question: question.title,
              options: question.options?.map((label) => ({ label })),
            }))}
            answers={
              item.questionAnswers &&
              Object.fromEntries(
                item.questionAnswers.map((text, index) => [
                  String(index),
                  { answers: [text] },
                ]),
              )
            }
          />
        )}
      </article>
    );
  if (item.type === "agentMessage" && item.questions?.length) {
    const context = item.text?.trim() &&
      !item.questions.some(
        (question) => question.title.trim() === item.text.trim(),
      ) && (
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      );
    if (item.questionAnswers || item.questionClosed)
      return <AsyncQuestion item={item} context={context} />;
    return (
      <article className="message assistant-message">
        {context}
        <AsyncQuestion item={item} context={context} />
      </article>
    );
  }
  if (item.type === "agentMessage" && item.phase === "commentary")
    return item.text?.trim() ? (
      <article className="message process-message">
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      </article>
    ) : null;
  if (item.type === "userMessage")
    return (
      <UserMessage
        key={item.id}
        item={item}
        readOnly={readOnly}
        editable={editable}
        cwd={cwd}
      />
    );
  if (item.type === "agentMessage")
    return (
      <article className="message assistant-message">
        <MessageAnnotations item={item}>
          <RichText text={item.text} annotations={annotations} />
        </MessageAnnotations>
      </article>
    );
  return <Activity item={item} cwd={cwd} />;
}
export function ReplyActions({ item }) {
  return (
    <div className="message-actions reply-actions" aria-label="回复操作">
      <IconButton
        icon={Copy}
        title="复制回复"
        onClick={() => copy(item.text)}
      />
      <IconButton
        icon={GitBranch}
        title="从这里创建分支"
        onClick={() => fork(get().current, item.turnId).catch(report)}
      />
    </div>
  );
}
