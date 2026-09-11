import { describe, expect, it } from "vitest";
import path from "node:path";
import { loadProfile, portsForSlot } from "./index.js";

describe("loadProfile", () => {
  it("loads bundled minimal profile", () => {
    const minimalDir = path.resolve(
      import.meta.dirname,
      "../../../profiles/minimal",
    );
    const loaded = loadProfile(minimalDir);
    expect(loaded.profile.name).toBe("minimal");
    expect(loaded.workspace).toBeTruthy();
  });

  it("formats worker ports from formula", () => {
    expect(portsForSlot("30{n}0/30{n}1", 3)).toBe("3030/3031");
  });
});
