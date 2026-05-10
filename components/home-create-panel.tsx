"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, WandSparkles } from "lucide-react";

const quickIdeas = [
  "竖屏躲避游戏，点击切换轨道，60 秒生存",
  "像素风首领连战，WASD 移动，鼠标射击",
  "轻量合成游戏，把两种元素拖到一起升级",
];

export function HomeCreatePanel() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");

  function startCreate(nextPrompt = prompt) {
    const value = nextPrompt.trim();
    if (!value) {
      router.push("/create");
      return;
    }
    router.push(`/create?prompt=${encodeURIComponent(value)}`);
  }

  return (
    <section className="home-create-panel" aria-labelledby="home-create-title">
      <div className="home-create-head">
        <Sparkles size={20} aria-hidden />
        <div>
          <p className="eyebrow">快速创建</p>
          <h2 id="home-create-title">把一个想法变成可玩的小游戏</h2>
          <p>先选一个方向，或者直接写你想玩的规则。</p>
        </div>
      </div>
      <label className="sr-only" htmlFor="home-prompt">
        游戏创作想法
      </label>
      <textarea
        id="home-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") startCreate();
        }}
        placeholder="比如：单屏弹幕首领战，WASD 移动，90 秒内击败首领。"
      />
      <div className="quick-prompts" aria-label="快速创作示例">
        {quickIdeas.map((idea) => (
          <button key={idea} type="button" onClick={() => startCreate(idea)}>
            {idea}
          </button>
        ))}
      </div>
      <button className="button primary wide" type="button" onClick={() => startCreate()}>
        <WandSparkles size={18} aria-hidden />
        开始创作
      </button>
    </section>
  );
}
