const skeletonCards = Array.from({ length: 8 }, (_, index) => index);

export default function Loading() {
  return (
    <div className="page arcade-page" aria-hidden>
      <section className="feed-section">
        <div className="section-head loading-head">
          <div>
            <span className="skeleton-line title" />
            <span className="skeleton-line copy" />
          </div>
          <span className="skeleton-line action" />
        </div>
        <div className="feed-grid">
          {skeletonCards.map((card) => (
            <div className="game-card loading-card" key={card}>
              <div className="card-media skeleton-block" />
              <div className="card-body">
                <span className="skeleton-line title" />
                <span className="skeleton-line copy" />
                <span className="skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
