/**
 * One table for both the Worker and the Durable Object. The Worker uses it to
 * reject an unknown route before waking an object; the object uses it to
 * dispatch. Sharing it keeps the two from drifting apart.
 */
const ROUTES = Object.freeze({
  "POST /claim": "claim",
  "POST /invites": "invite",
  "POST /join": "join",
  "GET /members": "members",
  "POST /members/remove": "remove",
  "GET /sync": "sync",
});

const PROJECT_PATH = /^\/projects\/([^/]+)(\/.*)?$/;

/** Splits `/projects/:projectId/rest` without deciding whether either is valid. */
export function parseProjectPath(pathname) {
  const match = PROJECT_PATH.exec(pathname);
  if (!match) return null;
  return { projectId: decodeURIComponent(match[1]), subpath: match[2] ?? "" };
}

export function actionFor(method, subpath) {
  return ROUTES[`${method} ${subpath}`] ?? null;
}
