"use client";

import { useEffect, useRef, useState } from "react";
import { apiGet, apiPostStream, type Quote } from "../../lib/api";
import { useTerminal } from "../../store/terminal";

type Msg = { role: "user" | "assistant"; content: string };

// Give up when the model has produced nothing for this long. Long enough for
// a self-hosted model to load and think; short enough that a dead endpoint
// does not leave the widget spinning forever.
const IDLE_TIMEOUT_MS = 120_000;

export default function AiWidget() {
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const scrollDown = () => setTimeout(() => scrollRef.current?.scrollTo({ top: 1e9 }), 50);

  const appendToReply = (text: string) =>
    setMessages((m) => {
      const last = m[m.length - 1];
      if (!last || last.role !== "assistant") return [...m, { role: "assistant", content: text }];
      return [...m.slice(0, -1), { role: "assistant", content: last.content + text }];
    });

  const send = async () => {
    const text = input.trim();
    if (!text || pending) return;
    const history = [...messages, { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setPending(true);
    setStreaming(false);

    let context: unknown = null;
    try {
      context = { activeSymbol, quote: (await apiGet<Quote[]>(`/api/quotes?symbols=${activeSymbol}`))[0] };
    } catch {
      // context is best-effort
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
    try {
      await apiPostStream(
        "/api/ai/chat",
        { messages: history, context },
        (delta) => {
          clearTimeout(idle);
          idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
          setStreaming(true);
          appendToReply(delta);
          scrollDown();
        },
        controller.signal
      );
    } catch (err) {
      const aborted = controller.signal.aborted;
      setError(
        aborted
          ? `Stopped: no response from the model for ${IDLE_TIMEOUT_MS / 1000}s or cancelled.`
          : (err as Error).message
      );
      setMessages((m) => (m[m.length - 1]?.content === "" ? m.slice(0, -1) : m));
    } finally {
      clearTimeout(idle);
      abortRef.current = null;
      setPending(false);
      setStreaming(false);
      scrollDown();
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-auto p-2 space-y-2 min-h-0">
        {messages.length === 0 && (
          <div className="dim">
            Ask about {activeSymbol}, the market, an indicator, or a headline. The current quote is shared as context.
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "assistant" && m.content === "" ? null : (
            <div key={i}>
              <span className={m.role === "user" ? "amber" : "up"}>{m.role === "user" ? "YOU" : "AI"} ›</span>{" "}
              <span className="whitespace-pre-wrap">{m.content}</span>
            </div>
          )
        )}
        {pending && !streaming && <div className="dim">thinking…</div>}
        {error && <div className="down">{error}</div>}
      </div>
      <div className="flex gap-1 p-1 border-t border-[var(--border)] shrink-0">
        <input
          className="flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Ask about ${activeSymbol}…`}
          disabled={pending}
        />
        {pending ? (
          <button className="term-btn" onClick={stop}>STOP</button>
        ) : (
          <button className="term-btn" onClick={send}>SEND</button>
        )}
      </div>
    </div>
  );
}
