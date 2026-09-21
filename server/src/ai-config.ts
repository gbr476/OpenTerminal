/**
 * Runtime configuration for the optional AI assistant.
 *
 * Connection settings are read by the Anthropic SDK itself from the
 * environment, so any server that speaks the Anthropic Messages API works:
 *
 *   ANTHROPIC_API_KEY     an Anthropic key (sent as `x-api-key`)
 *   ANTHROPIC_AUTH_TOKEN  a bearer token, for gateways and self-hosted servers
 *   ANTHROPIC_BASE_URL    the endpoint; defaults to Anthropic. llama.cpp's
 *                         llama-server, llama-swap and LiteLLM all accept the
 *                         same request shape.
 *
 * The request itself is tuned here:
 *
 *   AI_MODEL       model id passed on every request (default: claude-opus-4-8;
 *                  a self-hosted server needs one of the names it serves)
 *   AI_MAX_TOKENS  response budget (default: 16000; smaller keeps a local
 *                  model's answers quick)
 *   AI_THINKING    "adaptive" (default) lets the model reason before it
 *                  answers; "off" skips that for models or hosts where it is
 *                  slow or unsupported
 */
export type ThinkingMode = "adaptive" | "off";

export type AiConfig = {
  model: string;
  maxTokens: number;
  thinking: ThinkingMode;
};

export const DEFAULT_AI_MODEL = "claude-opus-4-8";
export const DEFAULT_AI_MAX_TOKENS = 16000;

type Env = Record<string, string | undefined>;

/** True when the SDK has some credential to send; the endpoint may still refuse it. */
export function aiConfigured(env: Env = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export function aiConfig(env: Env = process.env): AiConfig {
  const model = env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
  const parsed = Number.parseInt(env.AI_MAX_TOKENS ?? "", 10);
  const maxTokens = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_MAX_TOKENS;
  const thinking: ThinkingMode =
    (env.AI_THINKING ?? "").trim().toLowerCase() === "off" ? "off" : "adaptive";
  return { model, maxTokens, thinking };
}

export type AiConnection = { apiKey?: string; authToken?: string; baseURL?: string };

/**
 * Connection options for the SDK client, with empty strings treated as unset
 * so that `ANTHROPIC_BASE_URL=` in a compose file or shell means "default".
 */
export function aiConnection(env: Env = process.env): AiConnection {
  const clean = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  return {
    apiKey: clean(env.ANTHROPIC_API_KEY),
    authToken: clean(env.ANTHROPIC_AUTH_TOKEN),
    baseURL: clean(env.ANTHROPIC_BASE_URL),
  };
}
