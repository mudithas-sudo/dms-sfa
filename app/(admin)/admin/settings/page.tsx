import Banner from "@/components/Banner";
import { saveSettings } from "@/app/actions/platform-actions";
import { SETTING_DEFS, getAllSettings } from "@/lib/settings";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const values = await getAllSettings();
  const groups = [...new Set(SETTING_DEFS.map((d) => d.group))];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Platform Configuration</h2>
        <p className="mt-1 text-sm text-slate-500">
          Thresholds, approval limits, validation severities and policies are maintained by administrators — a change applies immediately and is recorded in the
          audit log, with no software release.
        </p>
      </div>
      <Banner error={error} notice={notice} />
      <form action={saveSettings} className="space-y-6">
        {groups.map((g) => (
          <div key={g} className="card p-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">{g}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              {SETTING_DEFS.filter((d) => d.group === g).map((d) => (
                <div key={d.key}>
                  <label className="label" htmlFor={d.key}>{d.label}</label>
                  {d.type === "select" ? (
                    <select className="input" id={d.key} name={d.key} defaultValue={values[d.key]}>
                      {d.options!.map((o) => (
                        <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="input" id={d.key} name={d.key} type={d.type === "number" ? "number" : "text"} step="any" defaultValue={values[d.key]} />
                  )}
                  {d.help && <p className="mt-1 text-xs text-slate-500">{d.help}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
        <button className="btn-primary" type="submit">Save configuration</button>
      </form>
    </div>
  );
}
