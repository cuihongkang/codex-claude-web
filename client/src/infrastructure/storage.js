export const saved = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

export function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
