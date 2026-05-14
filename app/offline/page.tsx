import Link from "next/link";

export default function OfflinePage() {
  return (
    <div className="page arcade-page">
      <section className="panel empty-panel" aria-labelledby="offline-title">
        <p className="eyebrow">离线模式</p>
        <h1 id="offline-title">暂时连不上 OpenGame</h1>
        <p className="helper">
          已安装的 App 壳仍可打开，但广场、作品列表和游戏生成需要网络连接。恢复网络后刷新即可继续创作和试玩。
        </p>
        <Link href="/" className="button primary">
          回到广场
        </Link>
      </section>
    </div>
  );
}
