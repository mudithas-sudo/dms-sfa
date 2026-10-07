"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-reads the dashboard on the configured interval; the server stamps each refresh time.
export default function AutoRefresh({ minutes }: { minutes: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!minutes || minutes <= 0) return;
    const t = setInterval(() => router.refresh(), minutes * 60000);
    return () => clearInterval(t);
  }, [minutes, router]);
  return null;
}
