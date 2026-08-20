/** Host-owned shortcuts stay data-driven so the help menu and key handler agree. */
export const HOST_KEYBOARD_SHORTCUTS = Object.freeze([
  Object.freeze({ id: "toggle-assistant", group: "AI", label: "AIアシスタントを開く／閉じる", key: "j", code: "KeyJ", displayKeys: ["Ctrl", "J"] }),
  Object.freeze({ id: "command-palette", group: "操作", label: "コマンドパレットを開く", key: "k", code: "KeyK", displayKeys: ["Ctrl", "K"] }),
  Object.freeze({ id: "new-chat", group: "AI", label: "新しいチャット", key: "n", code: "KeyN", shiftKey: true, displayKeys: ["Ctrl", "Shift", "N"] }),
  Object.freeze({ id: "apps", group: "移動", label: "アプリを開く", key: "1", code: "Digit1", displayKeys: ["Ctrl", "1"] }),
  Object.freeze({ id: "connections", group: "移動", label: "連携を開く", key: "2", code: "Digit2", displayKeys: ["Ctrl", "2"] }),
  Object.freeze({ id: "history", group: "移動", label: "履歴を開く", key: "3", code: "Digit3", displayKeys: ["Ctrl", "3"] }),
  Object.freeze({ id: "settings", group: "移動", label: "設定を開く", key: "4", code: "Digit4", displayKeys: ["Ctrl", "4"] }),
  Object.freeze({ id: "chat", group: "移動", label: "AIチャットを開く", key: "5", code: "Digit5", displayKeys: ["Ctrl", "5"] }),
  Object.freeze({ id: "add-app", group: "操作", label: "アプリを追加", key: "a", code: "KeyA", shiftKey: true, displayKeys: ["Ctrl", "Shift", "A"] }),
  Object.freeze({ id: "shortcut-menu", group: "操作", label: "コマンドパレットを開く", key: "/", code: "Slash", displayKeys: ["Ctrl", "/"] }),
]);

/** Command-palette-only destinations do not claim global key combinations. */
export function buildCommandPaletteCommands(apps = [], activeApp = null) {
  const hostCommands = HOST_KEYBOARD_SHORTCUTS.filter((shortcut) => (
    shortcut.id !== "command-palette" && shortcut.id !== "shortcut-menu"
  ));
  const appCommands = (apps ?? [])
    .filter((app) => app?.id && app?.name)
    .map((app) => ({
      id: `open-app:${app.id}`,
      appId: app.id,
      appIcon: app.icon,
      group: `${app.name} App`,
      label: `Open ${app.name} App`,
      searchText: `${app.name} アプリを開く`,
      displayKeys: [],
    }));
  const activeAppCommands = (activeApp?.shortcuts ?? []).map((shortcut) => ({
    ...shortcut,
    id: `app-command:${activeApp.id}:${shortcut.id}`,
    appId: activeApp.id,
    appIcon: activeApp.icon,
    group: `${activeApp.name} App`,
  }));

  return [
    ...hostCommands,
    {
      id: "home",
      group: "移動",
      label: "MyBoxのホーム画面に戻る",
      searchText: "MyBox home ホーム アプリ一覧",
      displayKeys: [],
    },
    ...appCommands,
    ...activeAppCommands,
  ];
}

export function resolveHostKeyboardShortcut(event) {
  if (!event || event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
  const key = String(event.key ?? "").toLowerCase();
  const code = String(event.code ?? "");
  const shortcut = HOST_KEYBOARD_SHORTCUTS.find((candidate) => (
    (candidate.key === key || candidate.code === code)
      && Boolean(candidate.shiftKey) === Boolean(event.shiftKey)
  ));
  if (!shortcut) return null;
  return shortcut;
}

/** Resolves only the selected App's declared shortcuts; Host shortcuts are checked first. */
export function resolveAppKeyboardShortcut(shortcuts, event) {
  if (!event || event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
  const key = String(event.key ?? "").toLowerCase();
  const code = String(event.code ?? "");
  return (shortcuts ?? []).find((candidate) => (
    (candidate.key === key || candidate.code === code)
      && Boolean(candidate.shiftKey) === Boolean(event.shiftKey)
  )) ?? null;
}
