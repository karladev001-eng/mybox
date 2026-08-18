/**
 * Drives two MyBox sync clients against a running sync server, which is the
 * only place the client, the protocol, and the server meet. Excluded from
 * `npm test` because it needs a server.
 *
 *   In sync-server/:
 *     npm run dev
 *   Then in mybox-app:
 *     npm run test:sync -- http://127.0.0.1:8787
 */
import { createSyncClient } from "../src/knowledge/sync-client.js";
import {
  applyPageMutation,
  createProjectDoc,
  readPage,
  seedPage,
} from "../src/knowledge/yjs-document.js";

const BASE = process.argv[2] ?? "http://127.0.0.1:8787";
const SECRET = process.env.SERVER_SECRET ?? "dev-secret";
const PROJECT = `client-${Date.now()}`;

const PAGE = {
  id: "page-1",
  title: "Shared Page",
  state: "active",
  tagIds: [],
  blocks: [{ id: "block-1", type: "paragraph", text: "", checked: false, links: [] }],
};

async function post(path, body, token) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return response.json();
}

const results = [];
function check(label, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

function start(token, doc) {
  return new Promise((resolve) => {
    const client = createSyncClient({
      doc,
      endpoint: BASE,
      projectId: PROJECT,
      token,
      onStatus: ({ status }) => { if (status === "connected") resolve(client); },
      onError: (error) => console.log("   (client error)", error.message),
    });
    client.connect();
  });
}

const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms));

// One member seeds the Page; a second joins with an invite.
const owner = await post(`/projects/${PROJECT}/claim`, { projectId: PROJECT, profileId: "github:1", secret: SECRET });
const invite = await post(`/projects/${PROJECT}/invites`, { role: "editor" }, owner.token);
const friend = await post(`/projects/${PROJECT}/join`, { invite: invite.invite, profileId: "github:2" });
const viewerInvite = await post(`/projects/${PROJECT}/invites`, { role: "viewer" }, owner.token);
const viewer = await post(`/projects/${PROJECT}/join`, { invite: viewerInvite.invite, profileId: "github:3" });

const docA = createProjectDoc();
seedPage(docA, PAGE);
const clientA = await start(owner.token, docA);
await settle();

const docB = createProjectDoc();
const clientB = await start(friend.token, docB);
await settle();

check("a joining member receives the existing Page", readPage(docB, PAGE.id)?.title === "Shared Page",
  `title=${readPage(docB, PAGE.id)?.title}`);

// The real test: neither waits for the other before typing.
applyPageMutation(docA, PAGE.id, { type: "block-update", blockId: "block-1", text: "Hello" });
applyPageMutation(docB, PAGE.id, { type: "block-update", blockId: "block-1", text: " world" });
await settle(1200);

const textA = readPage(docA, PAGE.id).blocks[0].text;
const textB = readPage(docB, PAGE.id).blocks[0].text;
check("both devices converge on one text", textA === textB, `A="${textA}" B="${textB}"`);
check("neither edit was lost", textA.includes("Hello") && textA.includes("world"), `text="${textA}"`);

// A structural change propagates too.
applyPageMutation(docA, PAGE.id, {
  type: "block-add",
  afterBlockId: "block-1",
  block: { id: "block-2", type: "heading-1", text: "Heading", checked: false, links: [] },
});
await settle();
check("a new Block reaches the other device",
  readPage(docB, PAGE.id).blocks.some((block) => block.id === "block-2"),
  readPage(docB, PAGE.id).blocks.map((b) => b.id).join(","));

// A Viewer sees the document but cannot change it for anyone else.
const docV = createProjectDoc();
const clientV = await start(viewer.token, docV);
await settle();
check("a viewer receives the Page", readPage(docV, PAGE.id)?.blocks[0].text === textA);
check("the viewer's client reports its role", clientV.role === "viewer", `role=${clientV.role}`);

applyPageMutation(docV, PAGE.id, { type: "block-update", blockId: "block-1", text: "viewer tried to write" });
await settle(1000);
check("a viewer's edit never reaches the others",
  readPage(docA, PAGE.id).blocks[0].text === textA,
  `owner text="${readPage(docA, PAGE.id).blocks[0].text}"`);

[clientA, clientB, clientV].forEach((client) => client.disconnect());
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
