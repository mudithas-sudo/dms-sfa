"use client";

import { useState } from "react";
import { nowIso } from "@/lib/offline-queue";

// Sends the device clock with the action so the server can flag a device whose time is off.
export default function DeviceClock() {
  const [t] = useState(() => nowIso());
  return <input type="hidden" name="deviceTime" value={t} suppressHydrationWarning />;
}
