"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// The app scrolls inside its own content area, so the browser's scroll restoration does not apply:
// without this, opening a screen from the middle of a long list lands the user in the middle of the next one.
export default function ScrollToTop() {
  const pathname = usePathname();
  useEffect(() => {
    document.getElementById("app-scroll")?.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}
