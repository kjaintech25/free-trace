import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

/**
 * T-12 acceptance: "Installable to iOS Home Screen with correct name, icon and
 * dark theme colour." This asserts the half a machine can check — the manifest
 * Next will serve. The install itself is iPhone-only and stays UNVERIFIED.
 */
describe("web app manifest", () => {
  const value = manifest();

  it("names the app Free Trace", () => {
    expect(value.name).toBe("Free Trace");
    expect(value.short_name).toBe("Free Trace");
  });

  it("launches standalone and portrait from the site root", () => {
    expect(value.start_url).toBe("/");
    expect(value.scope).toBe("/");
    expect(value.display).toBe("standalone");
    expect(value.orientation).toBe("portrait");
  });

  it("carries the SPEC §7 near-black theme in both colour fields", () => {
    // Must stay in step with --bg in app/globals.css. The browser paints these
    // before any CSS exists, so they cannot be tokens.
    expect(value.theme_color).toBe("#0B0B0C");
    expect(value.background_color).toBe("#0B0B0C");
  });

  it("ships 192 and 512 icons plus a maskable 512", () => {
    const icons = value.icons ?? [];
    const bySize = (size: string, purpose: string) =>
      icons.filter((icon) => icon.sizes === size && icon.purpose === purpose);

    expect(bySize("192x192", "any")).toHaveLength(1);
    expect(bySize("512x512", "any")).toHaveLength(1);
    expect(bySize("512x512", "maskable")).toHaveLength(1);

    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith("/icons/")).toBe(true);
    }
  });

  it("points every icon at a file the icon script actually writes", async () => {
    const { existsSync } = await import("node:fs");
    for (const icon of value.icons ?? []) {
      expect(existsSync(`${process.cwd()}/public${icon.src}`), icon.src).toBe(true);
    }
  });
});
