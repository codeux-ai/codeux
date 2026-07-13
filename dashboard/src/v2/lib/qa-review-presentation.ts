export type QaReviewPresentationKind = "running" | "changes-requested" | "reviewed";

export interface QaReviewPresentationInput {
  status: string | null | undefined;
  outcome: string | null | undefined;
}

export interface QaReviewPresentation {
  kind: QaReviewPresentationKind;
  heading: string;
  badgeLabel: string;
  screenReaderLabel: string;
}

function normalizeQaReviewSignal(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_\-\s]+/g, " ")
    .trim();
}

function isChangesRequestedSignal(value: string): boolean {
  return value === "changes requested"
    || value === "change requested"
    || value === "requested changes"
    || value === "requested change"
    || value === "request changes"
    || value === "request change";
}

export function getQaReviewPresentation(input: QaReviewPresentationInput): QaReviewPresentation {
  const status = normalizeQaReviewSignal(input.status);
  const outcome = normalizeQaReviewSignal(input.outcome);

  if (isChangesRequestedSignal(status) || isChangesRequestedSignal(outcome)) {
    return {
      kind: "changes-requested",
      heading: "QA Changes Requested",
      badgeLabel: "QA Changes Requested",
      screenReaderLabel: "QA changes requested.",
    };
  }

  if (status === "running" || status === "in progress" || status === "reviewing") {
    return {
      kind: "running",
      heading: "QA Review Running",
      badgeLabel: "Reviewing...",
      screenReaderLabel: "QA review running.",
    };
  }

  return {
    kind: "reviewed",
    heading: "QA Review Complete",
    badgeLabel: "QA Reviewed",
    screenReaderLabel: "QA review complete.",
  };
}
