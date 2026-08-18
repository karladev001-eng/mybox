import { isValidProjectId } from "./auth.js";
import { actionFor, parseProjectPath } from "./routes.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Routes `/projects/:projectId/*` to that Project's Durable Object. Naming the
 * object after the Project ID is what gives one Project one ordering point.
 *
 * The request is forwarded untouched. Rebuilding it here would hand the object
 * a body stream this Worker still owns, which fails once a response is sent.
 *
 * Kept apart from the Workers entry point so it carries no `cloudflare:`
 * import and stays testable under plain Node.
 */
export async function routeRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname === "/health") return json({ ok: true, service: "mybox-sync" });

  const route = parseProjectPath(url.pathname);
  if (!route) return json({ error: "NOT_FOUND" }, 404);
  if (!isValidProjectId(route.projectId)) return json({ error: "PROJECT_ID_INVALID" }, 400);
  if (!actionFor(request.method, route.subpath)) return json({ error: "NOT_FOUND" }, 404);

  // Without the secret the operator has not finished setup, and claim would be
  // open to whoever found the URL.
  if (!env.SERVER_SECRET) return json({ error: "SERVER_SECRET_UNSET" }, 503);

  return env.PROJECT_ROOM.getByName(route.projectId).fetch(request);
}
