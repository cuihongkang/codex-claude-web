// A bounded snapshot makes the last conversation available before RPC connects.
const KEY = "claude-history-v1";
const MAX_CHARS = 750_000;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function readClaudeCache(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(KEY));
    if (
      !value ||
      value.version !== 3 ||
      Date.now() - value.savedAt > MAX_AGE ||
      !Number.isFinite(value.savedAt) ||
      !Array.isArray(value.sessions) ||
      !Array.isArray(value.messages) ||
      value.session?.id !== value.selected
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export function writeClaudeCache(state, storage = globalThis.localStorage) {
  try {
    const value = {
      version: 3,
      savedAt: Date.now(),
      selected: state.selected,
      session: state.session,
      sessions: state.sessions.slice(0, 80),
      messages: state.messages.slice(-300),
    };
    // Never restore authorization prompts or treat cached running state as live.
    let json = JSON.stringify(value);
    while (json.length > MAX_CHARS && value.messages.length) {
      value.messages.shift();
      json = JSON.stringify(value);
    }
    if (json.length <= MAX_CHARS) storage.setItem(KEY, json);
  } catch {
    /* Storage may be disabled or full; live chat still works. */
  }
}
