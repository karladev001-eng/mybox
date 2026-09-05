import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createProfilePreferencesStore } from "../src/core/profile-preferences.js";
import { THEMES } from "../src/core/themes.js";

test("theme persists across stores, tolerates old IDs, and preserves concurrent preferences", async () => {
  let saved = { schemaVersion: 1, confirmationLevel: "review" };
  let fail = false;
  const storage = { readJson: async () => structuredClone(saved), writeJson: async (_, next) => {
    if (fail) throw new Error("disk full");
    saved = structuredClone(next);
  } };
  const store = createProfilePreferencesStore(storage);
  const initial = await store.load();
  assert.equal(initial.theme, "graphite");
  await Promise.all([store.setTheme(initial, "light"), store.setContextAutoRecord(initial, false)]);
  const restarted = createProfilePreferencesStore(storage);
  assert.equal((await restarted.load()).theme, "light");
  assert.equal((await restarted.load()).contextAutoRecord, false);
  for (const theme of THEMES) {
    await store.setTheme(initial, theme.id);
    assert.equal((await restarted.load()).theme, theme.id);
  }
  fail = true;
  await assert.rejects(store.setTheme(initial, "sepia"), /disk full/);
  assert.equal((await restarted.load()).theme, "midnight");
  await assert.rejects(store.setTheme(initial, "unknown"), /Theme is invalid/);
  saved.theme = "future-theme";
  assert.equal((await restarted.load()).theme, "graphite");
  assert.equal((await restarted.load()).contextAutoRecord, false);
});

const luminance = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((n) => parseInt(n, 16) / 255)
    .map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
test("theme text and primary action labels retain readable contrast", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const palette = (selector) => Object.fromEntries([...css.matchAll(/:root(?:\[data-theme="([^"]+)"\])?\s*\{([^}]+)\}/g)]
    .filter((m) => !m[1] || m[1] === selector)
    .flatMap((m) => [...m[2].matchAll(/(--[\w-]+):\s*(#[a-f0-9]{6})/g)].map((v) => [v[1], v[2]])));
  for (const {id} of THEMES) {
    const p = palette(id);
    for (const text of ["--text", "--muted"]) for (const bg of ["--bg", "--surface", "--surface-elevated"]) {
      assert.ok(contrast(p[text], p[bg]) >= 4.5, `${id} ${text} on ${bg}`);
    }
    assert.ok(contrast(p["--on-accent"], p["--accent"]) >= 4.5, `${id} primary label`);
  }
});
