import type { Metadata } from "next";
import { Lexend, Source_Sans_3 } from "next/font/google";
import "./globals.css";

// Typography via ui-ux-pro-max skill ("Corporate Trust" pairing): Lexend for
// headings (built for reading-fluency research) + Source Sans 3 for body —
// matched to enterprise/accessibility-focused products.
const lexend = Lexend({
  variable: "--font-heading",
  subsets: ["latin"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Company F and B — DMS & SFA",
  description: "Distributor Management System and Sales Force Automation prototype",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${lexend.variable} ${sourceSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
