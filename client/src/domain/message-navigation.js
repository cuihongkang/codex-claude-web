import { userMessageText } from "./user-message.js";

export function messageNavigationEntries(groups) {
  return groups
    .filter(
      (group) => group.type === "message" && group.item.type === "userMessage",
    )
    .map(({ item }, index) => {
      const content = item.content || [];
      const text = userMessageText(content).replace(/\s+/g, " ").trim();
      const attachments = content
        .filter((part) => ["image", "localImage", "skill"].includes(part.type))
        .map((part) =>
          part.type === "skill" ? `技能：${part.name}` : "图片附件",
        )
        .join(" · ");
      return {
        id: item.id,
        number: index + 1,
        label: text || attachments || "消息",
      };
    });
}
