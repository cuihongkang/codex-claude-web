import { uid } from "../domain/format.js";
import { fileReferenceInput } from "../domain/user-message.js";
import {
  filePresentation,
  decodeTextFile,
} from "../../../shared/file-types.mjs";

export async function readAttachment(file) {
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(",") + 1)), (c) =>
    c.charCodeAt(0),
  );
  const presentation = filePresentation(file.name);
  const text = presentation ? null : decodeTextFile(bytes);
  const image =
    presentation?.kind === "image" || file.type.startsWith("image/");
  return {
    id: uid(),
    name: file.name,
    size: file.size,
    mime: file.type,
    file,
    dataUrl: url,
    text,
    kind: image
      ? "image"
      : presentation?.kind || (text === null ? "download" : "text"),
    ...(image ? { preview: url, input: { type: "image", url } } : {}),
  };
}

export async function attachmentInputs(attachments, rpc) {
  return Promise.all(
    attachments.map(async (attachment) => {
      if (attachment.input) return attachment.input;
      if (!attachment.path) {
        const result = await rpc("fs/uploadAttachment", {
          name: attachment.name,
          dataBase64: attachment.dataUrl.slice(
            attachment.dataUrl.indexOf(",") + 1,
          ),
        });
        attachment.path = result.path;
      }
      return fileReferenceInput({ path: attachment.path });
    }),
  );
}
