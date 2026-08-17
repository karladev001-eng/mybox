import { invoke } from "@tauri-apps/api/core";
import { resolveAccountSession, signedOutSession } from "../core/account-identity.js";
import { isDesktopRuntime } from "./workspace.js";

/**
 * The Web preview has no credential store, so it stays signed out rather than
 * pretending to authenticate.
 */
function unsupported() {
  throw new Error("サインインはデスクトップ版で利用できます");
}

export async function getAccountSession() {
  if (!isDesktopRuntime()) return signedOutSession();
  return resolveAccountSession(await invoke("account_session"));
}

export async function beginGitHubSignIn() {
  if (!isDesktopRuntime()) unsupported();
  return invoke("begin_github_device_login");
}

export async function completeGitHubSignIn({ deviceCode, interval }) {
  if (!isDesktopRuntime()) unsupported();
  return resolveAccountSession(await invoke("complete_github_device_login", { deviceCode, interval }));
}

export async function signOutAccount() {
  if (!isDesktopRuntime()) return signedOutSession();
  return resolveAccountSession(await invoke("sign_out_account"));
}
