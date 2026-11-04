import type { Metadata, Viewport } from "next";
import { Fredoka, Nunito } from "next/font/google";
import { Sounds } from "@/components/client/sounds";
import "./globals.css";

const fredoka = Fredoka({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-fredoka", display: "swap" });
const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_URL || "http://localhost:3000"),
  title: { default: "Misogi · One hard thing this year", template: "%s · Misogi" },
  description:
    "Pick one hard thing to do this year. Your Muse plans it, checks in, and builds your page. Friends can climb with you.",
  openGraph: { siteName: "Misogi", type: "website" },
  twitter: { card: "summary_large_image" },
  icons: { icon: "/icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#fff8ef",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fredoka.variable} ${nunito.variable}`}>
      <body className="min-h-dvh">
        {children}
        <Sounds />
      </body>
    </html>
  );
}
