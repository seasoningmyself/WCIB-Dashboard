import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MfaStepUpDescriptor } from "../../../shared/mfa-scaffold.js";
import type {
  AdminStaffRecord,
  CreateAdminStaffRequest,
  ProducerRateInput,
  UpdateAdminStaffRequest,
} from "../../../shared/admin-staff.js";
import type { AdminOfficeLocation } from "../../../shared/admin-office-locations.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { EmptyState } from "../ui/EmptyState.js";
import { PageHeader } from "../ui/PageHeader.js";
import {
  ActiveDialogState,
  RateEditorDialog,
  StaffActiveDialog,
  StaffEditorDialog,
  TemporaryPasswordDialog,
  type RateDialogState,
  type StaffDialogState,
} from "./StaffDialogs.js";
import { AdminStaffApiError, createAdminStaffApi } from "./api.js";
import { createAdminOfficeApi } from "../offices/api.js";
import { createMfaApi } from "../auth/mfa-api.js";
import { MfaStepUpDialog } from "../auth/MfaStepUpDialog.js";
import {
  formatStaffDate,
  isManageStaffAdmin,
  newestRatesFirst,
  formatRate,
  staffRoleLabel,
} from "./view-state.js";

export type ManageStaffState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { items: readonly AdminStaffRecord[]; status: "ready" };

export function ManageStaff({ user }: { user: CurrentUser }) {
  return isManageStaffAdmin(user) ? (
    <AdminManageStaff user={user} />
  ) : (
    <StaffMessage
      body="This page is not available for your account."
      title="Staff management unavailable"
    />
  );
}

type StaffSensitiveMutation =
  | {
      input: UpdateAdminStaffRequest;
      kind: "update";
      userId: string;
    }
  | {
      kind: "temporary_password";
      temporaryPassword: string;
      userId: string;
    };

function AdminManageStaff({ user }: { user: CurrentUser }) {
  const currentUserId = user.id;
  const client = useApiClient();
  const api = useMemo(() => createAdminStaffApi(client), [client]);
  const mfaApi = useMemo(() => createMfaApi(), []);
  const officeApi = useMemo(() => createAdminOfficeApi(client), [client]);
  const [state, setState] = useState<ManageStaffState>({ status: "loading" });
  const [staffDialog, setStaffDialog] = useState<StaffDialogState | null>(null);
  const [rateDialog, setRateDialog] = useState<RateDialogState | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(null);
  const [temporaryPasswordDialog, setTemporaryPasswordDialog] = useState<{
    staff: AdminStaffRecord;
  } | null>(null);
  const [officeOptions, setOfficeOptions] = useState<readonly AdminOfficeLocation[]>([]);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sensitiveMutation, setSensitiveMutation] =
    useState<StaffSensitiveMutation | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(
    async (showLoading = true) => {
      const version = requestVersion.current + 1;
      requestVersion.current = version;
      if (showLoading) setState({ status: "loading" });
      try {
        const [items, offices] = await Promise.all([api.list(), officeApi.list()]);
        if (requestVersion.current === version) {
          setState({ items, status: "ready" });
          setOfficeOptions(offices.items);
        }
      } catch (error) {
        if (requestVersion.current !== version) return;
        setState({
          status:
            error instanceof AdminStaffApiError && error.kind === "denied"
              ? "denied"
              : "error",
        });
      }
    },
    [api, officeApi],
  );

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const clearSensitiveState = useCallback(() => {
    requestVersion.current += 1;
    pendingRef.current = false;
    setPending(false);
    setState({ status: "loading" });
    setStaffDialog(null);
    setRateDialog(null);
    setActiveDialog(null);
    setTemporaryPasswordDialog(null);
    setSensitiveMutation(null);
    setOfficeOptions([]);
    setDialogError(null);
    setNotice(null);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const beginMutation = () => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setDialogError(null);
    setNotice(null);
    return true;
  };

  const finishMutation = () => {
    pendingRef.current = false;
    setPending(false);
  };

  const handleFailure = async (error: unknown, conflictCopy: string) => {
    if (error instanceof AdminStaffApiError && error.kind === "denied") {
      clearSensitiveState();
      setState({ status: "denied" });
      return;
    }
    if (error instanceof AdminStaffApiError && error.kind === "conflict") {
      setDialogError(conflictCopy);
      await load(false);
      return;
    }
    if (error instanceof AdminStaffApiError && error.kind === "rejected") {
      setDialogError("The request was rejected. Review the values and try again.");
      return;
    }
    setDialogError("The change could not be saved. Try again.");
  };

  const createStaff = async (input: CreateAdminStaffRequest) => {
    if (!beginMutation()) return;
    try {
      await api.create(input);
      setStaffDialog(null);
      setNotice("Staff account created.");
      await load(false);
    } catch (error) {
      await handleFailure(error, "That email or display name is already in use.");
    } finally {
      finishMutation();
    }
  };

  const updateStaff = async (
    userId: string,
    input: UpdateAdminStaffRequest,
    stepUpToken?: string,
  ) => {
    if (!beginMutation()) return;
    try {
      await api.update(userId, input, stepUpToken);
      setStaffDialog(null);
      setSensitiveMutation(null);
      setNotice("Staff account updated.");
      await load(false);
    } catch (error) {
      await handleFailure(
        error,
        "The account changed or that email, name, or producer setup conflicts with current data.",
      );
    } finally {
      finishMutation();
    }
  };

  const changeActive = async () => {
    if (activeDialog === null || !beginMutation()) return;
    try {
      await api.setActive(activeDialog.staff.userId, activeDialog.active);
      setActiveDialog(null);
      setNotice(
        activeDialog.active
          ? "Staff account reactivated."
          : "Staff account deactivated and active sessions ended.",
      );
      await load(false);
    } catch (error) {
      await handleFailure(error, "That account changed. Review the current roster and try again.");
    } finally {
      finishMutation();
    }
  };

  const createRate = async (userId: string, input: ProducerRateInput) => {
    if (!beginMutation()) return;
    try {
      await api.createRate(userId, input);
      setRateDialog(null);
      setNotice("Producer rate added.");
      await load(false);
    } catch (error) {
      await handleFailure(error, "That effective date already exists or the account is no longer a producer.");
    } finally {
      finishMutation();
    }
  };

  const issueTemporaryPassword = async (
    temporaryPassword: string,
    stepUpToken: string,
  ) => {
    if (temporaryPasswordDialog === null || !beginMutation()) return;
    try {
      await api.issueTemporaryPassword(
        temporaryPasswordDialog.staff.userId,
        temporaryPassword,
        stepUpToken,
      );
      setTemporaryPasswordDialog(null);
      setSensitiveMutation(null);
      setNotice("Temporary password issued. The user must replace it at sign-in.");
      await load(false);
    } catch (error) {
      await handleFailure(
        error,
        "The temporary password must differ from the account's current password.",
      );
    } finally {
      finishMutation();
    }
  };

  const updateRate = async (
    userId: string,
    rateId: string,
    input: ProducerRateInput,
  ) => {
    if (!beginMutation()) return;
    try {
      await api.updateRate(userId, rateId, input);
      setRateDialog(null);
      setNotice("Unlocked producer rate corrected.");
      await load(false);
    } catch (error) {
      await handleFailure(
        error,
        "That rate is locked, changed, or conflicts with an existing effective date.",
      );
    } finally {
      finishMutation();
    }
  };

  return (
    <>
      <ManageStaffView
        notice={notice}
        onActive={(staff, active) => {
          setDialogError(null);
          setActiveDialog({ active, staff });
        }}
        onAdd={() => {
          setDialogError(null);
          setStaffDialog({ kind: "create" });
        }}
        onCompensation={(staff) => {
          setDialogError(null);
          setStaffDialog({ kind: "edit", panel: "compensation", staff });
        }}
        onEdit={(staff) => {
          setDialogError(null);
          setStaffDialog({ kind: "edit", panel: "profile", staff });
        }}
        onTemporaryPassword={(staff) => {
          setDialogError(null);
          setTemporaryPasswordDialog({ staff });
        }}
        onRetry={() => void load()}
        pending={pending}
        currentUserId={currentUserId}
        state={state}
      />
      <StaffEditorDialog
        dialog={staffDialog}
        error={dialogError}
        key={
          staffDialog === null
            ? "staff-closed"
            : staffDialog.kind === "create"
              ? "staff-create"
              : `staff-edit:${staffDialog.staff.userId}`
        }
        onCancel={() => {
          if (!pending) {
            setStaffDialog(null);
            setDialogError(null);
          }
        }}
        onAddRate={(staff) => {
          setStaffDialog(null);
          setDialogError(null);
          setRateDialog({ kind: "create", staff });
        }}
        onCorrectRate={(staff, rate) => {
          setStaffDialog(null);
          setDialogError(null);
          setRateDialog({ kind: "edit", rate, staff });
        }}
        onCreate={(input) => void createStaff(input)}
        onUpdate={(userId, input) => {
          if (input.email !== undefined || input.role !== undefined) {
            setSensitiveMutation({ input, kind: "update", userId });
            return;
          }
          void updateStaff(userId, input);
        }}
        officeOptions={officeOptions}
        pending={pending}
      />
      <RateEditorDialog
        dialog={rateDialog}
        error={dialogError}
        key={
          rateDialog === null
            ? "rate-closed"
            : rateDialog.kind === "create"
              ? `rate-create:${rateDialog.staff.userId}`
              : `rate-edit:${rateDialog.rate.id}`
        }
        onCancel={() => {
          if (!pending) {
            setRateDialog(null);
            setDialogError(null);
          }
        }}
        onCreate={(userId, input) => void createRate(userId, input)}
        onUpdate={(userId, rateId, input) => void updateRate(userId, rateId, input)}
        pending={pending}
      />
      <StaffActiveDialog
        dialog={activeDialog}
        error={dialogError}
        onCancel={() => {
          if (!pending) {
            setActiveDialog(null);
            setDialogError(null);
          }
        }}
        onConfirm={() => void changeActive()}
        pending={pending}
      />
      <TemporaryPasswordDialog
        dialog={temporaryPasswordDialog}
        error={dialogError}
        key={temporaryPasswordDialog?.staff.userId ?? "temporary-password-closed"}
        onCancel={() => {
          if (!pending) {
            setTemporaryPasswordDialog(null);
            setDialogError(null);
          }
        }}
        onConfirm={(temporaryPassword) => {
          if (temporaryPasswordDialog === null) return;
          setSensitiveMutation({
            kind: "temporary_password",
            temporaryPassword,
            userId: temporaryPasswordDialog.staff.userId,
          });
        }}
        pending={pending}
      />
      {sensitiveMutation === null ? null : (
        <MfaStepUpDialog
          api={mfaApi}
          descriptor={staffMutationDescriptor(sensitiveMutation)}
          methods={user.mfa?.methods ?? []}
          onAuthorized={async (token) => {
            if (sensitiveMutation.kind === "update") {
              await updateStaff(
                sensitiveMutation.userId,
                sensitiveMutation.input,
                token,
              );
              return;
            }
            await issueTemporaryPassword(
              sensitiveMutation.temporaryPassword,
              token,
            );
          }}
          onCancel={() => setSensitiveMutation(null)}
          title={
            sensitiveMutation.kind === "temporary_password"
              ? "Issue a temporary password"
              : "Change staff access"
          }
        />
      )}
    </>
  );
}

function staffMutationDescriptor(
  mutation: StaffSensitiveMutation,
): MfaStepUpDescriptor {
  if (mutation.kind === "update") {
    return {
      action: "admin_staff_update",
      mutation: mutation.input,
      targetUserId: mutation.userId,
    };
  }
  return {
    action: "temporary_password",
    mutation: { temporaryPassword: mutation.temporaryPassword },
    targetUserId: mutation.userId,
  };
}

export function ManageStaffView({
  notice,
  onActive,
  onAdd,
  onCompensation,
  onEdit,
  onTemporaryPassword,
  onRetry,
  pending,
  state,
  currentUserId,
}: {
  notice: string | null;
  onActive(staff: AdminStaffRecord, active: boolean): void;
  onAdd(): void;
  onCompensation(staff: AdminStaffRecord): void;
  onEdit(staff: AdminStaffRecord): void;
  onTemporaryPassword(staff: AdminStaffRecord): void;
  onRetry(): void;
  pending: boolean;
  state: ManageStaffState;
  currentUserId: string;
}) {
  const [showInactive, setShowInactive] = useState(false);
  if (state.status === "loading") {
    return <StaffMessage body="Retrieving staff accounts and rate history..." busy title="Loading staff" />;
  }
  if (state.status === "error") {
    return (
      <StaffMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="Staff accounts could not be loaded."
        title="Staff management unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <StaffMessage
        body="This page is not available for your account."
        title="Staff management unavailable"
      />
    );
  }

  const activeItems = state.items.filter(({ isActive }) => isActive);
  const inactiveItems = state.items.filter(({ isActive }) => !isActive);
  const visibleItems = showInactive ? state.items : activeItems;

  return (
    <section className="staff-page" aria-labelledby="staff-page-title">
      <PageHeader
        actions={state.items.length === 0 ? undefined : (
          <button className="staff-primary-action" disabled={pending} onClick={onAdd} type="button">
            Add staff
          </button>
        )}
        eyebrow="Account administration"
        status={(
          <>
            <strong>{activeItems.length}</strong>{" "}
            {activeItems.length === 1 ? "active account" : "active accounts"}
            {inactiveItems.length === 0
              ? " in the roster."
              : ` in the roster; ${inactiveItems.length} inactive ${
                  inactiveItems.length === 1 ? "account is" : "accounts are"
                } hidden.`}
          </>
        )}
        title="Manage Staff"
        titleId="staff-page-title"
      />

      {notice !== null ? <p className="staff-notice" role="status">{notice}</p> : null}

      {state.items.length === 0 ? (
        <EmptyState
          action={<button className="staff-primary-action" disabled={pending} onClick={onAdd} type="button">Add staff</button>}
          body="Add the people who need access, then assign their roles, offices, and producer rates."
          className="staff-empty"
          heading="No staff accounts"
        />
      ) : (
        <>
          <div className="staff-roster-toolbar">
            <p>
              Showing {showInactive ? "all staff" : "active staff"}
            </p>
            {inactiveItems.length === 0 ? null : (
              <button
                aria-pressed={showInactive}
                disabled={pending}
                onClick={() => setShowInactive((current) => !current)}
                type="button"
              >
                {showInactive
                  ? "Hide inactive"
                  : `Show inactive (${inactiveItems.length})`}
              </button>
            )}
          </div>
          {visibleItems.length === 0 ? (
            <EmptyState
              body="No active staff accounts are shown. Use Show inactive to review deactivated accounts."
              className="staff-empty is-compact"
              heading="No active staff"
            />
          ) : (
          <div className="staff-roster" role="list">
          {visibleItems.map((staff) => (
              <article className={`staff-row${staff.isActive ? "" : " is-inactive"}`} key={staff.userId} role="listitem">
                <div className="staff-row-main">
                  <header className="staff-card-header">
                    <div className="staff-identity">
                      <span className="staff-initials" aria-hidden="true">{initials(staff.displayName)}</span>
                      <div>
                        <h2>{staff.displayName}</h2>
                        <p>{staff.email}</p>
                      </div>
                    </div>
                    <div className="staff-badges" aria-label="Account classification">
                      <span className="is-role">{staffRoleLabel(staff.role)}</span>
                      <span className={staff.isActive ? "is-active" : "is-inactive"}>
                        {staff.isActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </header>
                  <div className="staff-card-details">
                    <div className="staff-card-detail">
                      <span>Office</span>
                      <strong>{staff.officeLocation?.name ?? "Not assigned"}</strong>
                    </div>
                    <StaffRateSummary staff={staff} />
                    {staff.passwordChangeRequired ? (
                      <p className="staff-password-state">
                        Password change required at next sign-in
                      </p>
                    ) : null}
                  </div>
                  <div className="staff-row-actions">
                    <button disabled={pending} onClick={() => onEdit(staff)} type="button">Edit</button>
                    {staff.rateState === "not_applicable" ? null : (
                      <button
                        disabled={pending}
                        onClick={() => onCompensation(staff)}
                        type="button"
                      >
                        Compensation
                      </button>
                    )}
                    <details className="staff-more-menu">
                      <summary>More</summary>
                      <div>
                        <button
                          disabled={pending}
                          onClick={() => onActive(staff, !staff.isActive)}
                          type="button"
                        >
                          {staff.isActive ? "Deactivate account" : "Reactivate account"}
                        </button>
                        {staff.userId === currentUserId ? null : (
                          <button
                            disabled={pending}
                            onClick={() => onTemporaryPassword(staff)}
                            type="button"
                          >
                            Issue temporary password
                          </button>
                        )}
                      </div>
                    </details>
                  </div>
                </div>
              </article>
          ))}
          </div>
          )}
        </>
      )}
    </section>
  );
}

function StaffRateSummary({
  staff,
}: {
  staff: AdminStaffRecord;
}) {
  if (staff.rateState === "not_applicable") return null;
  if (staff.rateState === "missing") {
    return (
      <p className="staff-rate-warning">
        No rates set. Pay Sheet will not calculate.
      </p>
    );
  }
  const rate = rateForCard(staff.rates);
  if (rate === null) return null;
  return (
    <div
      aria-label={`${staff.displayName} ${
        staff.rateState === "dormant" ? "dormant" : "current"
      } producer rates`}
      className={`staff-rate-summary${
        staff.rateState === "dormant" ? " is-dormant" : ""
      }`}
    >
      <div className="staff-rate-summary-heading">
        <span>
          {staff.rateState === "dormant"
            ? "Former producer rates"
            : "Current producer rates"}
        </span>
        <small>Effective {formatStaffDate(rate.effectiveDate)}</small>
      </div>
      <RateValue label="New commission" value={rate.newCommissionRate} />
      <RateValue label="New broker" value={rate.newBrokerRate} />
      <RateValue
        label="Renewal commission"
        value={rate.renewalCommissionRate}
      />
      <RateValue label="Renewal broker" value={rate.renewalBrokerRate} />
    </div>
  );
}

function RateValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{formatRate(value)}</strong>
    </div>
  );
}

function rateForCard(
  rates: readonly AdminStaffRecord["rates"][number][],
): AdminStaffRecord["rates"][number] | null {
  if (rates.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const sorted = newestRatesFirst(rates);
  return (
    sorted.find(({ effectiveDate }) => effectiveDate <= today) ??
    [...sorted].reverse()[0] ??
    null
  );
}

function StaffMessage({
  action,
  body,
  busy = false,
  title,
}: {
  action?: React.ReactNode;
  body: string;
  busy?: boolean;
  title: string;
}) {
  return (
    <section className="staff-message" aria-busy={busy || undefined}>
      <h1>{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "W";
}
