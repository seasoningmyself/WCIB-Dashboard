import React from "react";
import {
  getPasswordRequirementStatuses,
  normalizePassword,
} from "../../../shared/password-policy.js";

type RequirementState = "met" | "not_met" | "pending";

export function PasswordRequirements({
  confirmation,
  password,
  priorPassword,
  reuseRejected = false,
}: {
  confirmation?: string;
  password: string;
  priorPassword?: string | null;
  reuseRejected?: boolean;
}) {
  const policy = getPasswordRequirementStatuses(password).map((status) => ({
    label: status.label,
    state:
      password.length > 0 && status.isSatisfied
        ? ("met" as const)
        : ("not_met" as const),
  }));
  const rows: Array<{ label: string; state: RequirementState }> = [...policy];

  if (priorPassword !== undefined) {
    rows.push({
      label: "Different from the current or temporary password",
      state:
        reuseRejected ||
        (priorPassword !== null &&
          normalizePassword(password) === normalizePassword(priorPassword))
          ? "not_met"
          : priorPassword === null
            ? "pending"
            : password.length > 0
              ? "met"
              : "not_met",
    });
  }
  if (confirmation !== undefined) {
    rows.push({
      label: "Passwords match",
      state:
        confirmation.length > 0 &&
        normalizePassword(password) === normalizePassword(confirmation)
          ? "met"
          : "not_met",
    });
  }

  return (
    <ul className="password-requirements" aria-label="Password requirements">
      {rows.map(({ label, state }) => (
        <li className={`is-${state}`} key={label}>
          <span aria-hidden="true" className="password-requirement-mark" />
          <span>{label}</span>
          {state === "pending" ? (
            <span className="sr-only">Checked when submitted</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
