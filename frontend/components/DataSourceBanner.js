export default function DataSourceBanner({ source }) {
  const normalized = String(source || '').toLowerCase();

  if (normalized === 'backend' || !normalized) {
    return null;
  }

  const message =
    normalized === 'mock'
      ? 'Showing mock data because the backend is unavailable.'
      : 'Data source unavailable. Showing last known data.';

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
      {message}
    </div>
  );
}
