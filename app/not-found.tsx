import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page">
      <section className="panel">
        <h1>找不到这个游戏</h1>
        <p className="helper">它可能不存在，或是当前匿名身份没有访问权限。</p>
        <Link href="/" className="button primary">
          返回作品广场
        </Link>
      </section>
    </div>
  );
}
