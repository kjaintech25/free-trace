import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Slider } from "@/components/ui/Slider";

// jsdom has no layout engine, so getBoundingClientRect() is always zeroed —
// it cannot prove a real 44x44px hit area. What we CAN assert is that each
// primitive carries the Tailwind classes that guarantee that size at
// render time (h-11/w-11 = 2.75rem = 44px at the default 16px root, and
// min-h-11 for Button). Real geometry is a manual/visual check — see the
// Unverified section of the build report.
afterEach(() => {
  cleanup();
});

describe("Button — minimum 44px hit height", () => {
  it("carries the min-h-11 (44px) class", () => {
    const { getByRole } = render(<Button>Save</Button>);
    const button = getByRole("button", { name: "Save" });
    expect(button.className).toMatch(/\bmin-h-11\b/);
  });
});

describe("IconButton — 44x44 hit area regardless of icon size", () => {
  it("carries the h-11 w-11 (44x44px) classes", () => {
    const { getByRole } = render(
      <IconButton aria-label="Lock">
        <svg width="8" height="8" />
      </IconButton>,
    );
    const button = getByRole("button", { name: "Lock" });
    expect(button.className).toMatch(/\bh-11\b/);
    expect(button.className).toMatch(/\bw-11\b/);
  });

  it("requires an aria-label at the type level and renders it", () => {
    const { getByLabelText } = render(
      <IconButton aria-label="Flip horizontal">
        <svg />
      </IconButton>,
    );
    expect(getByLabelText("Flip horizontal")).toBeTruthy();
  });

  it("renders the active state in the accent token, not an inactive one", () => {
    const { getByRole, rerender } = render(
      <IconButton aria-label="Lock" active={false}>
        <svg />
      </IconButton>,
    );
    expect(getByRole("button", { name: "Lock" }).className).toMatch(
      /\bbg-surface\b/,
    );

    rerender(
      <IconButton aria-label="Lock" active>
        <svg />
      </IconButton>,
    );
    expect(getByRole("button", { name: "Lock" }).className).toMatch(
      /\bbg-accent\b/,
    );
  });
});

describe("Slider — thumb/track hit area", () => {
  it("uses the .ft-slider class, whose CSS (globals.css) sizes the input box to 2.75rem (44px) tall", () => {
    const { getByLabelText } = render(
      <Slider label="Opacity" value={50} onChange={() => {}} />,
    );
    const input = getByLabelText("Opacity") as HTMLInputElement;
    expect(input.type).toBe("range");
    expect(input.className).toMatch(/\bft-slider\b/);
  });
});
