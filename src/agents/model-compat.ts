import type { Api, Model } from "@mariozechner/pi-ai";

function isOpenAiCompletionsModel(model: Model<Api>): model is Model<"openai-completions"> {
  return model.api === "openai-completions";
}

/**
 * Returns true only for endpoints that are confirmed to be native OpenAI
 * infrastructure and therefore accept the `developer` message role.
 * Azure OpenAI uses the Chat Completions API and does NOT accept `developer`.
 * All other openai-completions backends (proxies, Qwen, GLM, DeepSeek, etc.)
 * only support the standard `system` role.
 */
function isOpenAINativeEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "api.openai.com";
  } catch {
    return false;
  }
}

function isAnthropicMessagesModel(model: Model<Api>): model is Model<"anthropic-messages"> {
  return model.api === "anthropic-messages";
}

/**
 * pi-ai constructs the Anthropic API endpoint as `${baseUrl}/v1/messages`.
 * If a user configures `baseUrl` with a trailing `/v1` (e.g. the previously
 * recommended format "https://api.anthropic.com/v1"), the resulting URL
 * becomes "…/v1/v1/messages" which the Anthropic API rejects with a 404.
 *
 * Strip a single trailing `/v1` (with optional trailing slash) from the
 * baseUrl for anthropic-messages models so users with either format work.
 */
function normalizeAnthropicBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/v1\/?$/, "");
}
export function normalizeModelCompat(model: Model<Api>): Model<Api> {
  const baseUrl = model.baseUrl ?? "";

  // Normalise anthropic-messages baseUrl: strip trailing /v1 that users may
  // have included in their config. pi-ai appends /v1/messages itself.
  if (isAnthropicMessagesModel(model) && baseUrl) {
    const normalised = normalizeAnthropicBaseUrl(baseUrl);
    if (normalised !== baseUrl) {
      return { ...model, baseUrl: normalised } as Model<"anthropic-messages">;
    }
  }

  if (!isOpenAiCompletionsModel(model)) {
    return model;
  }

  // The `developer` role and usage-in-streaming semantics are OpenAI-native
  // assumptions. For non-native openai-completions backends (proxies, Qwen,
  // GLM, DeepSeek, Kimi, etc.), force safe compatibility defaults:
  // - supportsDeveloperRole=false (many backends accept only `system`)
  // - supportsUsageInStreaming=false (usage-only chunks can break parsers that
  //   assume chunk.choices[0] exists)
  const compat = model.compat ?? undefined;
  // When baseUrl is empty the pi-ai library defaults to api.openai.com, so
  // leave compat unchanged and let the existing default behaviour apply.
  // Note: explicit compat=true hints are intentionally overridden for non-native
  // endpoints because these assumptions can cause request failures.
  const needsForce = baseUrl ? !isOpenAINativeEndpoint(baseUrl) : false;
  if (!needsForce) {
    return model;
  }
  const forceDeveloperRole = compat?.supportsDeveloperRole !== false;
  const forceUsageStreaming = compat?.supportsUsageInStreaming !== false;
  if (!forceDeveloperRole && !forceUsageStreaming) {
    return model;
  }

  // Return a new object — do not mutate the caller's model reference.
  return {
    ...model,
    compat: {
      ...compat,
      ...(forceDeveloperRole ? { supportsDeveloperRole: false } : {}),
      ...(forceUsageStreaming ? { supportsUsageInStreaming: false } : {}),
    },
  } as typeof model;
}
