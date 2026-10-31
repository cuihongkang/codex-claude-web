import { createInterface } from "node:readline";
const output = (m) => process.stdout.write(JSON.stringify(m) + "\n");
let model = "default",
  effort = "medium";
createInterface({ input: process.stdin })
  .on("line", (line) => {
    const m = JSON.parse(line);
    if (m.type === "control_request") {
      if (m.request.subtype === "set_model") model = m.request.model;
      if (m.request.subtype === "apply_flag_settings")
        effort = m.request.settings.effortLevel;
      output({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: m.request_id,
          response:
            m.request.subtype === "get_settings"
              ? { applied: { model, effort } }
              : {},
        },
      });
    }
    if (m.type === "user") {
      output(m);
      output({
        type: "assistant",
        uuid: "reply-" + m.uuid,
        session_id: m.session_id,
        message: {
          content: [{ type: "text", text: "received " + m.message.content }],
        },
      });
      if (m.message.content === "permission")
        output({
          type: "control_request",
          request_id: "approval",
          request: {
            subtype: "can_use_tool",
            tool_name: "Bash",
            input: { command: "pwd" },
          },
        });
      else output({ type: "result", session_id: m.session_id });
    }
    if (m.type === "control_response")
      output({ type: "result", result: m.response.response.behavior });
  })
  .on("close", () => process.exit(0));
