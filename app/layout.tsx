import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://garak-studio.faccio313.chatgpt.site"),
  title: "Garak — Orchestra notation studio",
  description: "Compose polished solo, ensemble, and orchestral scores in your browser.",
  applicationName: "Garak Studio",
  openGraph: {
    type: "website",
    title: "Garak — Orchestra notation studio",
    description: "Compose polished solo, ensemble, and orchestral scores in your browser.",
    url: "/",
    siteName: "Garak Studio",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "Garak — Compose beautifully. Think orchestrally." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Garak — Orchestra notation studio",
    description: "Compose polished solo, ensemble, and orchestral scores in your browser.",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
