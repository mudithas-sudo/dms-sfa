// Shows the result of the last action (set through ?error= / ?notice= by the server actions).
export default function Banner({ error, notice }: { error?: string; notice?: string }) {
  if (!error && !notice) return null;
  return (
    <div
      role={error ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm ${
        error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {error ?? notice}
    </div>
  );
}
