"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Bot, CheckCircle2, FileText, Globe2, Lock, Palette, Send, Sparkles, WandSparkles, XCircle } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { JobWatcher } from "@/components/job-watcher";
import { TaskProgressPanel, type TaskStep } from "@/components/task-progress-panel";
import {
  INITIAL_BRAINSTORM_STATE,
  extractBrainstormState,
  extractTextFromUIMessage,
  formatVisibleBrainstormText,
  type BrainstormState,
} from "@/lib/brainstorm";
import {
  DEFAULT_GAMEPLAY_SKELETON_KEY,
  GAMEPLAY_SKELETON_OPTIONS,
  getGameplaySkeletonOption,
  inferGameplaySkeletonKey,
  getGameplaySkeletonLabel,
  normalizeGameplaySkeletonKey,
  type GameplaySkeletonKey,
} from "@/lib/gameplay-skeleton";
import {
  GENERATION_MODEL_OPTIONS,
  getGenerationModelLabel,
  normalizeGenerationModelKey,
  type GenerationModelKey,
} from "@/lib/minimax-config";

type DraftForCreate = {
  id: string;
  visibility: string;
  status?: string;
  latestJob?: {
    id: string;
    status: string;
    progress?: number | null;
    errorMsg?: string | null;
    modelKey?: string | null;
    skeletonKey?: string | null;
  } | null;
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
  if (!latestAssistant) return INITIAL_BRAINSTORM_STATE;
  return extractBrainstormState(extractTextFromUIMessage(latestAssistant));
}

function visibleMessageText(message: UIMessage) {
  return formatVisibleBrainstormText(extractTextFromUIMessage(message));
}

const requiredSlots = ["核心玩法", "操作方式", "胜负目标", "视觉风格"] as const;

function slotIsMissing(slot: (typeof requiredSlots)[number], missingSlots: string[]) {
  return missingSlots.some((missingSlot) => {
    if (slot === "视觉风格") return missingSlot.includes("视觉") || missingSlot.includes("题材");
    return missingSlot.includes(slot);
  });
}

function normalizeJobStatus(status?: string | null) {
  return status?.toLowerCase() ?? null;
}

function buildCreateTaskSteps(isReady: boolean, isLaunching: boolean, jobStatus: string | null): TaskStep[] {
  const hasJob = Boolean(jobStatus);
  const isFailed = jobStatus === "failed";
  const isDone = jobStatus === "done";
  const isInValidation = jobStatus === "validating" || jobStatus === "repairing";
  const isPublishing = jobStatus === "finishing";
  const hasGenerated = isInValidation || isPublishing || isDone;

  return [
    { label: "确认需求", state: isReady ? "done" : "active" },
    { label: "创建任务", state: hasJob ? "done" : isLaunching ? "active" : "pending" },
    {
      label: "生成游戏",
      state: isFailed ? "failed" : hasGenerated ? "done" : hasJob ? "active" : "pending",
    },
    {
      label: "自动试玩",
      state: isFailed ? "failed" : isDone || isPublishing ? "done" : isInValidation ? "active" : "pending",
    },
    {
      label: "发布结果",
      state: isFailed ? "failed" : isDone ? "done" : isPublishing ? "active" : "pending",
    },
  ];
}

function createTaskStatusLabel(isReady: boolean, isLaunching: boolean, jobStatus: string | null) {
  if (jobStatus === "failed") return "失败";
  if (jobStatus === "done") return "已完成";
  if (jobStatus) return "生成中";
  if (isLaunching) return "启动中";
  if (isReady) return "等待生成";
  return "准备中";
}

function createTaskResultLabel(isReady: boolean, isLaunching: boolean, jobStatus: string | null, errorMsg?: string | null) {
  if (jobStatus === "failed") return errorMsg ?? "生成失败，展开运行日志查看原因。";
  if (jobStatus === "done") return "可试玩版本已生成。";
  if (jobStatus || isLaunching) return "生成完成后会进入试玩和继续修改工作台。";
  if (isReady) return "等待你在左侧确认后启动生成。";
  return "等待补齐核心玩法、操作、目标和视觉风格。";
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
  const [artEnhancementEnabled, setArtEnhancementEnabled] = useState(false);
  const [modelKey, setModelKey] = useState<GenerationModelKey>(() => normalizeGenerationModelKey(draft?.latestJob?.modelKey));
  const [skeletonKey, setSkeletonKey] = useState<GameplaySkeletonKey>(() => normalizeGameplaySkeletonKey(draft?.latestJob?.skeletonKey ?? DEFAULT_GAMEPLAY_SKELETON_KEY));
  const [pendingFirstMessage, setPendingFirstMessage] = useState("");
  const [brainstormState, setBrainstormState] = useState(() => stateFromMessages(initialMessages));
  const [activeJobId, setActiveJobId] = useState<string | null>(() => (draft?.status === "generating" ? draft.latestJob?.id ?? null : null));
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
  const isGenerationActive = Boolean(activeJobId);
  const canGenerate = Boolean(gameId && brainstormState.isReady && brainstormState.brief && status === "ready" && !isGenerationActive);
  const latestAssistantMessageId = useMemo(() => [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null, [messages]);
  const showSuggestions = Boolean(brainstormState.suggestions.length && !brainstormState.isReady && !isStreaming);
  const activeSlot = requiredSlots.find((slot) => !brainstormState.isReady && slotIsMissing(slot, brainstormState.missingSlots)) ?? null;
  const currentQuestion = brainstormState.isReady ? "确认生成设置" : activeSlot ? `继续确认：${activeSlot}` : "补充需求细节";
  const draftJobStatus = activeJobId && draft?.latestJob?.id === activeJobId ? normalizeJobStatus(draft.latestJob.status) : activeJobId ? "queued" : null;
  const activeJobInitialProgress = activeJobId
    ? {
        status: draftJobStatus ?? "queued",
        progress: draft?.latestJob?.id === activeJobId ? draft.latestJob.progress ?? undefined : undefined,
        errorMsg: draft?.latestJob?.id === activeJobId ? draft.latestJob.errorMsg : null,
      }
    : null;
  const createTaskSteps = useMemo(() => buildCreateTaskSteps(brainstormState.isReady, isGenerating, draftJobStatus), [brainstormState.isReady, draftJobStatus, isGenerating]);
  const createTaskStatus = createTaskStatusLabel(brainstormState.isReady, isGenerating, draftJobStatus);
  const createTaskResult = createTaskResultLabel(brainstormState.isReady, isGenerating, draftJobStatus, activeJobInitialProgress?.errorMsg);
  const createTaskResultTone = draftJobStatus === "failed" ? "danger" : draftJobStatus === "done" ? "success" : "muted";
  const hasStartedGeneration = Boolean(isGenerating || draftJobStatus);
  const hasLiveJobWatcher = Boolean(activeJobId && gameId);
  const inferredSkeletonKey = useMemo(
    () => (skeletonKey === "auto" ? inferGameplaySkeletonKey(brainstormState.brief) : skeletonKey),
    [brainstormState.brief, skeletonKey],
  );
  const selectedSkeleton = useMemo(() => getGameplaySkeletonOption(inferredSkeletonKey), [inferredSkeletonKey]);
  const autoMatchedSkeletonLabel =
    skeletonKey === "auto" && inferredSkeletonKey !== "auto" ? getGameplaySkeletonLabel(inferredSkeletonKey) : null;

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
    if (!text || isStreaming || isCreatingDraft || isGenerating || isGenerationActive) return;

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
    if (!gameId || !brainstormState.brief || isGenerationActive) return;

    setError("");
    startGenerate(async () => {
      const response = await fetch(`/api/games/${gameId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: brainstormState.brief, visibility, artEnhancementEnabled, modelKey, skeletonKey }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(errorMessage(payload, "生成任务启动失败。"));
        return;
      }

      if (typeof payload.jobId === "string") {
        setActiveJobId(payload.jobId);
        router.refresh();
      }
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
                  disabled={isCreatingDraft || isGenerating || isGenerationActive}
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
                      disabled={isCreatingDraft || isGenerating || isGenerationActive}
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

          {brainstormState.isReady ? (
            <article className="chat-row assistant brief-confirm-row">
              <span className="chat-avatar" aria-hidden>
                <Bot size={20} />
              </span>
              <div className="chat-message-stack brief-confirm-stack">
                <section className="brief-confirm-card" aria-label="确认 Brief">
                  <div className="brief-confirm-head">
                    <div>
                      <span className="brief-card-label">
                        <FileText size={15} aria-hidden />
                        确认 Brief
                      </span>
                      <h2>确认后开始生成可玩版本</h2>
                    </div>
                    <span className="task-status-pill">已收束</span>
                  </div>

                  <p className="brief-confirm-brief">{brainstormState.brief}</p>

                  <ul className="slot-list readiness-list brief-confirm-slots" aria-label="需求槽位确认状态">
                    {requiredSlots.map((slot) => (
                      <li key={slot} className="done">
                        <CheckCircle2 size={16} aria-hidden />
                        <span>{slot}</span>
                        <strong>已确认</strong>
                      </li>
                    ))}
                  </ul>

                  <label className={`art-enhancement-toggle ${artEnhancementEnabled ? "active" : ""}`}>
                    <input
                      type="checkbox"
                      checked={artEnhancementEnabled}
                      onChange={(event) => setArtEnhancementEnabled(event.target.checked)}
                      disabled={isGenerating || isGenerationActive}
                    />
                    <span className="art-enhancement-copy">
                      <span className="art-enhancement-title">
                        <Palette size={16} aria-hidden />
                        AI 美术增强
                      </span>
                      <span className="art-enhancement-desc">额外生成背景和角色图集，让游戏更像完成作品。会增加生成时间。</span>
                    </span>
                    <span className="switch-track" aria-hidden>
                      <span className="switch-thumb" />
                    </span>
                  </label>

                  <div className="brief-confirm-actions">
                    <div className="brief-confirm-settings">
                      <div className="brief-setting-group">
                        <span className="brief-setting-label">可见性</span>
                        <div className="segmented" aria-label="可见性">
                          <button
                            className={visibility === "PUBLIC" ? "active" : ""}
                            type="button"
                            onClick={() => setVisibility("PUBLIC")}
                            aria-pressed={visibility === "PUBLIC"}
                            disabled={isGenerating || isGenerationActive}
                          >
                            <Globe2 size={16} aria-hidden />
                            公开
                          </button>
                          <button
                            className={visibility === "PRIVATE" ? "active" : ""}
                            type="button"
                            onClick={() => setVisibility("PRIVATE")}
                            aria-pressed={visibility === "PRIVATE"}
                            disabled={isGenerating || isGenerationActive}
                          >
                            <Lock size={16} aria-hidden />
                            私密
                          </button>
                        </div>
                      </div>

                      <div className="brief-setting-group">
                        <span className="brief-setting-label">玩法骨架</span>
                        <div className="segmented segmented-rich" aria-label="玩法骨架">
                          {GAMEPLAY_SKELETON_OPTIONS.map((option) => (
                            <button
                              key={option.key}
                              className={skeletonKey === option.key ? "active" : ""}
                              type="button"
                              onClick={() => setSkeletonKey(option.key)}
                              aria-pressed={skeletonKey === option.key}
                              disabled={isGenerating || isGenerationActive}
                              title={option.description}
                            >
                              <Sparkles size={16} aria-hidden />
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <div className="skeleton-helper-card" aria-live="polite">
                          <div className="skeleton-helper-head">
                            <div>
                              <span className="skeleton-helper-eyebrow">当前骨架</span>
                              <strong>{skeletonKey === "auto" ? `自动匹配${autoMatchedSkeletonLabel ? ` · ${autoMatchedSkeletonLabel}` : ""}` : selectedSkeleton.label}</strong>
                            </div>
                            <span className="task-status-pill">
                              {skeletonKey === "auto" && autoMatchedSkeletonLabel ? `当前推断：${autoMatchedSkeletonLabel}` : selectedSkeleton.helperTitle}
                            </span>
                          </div>
                          <p className="helper brief-setting-helper">
                            {skeletonKey === "auto" && autoMatchedSkeletonLabel
                              ? `已根据你确认的需求自动匹配为「${autoMatchedSkeletonLabel}」。如果你的重点更偏向别的主循环，可以手动切换到更贴近的骨架。`
                              : selectedSkeleton.helperBody}
                          </p>

                          <div className="skeleton-helper-grid">
                            <section className="skeleton-preview-card">
                              <span>适合需求</span>
                              <ul>
                                {selectedSkeleton.fitFor.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            </section>

                            <section className="skeleton-preview-card">
                              <span>预期玩法</span>
                              <ol>
                                {selectedSkeleton.gameplayPreview.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ol>
                            </section>

                            <section className="skeleton-preview-card">
                              <span>界面示意</span>
                              <ul>
                                {selectedSkeleton.startScreenPreview.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                                {selectedSkeleton.hudPreview.map((item) => (
                                  <li key={`hud-${item}`}>HUD: {item}</li>
                                ))}
                              </ul>
                            </section>
                          </div>
                        </div>
                      </div>

                      <div className="brief-setting-group">
                        <span className="brief-setting-label">生成模型</span>
                        <div className="segmented" aria-label="生成模型">
                          {GENERATION_MODEL_OPTIONS.map((option) => (
                            <button
                              key={option.key}
                              className={modelKey === option.key ? "active" : ""}
                              type="button"
                              onClick={() => setModelKey(option.key)}
                              aria-pressed={modelKey === option.key}
                              disabled={isGenerating || isGenerationActive}
                              title={option.description}
                            >
                              <Sparkles size={16} aria-hidden />
                              {option.label}
                            </button>
                          ))}
                        </div>
                        <p className="helper brief-setting-helper">高质档已完成链路预留，后续可直接接付费限制。</p>
                      </div>
                    </div>

                    <button className="button primary wide" type="button" onClick={generateGame} disabled={!canGenerate || isGenerating || isGenerationActive}>
                      <WandSparkles size={18} aria-hidden />
                      {isGenerationActive ? "正在生成" : isGenerating ? "启动生成中" : "生成可玩版本"}
                    </button>
                  </div>
                </section>
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
            disabled={isStreaming || isCreatingDraft || isGenerating || isGenerationActive}
            rows={1}
          />
          <button className="icon-button send-button" type="submit" disabled={!input.trim() || isStreaming || isCreatingDraft || isGenerating || isGenerationActive} aria-label="发送">
            <Send size={21} aria-hidden />
          </button>
        </form>

        {error || streamError ? (
          <p className="error chat-error" role="alert">
            {error || streamError?.message}
          </p>
        ) : null}
      </div>

      <aside className="brief-panel task-sidebar" aria-label="生成任务">
        <TaskProgressPanel
          eyebrow="任务"
          title="新游戏创作"
          status={createTaskStatus}
          icon={<Sparkles size={16} aria-hidden />}
          meta={[
            { label: "当前", value: currentQuestion },
            { label: "可见性", value: visibility === "PUBLIC" ? "公开" : "私密" },
            { label: "美术", value: artEnhancementEnabled ? "增强" : "普通" },
            { label: "骨架", value: skeletonKey === "auto" && autoMatchedSkeletonLabel ? `自动匹配 · ${autoMatchedSkeletonLabel}` : getGameplaySkeletonLabel(skeletonKey) },
            { label: "模型", value: getGenerationModelLabel(modelKey) },
          ]}
          steps={createTaskSteps}
          result={{ label: createTaskResult, tone: createTaskResultTone }}
          progressStarted={hasStartedGeneration}
          idleProgressLabel="发布生成任务后开始"
          hideProgressMeter={hasLiveJobWatcher}
        >
          {hasLiveJobWatcher ? (
            <Suspense fallback={null}>
              <JobWatcher
                initialJobId={activeJobId}
                initialProgress={activeJobInitialProgress}
                completionHref={`/games/${gameId}/edit`}
                failureHref={`/games/${gameId}/edit`}
                title="运行状态"
                variant="inline"
              />
            </Suspense>
          ) : isGenerating ? (
            <p className="helper">正在启动真实生成链路，稍后会显示进度和运行日志。</p>
          ) : null}
        </TaskProgressPanel>
      </aside>
    </section>
  );
}
