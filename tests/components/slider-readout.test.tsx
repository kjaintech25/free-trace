import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Slider } from "@/components/ui/Slider";

afterEach(() => {
  cleanup();
});

describe("Slider readout", () => {
  it("renders the value in the .numeral (Geist Mono / tabular-nums) class", () => {
    const { getByText } = render(
      <Slider label="Opacity" value={42} onChange={() => {}} />,
    );
    const readout = getByText("42%");
    expect(readout.className).toMatch(/\bnumeral\b/);
  });

  it("reserves a fixed width so the readout does not reflow as digits change", () => {
    const { getByText, rerender } = render(
      <Slider label="Opacity" value={5} onChange={() => {}} />,
    );
    const readoutAt1Digit = getByText("5%");
    // Fixed width utility class — same class string regardless of value, so
    // the box the readout occupies does not grow/shrink with digit count.
    expect(readoutAt1Digit.className).toMatch(/\bw-14\b/);
    expect(readoutAt1Digit.className).toMatch(/\bshrink-0\b/);

    rerender(<Slider label="Opacity" value={100} onChange={() => {}} />);
    const readoutAt3Digits = getByText("100%");
    expect(readoutAt3Digits.className).toBe(readoutAt1Digit.className);
  });

  it("computes the fill percentage passed to CSS via --fill-percent", () => {
    const { getByLabelText } = render(
      <Slider label="Opacity" value={25} min={0} max={100} onChange={() => {}} />,
    );
    const input = getByLabelText("Opacity") as HTMLInputElement;
    expect(input.style.getPropertyValue("--fill-percent")).toBe("25%");
  });
});
