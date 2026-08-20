import assert from "node:assert/strict";
import test from "node:test";
import {
  bearerToken,
  canWrite,
  hashToken,
  isValidProfileId,
  isValidProjectId,
  isValidRole,
  randomToken,
  safeEqual,
} from "../src/auth.js";
import { decodeUpdate, encodeUpdate, parseClientMessage } from "../src/protocol.js";

test("only Owner and Editor may write", () => {
  assert.equal(canWrite("owner"), true);
  assert.equal(canWrite("editor"), true);
  assert.equal(canWrite("viewer"), false);
  assert.equal(canWrite(undefined), false);
  assert.equal(canWrite("admin"), false);
});

test("roles and identifiers reject anything unexpected", () => {
  assert.equal(isValidRole("editor"), true);
  assert.equal(isValidRole("superuser"), false);
  assert.equal(isValidProjectId("project-abc_1.2"), true);
  assert.equal(isValidProjectId("../etc/passwd"), false);
  assert.equal(isValidProjectId(""), false);
  assert.equal(isValidProfileId("github:42"), true);
  assert.equal(isValidProfileId("has space"), false);
});

test("tokens are unpredictable and URL-safe", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const token = randomToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(token.length >= 40);
    seen.add(token);
  }
  assert.equal(seen.size, 200);
});

test("a stored token is a digest, never the token itself", async () => {
  const token = randomToken();
  const digest = await hashToken(token);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(digest, await hashToken(token));
  assert.notEqual(digest, await hashToken(randomToken()));
});

test("secret comparison rejects mismatches including length", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
  assert.equal(safeEqual(undefined, "abc"), false);
});

test("reads a bearer token and ignores other schemes", () => {
  const of = (value) => bearerToken(new Request("https://x.test", { headers: value ? { Authorization: value } : {} }));
  assert.equal(of("Bearer abc123"), "abc123");
  assert.equal(of("Basic abc123"), null);
  assert.equal(of(undefined), null);
});

test("update payloads round-trip unchanged", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
  assert.deepEqual([...decodeUpdate(encodeUpdate(bytes))], [...bytes]);
});

test("client messages are validated before reaching the document", () => {
  assert.deepEqual(parseClientMessage('{"type":"update","update":"AAEC"}'), { type: "update", update: "AAEC" });
  assert.deepEqual(parseClientMessage('{"type":"awareness","state":{"cursor":1}}'), { type: "awareness", state: { cursor: 1 } });
  assert.equal(parseClientMessage("not json").error, "MALFORMED_MESSAGE");
  assert.equal(parseClientMessage('{"type":"update"}').error, "MALFORMED_UPDATE");
  assert.equal(parseClientMessage('{"type":"update","update":""}').error, "MALFORMED_UPDATE");
  assert.equal(parseClientMessage('{"type":"awareness","state":null}').error, "MALFORMED_AWARENESS");
  assert.equal(parseClientMessage('{"type":"awareness","state":[]}').error, "MALFORMED_AWARENESS");
  assert.equal(parseClientMessage(JSON.stringify({ type: "awareness", state: { text: "x".repeat(5000) } })).error, "AWARENESS_TOO_LARGE");
  assert.equal(parseClientMessage('{"type":"drop-table"}').error, "UNKNOWN_MESSAGE_TYPE");
  assert.equal(parseClientMessage("null").error, "MALFORMED_MESSAGE");
});
