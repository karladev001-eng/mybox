import assert from "node:assert/strict";
import test from "node:test";
import { routeRequest } from "../src/router.js";

const worker = { fetch: routeRequest };

function envWith(handler = async () => new Response("{}")) {
  const calls = [];
  return {
    calls,
    env: {
      SERVER_SECRET: "secret",
      PROJECT_ROOM: {
        getByName(name) {
          calls.push({ name });
          return {
            fetch: async (request) => {
              const call = calls.at(-1);
              call.url = request.url;
              call.body = request.method === "GET" ? null : request.text();
              return handler(request);
            },
          };
        },
      },
    },
  };
}

async function call(method, path, env) {
  return worker.fetch(new Request(`https://sync.test${path}`, { method }), env);
}

test("reports health without touching a Project", async () => {
  const { env, calls } = envWith();
  const response = await call("GET", "/health", env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "mybox-sync" });
  assert.deepEqual(calls, []);
});

test("routes a Project path to the Durable Object named for that Project", async () => {
  const { env, calls } = envWith();
  await call("GET", "/projects/project-42/sync", env);
  assert.equal(calls[0].name, "project-42");
});

test("forwards the request unchanged so its body survives the hop", async () => {
  const { env, calls } = envWith();
  await worker.fetch(
    new Request("https://sync.test/projects/p/join", { method: "POST", body: '{"invite":"x"}' }),
    env,
  );
  assert.equal(calls[0].url, "https://sync.test/projects/p/join");
  assert.equal(await calls[0].body, '{"invite":"x"}');
});

test("accepts every defined route and names the object for each", async () => {
  const cases = [
    ["POST", "/projects/p/claim"],
    ["POST", "/projects/p/invites"],
    ["POST", "/projects/p/join"],
    ["GET", "/projects/p/members"],
    ["POST", "/projects/p/members/remove"],
    ["GET", "/projects/p/sync"],
  ];
  for (const [method, path] of cases) {
    const { env, calls } = envWith();
    const response = await call(method, path, env);
    assert.equal(response.status, 200, `${method} ${path}`);
    assert.equal(calls[0].name, "p", `${method} ${path}`);
  }
});

test("refuses a Project ID that could escape its own object", async () => {
  const { env, calls } = envWith();
  const response = await call("GET", "/projects/..%2F..%2Fadmin/sync", env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "PROJECT_ID_INVALID");
  assert.deepEqual(calls, []);
});

test("rejects a method the route does not define", async () => {
  const { env, calls } = envWith();
  const response = await call("GET", "/projects/p/claim", env);
  assert.equal(response.status, 404);
  assert.deepEqual(calls, []);
});

test("refuses every Project route until the operator sets the server secret", async () => {
  const { env, calls } = envWith();
  const response = await worker.fetch(
    new Request("https://sync.test/projects/p/join", { method: "POST" }),
    { ...env, SERVER_SECRET: undefined },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "SERVER_SECRET_UNSET");
  assert.deepEqual(calls, []);
});

test("an unknown path never reaches a Project", async () => {
  const { env, calls } = envWith();
  assert.equal((await call("GET", "/", env)).status, 404);
  assert.equal((await call("GET", "/projects", env)).status, 404);
  assert.deepEqual(calls, []);
});
