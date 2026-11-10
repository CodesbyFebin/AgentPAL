import type { Metadata } from "next";
import { Sora, Source_Sans_3 } from "next/font/google";
import "./globals.css";
import { ModeBanner } from "@/components/ModeBanner";

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
  title: "MoneyMate Mesh — Your AI. Your Money. Your Rules.",
  description:
    "MoneyMate Mesh is an AI financial agent plus a MeshPaL trust layer: deterministic affordability, signed mandates, policy checks, sandbox authorize-then-capture, and a hash-chained audit log. Not a PayPal or Braintree product.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${sourceSans.variable}`}>
      <body className="mesh-bg font-sans antialiased">
        <ModeBanner />
        {children}
      </body>
    </html>
  );
}
