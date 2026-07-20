import React, {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { requiredPasswordChangeRequestSchema } from "../../../shared/account-settings.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import { normalizePassword } from "../../../shared/password-policy.js";
import {
  PasswordChangeApiError,
  type AuthApi,
} from "./api.js";
import { PasswordRequirements } from "./PasswordRequirements.js";

export function RequiredPasswordChangeDialog({
  api,
  onChanged,
  onLogout,
  temporaryPassword,
  user,
}: {
  api: AuthApi;
  onChanged(user: CurrentUser): void;
  onLogout(): void;
  temporaryPassword: string | null;
  user: CurrentUser;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reuseRejected, setReuseRejected] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    document.body.classList.add("has-blocking-dialog");
    return () => document.body.classList.remove("has-blocking-dialog");
  }, []);

  const valid = requiredPasswordChangeRequestSchema.safeParse({
    confirmation,
    newPassword,
  }).success;
  const knownReuse =
    temporaryPassword !== null &&
    normalizePassword(newPassword) === normalizePassword(temporaryPassword);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !valid || knownReuse) return;
    setPending(true);
    setError(null);
    setReuseRejected(false);
    void api
      .changeRequiredPassword({ confirmation, newPassword })
      .then(onChanged)
      .catch((caught: unknown) => {
        if (
          caught instanceof PasswordChangeApiError &&
          caught.kind === "reuse"
        ) {
          setReuseRejected(true);
          setError("Choose a password you have not just used.");
          return;
        }
        if (
          caught instanceof PasswordChangeApiError &&
          caught.kind === "validation"
        ) {
          setError("Review the password requirements and try again.");
          return;
        }
        setError("Your password could not be changed. Try again.");
      })
      .finally(() => setPending(false));
  };

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "input:not([disabled]), button:not([disabled])",
      ) ?? [],
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="required-password-backdrop" role="presentation">
      <section
        aria-describedby="required-password-copy"
        aria-labelledby="required-password-title"
        aria-modal="true"
        className="required-password-dialog"
        onKeyDown={trapFocus}
        ref={dialogRef}
        role="dialog"
      >
        <header>
          <p>Account security</p>
          <h1 id="required-password-title">Create your password</h1>
        </header>
        <p id="required-password-copy">
          Welcome, {user.displayName}. Replace the temporary password before
          entering your workspace.
        </p>
        <form onSubmit={submit}>
          <label>
            <span>New password</span>
            <input
              autoComplete="new-password"
              disabled={pending}
              maxLength={256}
              onChange={(event) => {
                setNewPassword(event.currentTarget.value);
                setReuseRejected(false);
              }}
              ref={firstFieldRef}
              required
              type="password"
              value={newPassword}
            />
          </label>
          <label>
            <span>Confirm new password</span>
            <input
              autoComplete="new-password"
              disabled={pending}
              maxLength={256}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              required
              type="password"
              value={confirmation}
            />
          </label>
          <PasswordRequirements
            confirmation={confirmation}
            password={newPassword}
            priorPassword={temporaryPassword}
            reuseRejected={reuseRejected}
          />
          {error === null ? null : (
            <p className="required-password-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="required-password-submit"
            disabled={pending || !valid || knownReuse}
            type="submit"
          >
            {pending ? "Securing account..." : "Set password and continue"}
          </button>
          <button
            className="required-password-logout"
            disabled={pending}
            onClick={onLogout}
            type="button"
          >
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}
