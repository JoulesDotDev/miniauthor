export function SplashScreen() {
  return (
    <div className="splash-screen" role="status" aria-live="polite" aria-label="Loading Mini Author">
      <div className="splash-brand">
        <img className="splash-icon" src="/mini-author-icon.svg" alt="" aria-hidden="true" />
        <div className="splash-wordmark" aria-hidden="true">
          <span className="splash-wordmark-main">Mini Author</span>
          <span className="splash-wordmark-app">.app</span>
        </div>
      </div>
    </div>
  );
}
