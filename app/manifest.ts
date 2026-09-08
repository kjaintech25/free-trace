import type { MetadataRoute } from "next";

/**
 * Web app manifest (ticket T-12), served by Next at `/manifest.webmanifest`.
 *
 * The hex literals below are deliberate: this is a manifest, not a component.
 * The browser reads it before any CSS exists, so it cannot resolve a Tailwind
 * token or a CSS custom property. They must stay in step with `--bg`/`--accent`
 * in `app/globals.css` (SPEC §7).
 *
 * 🔴 `display: "standalone"` is the line named in KNOWN_ISSUES.md. If the camera
 * comes up black after "Add to Home Screen" (SPEC §10.3), changing it to
 * "browser" makes the Home Screen icon open the app in Safari instead, where
 * getUserMedia is known-good. Do not implement that here — it is documented so
 * it can be flipped in ten seconds if the hardware actually misbehaves.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Free Trace",
    short_name: "Free Trace",
    description:
      "Turn a photo into line art on-device and trace it onto paper over the live camera.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0B0B0C",
    theme_color: "#0B0B0C",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        // Full-bleed ground with the mark inside the 80% safe circle, so a
        // launcher may crop it to any silhouette without clipping the artwork.
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
