import test from "node:test";
import assert from "node:assert/strict";
import {
  asyncQuestionState,
  questionAnswers,
} from "../src/domain/question-state.js";

const question = (id, title = "选择部署方式") => ({
  id,
  type: "agentMessage",
  questions: [{ title, options: ["源码", "npm"] }],
});
const response = (id, text, props = {}) => ({
  id,
  type: "userMessage",
  content: [{ type: "text", text }],
  ...props,
});

test("批量问题完整匹配并保留多行回答", () => {
  const questions = [{ title: "选择部署方式" }, { title: "补充要求" }];
  assert.deepEqual(
    questionAnswers(
      questions,
      "选择部署方式\n回答：npm\n\n补充要求\n回答：保留配置\n使用远程目录",
    ),
    ["npm", "保留配置\n使用远程目录"],
  );
  assert.equal(questionAnswers(questions, "选择部署方式\n回答：npm"), null);
  assert.equal(
    questionAnswers(questions, "选择部署方式\n回答：npm\n\n补充要求\n回答："),
    null,
  );
});

test("普通补充、引用问题和未确认发送保留待答状态", () => {
  const state = asyncQuestionState([
    question("question"),
    response("steer", "继续检查"),
    response("quote", "请检查以下内容：\n选择部署方式\n回答：npm"),
    response("pending", "选择部署方式\n回答：npm", {
      optimistic: true,
      questionId: "question",
    }),
  ]);
  assert.equal(state.answered.size, 0);
  assert.deepEqual([...state.responses], ["pending"]);
});

test("重复标题的多批提问一条回答只解决最近一批", () => {
  const state = asyncQuestionState([
    question("first"),
    question("second"),
    response("answer", "选择部署方式\n回答：npm"),
  ]);
  assert.deepEqual([...state.answered], [["second", ["npm"]]]);
  assert.deepEqual([...state.responses], ["answer"]);
});

test("提交确认立即保留答案，历史消息恢复后仍匹配同一问题", () => {
  const accepted = { ...question("question"), questionAnswers: ["源码"] };
  assert.deepEqual(
    [...asyncQuestionState([accepted]).answered],
    [["question", ["源码"]]],
  );
  const restored = asyncQuestionState([
    question("question"),
    response("answer", "选择部署方式\n回答：源码"),
  ]);
  assert.deepEqual([...restored.answered], [["question", ["源码"]]]);
});

test("当前页面提交较早的同名问题时，问题标识优先且保留其他待答卡片", () => {
  const state = asyncQuestionState([
    { ...question("first"), questionAnswers: ["源码"] },
    question("second"),
    response("answer", "选择部署方式\n回答：源码", { questionId: "first" }),
  ]);
  assert.deepEqual([...state.answered], [["first", ["源码"]]]);
});
