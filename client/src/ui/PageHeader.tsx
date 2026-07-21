import React, { type ReactNode } from "react";

export function PageHeader({
  actions,
  eyebrow,
  status,
  title,
  titleId,
}: {
  actions?: ReactNode;
  eyebrow: string;
  status: ReactNode;
  title: ReactNode;
  titleId: string;
}) {
  return (
    <header className="page-heading">
      <div className="page-heading-copy">
        <p className="page-heading-eyebrow">{eyebrow}</p>
        <h1 id={titleId}>{title}</h1>
        <p className="page-heading-status">{status}</p>
        <TideRule />
      </div>
      {actions === undefined ? null : (
        <div className="page-heading-actions">{actions}</div>
      )}
    </header>
  );
}

export function TideRule() {
  return (
    <span className="tide-rule" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
