import { resourceTarget } from "../../../shared/backend-identity.mjs";

export function backendEnabled(backends = [], id) {
  return !backends.length || backends.some((b) => b.id === id && b.enabled);
}

export function visibleBackendThreads(threads, backends) {
  return threads.filter((thread) =>
    backendEnabled(backends, resourceTarget(thread.id).backendId),
  );
}
