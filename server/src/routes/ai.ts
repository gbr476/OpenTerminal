import { Router } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { aiConfig, aiConfigured, aiConnection } from "../ai-config.js";

export const aiRouter = Router();

// ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL select the
// endpoint, so the same route talks to Anthropic or to any self-hosted server
// that speaks the Messages API. See ../ai-config.ts.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic(aiConnection());
  return client;
}

const SYSTEM = `You are the AI assistant inside OpenTerminal, a Bloomberg-style financial terminal.
You help the user interpret market data, charts, news, options chains and macro indicators.
Answer concisely and professionally, in the language the user writes in.
When market data is provided in the conversation as JSON context, ground your answer in it.
You are not a licensed financial advisor: never give personalized investment advice or tell the user what to buy or sell.`;

const DECLINED = "The assistant declined to answer this request.";
const UNAVAILABLE =
  "AI assistant unavailable: set ANTHROPIC_API_KEY on the server, or ANTHROPIC_AUTH_TOKEN " +
  "plus ANTHROPIC_BASE_URL for a self-hosted Messages-API endpoint.";

type ChatMessage = { role: "user" | "assistant"; content: string };

function validMessages(value: unknown): value is ChatMessage[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (m) =>
        m &&
        typeof m === "object" &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
  );
}

function buildParams(messages: ChatMessage[], context: unknown): Anthropic.MessageCreateParams {
  const cfg = aiConfig();
  const contextBlock: ChatMessage[] = context
    ? [{ role: "user", content: `Current terminal context (JSON):\n${JSON.stringify(context)}` }]
    : [];
  return {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    ...(cfg.thinking === "adaptive" ? { thinking: { type: "adaptive" as const } } : {}),
    system: SYSTEM,
    messages: [...contextBlock, ...messages],
  };
}

/** Map a failure to an HTTP status and a message that names the fix, not the secret. */
function classify(err: unknown): { status: number; error: string } {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401 || err.status === 403) return { status: 503, error: UNAVAILABLE };
    if (err.status === 404) {
      return {
        status: 502,
        error: `AI model "${aiConfig().model}" is not available at the configured endpoint; set AI_MODEL to one it serves.`,
      };
    }
    return { status: 502, error: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/api[_ ]?key|auth[_ ]?token|authentication/i.test(msg)) return { status: 503, error: UNAVAILABLE };
  return { status: 502, error: msg };
}

aiRouter.post("/chat", async (req, res) => {
  const { messages, context } = req.body ?? {};
  if (!validMessages(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }
  if (!aiConfigured()) {
    return res.status(503).json({ error: UNAVAILABLE });
  }
  const params = buildParams(messages, context);

  // A client that accepts text/event-stream receives the answer as it is
  // generated, one `data:` JSON event per line: {type:"delta",text}, then
  // {type:"done"} or {type:"error",error}. Everyone else gets the JSON reply.
  if (!(req.header("accept") ?? "").includes("text/event-stream")) {
    try {
      const response = await getClient().messages.create({ ...params, stream: false });
      if (response.stop_reason === "refusal") return res.json({ text: DECLINED });
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => ("text" in b ? b.text : ""))
        .join("");
      return res.json({ text });
    } catch (err) {
      const { status, error } = classify(err);
      return res.status(status).json({ error });
    }
  }

  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  const stream = getClient().messages.stream(params);
  // Stop generating if the browser goes away mid-answer. (The request object
  // emits "close" as soon as its body has been read, so it cannot be used.)
  res.on("close", () => {
    if (!res.writableFinished) stream.abort();
  });
  let sentText = false;
  try {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        sentText = true;
        send({ type: "delta", text: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal" && !sentText) send({ type: "delta", text: DECLINED });
    send({ type: "done", stopReason: final.stop_reason });
  } catch (err) {
    if (!res.writableEnded) send({ type: "error", error: classify(err).error });
  } finally {
    res.end();
  }
});
