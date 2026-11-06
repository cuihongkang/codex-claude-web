import { spawn } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createRunHooks } from "./hooks.mjs";
import { createInputStream } from "./input-stream.mjs";
import { convertMessage } from "./messages.mjs";
import { createTokenUsage } from "./token-usage.mjs";
import { modelOptions } from "./model-options.mjs";
import { captureNativeProcesses } from "./process-ownership.mjs";
import { createNativeCommands } from "./native-commands.mjs";
import { providerSettingsEnvironment } from "./provider-environment.mjs";
import {
  createProviderTransport,
  providerRuntimeEnvironment,
} from "./provider-transport.mjs";

export async function createExecutionSession({
  backend,
  session,
  queued,
  providers,
  save,
  emit,
  broadcast,
  questions,
  observeMessage,
  goals,
  tasks,
  current: getCurrent,
  finish,
  failed,
  beginActivity,
}) {
  const threadId = session.id;
  const usage = createTokenUsage({ threadId, session, save, emit });
  const provider = await providers.get(
    backend.id,
    queued.providerId ?? session.providerId,
  );
  const model = queued.model || session.model || provider?.models[0];
  const options = modelOptions(provider, model, queued);
  const proxy = provider ? await createProviderTransport(provider) : null;
  const input = createInputStream();
  const commands = createNativeCommands(
    input,
    session.nativeSessionId || threadId,
    (uuid) =>
      save(threadId, (s) => ({
        ...s,
        internalInputIds: { ...s.internalInputIds, [uuid]: true },
      })),
  );
  const process = {
    input,
    commands,
    query: null,
    providerId: provider?.id ?? queued.providerId ?? session.providerId,
    providerKey: JSON.stringify(provider),
    model,
    cwd: session.cwd,
    modelTokens: session.modelTokens || 0,
    lastTurnId: queued.id,
    lastActivityAt: Date.now(),
  };
  const current = () => (process.retired ? null : getCurrent());
  const context = () => ({
    turnId: current()?.turn.id || process.lastTurnId,
    readOnly: current()?.turn.mode === "plan" || current()?.queued.review,
  });
  process.query = query({
    prompt: input,
    options: {
      cwd: session.cwd,
      env: providerRuntimeEnvironment(provider, backend, {
        proxy,
        model,
        effort: queued.effort,
      }),
      pathToClaudeCodeExecutable: backend.executable,
      ...(session.initialized
        ? { resume: session.nativeSessionId || threadId }
        : { sessionId: session.nativeSessionId || threadId }),
      model,
      permissionMode:
        queued.mode === "plan" || queued.review ? "plan" : "bypassPermissions",
      planModeInstructions: queued.review
        ? "只读审查当前项目变更，核对相关实现及项目约定，给出问题、位置、触发条件及修复建议。保持只读权限，省略 ExitPlanMode 调用。"
        : "调查用户需求并制定完整方案。遵守只读计划模式。最终回复直接给出完整 Markdown 方案，等待用户通过网页批准或提出修改意见。保持计划模式，省略 ExitPlanMode 调用。",
      ...(queued.review && {
        disallowedTools: ["Write", "Edit", "NotebookEdit"],
      }),
      ...options,
      extraArgs: { "thinking-display": "summarized" },
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      enableFileCheckpointing: true,
      perTaskStopAffordance: true,
      forwardSubagentText: true,
      persistSession: true,
      systemPrompt: { type: "preset", preset: "claude_code" },
      settingSources: ["user", "project", "local"],
      canUseTool: async (name, toolInput) =>
        current()?.turn.mode === "plan" || current()?.queued.review
          ? {
              behavior: "deny",
              message: "当前任务处于只读模式，请使用读取和调查工具。",
            }
          : { behavior: "allow", updatedInput: toolInput },
      hooks: createRunHooks({
        threadId,
        context,
        save,
        broadcast,
        questions,
        goalBeforeTool: () => goals.beforeTool(threadId),
        onPromptFailure: (error) => {
          const active = current();
          if (active) active.promptError = error;
        },
      }),
      spawnClaudeCodeProcess: (options) => {
        const child = spawn(
          options.command,
          [...(backend.args || []), ...options.args],
          {
            cwd: options.cwd,
            env: options.env,
            signal: options.signal,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        process.child = child;
        process.ownerReady = captureNativeProcesses(child.pid)
          .then(({ owner, children }) =>
            save(threadId, (s) => ({
              ...s,
              nativeProcess: owner,
              nativeChildren: children,
            })),
          )
          .catch((error) => {
            process.ownerError = error;
          });
        return child;
      },
    },
  });
  const tools = new Map();
  const stopReasons = new Map();
  const blockOffsets = new Map();
  let streamingMessageId;
  process.close = () => {
    process.retired = true;
    input.close();
    commands.close(new Error("Claude 会话已关闭"));
    process.query.close();
    proxy?.close();
  };
  if (provider) {
    try {
      await process.query.applyFlagSettings({
        env: providerSettingsEnvironment(provider, backend, {
          proxy,
          model,
          effort: queued.effort,
        }),
      });
    } catch (error) {
      process.close();
      throw error;
    }
  }
  process.prewarm = process.query
    .supportedCommands()
    .then(() =>
      process.query.request({ subtype: "file_suggestions", query: "" }),
    )
    .catch((error) => {
      process.fileSuggestionsError = error;
      console.error("Claude 原生文件索引初始化失败", error);
    });
  process.done = (async () => {
    try {
      for await (const message of process.query) {
        await process.ownerReady;
        if (process.ownerError) throw process.ownerError;
        observeMessage?.(threadId, message);
        process.lastActivityAt = Date.now();
        if (message.isReplay || message.parent_tool_use_id) continue;
        if (commands.accept(message)) continue;
        if (
          message.type === "system" &&
          message.subtype === "session_state_changed"
        ) {
          process.nativeState = message.state;
          if (message.state === "running" && !commands.busy) {
            process.activityPending = true;
            if (!current()) await beginActivity(message);
          }
        }
        if (message.type === "rate_limit_event") {
          process.rateLimits ||= new Map();
          const info = message.rate_limit_info;
          process.rateLimits.set(info.rateLimitType || "default", info);
        }
        await tasks.event(threadId, message, process);
        let resultIds = [];
        if (message.type === "result") {
          const ids =
            message.user_message_uuids ||
            (message.user_message_uuid ? [message.user_message_uuid] : []);
          if (
            ids.length &&
            !current()?.automatic &&
            !ids.some((id) => current()?.inputIds.has(id))
          )
            continue;
          resultIds = ids;
        }
        if (
          !current() &&
          !commands.busy &&
          (message.type === "assistant" ||
            (message.type === "stream_event" &&
              message.event.type === "message_start") ||
            (message.type === "user" &&
              message.message.content?.some?.(
                (block) => block.type === "text",
              )))
        )
          await beginActivity(message);
        await goals.observe(threadId, message, process);
        await usage(message, process);
        if (message.type === "system" && message.subtype === "init") {
          process.terminalCommands = message.terminal_slash_commands || [];
          await save(threadId, (s) => ({
            ...s,
            initialized: true,
            model: message.model || s.model,
            skills: message.skills || [],
            mcpServers: message.mcp_servers || [],
            commands: message.slash_commands || [],
            agentsAvailable: message.agents || [],
          }));
        }
        const active = current();
        if (!active) continue;
        const turnId = active.turn.id;
        if (active.automatic && message.type === "assistant")
          active.turn.nativeMessageIds.push(message.uuid, message.message?.id);
        process.lastTurnId = turnId;
        const params = { threadId, turnId };
        if (
          message.type === "system" &&
          message.subtype === "hook_response" &&
          message.hook_event === "UserPromptSubmit" &&
          message.outcome === "error"
        )
          active.promptError = new Error(
            message.stderr || message.output || "读取项目指令失败",
          );
        if (message.type === "system" && message.subtype === "api_retry") {
          active.status = {
            turnId,
            kind: "retrying",
            attempt: message.attempt,
            retryAt: Date.now() + message.retry_delay_ms,
            message: "供应商暂时无法响应，正在重试…",
          };
          emit("lan/executionStatus", { threadId, ...active.status });
        }
        if (message.type === "stream_event") {
          const event = message.event;
          if (event.type === "message_start")
            streamingMessageId = event.message.id;
          if (event.type === "message_delta" && event.delta.stop_reason) {
            stopReasons.set(streamingMessageId, event.delta.stop_reason);
            if (event.delta.stop_reason === "end_turn") {
              for (const item of active.turn.items) {
                if (
                  item.type !== "agentMessage" ||
                  !item.id.startsWith(`${streamingMessageId}-`)
                )
                  continue;
                item.type =
                  active.turn.mode === "plan" ? "plan" : "agentMessage";
                item.phase = "final_answer";
                emit("item/completed", { ...params, item: { ...item } });
              }
              await save(threadId, (s) => ({
                ...s,
                turns: { ...s.turns, [turnId]: active.turn },
              }));
            }
          }
          if (event.type === "content_block_delta" && streamingMessageId) {
            if (active.status) {
              active.status = null;
              emit("lan/executionStatus", { ...params, kind: "working" });
            }
            if (event.delta.type === "text_delta")
              emit(
                active.turn.mode === "plan"
                  ? "item/plan/delta"
                  : "item/agentMessage/delta",
                {
                  ...params,
                  itemId: `${streamingMessageId}-${event.index}`,
                  delta: event.delta.text,
                },
              );
            if (event.delta.type === "thinking_delta")
              emit("item/reasoning/summaryTextDelta", {
                ...params,
                itemId: `${streamingMessageId}-${event.index}`,
                summaryIndex: 0,
                summaryTitle: "思考",
                delta: event.delta.thinking,
              });
          }
        }
        const finalMessage =
          message.type === "assistant" && stopReasons.has(message.message?.id)
            ? {
                ...message,
                message: {
                  ...message.message,
                  stop_reason: stopReasons.get(message.message.id),
                },
              }
            : message;
        const messageId = message.message?.id || message.uuid;
        const blockOffset = blockOffsets.get(messageId) || 0;
        if (message.type === "assistant")
          blockOffsets.set(
            messageId,
            blockOffset + message.message.content.length,
          );
        const items = convertMessage(
          finalMessage,
          turnId,
          tools,
          active.turn.mode,
          blockOffset,
        );
        if (items.length) {
          for (const item of items) {
            const prior = active.turn.items.findIndex((i) => i.id === item.id);
            if (prior >= 0) active.turn.items[prior] = item;
            else active.turn.items.push(item);
            emit("item/completed", { ...params, item });
          }
          await save(threadId, (s) => ({
            ...s,
            turns: { ...s.turns, [turnId]: active.turn },
          }));
        }
        if (message.type === "result") {
          if (!active.automatic) {
            active.completedInputs ||= new Set();
            for (const id of resultIds) active.completedInputs.add(id);
            if (!resultIds.length && active.inputIds.size === 1)
              active.completedInputs.add([...active.inputIds][0]);
            if (
              [...active.inputIds].some((id) => !active.completedInputs.has(id))
            )
              continue;
          }
          process.activityPending = false;
          if (active.promptError) await failed(active.promptError);
          else await finish(message);
        }
      }
      if (current()) await failed(new Error("Claude 会话结束时未返回任务结果"));
    } catch (error) {
      if (current()) await failed(error);
    } finally {
      process.ended = true;
      process.close();
    }
  })();
  return process;
}
