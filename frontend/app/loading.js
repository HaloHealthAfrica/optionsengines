export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
      <div className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-3">
        <span className="h-3 w-3 animate-ping rounded-full bg-cyan-400" />
        <span className="text-sm">Loading OptionAgents…</span>
      </div>
    </div>
  );
}
