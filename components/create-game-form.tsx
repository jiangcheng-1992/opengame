"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Bot, CheckCircle2, CircleDashed, FileText, Globe2, Lock, Send, Sparkles, WandSparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  EMPTY_BRAINSTORM_STATE,
  extractBrainstormState,
  extractTextFromUIMessage,
  stripBrainstormMetadata,
  type BrainstormState,
} from "@/lib/brainstorm";

type DraftForCreate = {
  id: string;
  visibility: string;
  messages?: Array<{
    id: string;
    role: string;
    content: string;
  }>;
};

function errorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return fallback;
  if ("error" in payload) {
    const error = payload.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      if ("formErrors" in error && Array.isArray(error.formErrors) && error.formErrors[0]) {
        return String(error.formErrors[0]);
      }
      if ("fieldErrors" in error && error.fieldErrors && typeof error.fieldErrors === "object") {
        const first = Object.values(error.fieldErrors).flat()[0];
        if (first) return String(first);
      }
    }
  }
  return fallback;
}

function toChatMessages(draft?: DraftForCreate | null): UIMessage[] {
  return (draft?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role === "agent" ? "assistant" : message.role === "user" ? "user" : "system",
    parts: [{ type: "text", text: message.content }],
  }));
}

function stateFromMessages(messages: UIMessage[]): BrainstormState {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!latestAssistant) return EMPTY_BRAINSTORM_STATE;
  return extractBrainstormState(extractTextFromUIMessage(latestAssistant));
}

function visibleMessageText(message: UIMessage) {
  return stripBrainstormMetadata(extractTextFromUIMessage(message));
}

const requiredSlots = ["核心玩法", "操作方式", "胜负目标", "视觉风格"] as const;

function slotIsMissing(slot: (typeof requiredSlots)[number], missingSlots: string[]) {
  return missingSlots.some((missingSlot) => {
    if (slot === "视觉风格") return missingSlot.includes("视觉") || missingSlot.includes("题材");
    return missingSlot.includes(slot);
  });
}

export function CreateGameForm({ initialPrompt = "", draft = null }: { initialPrompt?: string; draft?: DraftForCreate | null }) {
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initialMessages = useMemo(() => toChatMessages(draft), [draft]);
  const [gameId, setGameId] = useState(draft?.id ?? null);
  const [input, setInput] = useState(initialPrompt);
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">((draft?.visibility?.toUpperCase() as "PUBLIC" | "PRIVATE") ?? "PUBLIC");
  const [pendingFirstMessage, setPendingFirstMessage] = useState("");
  const [brainstormState, setBrainstormState] = useState(() => stateFromMessages(initialMessages));
  const [error, setError] = useState("");
  const [isCreatingDraft, startCreateDraft] = useTransition();
  const [isGenerating, startGenerate] = useTransition();

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: gameId ? `/api/games/${gameId}/brainstorm` : "/api/games/new/brainstorm",
        prepareSendMessagesRequest({ messages }) {
          const latest = messages[messages.length - 1];
          return {
            body: {
              message: extractTextFromUIMessage(latest),
              messages,
            },
          };
        },
      }),
    [gameId],
  );

  const { messages, sendMessage, status, error: streamError, stop } = useChat({
    id: gameId ?? "new-game-draft",
    messages: initialMessages,
    transport,
    onFinish({ message }) {
      setBrainstormState(extractBrainstormState(extractTextFromUIMessage(message)));
      router.refresh();
    },
    onError(nextError) {
      setError(nextError.message || "头脑风暴流式输出失败。");
    },
  });

  const isStreaming = status === "submitted" || status === "streaming";
  const canGenerate = Boolean(gameId && brainstormState.isReady && brainstormState.brief && status === "ready");

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    if (!latestAssistant) return;
    const text = extractTextFromUIMessage(latestAssistant);
    if (text.includes("<opengame_brief_json>") && text.includes("</opengame_brief_json>")) {
      setBrainstormState(extractBrainstormState(text));
    }
  }, [messages]);

  useEffect(() => {
    if (!pendingFirstMessage || !gameId || status !== "ready") return;
    sendMessage({ text: pendingFirstMessage });
    setPendingFirstMessage("");
  }, [gameId, pendingFirstMessage, sendMessage, status]);

  async function createDraft() {
    const response = await fetch("/api/games/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibility }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || typeof payload.gameId !== "string") {
      throw new Error(errorMessage(payload, "草稿创建失败。"));
    }

    setGameId(payload.gameId);
    router.replace(`/create?game=${payload.gameId}`);
    return payload.gameId as string;
  }

  function submitMessage(nextValue = input) {
    const text = nextValue.trim();
    if (!text || isStreaming || isCreatingDraft || isGenerating) return;

    setError("");
    setInput("");

    if (gameId) {
      sendMessage({ text });
      return;
    }

    startCreateDraft(async () => {
      try {
        await createDraft();
        setPendingFirstMessage(text);
      } catch (nextError) {
        setInput(text);
        setError(nextError instanceof Error ? nextError.message : "草稿创建失败。");
      }
    });
  }

  function generateGame() {
    if (!gameId || !brainstormState.brief) return;

    setError("");
    startGenerate(async () => {
      const response = await fetch(`/api/games/${gameId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brainstormState.brief, visibility }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(errorMessage(payload, "生成任务启动失败。"));
        return;
      }

      router.push(`/games/${payload.gameId}?job=${payload.jobId}`);
    });
  }

  return (
    <section className="create-chat-workbench" aria-label="对话创建游戏">
      <div className="chat-shell">
        <div className="chat-topbar">
          <div>
            <p className="eyebrow">对话创建</p>
            <h1>对话做游戏</h1>
          </div>
          {isStreaming ? (
            <button className="icon-button" type="button" onClick={stop} aria-label="停止输出">
              <XCircle size={20} aria-hidden />
            </button>
          ) : null}
        </div>

        <div className="chat-messages" ref={scrollRef} aria-live="polite">
          <article className="chat-row assistant">
            <span className="chat-avatar" aria-hidden>
              <Bot size={20} />
            </span>
            <div className="chat-bubble">
              <p>直接写你想做什么游戏，我会继续确认玩法、操作、目标和视觉风格，再启动生成。</p>
            </div>
          </article>

          {messages.map((message) => {
            const text = visibleMessageText(message);
            if (!text || message.role === "system") return null;
            return (
              <article className={`chat-row ${message.role === "user" ? "user" : "assistant"}`} key={message.id}>
                {message.role !== "user" ? (
                  <span className="chat-avatar" aria-hidden>
                    <Bot size={20} />
                  </span>
                ) : null}
                <div className="chat-bubble">
                  {text.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
                    <p key={`${message.id}-${paragraphIndex}`}>{paragraph}</p>
                  ))}
                </div>
              </article>
            );
          })}

          {isStreaming ? (
            <article className="chat-row assistant pending">
              <span className="chat-avatar" aria-hidden>
                <Bot size={20} />
              </span>
              <div className="chat-bubble">
                <span className="typing-dot" aria-hidden />
                <span className="typing-dot" aria-hidden />
                <span className="typing-dot" aria-hidden />
              </div>
            </article>
          ) : null}
        </div>

        {brainstormState.suggestions.length && !brainstormState.isReady ? (
          <div className="suggestion-grid" aria-label="可选回答">
            {brainstormState.suggestions.map((suggestion) => (
              <button type="button" key={suggestion} onClick={() => submitMessage(suggestion)} disabled={isStreaming || isCreatingDraft || isGenerating}>
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            submitMessage();
          }}
        >
          <label className="sr-only" htmlFor="create-chat-input">
            说说你想做什么游戏
          </label>
          <textarea
            id="create-chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="说说你想做什么游戏"
            disabled={isStreaming || isCreatingDraft || isGenerating}
            rows={1}
          />
          <button className="icon-button send-button" type="submit" disabled={!input.trim() || isStreaming || isCreatingDraft || isGenerating} aria-label="发送">
            <Send size={21} aria-hidden />
          </button>
        </form>

        {error || streamError ? (
          <p className="error chat-error" role="alert">
            {error || streamError?.message}
          </p>
        ) : null}
      </div>

      <aside className="brief-panel" aria-label="生成确认">
        <div className="mini-heading">
          <Sparkles size={16} aria-hidden />
          生成前确认
        </div>
        <h2>{brainstormState.isReady ? "需求已经收束" : "还差这些信息"}</h2>
        {brainstormState.isReady ? (
          <div className="brief-card">
            <span className="brief-card-label">
              <FileText size={15} aria-hidden />
              最终 Brief
            </span>
            <p>{brainstormState.brief}</p>
          </div>
        ) : (
          <div className="brief-card muted">
            <span className="brief-card-label">
              <FileText size={15} aria-hidden />
              当前草稿
            </span>
            <p>先通过对话确认玩法、操作、目标和视觉风格，再启动生成。</p>
          </div>
        )}

        <ul className="slot-list readiness-list" aria-label="需求槽位确认状态">
          {requiredSlots.map((slot) => {
            const missing = !brainstormState.isReady && slotIsMissing(slot, brainstormState.missingSlots);
            return (
              <li key={slot} className={missing ? "pending" : "done"}>
                {missing ? <CircleDashed size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
                <span>{slot}</span>
                <strong>{missing ? "待确认" : "已确认"}</strong>
              </li>
            );
          })}
        </ul>

        <div className="segmented" aria-label="可见性">
          <button
            className={visibility === "PUBLIC" ? "active" : ""}
            type="button"
            onClick={() => setVisibility("PUBLIC")}
            aria-pressed={visibility === "PUBLIC"}
          >
            <Globe2 size={16} aria-hidden />
            公开
          </button>
          <button
            className={visibility === "PRIVATE" ? "active" : ""}
            type="button"
            onClick={() => setVisibility("PRIVATE")}
            aria-pressed={visibility === "PRIVATE"}
          >
            <Lock size={16} aria-hidden />
            私密
          </button>
        </div>
        <p className="helper">公开作品生成成功后进入作品广场；草稿只会出现在你的工作室。</p>

        <button className="button primary wide" type="button" onClick={generateGame} disabled={!canGenerate || isGenerating}>
          <WandSparkles size={18} aria-hidden />
          {isGenerating ? "启动生成中" : "生成可玩版本"}
        </button>

        <div className="generation-pipeline" aria-label="生成和验证流程">
          <p>生成与验证流程</p>
          <ol>
            <li className={gameId ? "done" : ""}>
              <span>草稿</span>
              <small>{gameId ? "已保存" : "待保存"}</small>
            </li>
            <li>
              <span>生成中</span>
              <small>等待生成</small>
            </li>
            <li>
              <span>自动试玩</span>
              <small>浏览器验证</small>
            </li>
            <li>
              <span>可玩</span>
              <small>可发布</small>
            </li>
          </ol>
        </div>
      </aside>
    </section>
  );
}
