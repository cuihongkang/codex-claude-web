import { mergeUsageUpdate } from "../domain/account-usage.js";
export function createAccount({ get, set, rpc, transport }) {
  let accountRevision = 0,
    usageRevision = 0,
    usageRequest = null;
  function refreshUsage() {
    if (!get().connected || (get().account && get().account.type !== "chatgpt"))
      return Promise.resolve();
    const connection = transport.connection;
    if (usageRequest?.connection === connection) return usageRequest.promise;
    const revision = usageRevision;
    const request = { connection };
    usageRequest = request;
    const current = () =>
      transport.connection === connection &&
      get().connected &&
      revision === usageRevision;
    set({ usageLoading: true });
    request.promise = rpc("account/rateLimits/read", {}, 20000)
      .then((usage) => {
        if (current()) set({ usage, usageError: "" });
      })
      .catch((error) => {
        if (current()) set({ usageError: error.message });
      })
      .finally(() => {
        if (usageRequest === request) {
          usageRequest = null;
          set({ usageLoading: false });
        }
      });
    return request.promise;
  }
  function handle({ method, params: p = {} }) {
    if (method === "account/rateLimits/updated" && p.rateLimits) {
      usageRevision++;
      set({
        usage: mergeUsageUpdate(get().usage, p.rateLimits),
        usageError: "",
      });
      return;
    }
    if (method === "account/updated") {
      const revision = ++accountRevision;
      usageRevision++;
      usageRequest = null;
      const connection = transport.connection;
      set({ account: null, usage: null, usageLoading: false, usageError: "" });
      rpc("account/read", { refreshToken: false })
        .then((result) => {
          if (
            transport.connection !== connection ||
            !get().connected ||
            revision !== accountRevision
          )
            return;
          set({ account: result.account });
          return refreshUsage();
        })
        .catch(() => {});
      return;
    }
  }
  function reset() {
    usageRevision++;
    usageRequest = null;
  }
  return {
    refreshUsage,
    handle,
    reset,
    get revision() {
      return accountRevision;
    },
  };
}
