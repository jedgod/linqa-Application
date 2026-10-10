/**
 * Maps a transfer's real status (and the provider attempts recorded for it) onto the five
 * steps shown on the Transfer Tracking screen. Nothing here is animated or assumed: a step is
 * "done" only when the transfer has actually reached or passed that state.
 */
export type StepState = "done" | "current" | "pending" | "failed";
export type TrackingStep = { key: "initiated" | "payment" | "processing" | "payout" | "delivered"; label: string; state: StepState; at: string | null };
export type Tracking = {
  title: string;
  steps: TrackingStep[];
  /** Plain-language line for the card under the timeline. */
  message: string;
  outcome: "IN_PROGRESS" | "DELIVERED" | "NEEDS_ATTENTION" | "STOPPED";
};

type Attempt = { phase: string; status: string; at: string };

const ORDER = ["initiated", "payment", "processing", "payout", "delivered"] as const;

/** The step a status is currently working on (index into the five steps), 5 when everything is done, or null off the happy path. */
function reached(status: string): number | null {
  switch (status) {
    case "CREATED": case "QUOTE_CREATED": case "AWAITING_CONFIRMATION": case "AUTHENTICATING":
    case "COMPLIANCE_SCREENING": case "RISK_REVIEW": case "FUNDING_AUTHORIZATION":
      return 1; // initiated; confirming payment
    case "FUNDS_AUTHORIZED": case "TRANSFER_SUBMITTED": case "PROCESSING": return 2; // payment confirmed; processing
    case "PAYOUT_SUBMITTED": case "PAYOUT_PROCESSING": return 3; // payout on the way
    case "COMPLETED": return 5;
    default: return null;
  }
}

const STOPPED = new Set(["DECLINED", "CANCELED", "EXPIRED", "FAILED", "REVERSED", "REFUNDED", "PARTIALLY_REFUNDED", "CHARGEBACK", "DISPUTED"]);
const ATTENTION = new Set(["REQUIRES_ACTION", "MANUAL_REVIEW", "ON_HOLD"]);

const label = (status: string) => status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

function attemptTime(timeline: Attempt[], phasePattern: RegExp): string | null {
  const hit = timeline.find((a) => phasePattern.test(a.phase) && /^(SUCCEEDED|AUTHORIZED|COMPLETED|SUBMITTED|PROCESSING|OK)$/i.test(a.status));
  return hit?.at ?? null;
}

export function trackTransfer(input: { status: string; createdAt: string; completedAt: string | null; timeline: Attempt[]; failureCode?: string | null }): Tracking {
  const { status, timeline } = input;
  const base: Array<Pick<TrackingStep, "key" | "label">> = [
    { key: "initiated", label: "Transfer Initiated" },
    { key: "payment", label: "Payment Confirmed" },
    { key: "processing", label: "Processing" },
    { key: "payout", label: "Payout On The Way" },
    { key: "delivered", label: "Delivered" }
  ];
  const times: Record<string, string | null> = {
    initiated: input.createdAt,
    payment: attemptTime(timeline, /FUND/i),
    processing: attemptTime(timeline, /TRANSFER|PROCESS/i),
    payout: attemptTime(timeline, /PAYOUT/i),
    delivered: input.completedAt
  };

  const withTimes = (states: StepState[]): TrackingStep[] =>
    base.map((step, index) => {
      const state = states[index]!;
      return { ...step, state, at: state === "done" || state === "current" ? times[step.key] ?? null : null };
    });
  /** Steps before `current` are done, `current` is being worked on, the rest are pending. */
  const inProgress = (current: number): TrackingStep[] =>
    withTimes(base.map((_, index) => (index < current ? "done" : index === current ? "current" : "pending")));
  const stoppedAt = (failedIndex: number): TrackingStep[] =>
    withTimes(base.map((_, index) => (index < failedIndex ? "done" : index === failedIndex ? "failed" : "pending")));

  if (STOPPED.has(status)) {
    const progress = Math.max(0, (reached(status) ?? 1) - 1);
    // Stopped transfers fail at the step after the last one reached; before funding that is "Payment Confirmed".
    const failedIndex = status === "FAILED" || status === "DECLINED" || status === "CANCELED" || status === "EXPIRED" ? Math.max(1, Math.min(progress + 1, 4)) : 4;
    const steps = stoppedAt(failedIndex);
    const messages: Record<string, string> = {
      DECLINED: "This transfer was declined and no money was sent.",
      CANCELED: "This transfer was canceled and no money was sent.",
      EXPIRED: "This transfer expired before it was completed.",
      FAILED: "This transfer could not be completed. No money was delivered.",
      REVERSED: "This transfer was reversed.",
      REFUNDED: "This transfer was refunded.",
      PARTIALLY_REFUNDED: "Part of this transfer was refunded.",
      DISPUTED: "This transfer is under dispute.",
      CHARGEBACK: "This transfer has a chargeback."
    };
    return { title: `Transfer ${label(status)}`, steps, message: messages[status] ?? "This transfer has stopped.", outcome: "STOPPED" };
  }

  if (ATTENTION.has(status)) {
    const steps = inProgress(1);
    const messages: Record<string, string> = {
      REQUIRES_ACTION: "We need something from you to continue this transfer.",
      MANUAL_REVIEW: "This transfer is being reviewed. We'll notify you when it moves.",
      ON_HOLD: "This transfer is on hold. We'll notify you when it moves."
    };
    return { title: "Transfer Needs Attention", steps, message: messages[status]!, outcome: "NEEDS_ATTENTION" };
  }

  const progress = reached(status) ?? 1;
  const delivered = progress === 5;
  return {
    title: delivered ? "Transfer Complete" : "Transfer in Progress",
    steps: inProgress(progress),
    message: delivered ? "Delivered. Your recipient has received the money." : "We'll notify you when it's successfully delivered.",
    outcome: delivered ? "DELIVERED" : "IN_PROGRESS"
  };
}
