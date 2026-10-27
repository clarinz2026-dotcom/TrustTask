export type SubmissionStatus =
  "submitted" | "in_review" | "revision_requested" | "approved" | "rejected";

export type ReviewDecision = "approve" | "request_revision" | "reject";

export function decideReview(
  status: SubmissionStatus,
  decision: ReviewDecision,
  reason: string,
): SubmissionStatus {
  if (status !== "submitted" && status !== "in_review") {
    throw new Error("Submission is not awaiting review");
  }
  if (reason.trim().length < 10) {
    throw new Error("A meaningful review explanation is required");
  }
  if (decision === "approve") return "approved";
  if (decision === "request_revision") return "revision_requested";
  return "rejected";
}

export function nextSubmissionVersion(
  currentVersion: number,
  latestStatus: SubmissionStatus | undefined,
): number {
  if (latestStatus === undefined) return 1;
  if (latestStatus !== "revision_requested") {
    throw new Error(
      "A new submission is only allowed after a revision request",
    );
  }
  if (currentVersion >= 4) throw new Error("Revision limit reached");
  return currentVersion + 1;
}
