import { AgentProviderError } from "./agent-provider.js";
import { operationNeedsApproval } from "./app-contract.js";

/**
 * Shaped for OpenAI Structured Outputs, which the Codex backend enforces on
 * whatever schema it is handed: no `oneOf`, every property listed in
 * `required`, and `additionalProperties: false` on every object. That rules
 * out both a respond/invoke union and a free-form `input` object, so the two
 * decision shapes share one flat object whose unused fields are null, and the
 * Operation payload travels as a JSON string that `readDecisionInput` parses.
 */
const DECISION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["type", "message", "operationId", "inputJson", "reason"],
  properties: {
    type: { type: "string", enum: ["respond", "invoke"] },
    message: { type: ["string", "null"] },
    operationId: { type: ["string", "null"] },
    inputJson: { type: ["string", "null"] },
    reason: { type: ["string", "null"] },
  },
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

/**
 * The schema carries the Operation payload as a JSON string because Structured
 * Outputs cannot describe a free-form object. A provider (or a test double)
 * that answers with a real object is still accepted.
 */
function readDecisionInput(decision) {
  const raw = decision?.inputJson ?? decision?.input;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function createPrompt(goal, operations, observations) {
  return [
    "You are the MyBox planning agent.",
    "Choose exactly one next decision matching the supplied JSON Schema.",
    "Always send every field. Set the ones that do not apply to null.",
    "To answer the user, set type to \"respond\" and put the reply in message.",
    "To call an operation, set type to \"invoke\", set operationId and reason, and put the operation's arguments in inputJson as a JSON object encoded as a string (for example \"{\\\"projectId\\\":\\\"p1\\\"}\").",
    "Use only the listed operations.",
    // A model that answers conversationally instead of acting produces the worst
    // possible outcome here: the User is told their Page was edited when nothing
    // was written. State the rule as a hard constraint, not a preference.
    "If the request asks you to change anything in MyBox — write, edit, add, rename, summarise into a Page — you MUST invoke an operation. Answering without invoking one leaves the User's data untouched.",
    "Never say you have edited, added, created, renamed, or saved anything unless an observation in this turn shows that exact operation returning a result. If you have not invoked it yet, invoke it now instead of describing what you would do.",
    "If an operation was rejected, read the error in observations, correct the arguments, and try again rather than giving up or claiming success.",
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
    // Structural Operations are one unit per call — a Block at a time — so
    // writing even a short structured Page costs several steps before the
    // closing reply. At 8 the agent had to choose between structure and
    // finishing, and chose to cram a whole document into one Block.
    maxSteps = 16,
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
        // A turn whose every Operation was rejected must not be reported as a
        // success just because the model says so. An approval denial is exempt:
        // that is the User's own decision, and describing it is honest.
        const failure = observations.find(({ output }) => output?.error && output.error !== "APPROVAL_DENIED");
        const anySucceeded = observations.some(({ output }) => !output?.error);
        if (failure && !anySucceeded) {
          throw new AgentProviderError(failure.output.error, failure.output.message ?? "Operation failed", {
            operationId: failure.operationId,
          });
        }
        return Object.freeze({ message: decision.message, steps: step, observations: structuredClone(observations) });
      }
      const input = readDecisionInput(decision);
      if (decision.type !== "invoke" || !allowedIds.has(decision.operationId) || !input) {
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
          input,
          reason,
        });
        if (!granted) {
          observations.push({ operationId: decision.operationId, output: { error: "APPROVAL_DENIED" } });
          continue;
        }
        stepApproval = { granted: true, fresh: true };
      }

      // The Host re-checks the level itself and defaults to "review" when it is
      // not told, so omitting it here made a raised level (Recoverable,
      // Autonomous) fail the very writes it was meant to allow.
      let output;
      try {
        output = await this.#host.invoke(decision.operationId, input, {
          actor: { type: "agent", id: agentId },
          grant,
          approval: stepApproval,
          confirmationLevel,
          reason,
        });
      } catch (error) {
        // A rejected Operation is an observation, not the end of the turn — the
        // same way an approval denial already is. A malformed input or a stale
        // revision is exactly the kind of thing the model can correct on the
        // next step, and `maxSteps` still bounds how long it may keep trying.
        observations.push({
          operationId: decision.operationId,
          output: { error: error?.code ?? "OPERATION_FAILED", message: error?.message ?? String(error) },
        });
        continue;
      }
      observations.push({ operationId: decision.operationId, output });
    }

    throw new AgentProviderError("AGENT_STEP_LIMIT", "Agent reached its operation step limit", { maxSteps });
  }
}
