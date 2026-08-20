import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCommandPaletteCommands,
  HOST_KEYBOARD_SHORTCUTS,
  resolveAppKeyboardShortcut,
  resolveHostKeyboardShortcut,
} from "../src/core/keyboard-shortcuts.js";

const event = (key, overrides = {}) => ({ key, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target: null, ...overrides });

test("resolves every documented Host shortcut", () => {
  for (const shortcut of HOST_KEYBOARD_SHORTCUTS) {
    assert.equal(resolveHostKeyboardShortcut(event(shortcut.key, { shiftKey: Boolean(shortcut.shiftKey) }))?.id, shortcut.id);
  }
});

test("resolves a selected App shortcut without adding it to Host globals", () => {
  const shortcuts = [{ id: "page-search", key: "p", code: "KeyP", shiftKey: false }];
  assert.equal(resolveHostKeyboardShortcut(event("p", { code: "KeyP" })), null);
  assert.equal(resolveAppKeyboardShortcut(shortcuts, event("p", { code: "KeyP" }))?.id, "page-search");
  assert.equal(resolveAppKeyboardShortcut(shortcuts, event("p", { code: "KeyP", shiftKey: true })), null);
});

test("supports the primary Command key without accepting Alt combinations", () => {
  assert.equal(resolveHostKeyboardShortcut(event("j", { ctrlKey: false, metaKey: true }))?.id, "toggle-assistant");
  assert.equal(resolveHostKeyboardShortcut(event("j", { altKey: true })), null);
});

test("Ctrl+K opens the command palette", () => {
  assert.equal(resolveHostKeyboardShortcut(event("k", { code: "KeyK" }))?.id, "command-palette");
});

test("uses the physical key code when a keyboard layout reports another character", () => {
  assert.equal(resolveHostKeyboardShortcut(event(":", { code: "Slash" }))?.id, "shortcut-menu");
});

test("keeps Host commands available while preserving ordinary editing shortcuts", () => {
  const input = { tagName: "INPUT", isContentEditable: false };
  assert.equal(resolveHostKeyboardShortcut(event("1", { target: input }))?.id, "apps");
  assert.equal(resolveHostKeyboardShortcut(event("/", { target: input }))?.id, "shortcut-menu");
  assert.equal(resolveHostKeyboardShortcut(event("j", { target: { tagName: "DIV", isContentEditable: true } }))?.id, "toggle-assistant");
  assert.equal(resolveHostKeyboardShortcut(event("a", { target: input })), null);
  assert.equal(resolveHostKeyboardShortcut(event("c", { target: input })), null);
});

test("requires Shift only for shortcuts that declare it", () => {
  assert.equal(resolveHostKeyboardShortcut(event("n")), null);
  assert.equal(resolveHostKeyboardShortcut(event("n", { shiftKey: true }))?.id, "new-chat");
  assert.equal(resolveHostKeyboardShortcut(event("j", { shiftKey: true })), null);
});

test("builds palette-only commands for MyBox home and every installed App", () => {
  const commands = buildCommandPaletteCommands([
    { id: "knowledge", name: "Note", icon: "note" },
    { id: "sample", name: "Sample", icon: "code" },
  ]);

  assert.equal(commands.some((command) => command.id === "home" && command.label.includes("MyBox")), true);
  assert.deepEqual(
    commands.filter((command) => command.id.startsWith("open-app:")).map((command) => command.label),
    ["Open Note App", "Open Sample App"],
  );
  assert.deepEqual(
    commands.filter((command) => command.id.startsWith("open-app:")).map((command) => command.group),
    ["Note App", "Sample App"],
  );
  assert.equal(commands.some((command) => command.id === "command-palette"), false);
  assert.equal(commands.some((command) => command.id === "shortcut-menu"), false);
});

test("adds the active App's declared commands to the command palette", () => {
  const activeApp = {
    id: "knowledge",
    name: "Note",
    icon: "note",
    shortcuts: [{ id: "page-search", group: "Note", label: "Pageを検索", key: "p", code: "KeyP", displayKeys: ["Ctrl", "P"] }],
  };
  const commands = buildCommandPaletteCommands([activeApp], activeApp);
  assert.deepEqual(
    commands.find((command) => command.id === "app-command:knowledge:page-search"),
    {
      ...activeApp.shortcuts[0],
      id: "app-command:knowledge:page-search",
      appId: "knowledge",
      appIcon: "note",
      group: "Note App",
    },
  );
  assert.equal(commands.find((command) => command.id === "open-app:knowledge")?.group, "Note App");
});
