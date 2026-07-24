import React, { useEffect, useRef } from "react";

export const REVERSIBLE_ACTION_WINDOW_MS = 10_000;
export const CONFIRMATION_FEEDBACK_MS = 4_000;

export interface ActionFeedbackState {
  actionLabel?: string;
  kind: "error" | "success";
  message: string;
  onAction?(): void;
}

export function ActionFeedback({
  feedback,
  onDismiss,
  timeoutMs,
}: {
  feedback: ActionFeedbackState | null;
  onDismiss(): void;
  timeoutMs?: number;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (feedback === null || timeoutMs === undefined) return;
    const timeout = window.setTimeout(() => dismissRef.current(), timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [feedback, timeoutMs]);

  if (feedback === null) return null;
  return (
    <div
      className={`action-feedback is-${feedback.kind}`}
      role={feedback.kind === "error" ? "alert" : "status"}
    >
      <span>{feedback.message}</span>
      {feedback.onAction === undefined ? null : (
        <button onClick={feedback.onAction} type="button">
          {feedback.actionLabel ?? "Undo"}
        </button>
      )}
      <button
        aria-label="Dismiss notification"
        className="action-feedback-dismiss"
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
