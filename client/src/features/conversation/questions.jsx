import React from "react";
import { Shield } from "lucide-react";
import { useStore, sendMessage, respond } from "../../store.js";
import { QuestionRecord, UserInputForm } from "./user-input.jsx";
export function AsyncQuestion({ item, context }) {
  const s = useStore();
  const questions = item.questions.map((question, index) => ({
    id: String(index),
    header: `问题 ${index + 1}`,
    question: question.title,
    options: question.options?.map((label) => ({ label })),
  }));
  if (item.questionAnswers)
    return (
      <QuestionRecord
        questions={questions}
        answers={Object.fromEntries(
          item.questionAnswers.map((text, index) => [
            String(index),
            { answers: [text] },
          ]),
        )}
      >
        {context}
      </QuestionRecord>
    );
  const form = (
    <UserInputForm
      questions={questions}
      isBlocking={false}
      isCompleted={!!item.questionClosed}
      draftKey={JSON.stringify([s.current?.id, item.id])}
      disabled={!s.connected || s.busy}
      onSubmit={(answers) =>
        sendMessage(
          item.questions
            .map(
              (question, index) =>
                `${question.title}\n回答：${answers[index].answers[0]}`,
            )
            .join("\n\n"),
          [],
          {
            clearDraft: false,
            questionId: item.id,
            questionAnswers: item.questions.map(
              (_, index) => answers[index].answers[0],
            ),
          },
        )
      }
    />
  );
  return item.questionClosed ? (
    <QuestionRecord questions={questions} replyForm={form}>
      {context}
    </QuestionRecord>
  ) : (
    form
  );
}
export function Question({ request }) {
  const s = useStore(),
    p = request.params;
  const input = request.method === "item/tool/requestUserInput";
  if (input)
    return (
      <UserInputForm
        questions={p.questions}
        isBlocking={p.isBlocking}
        disabled={!s.connected}
        onSubmit={(answers) => respond(request, { answers })}
      />
    );
  const permission = request.method === "item/permissions/requestApproval";
  const standard = [
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
  ].includes(request.method);
  return (
    <div className="request-card">
      <div className="request-title">
        <Shield size={18} />
        {permission ? "权限请求" : standard ? "等待你的确认" : "工具请求"}
      </div>
      <p>{p.reason || p.command || "此操作需要你的确认。"}</p>
      {permission && <pre>{JSON.stringify(p.permissions, null, 2)}</pre>}
      {standard || permission ? (
        <div className="request-actions">
          <button
            className="secondary"
            onClick={() =>
              respond(
                request,
                permission ? { permissions: {} } : { decision: "decline" },
              )
            }
          >
            拒绝
          </button>
          <button
            className="secondary"
            onClick={() =>
              respond(
                request,
                permission
                  ? { permissions: p.permissions, scope: "session" }
                  : { decision: "acceptForSession" },
              )
            }
          >
            本次会话允许
          </button>
          <button
            className="primary"
            onClick={() =>
              respond(
                request,
                permission
                  ? { permissions: p.permissions, scope: "turn" }
                  : { decision: "accept" },
              )
            }
          >
            允许一次
          </button>
        </div>
      ) : (
        <>
          <p className="muted">此工具暂时无法使用，可以取消请求后继续对话。</p>
          <button
            className="secondary"
            onClick={() =>
              respond(request, null, {
                code: -32601,
                message: "此工具暂时无法使用。",
              })
            }
          >
            取消此请求
          </button>
        </>
      )}
    </div>
  );
}
