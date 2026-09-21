import { describe, expect, it } from "vitest";
import { aiConfig, aiConfigured, DEFAULT_AI_MAX_TOKENS, DEFAULT_AI_MODEL } from "./ai-config.js";

describe("aiConfigured", () => {
  it("is false with no credential", () => {
    expect(aiConfigured({})).toBe(false);
    expect(aiConfigured({ ANTHROPIC_API_KEY: "  " })).toBe(false);
  });

  it("accepts an Anthropic key or a bearer token", () => {
    expect(aiConfigured({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(true);
    expect(aiConfigured({ ANTHROPIC_AUTH_TOKEN: "local-token" })).toBe(true);
  });
});

describe("aiConfig", () => {
  it("uses the Claude defaults when nothing is set", () => {
    expect(aiConfig({})).toEqual({
      model: DEFAULT_AI_MODEL,
      maxTokens: DEFAULT_AI_MAX_TOKENS,
      thinking: "adaptive",
    });
  });

  it("takes the model, budget and thinking mode from the environment", () => {
    expect(
      aiConfig({ AI_MODEL: " qwen3.8-27b ", AI_MAX_TOKENS: "2048", AI_THINKING: "OFF" })
    ).toEqual({ model: "qwen3.8-27b", maxTokens: 2048, thinking: "off" });
  });

  it("falls back to defaults for empty or invalid values", () => {
    expect(aiConfig({ AI_MODEL: "", AI_MAX_TOKENS: "lots", AI_THINKING: "maybe" })).toEqual({
      model: DEFAULT_AI_MODEL,
      maxTokens: DEFAULT_AI_MAX_TOKENS,
      thinking: "adaptive",
    });
    expect(aiConfig({ AI_MAX_TOKENS: "-5" }).maxTokens).toBe(DEFAULT_AI_MAX_TOKENS);
  });
});

describe("aiConnection", () => {
  it("treats empty variables as unset", async () => {
    const { aiConnection } = await import("./ai-config.js");
    expect(aiConnection({ ANTHROPIC_API_KEY: "", ANTHROPIC_BASE_URL: " " })).toEqual({
      apiKey: undefined,
      authToken: undefined,
      baseURL: undefined,
    });
  });

  it("passes a self-hosted endpoint through", async () => {
    const { aiConnection } = await import("./ai-config.js");
    expect(
      aiConnection({ ANTHROPIC_AUTH_TOKEN: "tok", ANTHROPIC_BASE_URL: "http://localhost:8080/" })
    ).toEqual({ apiKey: undefined, authToken: "tok", baseURL: "http://localhost:8080/" });
  });
});
