export const DEFAULT_GAMEPLAY_SKELETON_KEY = "auto";
export const GAMEPLAY_SKELETON_KEYS = ["auto", "breakout", "runner", "shooter", "defense", "puzzle", "collector"] as const;

export type GameplaySkeletonKey = (typeof GAMEPLAY_SKELETON_KEYS)[number];

export type GameplaySkeletonOption = {
  key: GameplaySkeletonKey;
  label: string;
  description: string;
  helperTitle: string;
  helperBody: string;
  fitFor: string[];
  gameplayPreview: string[];
  hudPreview: string[];
  startScreenPreview: string[];
};

type ConcreteGameplaySkeletonKey = Exclude<GameplaySkeletonKey, "auto">;

export const GAMEPLAY_SKELETON_OPTIONS: GameplaySkeletonOption[] = [
  {
    key: "auto",
    label: "自动匹配",
    description: "根据你的需求自动选择最合适的玩法骨架。",
    helperTitle: "让系统先帮你收敛最稳的玩法结构",
    helperBody: "适合你还在探索题材或机制时使用。系统会根据 brief 自动匹配最接近的单屏骨架，优先保证首屏、HUD 和主循环完整。",
    fitFor: ["需求还比较开放", "想先看系统推荐结构", "希望优先保留生成自由度"],
    gameplayPreview: ["先解析题材与核心动作", "自动收敛到最稳的单屏玩法", "按骨架生成首屏、HUD 和结果态"],
    hudPreview: ["自动挑选 2-3 个状态模块", "例如得分 / 时间 / 生命", "优先保持信息清晰不拥挤"],
    startScreenPreview: ["标题 + 一句话玩法钩子", "主 CTA 与轻量操作提示", "贴合题材的背景与氛围层"],
  },
  {
    key: "breakout",
    label: "打砖块",
    description: "适合单屏反弹、砖块、挡板和街机连击类玩法。",
    helperTitle: "单屏街机最稳，适合高完成度爽感作品",
    helperBody: "适合做霓虹砖块、弹球清场、连击反弹这类高反馈玩法。优点是节奏快、成功率高、首屏和 HUD 很容易做出精品感。",
    fitFor: ["反弹球 / 砖块 / 挡板", "爽感连击与爆破反馈", "单屏可快速开玩的街机题材"],
    gameplayPreview: ["移动挡板接球", "击碎目标并累计连击", "用生命或回合控制失败条件"],
    hudPreview: ["得分", "生命", "连击或剩余砖块"],
    startScreenPreview: ["中央标题与开局 CTA", "一句话说明反弹核心玩法", "上方预置霓虹 HUD 风格"],
  },
  {
    key: "runner",
    label: "跑酷",
    description: "适合车道切换、冲刺躲避、节奏推进类玩法。",
    helperTitle: "适合做有节奏推进感的轻动作体验",
    helperBody: "如果你想做冲刺、切道、追逐、躲障碍这类玩法，这个骨架最容易稳定产出。整体会更强调动势、速度和结算成绩感。",
    fitFor: ["冲刺 / 躲避 / 追逐", "车道切换或持续前进", "想突出速度感和距离结算"],
    gameplayPreview: ["持续向前推进", "躲开障碍并吃到奖励", "随着时间提升速度或密度"],
    hudPreview: ["距离", "速度", "失误或生命"],
    startScreenPreview: ["主视觉突出冲刺方向", "CTA 附带操作提示", "底部展示目标分数或生存目标"],
  },
  {
    key: "shooter",
    label: "射击",
    description: "适合飞船、弹幕、波次战斗和清怪玩法。",
    helperTitle: "适合做节奏清晰的波次战斗和强反馈命中感",
    helperBody: "适合飞船、俯视角、弹幕清怪、Boss mini battle 等题材。骨架会优先控制战场复杂度，避免花但乱。",
    fitFor: ["飞船 / 弹幕 / 清怪", "波次推进", "强调命中反馈和危险躲避"],
    gameplayPreview: ["移动并持续射击", "躲避敌方弹道", "按波次或小 Boss 推进节奏"],
    hudPreview: ["生命", "波次", "得分或武器冷却"],
    startScreenPreview: ["英雄标题与战斗氛围背景", "开局 CTA + 操作说明", "预告波次推进或目标敌人"],
  },
  {
    key: "defense",
    label: "防守",
    description: "适合守塔、资源管理、波次防御和布置类玩法。",
    helperTitle: "适合做更有策略感但仍可控的防守循环",
    helperBody: "当你想要资源、布置、防线、波次压力这些元素时，用这个骨架最稳。它会把地图和系统数量控制在 MVP 范围内。",
    fitFor: ["守塔 / 波次防守", "资源管理", "布置与升级决策"],
    gameplayPreview: ["开局布置防线或触发器", "波次来袭时观察防守效果", "在波次间做补强和调整"],
    hudPreview: ["基地生命", "资源", "波次"],
    startScreenPreview: ["局势说明与目标提示", "开始按钮旁展示防守目标", "顶部或侧边预留商店/HUD 区域"],
  },
  {
    key: "puzzle",
    label: "解谜",
    description: "适合消除、连线、记忆、机关和单屏解谜循环。",
    helperTitle: "适合做规则清晰、上手快的单屏解谜",
    helperBody: "如果重点是规则理解、步数效率、连线完成或机关破解，这个骨架最合适。它会更强调提示性和完成后的奖励反馈。",
    fitFor: ["消除 / 连线 / 推理解谜", "记忆和机关交互", "更看重规则清晰度"],
    gameplayPreview: ["先理解唯一核心规则", "执行一组清晰操作", "完成目标后触发结算反馈"],
    hudPreview: ["步数", "计时", "目标进度"],
    startScreenPreview: ["展示规则钩子与目标", "CTA 旁带一行解法预期", "界面更干净突出棋盘或关卡主体"],
  },
  {
    key: "collector",
    label: "收集闪避",
    description: "适合俯视角移动、拾取目标、躲避危险的轻动作玩法。",
    helperTitle: "适合做轻量俯视角动作和节奏收集",
    helperBody: "适合 arena、迷你地图、拾取任务、危险躲避这类设计。它兼顾动作感和目标感，比较容易做成完整回合体验。",
    fitFor: ["俯视角 arena", "收集目标与回避危险", "更轻量的动作探索感"],
    gameplayPreview: ["移动搜集目标物", "躲避巡逻或危险区域", "在时限或生命压力下完成目标"],
    hudPreview: ["收集数", "时间", "生命或失误"],
    startScreenPreview: ["中央标题与任务描述", "进入按钮 + 简短操作提示", "背景先展示地图气质和目标物"],
  },
];

export function normalizeGameplaySkeletonKey(value?: string | null): GameplaySkeletonKey {
  return GAMEPLAY_SKELETON_KEYS.includes(value as GameplaySkeletonKey)
    ? (value as GameplaySkeletonKey)
    : DEFAULT_GAMEPLAY_SKELETON_KEY;
}

function scorePattern(text: string, pattern: RegExp, score: number) {
  return pattern.test(text) ? score : 0;
}

export function inferGameplaySkeletonKey(value?: string | null): GameplaySkeletonKey {
  const text = value?.toLowerCase().trim() ?? "";
  if (!text) return "auto";

  const scores: Record<ConcreteGameplaySkeletonKey, number> = {
    breakout: 0,
    runner: 0,
    shooter: 0,
    defense: 0,
    puzzle: 0,
    collector: 0,
  };

  scores.breakout += scorePattern(text, /(brick|breakout|paddle|bounce|bouncing|pinball|挡板|砖块|反弹|弹球|接球)/i, 4);
  scores.breakout += scorePattern(text, /(ball|orb).*(paddle|挡板)|(挡板).*(球|弹球)/i, 4);

  scores.runner += scorePattern(text, /(runner|endless run|跑酷|车道|lane|冲刺|dash|追逐|持续前进|向前推进|距离)/i, 4);
  scores.runner += scorePattern(text, /(躲避障碍|避开障碍|survive the run|生存冲刺|冲线)/i, 3);
  scores.runner += scorePattern(text, /(dodge|avoid|躲避|闪避|避开)/i, 1);

  scores.shooter += scorePattern(text, /(shoot|shooter|fire|weapon|gun|bullet|projectile|laser|弹幕|射击|开火|武器|子弹|激光|清怪|boss)/i, 4);
  scores.shooter += scorePattern(text, /(enemy wave|波次战斗|空战|战机射击|飞船射击)/i, 3);

  scores.defense += scorePattern(text, /(tower defense|defense|defend|base|turret|fortress|守塔|塔防|防守|守住|基地|炮塔|布置防线)/i, 4);
  scores.defense += scorePattern(text, /(resource|upgrade|shop|build|资源管理|升级|建造|部署)/i, 2);
  scores.defense += scorePattern(text, /(wave|波次)/i, 1);

  scores.puzzle += scorePattern(text, /(puzzle|match|merge|memory|connect|sokoban|logic|解谜|连线|记忆|推箱子|消除|机关|逻辑)/i, 4);
  scores.puzzle += scorePattern(text, /(steps|moves|步数|回合|提示|解法|拼图)/i, 2);

  scores.collector += scorePattern(text, /(collect|collector|gather|pick up|pickup|salvage|harvest|拾取|收集|采集|回收|收集物|目标物)/i, 4);
  scores.collector += scorePattern(text, /(arena|top-down|bounded map|俯视角|区域内移动|arena|小地图)/i, 2);
  scores.collector += scorePattern(text, /(energy|coin|gem|key|orb|能量|金币|宝石|钥匙|能量球)/i, 2);

  if (/(collect|pickup|拾取|收集|采集|回收)/i.test(text) && /(dodge|avoid|hazard|躲避|闪避|危险|障碍)/i.test(text)) {
    scores.collector += 3;
  }

  if (/(runner|跑酷|车道|lane|冲刺|持续前进|距离)/i.test(text) && /(dodge|avoid|躲避|闪避|障碍)/i.test(text)) {
    scores.runner += 3;
  }

  if (/(shoot|fire|bullet|weapon|射击|开火|弹幕|武器)/i.test(text) && /(dodge|avoid|躲避|闪避)/i.test(text)) {
    scores.shooter += 2;
  }

  if (/(defense|守塔|塔防|防守|基地|炮塔)/i.test(text) && /(wave|波次|资源|升级|建造)/i.test(text)) {
    scores.defense += 3;
  }

  if (/(puzzle|解谜|机关|消除|连线)/i.test(text) && /(steps|moves|步数|目标|通关)/i.test(text)) {
    scores.puzzle += 2;
  }

  const ranked = (Object.entries(scores) as Array<[ConcreteGameplaySkeletonKey, number]>).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;

  if (!top || top[1] < 3) return "auto";
  if (second && top[1] - second[1] < 2) return "auto";
  return top[0];
}

export function resolveGameplaySkeletonKey(value?: string | null, brief?: string | null): GameplaySkeletonKey {
  const normalized = normalizeGameplaySkeletonKey(value);
  return normalized === "auto" ? inferGameplaySkeletonKey(brief) : normalized;
}

export function getGameplaySkeletonLabel(value?: string | null) {
  return GAMEPLAY_SKELETON_OPTIONS.find((option) => option.key === normalizeGameplaySkeletonKey(value))?.label ?? "自动匹配";
}

export function getGameplaySkeletonOption(value?: string | null) {
  return (
    GAMEPLAY_SKELETON_OPTIONS.find((option) => option.key === normalizeGameplaySkeletonKey(value)) ??
    GAMEPLAY_SKELETON_OPTIONS[0]
  );
}
