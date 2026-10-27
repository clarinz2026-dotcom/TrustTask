import { describe, expect, it } from "vitest";
import { calculateEarnings } from "../../src/domain/money.js";
import {
  decideReview,
  nextSubmissionVersion,
} from "../../src/domain/review.js";

describe("review workflow rules", () => {
  it("requires an explanation and maps each allowed decision", () => {
    expect(
      decideReview("submitted", "approve", "All acceptance criteria are met."),
    ).toBe("approved");
    expect(
      decideReview(
        "submitted",
        "request_revision",
        "Please include the missing test evidence.",
      ),
    ).toBe("revision_requested");
    expect(
      decideReview(
        "in_review",
        "reject",
        "The submission does not meet the required scope.",
      ),
    ).toBe("rejected");
    expect(() => decideReview("submitted", "reject", "No")).toThrow(
      "meaningful review explanation",
    );
  });

  it("rejects stale decisions and enforces the revision cap", () => {
    expect(() =>
      decideReview("approved", "reject", "Change the outcome after approval."),
    ).toThrow("not awaiting review");
    expect(nextSubmissionVersion(1, undefined)).toBe(1);
    expect(nextSubmissionVersion(2, "revision_requested")).toBe(3);
    expect(() => nextSubmissionVersion(4, "revision_requested")).toThrow(
      "Revision limit reached",
    );
    expect(() => nextSubmissionVersion(1, "submitted")).toThrow(
      "only allowed after a revision request",
    );
  });
});

describe("exact earnings arithmetic", () => {
  it("uses integer minor units and a rounded ten percent fee", () => {
    expect(calculateEarnings(10_005n)).toEqual({
      grossMinor: 10_005n,
      feeMinor: 1_001n,
      netMinor: 9_004n,
    });
  });

  it("rejects invalid amounts and rates", () => {
    expect(() => calculateEarnings(0n)).toThrow("positive");
    expect(() => calculateEarnings(100n, 10_001)).toThrow(
      "between 0 and 10000",
    );
  });
});
