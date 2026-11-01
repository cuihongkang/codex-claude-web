export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
export const basename = (path) =>
  path?.split("/").filter(Boolean).at(-1) || "本机";
export const titleOf = (t) => t?.name?.trim() || t?.preview || "新对话";
export const b64decode = (text) =>
  new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
export const b64encode = (text) => {
  const bytes = new TextEncoder().encode(text);
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
};
