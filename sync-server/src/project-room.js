import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import { canWrite, hashToken, isValidProfileId, isValidRole, randomToken, safeEqual } from "./auth.js";
import { decodeUpdate, encodeUpdate, parseClientMessage } from "./protocol.js";
import { actionFor, parseProjectPath } from "./routes.js";

/**
 * Typing produces updates far faster than the free plan's 100,000 daily row
 * writes tolerate, so the merged state is written on a timer instead of per
 * message. Losing at most this window on an eviction is acceptable because
 * every device keeps its own copy and re-sends on reconnect.
 */
const PERSIST_DEBOUNCE_MS = 5_000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Always drains the body, even when the handler is about to reject the caller.
 * Answering a forwarded request while its stream is unread tears down the
 * Durable Object, so an authorization failure would take the room with it.
 */
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** One Durable Object per Project: the single place its updates are ordered. */
export class ProjectRoom extends DurableObject {
  #doc = null;
  #dirty = false;

  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.#migrate();
      this.#doc = await this.#loadDoc();
    });
  }

  #migrate() {
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY, owner_profile_id TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS members (
      profile_id TEXT PRIMARY KEY, role TEXT NOT NULL, joined_at INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS tokens (
      token_hash TEXT PRIMARY KEY, profile_id TEXT NOT NULL, role TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY, role TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS doc_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), state BLOB NOT NULL)`);
  }

  async #loadDoc() {
    const doc = new Y.Doc();
    const row = this.ctx.storage.sql.exec("SELECT state FROM doc_state WHERE id = 1").toArray()[0];
    if (row?.state) Y.applyUpdate(doc, new Uint8Array(row.state));
    return doc;
  }

  #schedulePersist() {
    this.#dirty = true;
    // A single pending alarm coalesces a burst of keystrokes into one write.
    this.ctx.storage.setAlarm(Date.now() + PERSIST_DEBOUNCE_MS);
  }

  async alarm() {
    if (!this.#dirty) return;
    const state = Y.encodeStateAsUpdate(this.#doc);
    this.ctx.storage.sql.exec(
      "INSERT INTO doc_state (id, state) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state",
      state,
    );
    this.#dirty = false;
  }

  #project() {
    return this.ctx.storage.sql.exec("SELECT * FROM project WHERE id IS NOT NULL").toArray()[0] ?? null;
  }

  #memberFor(tokenHash) {
    return this.ctx.storage.sql.exec("SELECT * FROM tokens WHERE token_hash = ?", tokenHash).toArray()[0] ?? null;
  }

  async #issueToken(profileId, role) {
    const token = randomToken();
    this.ctx.storage.sql.exec(
      "INSERT INTO tokens (token_hash, profile_id, role) VALUES (?, ?, ?)",
      await hashToken(token), profileId, role,
    );
    return token;
  }

  async #requireRole(request, roles) {
    const token = new URL(request.url).searchParams.get("token") ?? bearerOf(request);
    if (!token) return { error: json({ error: "TOKEN_REQUIRED" }, 401) };
    const member = this.#memberFor(await hashToken(token));
    if (!member) return { error: json({ error: "TOKEN_INVALID" }, 403) };
    if (roles && !roles.includes(member.role)) return { error: json({ error: "ROLE_REQUIRED" }, 403) };
    return { member };
  }

  async fetch(request) {
    const route = parseProjectPath(new URL(request.url).pathname);
    const action = route ? actionFor(request.method, route.subpath) : null;

    if (action === "claim") return this.#claim(request);
    if (action === "invite") return this.#invite(request);
    if (action === "join") return this.#join(request);
    if (action === "members") return this.#members(request);
    if (action === "remove") return this.#remove(request);
    if (action === "sync") return this.#sync(request);
    return json({ error: "UNKNOWN_ACTION" }, 404);
  }

  /**
   * The deploying operator claims the Project once, proving they hold the
   * server secret. Without this an unclaimed Project would belong to whoever
   * found the URL first.
   */
  async #claim(request) {
    const { profileId, projectId, secret } = await readJson(request);
    if (!safeEqual(secret ?? "", this.env.SERVER_SECRET ?? "")) {
      return json({ error: "SERVER_SECRET_INVALID" }, 403);
    }
    if (!isValidProfileId(profileId)) return json({ error: "PROFILE_ID_INVALID" }, 400);

    const existing = this.#project();
    if (existing && existing.owner_profile_id !== profileId) {
      return json({ error: "PROJECT_ALREADY_CLAIMED" }, 409);
    }
    if (!existing) {
      this.ctx.storage.sql.exec(
        "INSERT INTO project (id, owner_profile_id, created_at) VALUES (?, ?, ?)",
        projectId, profileId, Date.now(),
      );
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO members (profile_id, role, joined_at) VALUES (?, 'owner', ?)",
        profileId, Date.now(),
      );
    }
    return json({ token: await this.#issueToken(profileId, "owner"), role: "owner" });
  }

  async #invite(request) {
    const { role = "editor" } = await readJson(request);
    const auth = await this.#requireRole(request, ["owner"]);
    if (auth.error) return auth.error;
    if (!isValidRole(role) || role === "owner") return json({ error: "ROLE_INVALID" }, 400);

    const invite = randomToken();
    this.ctx.storage.sql.exec(
      "INSERT INTO invites (token_hash, role, created_at) VALUES (?, ?, ?)",
      await hashToken(invite), role, Date.now(),
    );
    return json({ invite, role });
  }

  /** An invite is spent on first use, so a leaked one cannot admit a crowd. */
  async #join(request) {
    const { invite, profileId } = await readJson(request);
    if (!isValidProfileId(profileId)) return json({ error: "PROFILE_ID_INVALID" }, 400);
    if (typeof invite !== "string" || !invite) return json({ error: "INVITE_REQUIRED" }, 400);

    const inviteHash = await hashToken(invite);
    const row = this.ctx.storage.sql.exec("SELECT * FROM invites WHERE token_hash = ?", inviteHash).toArray()[0];
    if (!row) return json({ error: "INVITE_INVALID" }, 403);
    this.ctx.storage.sql.exec("DELETE FROM invites WHERE token_hash = ?", inviteHash);

    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO members (profile_id, role, joined_at) VALUES (?, ?, ?)",
      profileId, row.role, Date.now(),
    );
    return json({ token: await this.#issueToken(profileId, row.role), role: row.role });
  }

  async #members(request) {
    const auth = await this.#requireRole(request, ["owner"]);
    if (auth.error) return auth.error;
    return json({ members: this.ctx.storage.sql.exec("SELECT profile_id, role, joined_at FROM members").toArray() });
  }

  /**
   * Removing a member drops their tokens and closes their live sockets, so
   * revocation takes effect during an open session rather than at next login.
   */
  async #remove(request) {
    const { profileId } = await readJson(request);
    const auth = await this.#requireRole(request, ["owner"]);
    if (auth.error) return auth.error;
    const project = this.#project();
    if (project && project.owner_profile_id === profileId) return json({ error: "CANNOT_REMOVE_OWNER" }, 400);

    this.ctx.storage.sql.exec("DELETE FROM members WHERE profile_id = ?", profileId);
    this.ctx.storage.sql.exec("DELETE FROM tokens WHERE profile_id = ?", profileId);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.deserializeAttachment()?.profileId === profileId) socket.close(4003, "membership revoked");
    }
    return json({ removed: profileId });
  }

  async #sync(request) {
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "UPGRADE_REQUIRED" }, 426);
    const auth = await this.#requireRole(request, null);
    if (auth.error) return auth.error;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernation keeps an idle room from billing duration while connected.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ profileId: auth.member.profile_id, role: auth.member.role });
    server.send(JSON.stringify({
      type: "sync",
      update: encodeUpdate(Y.encodeStateAsUpdate(this.#doc)),
      role: auth.member.role,
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    const attachment = ws.deserializeAttachment() ?? {};
    const message = parseClientMessage(raw);
    if (message.error) {
      ws.send(JSON.stringify({ type: "error", error: message.error }));
      return;
    }
    if (message.type === "awareness") {
      this.#broadcast(ws, JSON.stringify({ type: "awareness", profileId: attachment.profileId, state: message.state }));
      return;
    }
    // The client-side role check is advice; this is the boundary that holds.
    if (!canWrite(attachment.role)) {
      ws.send(JSON.stringify({ type: "error", error: "ROLE_READ_ONLY" }));
      return;
    }
    try {
      Y.applyUpdate(this.#doc, decodeUpdate(message.update));
    } catch {
      ws.send(JSON.stringify({ type: "error", error: "UPDATE_REJECTED" }));
      return;
    }
    this.#schedulePersist();
    this.#broadcast(ws, JSON.stringify({ type: "update", update: message.update }));
  }

  async webSocketClose(ws) {
    const attachment = ws.deserializeAttachment() ?? {};
    this.#broadcast(ws, JSON.stringify({ type: "left", profileId: attachment.profileId }));
  }

  #broadcast(sender, payload) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== sender) socket.send(payload);
    }
  }
}

function bearerOf(request) {
  const match = /^Bearer (.+)$/.exec((request.headers.get("Authorization") ?? "").trim());
  return match ? match[1] : null;
}
