import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import RegisterSW from "@/components/RegisterSW";
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
  title: "Free Trace",
  description:
    "Import a photo, convert it to line art on-device, trace it onto paper over the live camera.",
  applicationName: "Free Trace",
  // `app/manifest.ts` generates /manifest.webmanifest and Next injects the
  // <link rel="manifest"> for it automatically — it is not repeated here.
  appleWebApp: {
    // iOS ignores the manifest entirely: display mode, name and icon all come
    // from these apple-prefixed tags instead (T-12, SPEC §3).
    capable: true,
    title: "Free Trace",
    // The camera feed runs full-bleed under the status bar, so the bar must be
    // transparent over it rather than painting its own strip (SPEC §7 iOS).
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // iOS reads ONLY this for the Home Screen icon — never the manifest icons.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    /* VERIFIED against this build's own output: `appleWebApp.capable: true`
       makes Next 16.3 emit the modern `mobile-web-app-capable` and NOT the
       apple-prefixed name, which is the one iOS supported first. Added by hand
       for iOS older than ~11.3.

       It cannot fight the KNOWN_ISSUES.md fallback: since 2018 iOS lets the
       manifest's `display` override this meta, so flipping app/manifest.ts to
       "browser" still wins on any current iPhone. Precedence is spelled out in
       KNOWN_ISSUES.md so nobody has to rediscover it with a black camera. */
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0C",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
