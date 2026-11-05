import { testServiceTierControls } from "./service-tier-controls.mjs";
import { testReasoningControls } from "./reasoning-controls.mjs";
import { testProjectFolders } from "./project-folders.mjs";
import { testProjectlessCreation } from "./projectless-creation.mjs";
import { testDraftSubmission } from "./draft-submission.mjs";
import { testAttachmentDrafts } from "./attachment-drafts.mjs";
import { testVersionDetails } from "./version-details.mjs";
import { testProcessDisplay } from "./process-display.mjs";
import { testProcessSteering } from "./process-steering.mjs";
import { testProcessCommands } from "./process-commands.mjs";
import { testTranslationLifecycle } from "./translation-lifecycle.mjs";
import { testComposerKeyboard } from "./composer-keyboard.mjs";
import { testTerminalLifecycle } from "./terminal-lifecycle.mjs";
import { testThreadSorting } from "./thread-sorting.mjs";
import { testProjectSnapshot } from "./project-snapshot.mjs";
import { testQuestionInteraction } from "./question-interaction.mjs";
import { testAuthentication } from "./auth.mjs";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

import { testMermaid } from "./mermaid.mjs";
import { testMessageImages } from "./message-image.mjs";
import { testMarkdownHtml } from "./markdown-html.mjs";
import { testToolActivities } from "./tool-activities.mjs";
import { testThreadAccess } from "./thread-access.mjs";
import { testThreadArchive } from "./thread-archive.mjs";
import { testThreadUnread } from "./thread-unread.mjs";
import { testThreadNames } from "./thread-names.mjs";
import { testForkTitles } from "./fork-titles.mjs";
import { testAnnotations } from "./annotations.mjs";
import { testUserMessage } from "./user-message.mjs";
import { testFilePanel } from "./file-panel.mjs";
import { testFileChanges } from "./file-changes.mjs";
import { testProcessTiming } from "./process-timing.mjs";
import { testQuestions } from "./questions.mjs";
import { testConnectionLifecycle } from "./connection-lifecycle.mjs";
import { testConnectionRecovery } from "./connection-recovery.mjs";
import { testProjectModels } from "./project-models.mjs";
import { testAccountUsage } from "./account-usage.mjs";
import { testHistory } from "./history.mjs";
import { testProgressiveHistory } from "./progressive-history.mjs";
import { testHistoryTranslations } from "./history-translations.mjs";
import { testConversationScroll } from "./conversation-scroll.mjs";
import { testComposerPerformance } from "./composer-performance.mjs";
import { testMessageNavigation } from "./message-navigation.mjs";
import { testContextPanel } from "./context-panel.mjs";
import { testCommands } from "./commands.mjs";
import { testCompaction } from "./compaction.mjs";
import { testCompactionDisplay } from "./compaction-display.mjs";
import { testCompactionRecovery } from "./compaction-recovery.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => storage.get(k) ?? null,
  setItem: (k, v) => storage.set(k, v),
  removeItem: (k) => storage.delete(k),
};
globalThis.location = { protocol: "http:", host: "component-test" };
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.testTerminals = [];
const fixture = {
  requests: [],
  socket: null,
  responseFor: (m) =>
    m.method === "thread/list" ? { data: [], nextCursor: null } : {},
};
const { requests } = fixture;
globalThis.WebSocket = class {
  static OPEN = 1;
  readyState = 1;
  constructor() {
    fixture.socket = this;
  }
  send(raw) {
    const m = JSON.parse(raw);
    requests.push(m);
    if (!m.method || m.method === "command/exec") return;
    Promise.resolve(fixture.responseFor(m)).then((result) =>
      this.onmessage({
        data: JSON.stringify({
          id: m.id,
          ...(result.error ? { error: result.error } : { result }),
        }),
      }),
    );
  }
  emit(method, params, id) {
    return this.onmessage({ data: JSON.stringify({ method, params, id }) });
  }
};
localStorage.setItem(
  "cx-summary-zh-v1",
  JSON.stringify([["Reviewing local configuration", "历史缓存不应展示"]]),
);
const app = await import(
  pathToFileURL(process.env.CODEX_COMPONENT_BUNDLE).href
);
app.applySession({
  authenticated: true,
  username: "fixture",
  expiresAt: Date.now() + 86400000,
});
assert.equal(storage.has("cx-summary-zh-v1"), false);
await testMermaid(app);
{
  const previousResponse = fixture.responseFor;
  try {
    await testAccountUsage(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testCommands(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testCompactionDisplay(app);
    await testCompaction(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testCompactionRecovery(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
      () => fixture.socket,
    );
    await testHistory(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testProgressiveHistory(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testConversationScroll(app);
    await testComposerPerformance(app);
    await testHistoryTranslations(app);
    await testMessageNavigation(app);
    await testContextPanel(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testThreadAccess(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testThreadArchive(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testForkTitles(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
    );
    await testThreadUnread(
      app,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testThreadNames(
      app,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testMessageImages(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
    );
    await testMarkdownHtml(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
    );
    await testToolActivities(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testAnnotations(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
    );
    await testUserMessage(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
    );
    await testFilePanel(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
    );
    await testFileChanges(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testProcessTiming(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testQuestions(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testConnectionLifecycle(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
      () => fixture.socket,
    );
    await testAuthentication(
      app,
      (respond) => (fixture.responseFor = respond),
      () => fixture.socket,
    );
    await testConnectionRecovery(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
    await testProjectModels(
      app,
      requests,
      (respond) => (fixture.responseFor = respond),
      (method, params) => fixture.socket.emit(method, params),
    );
  } finally {
    fixture.responseFor = previousResponse;
  }
}
await testServiceTierControls(app, fixture);
await testReasoningControls(app, fixture);
await testProjectFolders(app, fixture);
await testProjectlessCreation(app, fixture);
await testDraftSubmission(app, fixture);
await testAttachmentDrafts(app, fixture);
await testVersionDetails(app, fixture);
await testProcessDisplay(app, fixture);
await testProcessSteering(app, fixture);
await testProcessCommands(app, fixture);
await testTranslationLifecycle(app, fixture);
await testComposerKeyboard(app, fixture);
await testTerminalLifecycle(app, fixture);
await testThreadSorting(app, fixture);
await testProjectSnapshot(app, fixture);
await testQuestionInteraction(app, fixture);
