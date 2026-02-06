export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900/70 p-6 text-center">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-300">The page you requested does not exist.</p>
        <a
          href="/"
          className="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
        >
          Return home
        </a>
      </div>
    </div>
  );
}
