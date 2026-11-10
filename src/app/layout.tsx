import type { Metadata } from "next";
import { Sora, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MeshPaL — Trust layer between AI agents and PayPal",
  description:
    "MeshPaL lets people delegate purchases to AI agents under a signed mandate, with policy checks, PayPal authorize-then-capture, outcome verification, and a signed receipt. A payment is not the outcome; a verified outcome is.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${sourceSans.variable}`}>
      <body className="mesh-bg font-sans antialiased">{children}</body>
    </html>
  );
}
