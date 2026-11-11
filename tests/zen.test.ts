import { describe, expect, it } from "vitest";
import {
  DEFAULT_ZEN_PREFS,
  DEFAULT_ZEN_THRESHOLD_INR,
  amountToInr,
  parseZenPrefs,
  shouldZenPause,
} from "@/lib/zen";

describe("Zen pause threshold", () => {
  it("does not pause amounts under the INR threshold", () => {
    expect(shouldZenPause(4999, "INR")).toBe(false);
    expect(shouldZenPause(8, "USD")).toBe(false); // 8 * 83 = 664
  });

  it("pauses when the INR amount meets or exceeds the threshold", () => {
    expect(shouldZenPause(DEFAULT_ZEN_THRESHOLD_INR, "INR")).toBe(true);
    expect(shouldZenPause(65000, "INR")).toBe(true);
  });

  it("converts USD to INR at the demo FX rate before comparing", () => {
    expect(amountToInr(80, "USD")).toBe(6640);
    expect(shouldZenPause(80, "USD")).toBe(true);
    expect(shouldZenPause(60, "USD", { ...DEFAULT_ZEN_PREFS, thresholdInr: 5000 })).toBe(false); // 4980
  });

  it("never pauses when Zen Mode is disabled, even for large amounts", () => {
    expect(shouldZenPause(65000, "INR", { ...DEFAULT_ZEN_PREFS, enabled: false })).toBe(false);
  });

  it("never pauses zero or invalid amounts", () => {
    expect(shouldZenPause(0, "INR")).toBe(false);
    expect(shouldZenPause(-10, "INR")).toBe(false);
    expect(shouldZenPause(Number.NaN, "INR")).toBe(false);
  });

  it("parses stored prefs and clamps seconds", () => {
    expect(parseZenPrefs(null)).toEqual(DEFAULT_ZEN_PREFS);
    expect(parseZenPrefs(`{"enabled":false,"thresholdInr":10000,"seconds":12}`)).toEqual({
      enabled: false,
      thresholdInr: 10000,
      seconds: 12,
    });
    expect(parseZenPrefs(`{"seconds":99}`).seconds).toBe(30);
    expect(parseZenPrefs("not-json")).toEqual(DEFAULT_ZEN_PREFS);
  });
});
