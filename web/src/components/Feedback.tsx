import type { ReactNode } from 'react';

export function ErrorMessage({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="notice" data-tone="error" role="alert">
      <p>
        <strong>Something went wrong.</strong> {message}
      </p>
      <div className="actions">
        {onRetry && (
          <button type="button" className="btn secondary small" onClick={onRetry}>
            Try again
          </button>
        )}
        {onDismiss && (
          <button type="button" className="btn ghost small" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

/** Shown across the page while the MCP server cannot be reached. */
export function StatusBanner({
  message,
  onRetry,
  onUseDemo,
}: {
  message: string;
  onRetry(): void;
  onUseDemo(): void;
}) {
  return (
    <div className="banner" role="alert">
      <p>
        <strong>Not connected.</strong> {message}
      </p>
      <div className="actions">
        <button type="button" className="btn primary small" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="btn ghost small" onClick={onUseDemo}>
          Use demo data instead
        </button>
      </div>
    </div>
  );
}

export function Skeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="skeletons" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-card">
          <span className="skeleton-line wide" />
          <span className="skeleton-line" />
          <span className="skeleton-line short" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ring" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
