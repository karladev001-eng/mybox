/**
 * MyBox speaks its own envelope rather than the y-websocket wire protocol.
 * Both ends ship together, so compatibility with other Yjs clients buys
 * nothing, while a JSON envelope carrying base64 Yjs updates stays readable in
 * logs and testable without a binary codec. The payloads are still ordinary Yjs
 * updates, so merging remains Yjs's job.
 */
export const MESSAGE_TYPES = Object.freeze(["sync", "update", "awareness"]);

export function encodeUpdate(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeUpdate(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Rejects anything malformed before it reaches the document. */
export function parseClientMessage(raw) {
  let message;
  try {
    message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return { error: "MALFORMED_MESSAGE" };
  }
  if (!message || typeof message !== "object") return { error: "MALFORMED_MESSAGE" };
  if (message.type === "update") {
    if (typeof message.update !== "string" || !message.update) return { error: "MALFORMED_UPDATE" };
    return { type: "update", update: message.update };
  }
  if (message.type === "awareness") {
    if (typeof message.state !== "object") return { error: "MALFORMED_AWARENESS" };
    return { type: "awareness", state: message.state };
  }
  return { error: "UNKNOWN_MESSAGE_TYPE" };
}
