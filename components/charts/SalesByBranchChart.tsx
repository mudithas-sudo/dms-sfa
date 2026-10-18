"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function SalesByBranchChart({ data }: { data: { name: string; sales: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#d6ded9" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#51635f" }} />
        <YAxis tick={{ fontSize: 12, fill: "#51635f" }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v) => `₱${Number(v).toLocaleString()}`} />
        <Bar dataKey="sales" fill="#0f2a40" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
