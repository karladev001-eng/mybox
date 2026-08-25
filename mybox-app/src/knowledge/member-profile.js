import { LOCAL_ACCOUNT_DISPLAY_NAME, LOCAL_PROFILE_ID } from "../core/account-identity.js";

/**
 * The local membership remains in storage so signing out never loses access.
 * Once its linked account is also present, show one human-facing account row.
 */
export function visibleProjectMembers(members, activeProfileId) {
  const source = Array.isArray(members) ? members : [];
  const linkedAccountIsPresent = activeProfileId !== LOCAL_PROFILE_ID
    && source.some((member) => member.profileId === activeProfileId);
  return linkedAccountIsPresent
    ? source.filter((member) => member.profileId !== LOCAL_PROFILE_ID)
    : source;
}

export function projectMemberAccountName(profileId, { activeProfile, knownDisplayNames = {} } = {}) {
  if (profileId === LOCAL_PROFILE_ID) {
    return activeProfile?.profileId !== LOCAL_PROFILE_ID && activeProfile?.displayName
      ? activeProfile.displayName
      : LOCAL_ACCOUNT_DISPLAY_NAME;
  }
  if (profileId === activeProfile?.profileId && activeProfile.displayName) return activeProfile.displayName;
  return knownDisplayNames[profileId] ?? profileId;
}
