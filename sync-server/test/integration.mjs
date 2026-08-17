/**
 * Exercises a running server end to end: membership, live relay, role
 * enforcement, and persistence across a reconnect. Kept out of `npm test`
 * because it needs `npm run dev` in another terminal.
 *
 *   npm run dev
 *   npm run test:live -- http://127.0.0.1:8787
 */
import * as Y from "yjs";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const SECRET = process.env.SERVER_SECRET ?? "dev-secret";
const PROJECT = `live-${Date.now()}`;

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const unb64 = (value) => new Uint8Array(Buffer.from(value, "base64"));

async function post(path, body, token) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return response.json();
}

function connect(token, name) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${BASE.replace("http", "ws")}/projects/${PROJECT}/sync?token=${token}`);
    const inbox = [];
    const waiters = [];
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiter = waiters.shift();
      if (waiter) waiter(message); else inbox.push(message);
    };
    socket.onerror = () => reject(new Error(`${name}: socket error`));
    socket.onopen = () => resolve({
      next: (ms = 5000) => new Promise((res, rej) => {
        if (inbox.length) return res(inbox.shift());
        const timer = setTimeout(() => rej(new Error(`${name}: timed out waiting for a message`)), ms);
        waiters.push((message) => { clearTimeout(timer); res(message); });
      }),
      send: (message) => socket.send(JSON.stringify(message)),
      close: () => socket.close(),
    });
  });
}

const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

const owner = await post(`/projects/${PROJECT}/claim`, { projectId: PROJECT, profileId: "github:1", secret: SECRET });
const editorInvite = await post(`/projects/${PROJECT}/invites`, { role: "editor" }, owner.token);
const editor = await post(`/projects/${PROJECT}/join`, { invite: editorInvite.invite, profileId: "github:2" });
const viewerInvite = await post(`/projects/${PROJECT}/invites`, { role: "viewer" }, owner.token);
const viewer = await post(`/projects/${PROJECT}/join`, { invite: viewerInvite.invite, profileId: "github:3" });
check("owner, editor, and viewer are provisioned",
  owner.role === "owner" && editor.role === "editor" && viewer.role === "viewer");

const a = await connect(owner.token, "owner");
const greeting = await a.next();
check("connecting returns current state and the caller's role", greeting.type === "sync" && greeting.role === "owner");

const b = await connect(editor.token, "editor");
await b.next();

const docA = new Y.Doc();
docA.getText("body").insert(0, "Hello ");
a.send({ type: "update", update: b64(Y.encodeStateAsUpdate(docA)) });

const relayed = await b.next();
const docB = new Y.Doc();
if (relayed.type === "update") Y.applyUpdate(docB, unb64(relayed.update));
check("an update reaches the other member", docB.getText("body").toString() === "Hello ",
  `text="${docB.getText("body").toString()}"`);

docB.getText("body").insert(docB.getText("body").length, "world");
b.send({ type: "update", update: b64(Y.encodeStateAsUpdate(docB)) });
const echoed = await a.next();
if (echoed.type === "update") Y.applyUpdate(docA, unb64(echoed.update));
check("edits from both sides merge instead of overwriting",
  docA.getText("body").toString() === "Hello world", `text="${docA.getText("body").toString()}"`);

b.send({ type: "awareness", state: { cursor: 3 } });
const awareness = await a.next();
check("awareness is relayed to peers", awareness.type === "awareness" && awareness.state?.cursor === 3);

const v = await connect(viewer.token, "viewer");
const viewerGreeting = await v.next();
check("a viewer still receives the document", viewerGreeting.type === "sync" && viewerGreeting.role === "viewer");
v.send({ type: "update", update: b64(Y.encodeStateAsUpdate(docA)) });
const refusal = await v.next();
check("the server refuses a viewer's write", refusal.type === "error" && refusal.error === "ROLE_READ_ONLY",
  refusal.error ?? "");

a.send({ type: "update", update: "not-base64!!" });
check("a malformed update is rejected", (await a.next()).type === "error");

// Persistence is debounced, so wait past the window before reconnecting.
await new Promise((resolve) => setTimeout(resolve, 7000));
const c = await connect(owner.token, "rejoin");
const restored = await c.next();
const docC = new Y.Doc();
Y.applyUpdate(docC, unb64(restored.update));
check("state survives a reconnect", docC.getText("body").toString() === "Hello world",
  `text="${docC.getText("body").toString()}"`);

[a, b, v, c].forEach((socket) => socket.close());
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
