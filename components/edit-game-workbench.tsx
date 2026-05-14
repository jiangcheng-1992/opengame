"use client";

import { Suspense, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  Gamepad2,
  Globe2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { JobWatcher } from "@/components/job-watcher";
import { ResponsiveGameFrame } from "@/components/responsive-game-frame";
import { TaskProgressPanel, type TaskStep } from "@/components/task-progress-panel";

type EditableGame = {
  id: string;
  title: string;
  summary: string | null;
  status: string;
  visibility: string;
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
  const normalizedStatus = status?.toLowerCase();
  return Boolean(normalizedStatus && ["queued", "running", "validating", "repairing", "finishing"].includes(normalizedStatus));
}

function normalizeJobStatus(status?: string | null) {
  return status?.toLowerCase() ?? null;
}

function compactText(value: string, maxLength = 34) {
  const text = value.trim();
  if (!text) return "";
  const chars = Array.from(text);
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}...` : text;
}

function normalizeVisibility(value: string): "PUBLIC" | "PRIVATE" {
  return value.toUpperCase() === "PRIVATE" ? "PRIVATE" : "PUBLIC";
}

function buildEditTaskSteps(isSubmitting: boolean, jobStatus: string | null): TaskStep[] {
  const hasJob = Boolean(jobStatus);
  const isFailed = jobStatus === "failed";
  const isDone = jobStatus === "done";
  const isInValidation = jobStatus === "validating" || jobStatus === "repairing";
  const isPublishing = jobStatus === "finishing";
  const hasGenerated = isInValidation || isPublishing || isDone;

  return [
    { label: "提交修改", state: hasJob ? "done" : isSubmitting ? "active" : "pending" },
    { label: "生成新版本", state: isFailed ? "failed" : hasGenerated ? "done" : hasJob ? "active" : "pending" },
    { label: "自动试玩", state: isFailed ? "failed" : isDone || isPublishing ? "done" : isInValidation ? "active" : "pending" },
    { label: "发布结果", state: isFailed ? "failed" : isDone ? "done" : isPublishing ? "active" : "pending" },
  ];
}

function editTaskStatusLabel(isSubmitting: boolean, jobStatus: string | null) {
  if (jobStatus === "failed") return "失败";
  if (jobStatus === "done") return "已完成";
  if (jobStatus) return "生成中";
  if (isSubmitting) return "启动中";
  return "准备中";
}

function editTaskResultLabel(isSubmitting: boolean, jobStatus: string | null, errorMsg?: string | null) {
  if (jobStatus === "failed") return errorMsg ?? "生成失败，展开运行日志查看原因。";
  if (jobStatus === "done") return "新版本已生成，可继续试玩。";
  if (jobStatus) return "旧版本仍可玩，新版本通过自动试玩后再发布。";
  if (isSubmitting) return "正在提交修改意图。";
  return "等待明确修改意图。";
}

export function EditGameWorkbench({ game }: { game: EditableGame }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">(() => normalizeVisibility(game.visibility));
  const [visibilityError, setVisibilityError] = useState("");
  const [isVisibilitySaving, setIsVisibilitySaving] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(() => (isActiveJobStatus(game.latestJob?.status) ? game.latestJob?.id ?? null : null));
  const [isPending, startTransition] = useTransition();
  const isFailed = game.status === "failed";
  const hasPlayableVersion = Boolean(game.playUrl);
  const canSubmit = hasPlayableVersion || isFailed;
  const isGenerationActive = Boolean(activeJobId);
  const suggestedEdits = isFailed ? failedQuickEdits : quickEdits;
  const editJobStatus = activeJobId && game.latestJob?.id === activeJobId ? normalizeJobStatus(game.latestJob.status) : activeJobId ? "queued" : null;
  const activeJobInitialProgress = activeJobId
    ? {
        status: editJobStatus ?? "queued",
        errorMsg: game.latestJob?.id === activeJobId ? game.latestJob.errorMsg : null,
      }
    : null;
  const showEditTask = isPending || isGenerationActive;
  const editTaskSteps = useMemo(() => buildEditTaskSteps(isPending, editJobStatus), [editJobStatus, isPending]);
  const editTaskStatus = editTaskStatusLabel(isPending, editJobStatus);
  const editTaskResult = editTaskResultLabel(isPending, editJobStatus, activeJobInitialProgress?.errorMsg);
  const editTaskResultTone = editJobStatus === "failed" ? "danger" : editJobStatus === "done" ? "success" : "muted";
  const compactPrompt = compactText(prompt) || (isFailed ? "修复失败版本" : "调整当前版本");
  const latestFailedJob = !activeJobId && game.latestJob && normalizeJobStatus(game.latestJob.status) === "failed" ? game.latestJob : null;
  const visibilityHint = visibility === "PUBLIC" ? "会出现在广场" : "仅自己可见";

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

  async function updateVisibility(nextVisibility: "PUBLIC" | "PRIVATE") {
    if (nextVisibility === visibility || isVisibilitySaving) return;
    const previousVisibility = visibility;
    setVisibility(nextVisibility);
    setVisibilityError("");
    setIsVisibilitySaving(true);

    try {
      const response = await fetch(`/api/games/${game.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(errorMessage(payload, "公开状态保存失败。"));
      }
      if (payload?.game?.visibility) {
        setVisibility(normalizeVisibility(String(payload.game.visibility)));
      }
      router.refresh();
    } catch (nextError) {
      setVisibility(previousVisibility);
      setVisibilityError(nextError instanceof Error ? nextError.message : "公开状态保存失败。");
    } finally {
      setIsVisibilitySaving(false);
    }
  }

  const publishSetting = (
    <section className="edit-publish-setting" aria-label="发布设置">
      <div className="edit-publish-copy">
        <span className="edit-publish-label">
          {visibility === "PUBLIC" ? <Globe2 size={15} aria-hidden /> : <LockKeyhole size={15} aria-hidden />}
          发布设置
        </span>
        <p>{isVisibilitySaving ? "正在保存公开状态" : visibilityHint}</p>
      </div>
      <div className="edit-visibility-toggle" aria-label="作品可见性">
        <button type="button" className={visibility === "PUBLIC" ? "active" : ""} onClick={() => updateVisibility("PUBLIC")} disabled={isVisibilitySaving} aria-pressed={visibility === "PUBLIC"}>
          公开
        </button>
        <button type="button" className={visibility === "PRIVATE" ? "active" : ""} onClick={() => updateVisibility("PRIVATE")} disabled={isVisibilitySaving} aria-pressed={visibility === "PRIVATE"}>
          私密
        </button>
      </div>
      {visibilityError ? (
        <p className="edit-visibility-error" role="alert">
          {visibilityError}
        </p>
      ) : null}
    </section>
  );

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
        <div className="edit-topbar-actions">
          <div className="edit-status-pill">
            {isFailed ? <AlertTriangle size={16} aria-hidden /> : isGenerationActive ? <WandSparkles size={16} aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
            {isFailed ? "等待重新生成" : isGenerationActive ? "新版本生成中" : "旧版本仍保留"}
          </div>
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
          {game.playUrl ? (
            <ResponsiveGameFrame
              title={`${game.title} 当前版本`}
              src={game.playUrl}
              shellClassName="edit-game-frame-wrap responsive-game-shell"
              iframeClassName="responsive-game-iframe edit-game-frame"
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

        <aside className="edit-plan-panel" aria-label={showEditTask ? "生成任务" : "修改意图"}>
          {showEditTask ? (
            <TaskProgressPanel
              eyebrow="任务"
              title={isFailed ? "修复当前游戏" : "修改当前游戏"}
              status={editTaskStatus}
              icon={<Sparkles size={16} aria-hidden />}
              meta={[
                { label: "作品", value: game.title },
                { label: "版本", value: `v${game.version}` },
                { label: "本次修改", value: compactPrompt },
              ]}
              steps={editTaskSteps}
              result={{ label: editTaskResult, tone: editTaskResultTone }}
            >
              {activeJobId ? (
                <Suspense fallback={null}>
                  <JobWatcher
                    initialJobId={activeJobId}
                    initialProgress={activeJobInitialProgress}
                    completionHref={`/games/${game.id}/edit`}
                    title="运行状态"
                    variant="inline"
                  />
                </Suspense>
              ) : (
                <p className="helper">正在启动真实生成链路，稍后会显示进度和运行日志。</p>
              )}
              {publishSetting}
              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}
            </TaskProgressPanel>
          ) : (
            <section className="edit-intent-card" aria-label="修改意图">
              <div className="mini-heading">
                <Sparkles size={16} aria-hidden />
                修改意图
              </div>
              <h2>{isFailed ? "重新生成前先说清修复方向" : "想改哪里？"}</h2>

              <div className="edit-intent-dialog">
                <span className="chat-avatar" aria-hidden>
                  <Bot size={18} />
                </span>
                <p>{isFailed ? "写清这次要怎么避开失败；我会把失败原因一起带进生成。" : "写清刚试玩发现的问题；默认保留当前核心玩法，只改你说的部分。"}</p>
              </div>

              {prompt.trim() ? (
                <div className="edit-intent-summary">
                  <span>本次修改</span>
                  <p>{prompt.trim()}</p>
                </div>
              ) : null}

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
              </div>

              <button className="button primary wide" type="button" onClick={submitEdit} disabled={isPending || isGenerationActive || !canSubmit || prompt.trim().length < 4}>
                <WandSparkles size={18} aria-hidden />
                {isPending ? "启动生成中" : isFailed ? "重新生成可玩版本" : "生成新版本"}
              </button>

              {publishSetting}

              {latestFailedJob ? (
                <Suspense fallback={null}>
                  <JobWatcher
                    initialJobId={latestFailedJob.id}
                    initialProgress={{ status: latestFailedJob.status, errorMsg: latestFailedJob.errorMsg }}
                    title="最近一次运行状态"
                    variant="inline"
                  />
                </Suspense>
              ) : null}

              {error ? (
                <p className="error" role="alert">
                  {error}
                </p>
              ) : null}
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
