import WebSocket from "ws";
import { RPC_FRAME_BYTES } from "../../shared/rpc-limits.mjs";
export {
  MAX_RPC_MESSAGE_BYTES,
  RPC_FRAME_BYTES,
} from "../../shared/rpc-limits.mjs";

// Codex 的 WebSocket 接口分别限制单帧与完整消息的大小。
export function sendRpcText(socket, text) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (Buffer.byteLength(text) <= RPC_FRAME_BYTES) {
    socket.send(text);
    return;
  }
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += RPC_FRAME_BYTES)
    socket.send(bytes.subarray(offset, offset + RPC_FRAME_BYTES), {
      binary: false,
      fin: offset + RPC_FRAME_BYTES >= bytes.length,
    });
}
