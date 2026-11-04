// Phone normalization: every stored and entered phone compares in E.164.
import { describe, expect, it } from "vitest";
import { normalizePhone, PhoneNumber } from "../src/phone-auth";

describe("normalizePhone", () => {
  it.each([
    ["+12125550123", "+12125550123"],
    ["(212) 555-0123", "+12125550123"],
    ["212.555.0123", "+12125550123"],
    ["1 212 555 0123", "+12125550123"],
    ["0044 20 7946 0958", "+442079460958"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "12345", "555-0123", "+0123456789", "112 555 0123", "+1234567890123456", "212-555-0123 ext 4"])(
    "rejects %j", (input) => {
      expect(normalizePhone(input)).toBeNull();
      expect(PhoneNumber.safeParse(input).success).toBe(false);
    },
  );
});
