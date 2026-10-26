// Shown the moment a link is pressed, while the next screen is read from the database, so the app answers at once
// instead of looking frozen. The navigation and header stay on screen; only the content area is replaced.
export default function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-5" role="status" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-5 w-56 rounded-full bg-slate-200" />
        <div className="h-3 w-80 max-w-full rounded-full bg-slate-200/70" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-3 p-5">
            <div className="h-3 w-24 rounded-full bg-slate-200/70" />
            <div className="h-7 w-32 rounded-full bg-slate-200" />
          </div>
        ))}
      </div>
      <div className="card space-y-3 p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-4 rounded-full bg-slate-100" style={{ width: `${95 - i * 8}%` }} />
        ))}
      </div>
    </div>
  );
}
