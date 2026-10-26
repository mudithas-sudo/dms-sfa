import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

// Figtree is a friendly geometric sans with a clear peso sign, which suits a calm delivery-tracking interface.
// One typeface everywhere: text, tables, navigation, titles and headline numbers.
const figtree = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Company F and B — DMS & SFA",
  description: "Distributor Management System and Sales Force Automation prototype",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
