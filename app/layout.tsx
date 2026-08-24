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

function deploymentPublicUrl(value: string | undefined) {
  const url = new URL(value ?? "https://garak-studio.faccio313.chatgpt.site/");

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("GARAK_PUBLIC_URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }

  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

const publicUrl = deploymentPublicUrl(process.env.GARAK_PUBLIC_URL);
const openGraphImageUrl = new URL("og.png", publicUrl);
const faviconUrl = new URL("favicon.svg", publicUrl);

export const metadata: Metadata = {
  metadataBase: new URL(publicUrl.origin),
  title: "Garak — Orchestra notation studio",
  description: "Compose polished solo, ensemble, and orchestral scores in your browser.",
  applicationName: "Garak Studio",
  openGraph: {
    type: "website",
    title: "Garak — Orchestra notation studio",
    description: "Compose polished solo, ensemble, and orchestral scores in your browser.",
    url: publicUrl,
    siteName: "Garak Studio",
    images: [{ url: openGraphImageUrl, width: 1200, height: 630, alt: "Garak — Compose beautifully. Think orchestrally." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Garak — Orchestra notation studio",
    description: "Compose polished solo, ensemble, and orchestral scores in your browser.",
    images: [openGraphImageUrl],
  },
  icons: {
    icon: faviconUrl,
    shortcut: faviconUrl,
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
