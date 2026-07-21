import React, { type ReactNode } from "react";

export function EmptyState({
  action,
  body,
  className,
  heading,
  headingId,
  headingLevel = 2,
}: {
  action?: ReactNode;
  body: ReactNode;
  className?: string;
  heading: ReactNode;
  headingId?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  return (
    <div className={["app-empty-state", className].filter(Boolean).join(" ")}>
      <Heading id={headingId}>{heading}</Heading>
      <p>{body}</p>
      {action === undefined ? null : (
        <div className="app-empty-state-action">{action}</div>
      )}
    </div>
  );
}
