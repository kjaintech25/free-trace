import { describe, expect, it } from "vitest";

// Trivial smoke test proving the Vitest harness itself is wired up correctly
// for this scaffold (T-01). Real coverage (e.g. the line-art engine) arrives
// in later tickets.
describe("scaffold", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
