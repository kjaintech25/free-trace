import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it } from "vitest";
import {
  peekPendingImport,
  setPendingImport,
  takePendingImport,
} from "@/lib/pendingImport";
import type { ImportedImage } from "@/lib/import";

// Node's Blob, not jsdom's — see tests/storage.test.ts's harness note for why
// (fake-indexeddb structuredClone concern doesn't apply here since this store
// is plain module state, but Node's Blob is a real Blob either way and keeps
// this file consistent with the rest of the suite).
const NativeBlob = NodeBlob as unknown as typeof Blob;

function makeImage(): ImportedImage {
  return {
    original: new NativeBlob(["orig"], { type: "image/jpeg" }),
    width: 100,
    height: 200,
    thumbnail: new NativeBlob(["thumb"], { type: "image/jpeg" }),
  };
}

beforeEach(() => {
  // Drain any value left by a previous test — the store is module-scoped.
  takePendingImport();
});

describe("pendingImport", () => {
  it("peek returns null when nothing has been set", () => {
    expect(peekPendingImport()).toBeNull();
  });

  it("take returns null when nothing has been set", () => {
    expect(takePendingImport()).toBeNull();
  });

  it("peek returns the stored value without clearing it", () => {
    const value = makeImage();
    setPendingImport(value);
    expect(peekPendingImport()).toBe(value);
    expect(peekPendingImport()).toBe(value);
  });

  it("take returns the stored value and clears it", () => {
    const value = makeImage();
    setPendingImport(value);
    expect(takePendingImport()).toBe(value);
    expect(takePendingImport()).toBeNull();
    expect(peekPendingImport()).toBeNull();
  });

  it("set replaces any previously stored value", () => {
    const first = makeImage();
    const second = makeImage();
    setPendingImport(first);
    setPendingImport(second);
    expect(takePendingImport()).toBe(second);
  });
});
