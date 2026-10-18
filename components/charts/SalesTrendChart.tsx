"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export default function SalesTrendChart({ data }: { data: { date: string; sales: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#d6ded9" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#51635f" }} interval={4} />
        <YAxis tick={{ fontSize: 12, fill: "#51635f" }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v) => `₱${Number(v).toLocaleString()}`} />
        <Line type="monotone" dataKey="sales" stroke="#1d4f7c" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
