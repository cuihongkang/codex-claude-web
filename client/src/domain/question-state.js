export function questionAnswers(questions, text) {
  const answers = [];
  let remaining = text.trim();
  for (const [index, question] of questions.entries()) {
    const prefix = `${question.title}\n回答：`;
    if (!remaining.startsWith(prefix)) return null;
    remaining = remaining.slice(prefix.length);
    const next = questions[index + 1];
    const end = next
      ? remaining.indexOf(`\n\n${next.title}\n回答：`)
      : remaining.length;
    if (end < 0 || !remaining.slice(0, end).trim()) return null;
    answers.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  return answers;
}

// 按发送顺序匹配整批问题，一条回答只归属最近一张匹配的卡片。
export function asyncQuestionState(items) {
  const answered = new Map();
  const responses = new Set();
  const pending = [];
  const questions = new Set(
    items.filter((item) => item.questions?.length).map((item) => item.id),
  );
  for (const item of items) {
    if (item.type === "agentMessage" && item.questions?.length) {
      pending.push(item);
      if (item.questionAnswers) answered.set(item.id, item.questionAnswers);
    }
    if (questions.has(item.questionId)) responses.add(item.id);
    if (item.type !== "userMessage" || item.optimistic) continue;
    const text = (item.content || [])
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("\n");
    const indexes = [...pending.keys()].reverse();
    const associated = pending.findIndex(
      (question) =>
        question.id === item.questionId ||
        (question.questionAnswers &&
          JSON.stringify(questionAnswers(question.questions, text)) ===
            JSON.stringify(question.questionAnswers)),
    );
    if (associated >= 0) indexes.unshift(associated);
    for (const index of indexes) {
      const question = pending[index];
      const answers = questionAnswers(question.questions, text);
      if (!answers) continue;
      answered.set(question.id, answers);
      responses.add(item.id);
      pending.splice(index, 1);
      break;
    }
  }
  return { answered, responses };
}

export function inputRequestItem(request, answers) {
  return {
    id: `user-input-${request.id}`,
    type: "userInputRequest",
    turnId: request.params.turnId,
    request,
    answers,
  };
}
