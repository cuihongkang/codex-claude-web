import { resourceTarget } from "../../../shared/backend-identity.mjs";
export function currentBackendId(state) {
  return state.current
    ? resourceTarget(state.current.id).backendId
    : state.backendId || "codex";
}
export function backendCapability(state, name) {
  const backend = state.backends?.find((b) => b.id === currentBackendId(state));
  return backend?.capabilities?.[name] ?? false;
}
export function backendReady(state) {
  const backend = state.backends?.find((b) => b.id === currentBackendId(state));
  return backend ? backend.ready : state.connected;
}
