import * as Y from "yjs";

const STORE_REMOTE_ORIGIN = Symbol("mybox-project-store-remote");
const DEFAULT_POLL_MS = 2_000;

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Eventually-consistent Yjs transport over an append-only Project store.
 * Native code owns paths and atomic files; this client sees opaque IDs/bytes.
 */
export function createProjectStoreClient({
  doc,
  projectId,
  readUpdates,
  writeUpdate,
  onStatus = () => {},
  onError = () => {},
  pollMs = DEFAULT_POLL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const seen = new Set();
  let status = "idle";
  let closed = false;
  let timer = null;
  let dirtyBeforeConnection = false;
  let writeQueue = Promise.resolve();

  const setStatus = (next) => {
    if (status === next) return;
    status = next;
    onStatus({ status, role: "owner" });
  };

  const reportError = (error) => {
    setStatus("offline");
    onError(error instanceof Error ? error : new Error(String(error)));
  };

  const persist = (bytes) => {
    writeQueue = writeQueue
      .then(async () => {
        if (closed) return;
        const id = await writeUpdate(projectId, toBase64(bytes));
        if (id) seen.add(id);
        dirtyBeforeConnection = false;
        setStatus("connected");
      })
      .catch((error) => {
        dirtyBeforeConnection = true;
        reportError(error);
      });
    return writeQueue;
  };

  const onDocumentUpdate = (update, origin) => {
    if (origin === STORE_REMOTE_ORIGIN) return;
    if (status !== "connected") {
      dirtyBeforeConnection = true;
      return;
    }
    persist(update);
  };
  doc.on("update", onDocumentUpdate);

  const pull = async () => {
    const updates = await readUpdates(projectId, [...seen]);
    // One observable document change per pull, even when reopening a long log.
    doc.transact(() => {
      for (const item of updates) {
        if (!item?.id || seen.has(item.id)) continue;
        Y.applyUpdate(doc, fromBase64(item.update), STORE_REMOTE_ORIGIN);
        seen.add(item.id);
      }
    }, STORE_REMOTE_ORIGIN);
  };

  const schedule = () => {
    if (closed) return;
    timer = setTimer(async () => {
      try {
        await pull();
        if (dirtyBeforeConnection) await persist(Y.encodeStateAsUpdate(doc));
        else setStatus("connected");
      } catch (error) {
        reportError(error);
      } finally {
        schedule();
      }
    }, pollMs);
  };

  const connect = async () => {
    if (closed || status !== "idle") return;
    setStatus("connecting");
    try {
      await pull();
      // Seeds a new store and captures edits made while the initial pull ran.
      await persist(Y.encodeStateAsUpdate(doc));
    } catch (error) {
      dirtyBeforeConnection = true;
      reportError(error);
    } finally {
      schedule();
    }
  };

  return {
    connect,
    async flush() {
      if (closed) throw new Error("PROJECT_STORE_CLOSED");
      await writeQueue;
      if (dirtyBeforeConnection) await persist(Y.encodeStateAsUpdate(doc));
      if (dirtyBeforeConnection || status !== "connected") throw new Error("PROJECT_STORE_NOT_SAVED");
    },
    get status() { return status; },
    get role() { return "owner"; },
    sendAwareness() {},
    disconnect() {
      closed = true;
      if (timer) clearTimer(timer);
      doc.off("update", onDocumentUpdate);
      setStatus("idle");
    },
  };
}

export const STORE_REMOTE = STORE_REMOTE_ORIGIN;
