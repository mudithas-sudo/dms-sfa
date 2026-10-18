import type { Metadata } from "next";
import { Barlow } from "next/font/google";
import "./globals.css";

// Barlow comes from road and freight signage, which suits a system about trucks, cartons and delivery receipts.
// One typeface everywhere: the same Barlow the navigation uses, for text, tables, titles and headline numbers.
const barlow = Barlow({
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
    <html lang="en" className={`${barlow.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
