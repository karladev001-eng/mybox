import { AgentProviderError } from "./agent-provider.js";
import { operationNeedsApproval } from "./app-contract.js";

const DECISION_SCHEMA = Object.freeze({
  type: "object",
  oneOf: [
    {
      required: ["type", "message"],
      additionalProperties: false,
      properties: {
        type: { const: "respond" },
        message: { type: "string" },
      },
    },
    {
      required: ["type", "operationId", "input", "reason"],
      additionalProperties: false,
      properties: {
        type: { const: "invoke" },
        operationId: { type: "string" },
        input: { type: "object" },
        reason: { type: "string" },
      },
    },
  ],
});

function parseDecision(result) {
  if (result?.data && typeof result.data === "object") return result.data;
  if (typeof result?.text !== "string") {
    throw new AgentProviderError("INVALID_PROVIDER_OUTPUT", "Provider returned no agent decision");
  }
  try {
    return JSON.parse(result.text);
  } catch {
    throw new AgentProviderError("INVALID_PROVIDER_OUTPUT", "Provider output is not valid JSON");
  }
}

function createPrompt(goal, operations, observations) {
  return [
    "You are the MyBox planning agent.",
    "Choose exactly one next decision matching the supplied JSON Schema.",
    "Use only the listed operations. Do not claim an operation succeeded until its result appears in observations.",
    `Goal: ${goal}`,
    `Operations: ${JSON.stringify(operations)}`,
    `Observations: ${JSON.stringify(observations)}`,
  ].join("\n");
}

export class AgentRuntime {
  #host;
  #providers;

  constructor({ host, providers }) {
    if (!host || typeof host.listOperations !== "function" || typeof host.invoke !== "function") {
      throw new TypeError("AgentRuntime requires an AppHost-compatible host");
    }
    if (!providers || typeof providers.get !== "function") {
      throw new TypeError("AgentRuntime requires an AgentProviderRegistry-compatible registry");
    }
    this.#host = host;
    this.#providers = providers;
  }

  async run(goal, {
    providerId,
    agentId = "mybox-assistant",
    grant,
    approval,
    confirmationLevel = "review",
    onApprovalNeeded,
    maxSteps = 8,
  } = {}) {
    if (typeof goal !== "string" || !goal.trim()) throw new TypeError("Agent goal is required");
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 32) throw new TypeError("maxSteps must be between 1 and 32");

    const provider = this.#providers.get(providerId);
    const declarations = this.#host.listOperations({ callerType: "agent" });
    const operations = declarations.map((operation) => ({
      id: operation.id,
      title: operation.title,
      effect: operation.effect,
      inputSchema: operation.inputSchema,
    }));
    const declarationById = new Map(declarations.map((operation) => [operation.id, operation]));
    const allowedIds = new Set(operations.map(({ id }) => id));
    const observations = [];

    for (let step = 1; step <= maxSteps; step += 1) {
      const result = await provider.generate({
        prompt: createPrompt(goal.trim(), operations, observations),
        responseSchema: DECISION_SCHEMA,
      });
      const decision = parseDecision(result);

      if (decision.type === "respond" && typeof decision.message === "string") {
        return Object.freeze({ message: decision.message, steps: step, observations: structuredClone(observations) });
      }
      if (decision.type !== "invoke" || !allowedIds.has(decision.operationId) || !decision.input || typeof decision.input !== "object") {
        throw new AgentProviderError("INVALID_AGENT_DECISION", "Provider requested an unavailable or malformed operation", { decision });
      }

      const declaration = declarationById.get(decision.operationId);
      const reason = typeof decision.reason === "string" ? decision.reason : goal.trim();

      // Ask before attempting the call, not only after AppHost's own
      // authorization rejects it — the panel can then show the exact input
      // the model chose rather than a bare "confirmation required" error.
      let stepApproval = approval;
      if (operationNeedsApproval(declaration.confirmationClass, confirmationLevel)) {
        const granted = typeof onApprovalNeeded === "function" && await onApprovalNeeded({
          operationId: decision.operationId,
          title: declaration.title,
          effect: declaration.effect,
          confirmationClass: declaration.confirmationClass,
          input: decision.input,
          reason,
        });
        if (!granted) {
          observations.push({ operationId: decision.operationId, output: { error: "APPROVAL_DENIED" } });
          continue;
        }
        stepApproval = { granted: true, fresh: true };
      }

      const output = await this.#host.invoke(decision.operationId, decision.input, {
        actor: { type: "agent", id: agentId },
        grant,
        approval: stepApproval,
        reason,
      });
      observations.push({ operationId: decision.operationId, output });
    }

    throw new AgentProviderError("AGENT_STEP_LIMIT", "Agent reached its operation step limit", { maxSteps });
  }
}
