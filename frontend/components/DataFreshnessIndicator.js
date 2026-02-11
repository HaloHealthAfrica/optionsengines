import { useEffect, useState } from 'react';

function formatAge(ms) {
  if (ms < 1000) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hours ago`;
}

export default function DataFreshnessIndicator({ lastUpdated, staleAfterMs = 5 * 60 * 1000 }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  if (!lastUpdated) return null;

  const updatedAt = typeof lastUpdated === 'number' ? lastUpdated : new Date(lastUpdated).getTime();
  const ageMs = Math.max(0, now - updatedAt);
  const stale = ageMs > staleAfterMs;

  return (
    <div className="flex flex-col gap-2">
      <p className="muted text-xs">Last updated: {formatAge(ageMs)}</p>
      {stale && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          Data appears stale (older than 5 minutes).
        </div>
      )}
    </div>
  );
}
