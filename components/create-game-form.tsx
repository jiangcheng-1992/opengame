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

function SuggestionReplies({
  suggestions,
  disabled,
  onSelect,
}: {
  suggestions: string[];
  disabled: boolean;
  onSelect: (suggestion: string) => void;
}) {
  if (!suggestions.length) return null;

  return (
    <div className="suggestion-grid chat-suggestions" aria-label="可选回答">
      <span className="suggestion-label">可点回复</span>
      {suggestions.map((suggestion) => (
        <button type="button" key={suggestion} onClick={() => onSelect(suggestion)} disabled={disabled}>
          {suggestion}
        </button>
      ))}
    </div>
  );
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
  const latestAssistantMessageId = useMemo(() => [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null, [messages]);
  const showSuggestions = Boolean(brainstormState.suggestions.length && !brainstormState.isReady && !isStreaming);
  const activeSlot = requiredSlots.find((slot) => !brainstormState.isReady && slotIsMissing(slot, brainstormState.missingSlots)) ?? null;
  const currentQuestion = brainstormState.isReady ? "确认生成设置" : activeSlot ? `继续确认：${activeSlot}` : "补充需求细节";

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

    if (gameId && brainstormState.isReady && /^(现在)?(开始|确认)?生成|生成可玩版本|可以生成/i.test(text)) {
      generateGame();
      return;
    }

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
          <div className="chat-topbar-actions">
            <span className="chat-status-pill">草稿自动保存</span>
            {isStreaming ? (
              <button className="icon-button" type="button" onClick={stop} aria-label="停止输出">
                <XCircle size={20} aria-hidden />
              </button>
            ) : null}
          </div>
        </div>

        <div className="chat-messages" ref={scrollRef} aria-live="polite">
          <article className="chat-row assistant">
            <span className="chat-avatar" aria-hidden>
              <Bot size={20} />
            </span>
            <div className="chat-message-stack">
              <div className="chat-bubble">
                <p>说一句你想玩的游戏。我会一次只追问一个关键点，最后整理成可生成的 brief。</p>
              </div>
              {showSuggestions && !latestAssistantMessageId ? (
                <SuggestionReplies
                  suggestions={brainstormState.suggestions}
                  disabled={isCreatingDraft || isGenerating}
                  onSelect={(suggestion) => submitMessage(suggestion)}
                />
              ) : null}
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
                <div className="chat-message-stack">
                  <div className="chat-bubble">
                    {text.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
                      <p key={`${message.id}-${paragraphIndex}`}>{paragraph}</p>
                    ))}
                  </div>
                  {message.role === "assistant" && message.id === latestAssistantMessageId && showSuggestions ? (
                    <SuggestionReplies
                      suggestions={brainstormState.suggestions}
                      disabled={isCreatingDraft || isGenerating}
                      onSelect={(suggestion) => submitMessage(suggestion)}
                    />
                  ) : null}
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
                <span className="typing-label">正在生成追问</span>
                <span className="typing-dot" aria-hidden />
                <span className="typing-dot" aria-hidden />
                <span className="typing-dot" aria-hidden />
              </div>
            </article>
          ) : null}
        </div>

        <p className="composer-hint">Enter 发送 · Shift+Enter 换行，也可以点上方选项</p>
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
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submitMessage();
              }
            }}
            placeholder="继续补充你的想法，或点上面的选项"
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

      <aside className="brief-panel" aria-label="需求进度">
        <div className="mini-heading">
          <Sparkles size={16} aria-hidden />
          生成前只确认必要信息
        </div>
        <h2>{brainstormState.isReady ? "需求已经收束" : "需求进度"}</h2>
        {brainstormState.isReady ? (
          <div className="brief-card">
            <span className="brief-card-label">
              <FileText size={15} aria-hidden />
              最终 Brief
            </span>
            <p>{brainstormState.brief}</p>
          </div>
        ) : (
          <div className="brief-card muted current-step-card">
            <span className="brief-card-label">
              <CircleDashed size={15} aria-hidden />
              当前问题
            </span>
            <p>{currentQuestion}</p>
          </div>
        )}

        <ul className="slot-list readiness-list" aria-label="需求槽位确认状态">
          {requiredSlots.map((slot) => {
            const missing = !brainstormState.isReady && slotIsMissing(slot, brainstormState.missingSlots);
            const active = missing && slot === activeSlot;
            const stateLabel = active ? "进行中" : missing ? "待确认" : "已确认";
            return (
              <li key={slot} className={active ? "active" : missing ? "pending" : "done"}>
                {missing ? <CircleDashed size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
                <span>{slot}</span>
                <strong>{stateLabel}</strong>
              </li>
            );
          })}
        </ul>

        {brainstormState.isReady ? (
          <div className="finalize-panel">
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

            {isGenerating ? (
              <div className="generation-pipeline" aria-label="生成和验证流程">
                <p>生成与验证流程</p>
                <ol>
                  <li className="done">
                    <span>草稿</span>
                    <small>已保存</small>
                  </li>
                  <li className="done">
                    <span>生成中</span>
                    <small>已启动</small>
                  </li>
                  <li>
                    <span>自动试玩</span>
                    <small>等待验证</small>
                  </li>
                  <li>
                    <span>可玩</span>
                    <small>待发布</small>
                  </li>
                </ol>
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>
    </section>
  );
}
