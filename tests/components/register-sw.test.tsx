import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RegisterSW from "@/components/RegisterSW";

/**
 * T-12. The worker must register in production and must be completely inert
 * anywhere else — including on browsers with no service worker at all, where
 * the only acceptable behaviour is to do nothing quietly.
 */

function installServiceWorker(register: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register },
  });
}

function removeServiceWorker() {
  // `delete` is a no-op on a non-configurable property, so redefine-then-delete.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: undefined,
  });
  Reflect.deleteProperty(navigator, "serviceWorker");
}

describe("RegisterSW", () => {
  let register: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    register = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeServiceWorker();
  });

  it("registers /sw.js with the build id in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "abc123def456");
    installServiceWorker(register);

    render(<RegisterSW />);

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js?v=abc123def456");
  });

  it("versions the script URL so a new deploy installs a fresh worker", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "second-build");
    installServiceWorker(register);

    render(<RegisterSW />);

    const [url] = register.mock.calls[0] as [string];
    expect(url.startsWith("/sw.js?v=")).toBe(true);
    expect(url).toContain("second-build");
  });

  it("does not register outside production", () => {
    // A cache-first worker on a dev server serves the chunks from before your
    // last edit and makes a correct change look broken.
    for (const env of ["development", "test"]) {
      register.mockClear();
      vi.stubEnv("NODE_ENV", env);
      installServiceWorker(register);

      render(<RegisterSW />);

      expect(register, env).not.toHaveBeenCalled();
    }
  });

  it("does not throw where navigator.serviceWorker is undefined", () => {
    vi.stubEnv("NODE_ENV", "production");
    removeServiceWorker();

    expect(() => render(<RegisterSW />)).not.toThrow();
  });

  it("renders nothing", () => {
    vi.stubEnv("NODE_ENV", "production");
    installServiceWorker(register);

    const { container } = render(<RegisterSW />);

    expect(container.innerHTML).toBe("");
  });

  it("swallows a rejected registration instead of surfacing an error", async () => {
    // Private windows reject here. The app still works, just not offline.
    vi.stubEnv("NODE_ENV", "production");
    const rejecting = vi.fn().mockRejectedValue(new Error("not allowed"));
    installServiceWorker(rejecting);

    expect(() => render(<RegisterSW />)).not.toThrow();
    await expect(rejecting.mock.results[0]?.value).rejects.toThrow("not allowed");
  });
});
