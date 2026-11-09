import { randomUUID } from "node:crypto";
import { isUserPrompt, visibleSessionMessages } from "./messages.mjs";

export async function forkHistory(readSession, session, retained) {
  const sourceId = session.nativeSessionId || session.id;
  if (!retained.length)
    return {
      nativeSessionId: randomUUID(),
      turnIds: {},
      inputTurns: {},
      internalInputIds: {},
      historyAnchors: {},
      initialized: false,
    };
  const messages = await readSession("getSessionMessages", sourceId, {
    dir: session.historySearchAll ? undefined : session.cwd,
  });
  const anchors = new Map(
    Object.values(session.turns || {}).flatMap((turn) =>
      [turn.nativeAnchorId, ...(turn.nativeMessageIds || [])]
        .filter(Boolean)
        .map((id) => [id, turn.id]),
    ),
  );
  const markers = visibleSessionMessages(
    messages,
    session.internalInputIds,
  ).filter((message) => isUserPrompt(message) || anchors.has(message.uuid));
  const retainedIds = new Set(retained.map((turn) => turn.id));
  const sourceTurn = (message) =>
    anchors.get(message.uuid) ||
    session.turnIds?.[message.uuid] ||
    session.inputTurns?.[message.uuid] ||
    message.uuid;
  const retainedPrompts = markers.filter((message) =>
    retainedIds.has(sourceTurn(message)),
  );
  const next = markers[retainedPrompts.length];
  const boundary = next
    ? messages.findIndex((m) => m.uuid === next.uuid)
    : messages.length;
  if (!retainedPrompts.length || boundary <= 0)
    throw new Error("历史分支起点已变化，请刷新后重试");
  if (next && !next.parentUuid)
    throw new Error("Claude 原生历史缺少分支链边界");
  const { sessionId } = await readSession("forkSession", sourceId, {
    dir: session.historySearchAll ? undefined : session.cwd,
    // A turn may end on an attachment omitted by the SDK's message projection.
    // Its next prompt retains the exact native chain boundary.
    ...(next && { upToMessageId: next.parentUuid }),
  });
  const forked = await readSession("getSessionMessages", sessionId, {
    dir: session.historySearchAll ? undefined : session.cwd,
  });
  const original = messages.slice(0, boundary);
  const copiedIds = new Map(
    forked
      .filter((message) => message.forkedFrom?.sessionId === sourceId)
      .map((message) => [message.forkedFrom.messageUuid, message.uuid]),
  );
  if (original.some((message) => !copiedIds.has(message.uuid)))
    throw new Error("Claude 原生历史分支的消息来源不一致");
  const turnIds = {},
    inputTurns = {},
    historyAnchors = {},
    seen = new Set();
  for (const message of retainedPrompts.filter(isUserPrompt)) {
    const id = sourceTurn(message),
      uuid = copiedIds.get(message.uuid);
    if (seen.has(id)) inputTurns[uuid] = id;
    else {
      turnIds[uuid] = id;
      seen.add(id);
    }
  }
  for (const turn of retained) {
    if (!turn.nativeAnchorId && !turn.nativeMessageIds?.length) continue;
    historyAnchors[turn.id] = {
      nativeAnchorId: copiedIds.get(turn.nativeAnchorId),
      nativeMessageIds: (turn.nativeMessageIds || [])
        .map((id) => copiedIds.get(id))
        .filter(Boolean),
    };
  }
  return {
    nativeSessionId: sessionId,
    initialized: true,
    turnIds,
    inputTurns,
    internalInputIds: Object.fromEntries(
      Object.keys(session.internalInputIds || {})
        .filter((uuid) => copiedIds.has(uuid))
        .map((uuid) => [copiedIds.get(uuid), true]),
    ),
    historyAnchors,
  };
}

export function retainedDetails(session, retained, threadId = session.id) {
  const ids = new Set(retained.map((turn) => turn.id));
  const entries = [
    ...Object.values(session.extraItems || {}).filter(
      (item) =>
        ids.has(item.turnId) &&
        !(item.type === "userMessage" && session.inputTurns?.[item.id]),
    ),
    ...retained.flatMap((turn) =>
      turn.items.filter((item) => item.type === "subAgentActivity"),
    ),
  ];
  const agents = {};
  const extraItems = {};
  for (const original of entries) {
    const item = { ...original };
    if (item.agentThreadId) {
      const agent = session.agents?.[item.agentThreadId];
      if (agent) {
        item.agentThreadId = `agent/${threadId}/${agent.agentId}`;
        agents[item.agentThreadId] = {
          ...agent,
          parentNativeId:
            agent.parentNativeId || session.nativeSessionId || session.id,
        };
      }
    }
    extraItems[item.id] = item;
  }
  return { agents, extraItems };
}

export function createHistoryActions({
  session,
  turns,
  update,
  readSession,
  notify,
}) {
  return async function revert(params) {
    const s = await session(params.threadId);
    const records = await turns(s.id);
    const index = params.beforeTurnId
      ? records.findIndex((turn) => turn.id === params.beforeTurnId)
      : records.length - params.numTurns;
    if (!Number.isInteger(index) || index < 0 || index >= records.length)
      throw new Error("编辑起点已变化，请刷新历史后重试");
    const retained = records.slice(0, index);
    const fork = await forkHistory(readSession, s, retained);
    await update(s.id, {
      ...fork,
      nativeAliases: [
        ...new Set([
          ...(s.nativeAliases || []),
          s.nativeSessionId || s.id,
          fork.nativeSessionId,
        ]),
      ],
      turns: Object.fromEntries(
        retained.map((turn) => [
          turn.id,
          { ...turn, ...fork.historyAnchors?.[turn.id] },
        ]),
      ),
      ...retainedDetails(await session(s.id), retained),
      active: null,
      queue: [],
    });
    notify("thread/reverted", { threadId: s.id });
    return {};
  };
}
