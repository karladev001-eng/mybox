import assert from "node:assert/strict";
import test from "node:test";
import { AppHost } from "../src/core/app-host.js";
import { MemoryStorageDriver } from "../src/core/storage.js";
import { createImageStudioApp } from "../src/image-studio/app.js";
import { BUILT_IN_TEMPLATES, compilePrompt, parseTemplateMarkdown, RATIOS, serializeTemplateMarkdown } from "../src/image-studio/domain.js";
import { filterNotePageChoices } from "../src/image-studio/note-page-search.js";

const user = { type: "user", id: "local-user" };
const reference = { appId: "image-studio", resourceId: "reference.png", mediaType: "image/png", revision: 1 };

test("filters Note Page choices by normalized title and Tag text", () => {
  const pages = [
    { id: "page-1", title: "静かな海", tagIds: ["tag-world", "tag-blue"] },
    { id: "page-2", title: "ＡＦＴＥＲ ＴＨＥ ＲＡＩＮ", tagIds: ["tag-poster"] },
    { id: "page-3", title: "都市", tagIds: [] },
  ];
  const tags = [
    { id: "tag-world", label: "幻想" },
    { id: "tag-blue", label: "Blue" },
    { id: "tag-poster", label: "ポスター" },
  ];

  assert.deepEqual(filterNotePageChoices(pages, tags, "#幻想 blue").map((page) => page.id), ["page-1"]);
  assert.deepEqual(filterNotePageChoices(pages, tags, "after rain").map((page) => page.id), ["page-2"]);
  assert.deepEqual(filterNotePageChoices(pages, tags, "見つからない"), []);
  assert.deepEqual(filterNotePageChoices(pages, tags).find((page) => page.id === "page-1").tags, ["幻想", "Blue"]);
});

test("parses and serializes versioned Markdown prompt templates", () => {
  const markdown = serializeTemplateMarkdown({ name: "雨の街", category: "world", prompt: "濡れた路面と静かな夜" });
  assert.deepEqual(parseTemplateMarkdown(markdown), { name: "雨の街", category: "world", prompt: "濡れた路面と静かな夜" });
  assert.throws(() => parseTemplateMarkdown("# no front matter"), (error) => error.code === "INVALID_FRONT_MATTER");
});

test("compiles prompt fragments in the fixed order and maps every ratio", () => {
  for (const ratio of Object.keys(RATIOS)) {
    const result = compilePrompt({ subject: "白いロボット", selections: { world: "builtin-world-fantasy", style: "builtin-style-watercolor", composition: "builtin-composition-poster", mood: "builtin-mood-cinematic" }, ratio, references: [reference], referenceInstruction: "輪郭を残す", extra: "文字なし" });
    assert.deepEqual(result.target, RATIOS[ratio]);
    const markers = ["主題:", "世界観:", "画風:", "用途・構図:", "雰囲気・装飾:", ...(ratio === "auto" ? [] : ["出力:"]), "参照画像:", "追加入力:"];
    assert.deepEqual(markers.map((marker) => result.prompt.indexOf(marker)), [...markers.map((marker) => result.prompt.indexOf(marker))].sort((a, b) => a - b));
  }
  assert.doesNotMatch(compilePrompt({ subject: "白いロボット", ratio: "auto" }).prompt, /出力:/);
  assert.deepEqual(compilePrompt({ subject: "", ratio: "16:9", promptOverride: "# Imported\n\n静かな海" }), { prompt: "# Imported\n\n静かな海", target: RATIOS["16:9"] });
  assert.throws(() => compilePrompt({ subject: "", ratio: "1:1", promptOverride: "   " }), (error) => error.code === "PROMPT_REQUIRED");
  assert.throws(() => compilePrompt({ subject: "x", references: [1, 2, 3, 4, 5] }), (error) => error.code === "TOO_MANY_REFERENCES");
});

test("ships detailed versioned templates and preserves reference composition by default", () => {
  for (const category of ["world", "style", "composition", "mood"]) {
    const templates = BUILT_IN_TEMPLATES.filter((template) => template.category === category);
    assert.equal(templates[0].name, "指定なし");
    assert.equal(templates[0].prompt, "");
    for (const template of templates.slice(1)) {
      assert.equal(template.revision, 2);
      assert.ok(template.prompt.length >= 55, `${template.id} should contain useful generation direction`);
    }
  }

  assert.deepEqual(RATIOS["21:9"], { ratio: "21:9" });
  const prompt = compilePrompt({ subject: "海辺の駅", ratio: "21:9", references: [reference] }).prompt;
  assert.match(prompt, /コラージュせず/);
  assert.match(prompt, /位置・大きさ・奥行き・シルエット/);
  assert.match(prompt, /縦横比 21:9/);
  assert.doesNotMatch(prompt, /目標寸法|px|\d+×\d+/);
});

test("persists completed generation before publishing its Event", async () => {
  const storageDriver = new MemoryStorageDriver();
  let generated = 0;
  let generatedPrompt = "";
  const connections = { pull: async () => ({ items: [], failures: [] }) };
  const host = new AppHost({ storageDriver, connections });
  host.register(createImageStudioApp({ generator: { generate: async ({ prompt }) => { generated += 1; generatedPrompt = prompt; return { resource: { appId: "image-studio", resourceId: "result.png", mediaType: "image/png", revision: 1 }, actual: { width: 1200, height: 800 } }; } } }));
  let event;
  host.subscribe("image-studio.generation.completed", (envelope) => { event = envelope; });
  const result = await host.invoke("image-studio.generation.create", { subject: "", ratio: "1:1", selections: {}, promptOverride: "編集した全体Prompt" }, { actor: user });
  assert.equal(generated, 1);
  assert.equal(generatedPrompt, "編集した全体Prompt");
  assert.equal(result.generation.state, "complete");
  assert.equal(result.generation.finalPrompt, "編集した全体Prompt");
  assert.deepEqual(result.generation.actual, { width: 1200, height: 800 });
  assert.match(result.generation.warning, /選択した比率/);
  const read = await host.invoke("image-studio.generation.read", { id: result.generation.id }, { actor: user });
  assert.equal(read.generation.resource.resourceId, "result.png");
  assert.equal(event.payload.generationId, result.generation.id);
  assert.equal(event.payload.width, 1200);
  assert.equal(event.payload.height, 800);
  assert.equal(BUILT_IN_TEMPLATES.length, 30);
});

test("requires fresh confirmation for agent reference generation and keeps purge User-only", async () => {
  let purgedResourceId = null;
  const host = new AppHost({ connections: { pull: async () => ({ items: [] }) } });
  host.register(createImageStudioApp({ generator: {
    generate: async () => ({ resource: reference, actual: { width: 1024, height: 1024 } }),
    purge: async (resourceId) => { purgedResourceId = resourceId; },
  } }));
  const options = { actor: { type: "agent", id: "assistant" }, grant: { operationIds: ["image-studio.generation.create-from-reference"] }, confirmationLevel: "autonomous" };
  await assert.rejects(host.invoke("image-studio.generation.create-from-reference", { subject: "arrange", ratio: "1:1", references: [reference] }, options), (error) => error.code === "ALWAYS_CONFIRM_REQUIRED");
  const result = await host.invoke("image-studio.generation.create-from-reference", { subject: "arrange", ratio: "1:1", references: [reference] }, { ...options, approval: { granted: true, fresh: true } });
  await assert.rejects(host.invoke("image-studio.generation.purge", { id: result.generation.id }, { actor: { type: "agent", id: "assistant" }, grant: { operationIds: ["image-studio.generation.purge"] }, approval: { granted: true, fresh: true } }), (error) => error.code === "CALLER_NOT_ALLOWED");
  await host.invoke("image-studio.generation.purge", { id: result.generation.id }, { actor: user, approval: { granted: true, fresh: true } });
  assert.equal(purgedResourceId, reference.resourceId);
});

test("keeps Workflow reference generation on an always-confirm Operation", async () => {
  const host = new AppHost({ workflows: { request: async () => ({ items: [] }) } });
  host.register(createImageStudioApp({ generator: {
    generate: async () => ({ resource: reference, actual: { width: 1024, height: 1024 } }),
  } }));
  const input = {
    config: { subject: "arrange", ratio: "1:1", references: [reference] },
    runId: "run-1",
    stepId: "step-1",
    deliveryId: "delivery-1",
    trigger: { kind: "schedule" },
    source: null,
  };
  const options = {
    actor: { type: "flow", id: "workflow-1" },
    grant: { operationIds: ["image-studio.workflow.generate-from-reference"] },
    confirmationLevel: "autonomous",
  };
  await assert.rejects(
    host.invoke("image-studio.workflow.generate-from-reference", input, options),
    (error) => error.code === "ALWAYS_CONFIRM_REQUIRED",
  );
  await assert.rejects(
    host.invoke("image-studio.workflow.generate", input, { ...options, grant: { operationIds: ["image-studio.workflow.generate"] } }),
    (error) => error.code === "INVALID_OPERATION_INPUT",
  );
  const result = await host.invoke("image-studio.workflow.generate-from-reference", input, { ...options, approval: { granted: true, fresh: true } });
  assert.equal(result.item.resource.resourceId, reference.resourceId);
});
