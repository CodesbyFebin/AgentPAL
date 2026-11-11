import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ModeBanner } from "@/components/ModeBanner";

const inter = Inter({
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
    <html lang="en" className={inter.variable} data-appearance="light" data-theme="default">
      <body className="font-sans antialiased">
        <ModeBanner />
        {children}
      </body>
    </html>
  );
}
