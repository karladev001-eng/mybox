export const LOCAL_PROFILE_ID = "local-user";
export const ACCOUNT_PROVIDERS = Object.freeze(["github"]);

const SUBJECT_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export class AccountIdentityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AccountIdentityError";
    this.code = code;
    this.details = details;
  }
}

export function signedOutSession() {
  return Object.freeze({ signedIn: false, profileId: LOCAL_PROFILE_ID, provider: null, displayName: null, avatarUrl: null });
}

/**
 * Builds the profile ID a Project membership stores. The subject is the
 * provider's immutable numeric ID, never a login name, so renaming an account
 * upstream preserves membership.
 */
export function accountProfileId(provider, subject) {
  if (!ACCOUNT_PROVIDERS.includes(provider)) {
    throw new AccountIdentityError("UNSUPPORTED_ACCOUNT_PROVIDER", "Account provider is not supported", { provider });
  }
  const value = String(subject ?? "").trim();
  if (!SUBJECT_PATTERN.test(value)) {
    throw new AccountIdentityError("INVALID_ACCOUNT_SUBJECT", "Account subject is invalid", { provider });
  }
  return `${provider}:${value}`;
}

/**
 * Normalizes a host-supplied account view into the session the UI and the
 * Knowledge client share. A malformed or signed-out view resolves to the local
 * profile so a device keeps working without an account.
 */
export function resolveAccountSession(view) {
  if (!view || view.signedIn !== true) return signedOutSession();
  let profileId;
  try {
    profileId = accountProfileId(view.provider, view.subject);
  } catch {
    return signedOutSession();
  }
  const displayName = typeof view.displayName === "string" && view.displayName.trim()
    ? view.displayName.trim()
    : profileId;
  const avatarUrl = typeof view.avatarUrl === "string" && /^https:\/\//.test(view.avatarUrl)
    ? view.avatarUrl
    : null;
  return Object.freeze({ signedIn: true, profileId, provider: view.provider, displayName, avatarUrl });
}

/** Resolves the profile ID Operations run as. */
export function resolveProfileId(session) {
  return session?.signedIn === true && typeof session.profileId === "string"
    ? session.profileId
    : LOCAL_PROFILE_ID;
}
