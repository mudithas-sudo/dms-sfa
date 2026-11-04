"use client";

import { useRouter } from "next/navigation";

// A select whose choice reloads the screen for that option (e.g. the customer being checked in), so everything
// that depends on it — the customer's position, balances — follows the choice instead of staying on the first option.
export default function NavSelect({
  id,
  name,
  value,
  options,
  hrefFor,
}: {
  id: string;
  name: string;
  value?: string;
  options: { value: string; label: string }[];
  hrefFor: string; // URL with "{value}" where the chosen option goes
}) {
  const router = useRouter();
  return (
    <select className="input" id={id} name={name} defaultValue={value} onChange={(e) => router.push(hrefFor.replace("{value}", encodeURIComponent(e.target.value)))}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
