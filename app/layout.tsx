/**
 * Root layout — sets up fonts, metadata, and global styles.
 *
 * Uses Geist Sans and Geist Mono loaded from Google Fonts via Next.js
 * `next/font` for automatic subsetting and zero layout shift.
 */

import type { Metadata } from "next";
import { Outfit, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FX Routing Console",
  description: "Internal routing console for ranking multi-leg FX execution paths.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} ${ibmPlexMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
