/**
 * Bundles a sync endpoint, Project ID, and invite code into one opaque string
 * so a joiner pastes one value instead of typing three. It carries no secret
 * that a server invite token does not already carry, so it is safe over any
 * channel the Owner already trusts to send the code through.
 */
const LINK_PREFIX = "mbx1.";

export function encodeInviteLink({ endpoint, projectId, invite }) {
  const payload = JSON.stringify({ e: endpoint, p: projectId, i: invite });
  return `${LINK_PREFIX}${btoa(unescape(encodeURIComponent(payload)))}`;
}

export function decodeInviteLink(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith(LINK_PREFIX)) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(LINK_PREFIX.length)))));
    if (!payload.e || !payload.p || !payload.i) return null;
    return { endpoint: payload.e, sharedProjectId: payload.p, invite: payload.i };
  } catch {
    return null;
  }
}
