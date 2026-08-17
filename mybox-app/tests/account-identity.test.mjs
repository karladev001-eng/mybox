import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_PROFILE_ID,
  accountProfileId,
  resolveAccountSession,
  resolveProfileId,
  signedOutSession,
} from "../src/core/account-identity.js";
import { AppHost } from "../src/core/app-host.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createKnowledgeApp } from "../src/knowledge/app.js";
import {
  adoptLocalMemberships,
  createKnowledgeState,
  createPage,
  createProject,
  listProjects,
  readPage,
} from "../src/knowledge/domain.js";

function deterministicIds() {
  let value = 0;
  return (prefix) => `${prefix}-${++value}`;
}

test("builds a profile ID from the provider subject and rejects malformed input", () => {
  assert.equal(accountProfileId("github", "1234567"), "github:1234567");
  assert.throws(() => accountProfileId("gitlab", "1"), (error) => error.code === "UNSUPPORTED_ACCOUNT_PROVIDER");
  assert.throws(() => accountProfileId("github", "  "), (error) => error.code === "INVALID_ACCOUNT_SUBJECT");
  assert.throws(() => accountProfileId("github", "has space"), (error) => error.code === "INVALID_ACCOUNT_SUBJECT");
});

test("a signed-out or malformed account view resolves to the local profile", () => {
  assert.deepEqual(resolveAccountSession(null), signedOutSession());
  assert.deepEqual(resolveAccountSession({ signedIn: false }), signedOutSession());
  assert.deepEqual(resolveAccountSession({ signedIn: true, provider: "github" }), signedOutSession());
  assert.equal(resolveProfileId(signedOutSession()), LOCAL_PROFILE_ID);
  assert.equal(resolveProfileId(undefined), LOCAL_PROFILE_ID);
});

test("a signed-in view keeps only non-secret fields and an https avatar", () => {
  const session = resolveAccountSession({
    signedIn: true,
    provider: "github",
    subject: "42",
    displayName: "  Kan  ",
    avatarUrl: "https://avatars.example/u/42.png",
    accessToken: "gho_should_never_be_used",
  });
  assert.equal(session.profileId, "github:42");
  assert.equal(session.displayName, "Kan");
  assert.equal(session.avatarUrl, "https://avatars.example/u/42.png");
  assert.equal(Object.hasOwn(session, "accessToken"), false);
  assert.equal(resolveProfileId(session), "github:42");

  const insecureAvatar = resolveAccountSession({
    signedIn: true,
    provider: "github",
    subject: "42",
    avatarUrl: "http://avatars.example/u/42.png",
  });
  assert.equal(insecureAvatar.avatarUrl, null);
  assert.equal(insecureAvatar.displayName, "github:42");
});

test("first sign-in grants the account the role the local profile holds", () => {
  const idFactory = deterministicIds();
  const now = new Date("2026-08-17T00:00:00.000Z");
  const base = createKnowledgeState({ idFactory, now });
  const second = createProject(base, { name: "Shared", idFactory, now });
  const projectId = base.projects[0].id;

  const created = createPage(second.state, { projectId, title: "Local Page", idFactory, now });
  const accountId = "github:42";

  // Signed out, the account cannot reach the Project at all.
  assert.throws(
    () => readPage(created.state, { projectId, pageId: created.page.id, profileId: accountId }),
    (error) => error.code === "PROJECT_ROLE_REQUIRED",
  );

  const adopted = adoptLocalMemberships(created.state, { accountId, now });
  assert.deepEqual(adopted.adoptedProjectIds.sort(), [projectId, second.project.id].sort());
  assert.equal(readPage(adopted.state, { projectId, pageId: created.page.id, profileId: accountId }).title, "Local Page");
  assert.equal(listProjects(adopted.state, { profileId: accountId }).length, 2);

  // The local profile keeps its access, so signing out loses nothing.
  assert.equal(listProjects(adopted.state, { profileId: LOCAL_PROFILE_ID }).length, 2);

  // Repeating the grant adds no duplicate membership.
  const repeated = adoptLocalMemberships(adopted.state, { accountId, now });
  assert.deepEqual(repeated.adoptedProjectIds, []);
  assert.equal(
    repeated.state.projects.find((project) => project.id === projectId).members.filter((m) => m.profileId === accountId).length,
    1,
  );
});

test("adopting refuses the local profile as an account ID", () => {
  const state = createKnowledgeState({ idFactory: deterministicIds(), now: new Date("2026-08-17T00:00:00.000Z") });
  assert.throws(
    () => adoptLocalMemberships(state, { accountId: LOCAL_PROFILE_ID }),
    (error) => error.code === "INVALID_ACCOUNT_ID",
  );
});

test("Operations run as the signed-in profile and keep signed-out Pages reachable", async () => {
  const host = new AppHost({ storageDriver: new MemoryStorageDriver() });
  host.register(createKnowledgeApp());
  const localActor = { type: "user", id: LOCAL_PROFILE_ID };
  const accountActor = { type: "user", id: "github:42" };

  const { projects } = await host.invoke("knowledge.project.list", {}, { actor: localActor });
  await host.invoke("knowledge.page.create", { projectId: projects[0].id, title: "Before sign-in" }, { actor: localActor });

  // The account is a stranger to the Project until it is linked.
  await assert.rejects(
    host.invoke("knowledge.project.list", {}, { actor: accountActor }).then((result) => {
      assert.equal(result.projects.length, 0);
      throw new Error("EMPTY_CATALOG");
    }),
    (error) => error.message === "EMPTY_CATALOG",
  );

  await host.invoke("knowledge.profile.link-account", { accountId: "github:42" }, { actor: localActor });
  const afterLink = await host.invoke("knowledge.page.list", { projectId: projects[0].id }, { actor: accountActor });
  assert.equal(afterLink.pages[0].title, "Before sign-in");
});
