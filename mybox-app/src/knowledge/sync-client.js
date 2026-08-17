import * as Y from "yjs";
import { applyUpdate, encodeState } from "./yjs-document.js";

/**
 * Marks updates that arrived from the server. Rebroadcasting those would echo
 * every edit back to the sender and around the room forever, so the origin is
 * how a local edit is told apart from a relayed one.
 */
const REMOTE_ORIGIN = Symbol("mybox-sync-remote");

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const toBase64 = (bytes) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export function syncUrl(endpoint, projectId, token) {
  const base = new URL(endpoint);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = `${base.pathname.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}/sync`;
  base.searchParams.set("token", token);
  return base.toString();
}

/**
 * Keeps one Yjs document in step with a Project's sync endpoint.
 *
 * The socket is injected so the protocol can be tested without a network, and
 * so the desktop host can supply its own transport later.
 */
export function createSyncClient({
  doc,
  endpoint,
  projectId,
  token,
  openSocket = (url) => new WebSocket(url),
  onStatus = () => {},
  onAwareness = () => {},
  onError = () => {},
  reconnect = true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let socket = null;
  let role = null;
  let status = "idle";
  let attempts = 0;
  let closed = false;
  let retryHandle = null;

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    onStatus({ status, role });
  };

  const sendLocalUpdate = (update, origin) => {
    if (origin === REMOTE_ORIGIN) return;
    // A Viewer's write is refused by the server, so do not spend the round trip.
    if (role === "viewer") return;
    // Before the handshake the granted role is unknown, and anything written
    // meanwhile still reaches the server in the full state pushed on sync.
    if (status !== "connected" || socket?.readyState !== 1) return;
    socket.send(JSON.stringify({ type: "update", update: toBase64(update) }));
  };

  doc.on("update", sendLocalUpdate);

  function scheduleReconnect() {
    if (!reconnect || closed) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempts, RECONNECT_MAX_MS);
    attempts += 1;
    retryHandle = setTimer(open, delay);
  }

  function handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      onError(new Error("MALFORMED_SERVER_MESSAGE"));
      return;
    }

    if (message.type === "sync") {
      role = message.role ?? null;
      applyUpdate(doc, fromBase64(message.update), REMOTE_ORIGIN);
      // Hand the server anything written while disconnected. Yjs merges an
      // already-known state to nothing, so re-sending in full is safe.
      if (role !== "viewer") {
        socket.send(JSON.stringify({ type: "update", update: toBase64(encodeState(doc)) }));
      }
      setStatus("connected");
      return;
    }
    if (message.type === "update") {
      applyUpdate(doc, fromBase64(message.update), REMOTE_ORIGIN);
      return;
    }
    if (message.type === "awareness") {
      onAwareness({ profileId: message.profileId, state: message.state });
      return;
    }
    if (message.type === "left") {
      onAwareness({ profileId: message.profileId, state: null });
      return;
    }
    if (message.type === "error") {
      onError(new Error(message.error));
    }
  }

  function open() {
    if (closed) return;
    setStatus("connecting");
    try {
      socket = openSocket(syncUrl(endpoint, projectId, token));
    } catch (error) {
      onError(error);
      scheduleReconnect();
      return;
    }
    socket.onopen = () => { attempts = 0; };
    socket.onmessage = (event) => handleMessage(typeof event.data === "string" ? event.data : String(event.data));
    socket.onerror = () => onError(new Error("SYNC_SOCKET_ERROR"));
    socket.onclose = () => {
      setStatus("offline");
      scheduleReconnect();
    };
  }

  return {
    connect: open,
    get status() { return status; },
    get role() { return role; },
    /** Presence is ephemeral: it is relayed, never written to the document. */
    sendAwareness(state) {
      if (socket?.readyState !== 1) return;
      socket.send(JSON.stringify({ type: "awareness", state }));
    },
    disconnect() {
      closed = true;
      if (retryHandle) clearTimer(retryHandle);
      doc.off("update", sendLocalUpdate);
      socket?.close();
      setStatus("idle");
    },
  };
}

/** Exposed so tests can assert that relayed updates are not echoed back. */
export const REMOTE = REMOTE_ORIGIN;

export function encodeDocState(doc) {
  return toBase64(Y.encodeStateAsUpdate(doc));
}
