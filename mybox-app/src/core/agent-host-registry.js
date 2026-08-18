/**
 * Makes each App's live `AppHost` reachable by App ID, independent of which
 * View is mounted. An App's `client.js` registers the host it already owns;
 * nothing else about how that client is constructed changes. This is the
 * seam that lets the assistant panel invoke an App's Operations without
 * holding a private reference to every App (ADR 0025).
 */
const hosts = new Map();

export function registerAgentHost(appId, host) {
  hosts.set(appId, host);
  return () => {
    if (hosts.get(appId) === host) hosts.delete(appId);
  };
}

export function getAgentHost(appId) {
  return hosts.get(appId) ?? null;
}

export function hasRegisteredAgentHosts() {
  return hosts.size > 0;
}

/**
 * Fans one Operation-invoking session out across every registered App host,
 * so the assistant offers whatever installed Apps have made available —
 * union of their agent-eligible Operations — from any screen, not only while
 * that App's own View happens to be mounted. Operation IDs are always
 * namespaced `<appId>.<name>` (`app-contract.js` enforces this at
 * registration), so the App ID prefix alone is enough to route `invoke` to
 * the host that actually owns it; nothing here needs to remember which
 * host declared which operation. The same shape works for a future Flow
 * runtime (`docs/adr/0025-agent-operations-from-the-assistant-panel.md`) by
 * passing `actor: { type: "flow", ... }` through `invoke`'s options instead
 * of `"agent"` — this aggregate does not assume a caller type.
 */
export function createAggregateAgentHost() {
  return Object.freeze({
    listOperations({ callerType } = {}) {
      return [...hosts.values()].flatMap((host) => host.listOperations({ callerType }));
    },
    async invoke(operationId, input, options) {
      const appId = operationId.split(".")[0];
      const host = hosts.get(appId);
      if (!host) throw new Error(`No registered App host owns operation "${operationId}"`);
      return host.invoke(operationId, input, options);
    },
  });
}
