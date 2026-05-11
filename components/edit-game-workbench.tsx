"use client";

import { Suspense, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FileText,
  Gamepad2,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { JobWatcher } from "@/components/job-watcher";

type EditableGame = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  playUrl: string | null;
  version: number;
  updatedAt: string;
  controls: string[];
  genre: string | null;
  tags: string[];
  latestJob?: {
    id: string;
    status: string;
    errorMsg?: string | null;
  } | null;
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

function compactDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "最近更新";
  return date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function splitChangeItems(text: string) {
  return text
    .split(/[，,。；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
}

const quickEdits = ["失败提示更明显", "降低第二关难度", "增强操作反馈", "让画面更明亮", "增加新关卡目标"];
const failedQuickEdits = ["先做单屏版本", "降低机制复杂度", "保留键盘移动", "减少敌人数量", "强化开始反馈"];

function isActiveJobStatus(status?: string | null) {
  return Boolean(status && ["queued", "running", "validating", "repairing", "finishing"].includes(status));
}

export function EditGameWorkbench({ game }: { game: EditableGame }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(() => (isActiveJobStatus(game.latestJob?.status) ? game.latestJob?.id ?? null : null));
  const [isPending, startTransition] = useTransition();
  const isFailed = game.status === "failed";
  const hasPlayableVersion = Boolean(game.playUrl);
  const canSubmit = hasPlayableVersion || isFailed;
  const isGenerationActive = Boolean(activeJobId);
  const suggestedEdits = isFailed ? failedQuickEdits : quickEdits;
  const activeJobInitialProgress =
    game.latestJob && activeJobId === game.latestJob.id ? { status: game.latestJob.status, errorMsg: game.latestJob.errorMsg } : null;

  useEffect(() => {
    if (!activeJobId || game.latestJob?.id !== activeJobId) return;
    if (!isActiveJobStatus(game.latestJob.status)) setActiveJobId(null);
  }, [activeJobId, game.latestJob?.id, game.latestJob?.status]);

  const changeItems = useMemo(() => splitChangeItems(prompt), [prompt]);
  const preserveItems = useMemo(
    () =>
      isFailed
        ? [
            game.genre ? `${game.genre}方向` : "原始玩法意图",
            game.controls[0] ? `${game.controls[0]}操作设定` : "已确认的操作设定",
            "重新生成后必须通过自动试玩",
          ]
        : [
            game.genre ? `${game.genre}核心玩法` : "核心玩法",
            game.controls[0] ? `${game.controls[0]}操作` : "当前操作方式",
            `当前版本 v${game.version} 仍保留可玩`,
          ],
    [game.controls, game.genre, game.version, isFailed],
  );
  const unknownItems = useMemo(() => {
    if (!prompt.trim()) return isFailed ? ["失败后希望怎么调整", "是否降低实现复杂度"] : ["要改哪里", "希望改到什么程度"];
    if (!/(视觉|画面|风格|颜色|像素|霓虹|明亮|暗)/i.test(prompt)) return ["视觉风格是否保持不变"];
    return [];
  }, [isFailed, prompt]);

  const editBrief = useMemo(() => {
    const changes = changeItems.length ? changeItems.join("；") : isFailed ? "根据失败原因降低复杂度并重新生成可玩版本" : "根据用户补充的试玩问题进行局部调整";
    const unknown = unknownItems.length ? `待确认但默认保守处理：${unknownItems.join("、")}。` : "";
    const failureReason = game.latestJob?.errorMsg ? `上次失败原因：${game.latestJob.errorMsg}` : "";
    return (isFailed
      ? [
          `修复失败作品《${game.title}》。`,
          failureReason,
          `保留：${preserveItems.join("、")}。`,
          `重新生成方向：${changes}。`,
          unknown,
          "可以简化机制来保证可玩，但不要偏离原始游戏意图；新版本必须通过自动试玩验证后再发布。",
        ]
      : [
          `修改现有游戏《${game.title}》。`,
          `保留：${preserveItems.join("、")}。`,
          `变更：${changes}。`,
          unknown,
          "不要重做成新游戏；旧版本需要继续可玩，新版本通过自动试玩验证后再发布。",
        ])
      .filter(Boolean)
      .join("\n");
  }, [changeItems, game.latestJob?.errorMsg, game.title, isFailed, preserveItems, unknownItems]);

  function appendQuickEdit(value: string) {
    setPrompt((current) => {
      const text = current.trim();
      if (!text) return value;
      if (text.includes(value)) return text;
      return `${text}，${value}`;
    });
  }

  function submitEdit() {
    if (prompt.trim().length < 4 || isPending || isGenerationActive || !canSubmit) return;
    setError("");
    startTransition(async () => {
      const response = await fetch(`/api/games/${game.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: editBrief }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(errorMessage(payload, "继续修改失败。"));
        return;
      }
      if (typeof payload.jobId === "string") {
        setActiveJobId(payload.jobId);
        router.refresh();
      }
    });
  }

  return (
    <section className="edit-workbench" aria-label="修改游戏工作台">
      <header className="edit-topbar">
        <Link href="/?tab=mine" className="button secondary edit-back">
          <ArrowLeft size={17} aria-hidden />
          返回我的
        </Link>
        <div className="edit-title">
          <p className="eyebrow">{isFailed ? "正在修复失败作品" : "正在修改当前版本"}</p>
          <h1>{game.title}</h1>
        </div>
        <div className="edit-status-pill">
          {isFailed ? <AlertTriangle size={16} aria-hidden /> : isGenerationActive ? <WandSparkles size={16} aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
          {isFailed ? "等待重新生成" : isGenerationActive ? "新版本生成中" : "旧版本仍保留"}
        </div>
      </header>

      <div className="edit-layout">
        <main className="edit-playtest" aria-label={isFailed ? "失败原因" : "当前版本试玩"}>
          <div className="edit-stage-head">
            <div>
              <p className="eyebrow">{isFailed ? "Recovery" : "Playtest"}</p>
              <h2>{isFailed ? "先看失败，再修复" : "先试玩，再调整"}</h2>
            </div>
            <span className="edit-version">v{game.version}</span>
          </div>
          <div className="edit-game-frame-wrap">
            {game.playUrl ? (
              <iframe
                title={`${game.title} 当前版本`}
                src={game.playUrl}
                sandbox="allow-scripts allow-same-origin allow-pointer-lock"
                allow="autoplay; fullscreen; gamepad"
                className="game-frame edit-game-frame"
              />
            ) : (
              <div className="empty-frame edit-empty-frame">
                <div>
                  <AlertTriangle size={28} aria-hidden />
                  <h2>{isFailed ? "上次生成失败" : "当前版本暂不可试玩"}</h2>
                  <p className="helper">
                    {isFailed
                      ? game.latestJob?.errorMsg ?? "最近一次生成没有产出可试玩版本。请在右侧调整方向后重新生成。"
                      : "需要等游戏生成完成后，才能进入修改工作台。"}
                  </p>
                </div>
              </div>
            )}
          </div>
          {isFailed && game.latestJob && !activeJobId ? (
            <Suspense fallback={null}>
              <JobWatcher
                initialJobId={game.latestJob.id}
                initialProgress={{ status: game.latestJob.status, errorMsg: game.latestJob.errorMsg }}
                title="最近一次生成日志"
                variant="inline"
              />
            </Suspense>
          ) : null}
          <div className="edit-version-row" aria-label="版本信息">
            <span>
              <Gamepad2 size={15} aria-hidden />
              当前版本 v{game.version}
            </span>
            <span>
              {isFailed ? <AlertTriangle size={15} aria-hidden /> : <CheckCircle2 size={15} aria-hidden />}
              {isFailed ? "待修复" : "可试玩"}
            </span>
            <span>
              <Clock3 size={15} aria-hidden />
              {compactDate(game.updatedAt)}
            </span>
          </div>
        </main>

        <aside className="edit-plan-panel" aria-label="修改计划">
          <div className="edit-plan-card">
            <div className="mini-heading">
              <Sparkles size={16} aria-hidden />
              修改计划
            </div>
            <h2>先定边界，再生成</h2>

            <div className="plan-section preserve">
              <h3>
                <ShieldCheck size={16} aria-hidden />
                保留项
              </h3>
              <div className="plan-chip-row">
                {preserveItems.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </div>

            <div className="plan-section changes">
              <h3>
                <FileText size={16} aria-hidden />
                变更项
              </h3>
              {changeItems.length ? (
                <ul className="plan-list">
                  {changeItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="helper">{isFailed ? "在下方写清这次要怎么避开失败，必要时降低复杂度。" : "试玩左侧游戏后，在下方写下不符合预期的地方。"}</p>
              )}
            </div>

            <div className="plan-section unknown">
              <h3>
                <CircleHelp size={16} aria-hidden />
                待确认
              </h3>
              {unknownItems.length ? (
                <div className="plan-chip-row muted">
                  {unknownItems.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              ) : (
                <p className="helper">当前修改边界已经足够清楚。</p>
              )}
            </div>
          </div>

          <div className="edit-chat-card" aria-label="修改对话">
            <div className="edit-card-title">
              <Bot size={17} aria-hidden />
              修改对话
            </div>
            <div className="edit-chat-thread">
              <article className="chat-row assistant">
                <span className="chat-avatar" aria-hidden>
                  <Bot size={18} />
                </span>
                <div className="chat-message-stack">
                  <div className="chat-bubble">
                    <p>{isFailed ? "说清这次想怎么修复。我会把失败原因和你的调整合成新的生成 brief。" : "说清你刚试玩发现的问题。我会默认保留核心玩法，只整理这次要改的部分。"}</p>
                  </div>
                </div>
              </article>
              {prompt.trim() ? (
                <article className="chat-row user">
                  <div className="chat-message-stack">
                    <div className="chat-bubble">
                      <p>{prompt.trim()}</p>
                    </div>
                  </div>
                </article>
              ) : null}
            </div>

            <div className="suggestion-grid chat-suggestions edit-suggestions" aria-label="常用修改方向">
              <span className="suggestion-label">常用修改</span>
              {suggestedEdits.map((edit) => (
                <button key={edit} type="button" onClick={() => appendQuickEdit(edit)} disabled={isPending || isGenerationActive}>
                  {edit}
                </button>
              ))}
            </div>

            <label className="sr-only" htmlFor="edit-game-input">
              描述要修改的内容
            </label>
            <div className="chat-composer edit-composer">
              <textarea
                id="edit-game-input"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={isFailed ? "比如：先做成单屏版本，减少敌人数量，保证键盘能移动和得分。" : "比如：失败后看不清原因，第二关也太难，希望降低一点。"}
                disabled={isPending || isGenerationActive || !canSubmit}
                rows={3}
              />
              <button
                className="icon-button send-button"
                type="button"
                onClick={submitEdit}
                disabled={isPending || isGenerationActive || !canSubmit || prompt.trim().length < 4}
                aria-label={isFailed ? "重新生成" : "生成新版本"}
              >
                <Send size={20} aria-hidden />
              </button>
            </div>
          </div>

          <div className="edit-brief-card" aria-label="修改 Brief">
            <span className="brief-card-label">
              <FileText size={15} aria-hidden />
              {isFailed ? "修复 Brief" : "修改 Brief"}
            </span>
            <p>{editBrief}</p>
            <button className="button primary wide" type="button" onClick={submitEdit} disabled={isPending || isGenerationActive || !canSubmit || prompt.trim().length < 4}>
              {isFailed ? <RotateCcw size={18} aria-hidden /> : <WandSparkles size={18} aria-hidden />}
              {isGenerationActive ? "正在生成" : isPending ? "启动生成中" : isFailed ? "重新生成可玩版本" : "生成新版本"}
            </button>
            <p className="helper">{isFailed ? "这次会复用原始意图和失败原因重新生成，通过自动试玩后再发布。" : "旧版本仍保留可玩；新版本通过自动试玩后再发布。"}</p>
            {activeJobId ? (
              <Suspense fallback={null}>
                <JobWatcher
                  initialJobId={activeJobId}
                  initialProgress={activeJobInitialProgress}
                  completionHref={`/games/${game.id}/edit`}
                  title={isFailed ? "正在重新生成" : "正在生成新版本"}
                  variant="inline"
                />
              </Suspense>
            ) : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}
