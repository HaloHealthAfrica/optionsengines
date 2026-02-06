'use client';

export default function GlobalError({ error, reset }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
      <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900/70 p-6 text-center">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-300">{error?.message || 'Unexpected error.'}</p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
