import {
  textReferences,
  threadReferenceInstructions,
} from "../domain/inline-references.js";
import { resourceTarget } from "../../../shared/backend-identity.mjs";
import { readThreadHistory } from "../domain/thread-history.js";
import { threadReferenceInput } from "../domain/composer-references.js";

export async function referenceInputs(text, backendId, rpc) {
  const references = textReferences(text);
  const inputs = [];
  const seen = new Set();
  const nativeSkills = [];
  for (const reference of references) {
    const key = reference.kind + ":" + reference.path;
    if (seen.has(key)) continue;
    seen.add(key);
    if (reference.kind === "skill") {
      if (backendId === "claude") nativeSkills.push(reference.name);
      else {
        if (reference.path.startsWith("skill://"))
          throw new Error("请从 Codex 技能列表重新选择此技能。");
        inputs.push({
          type: "skill",
          name: reference.name,
          path: reference.path,
        });
      }
    }
    if (reference.kind === "thread") {
      const target = resourceTarget(reference.threadId);
      if (target.backendId !== backendId)
        throw new Error("请选择同一后端的会话引用。");
      if (backendId === "codex")
        inputs.push({
          type: "mention",
          name: reference.name,
          path: reference.path,
        });
      else {
        const messages = await readThreadHistory(rpc, reference.threadId);
        inputs.push(
          threadReferenceInput(
            { id: reference.threadId, name: reference.name },
            messages,
          ),
        );
      }
    }
  }
  if (backendId === "codex" && references.some((ref) => ref.kind === "thread"))
    inputs.push({
      type: "text",
      text: threadReferenceInstructions(references),
      text_elements: [],
    });
  return {
    text: nativeSkills.length ? `/${nativeSkills[0]} ${text}` : text,
    inputs,
  };
}
