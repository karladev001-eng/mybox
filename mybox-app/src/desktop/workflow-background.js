import { invoke, isTauri } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

const WORKFLOW_NOTIFICATION_EVENT = "mybox:workflow-notification";
const activeWorkflowNotifications = new Map();

export async function getWorkflowBackgroundSettings() {
  if (!isTauri()) return { background: false, autostart: false, desktop: false };
  const [background, autostart] = await Promise.all([invoke("workflow_background_enabled"), isEnabled()]);
  return { background, autostart, desktop: true };
}

export async function setWorkflowBackground({ background, autostart }) {
  if (!isTauri()) return { background: false, autostart: false, desktop: false };
  await invoke("set_workflow_background", { enabled: Boolean(background) });
  if (autostart === true) await enable();
  if (autostart === false) await disable();
  return getWorkflowBackgroundSettings();
}

export async function showMyBox() {
  if (isTauri()) await invoke("show_main_window");
}

export async function exitMyBox() {
  if (isTauri()) await invoke("exit_mybox");
}

export async function listenWorkflowNotifications(onOpen) {
  if (!isTauri()) return () => {};
  const listener = (event) => onOpen?.(event.detail ?? {});
  window.addEventListener(WORKFLOW_NOTIFICATION_EVENT, listener);
  return () => window.removeEventListener(WORKFLOW_NOTIFICATION_EVENT, listener);
}

export async function notifyWorkflow(notice) {
  if (!isTauri()) return false;
  let allowed = await isPermissionGranted();
  if (!allowed) allowed = await requestPermission() === "granted";
  if (!allowed) return false;
  activeWorkflowNotifications.get(notice.runId)?.close();
  const notification = new window.Notification(
    notice.kind === "pending-approval" ? `${notice.title} · 承認待ち` : `${notice.title} · 停止`,
    { body: notice.message, tag: `workflow-${notice.runId}` },
  );
  activeWorkflowNotifications.set(notice.runId, notification);
  notification.onclose = () => activeWorkflowNotifications.delete(notice.runId);
  notification.onclick = async () => {
    notification.close();
    await showMyBox();
    window.dispatchEvent(new CustomEvent(WORKFLOW_NOTIFICATION_EVENT, { detail: { workflowId: notice.workflowId, runId: notice.runId } }));
  };
  return true;
}
