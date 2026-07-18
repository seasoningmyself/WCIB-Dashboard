import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  AdminStaffRecord,
  CreateAdminStaffRequest,
  ProducerRateInput,
  UpdateAdminStaffRequest,
} from "../../../shared/admin-staff.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import {
  ActiveDialogState,
  RateEditorDialog,
  StaffActiveDialog,
  StaffEditorDialog,
  type RateDialogState,
  type StaffDialogState,
} from "./StaffDialogs.js";
import { AdminStaffApiError, createAdminStaffApi } from "./api.js";
import { VocabularyManagement } from "./VocabularyManagement.js";
import {
  formatRate,
  formatStaffDate,
  formatStaffTimestamp,
  isManageStaffAdmin,
  newestRatesFirst,
  staffRateStateLabel,
  staffRoleLabel,
} from "./view-state.js";

export type ManageStaffState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { items: readonly AdminStaffRecord[]; status: "ready" };

export function ManageStaff({ user }: { user: CurrentUser }) {
  return isManageStaffAdmin(user) ? (
    <AdminManageStaff />
  ) : (
    <StaffMessage
      body="This page is not available for your account."
      title="Staff management unavailable"
    />
  );
}

function AdminManageStaff() {
  const client = useApiClient();
  const api = useMemo(() => createAdminStaffApi(client), [client]);
  const [state, setState] = useState<ManageStaffState>({ status: "loading" });
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [staffDialog, setStaffDialog] = useState<StaffDialogState | null>(null);
  const [rateDialog, setRateDialog] = useState<RateDialogState | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialogState | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(
    async (showLoading = true) => {
      const version = requestVersion.current + 1;
      requestVersion.current = version;
      if (showLoading) setState({ status: "loading" });
      try {
        const items = await api.list();
        if (requestVersion.current === version) {
          setState({ items, status: "ready" });
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
    [api],
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
    setExpandedUserId(null);
    setStaffDialog(null);
    setRateDialog(null);
    setActiveDialog(null);
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

  const updateStaff = async (userId: string, input: UpdateAdminStaffRequest) => {
    if (!beginMutation()) return;
    try {
      await api.update(userId, input);
      setStaffDialog(null);
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
        expandedUserId={expandedUserId}
        notice={notice}
        onActive={(staff, active) => {
          setDialogError(null);
          setActiveDialog({ active, staff });
        }}
        onAdd={() => {
          setDialogError(null);
          setStaffDialog({ kind: "create" });
        }}
        onAddRate={(staff) => {
          setDialogError(null);
          setRateDialog({ kind: "create", staff });
        }}
        onCorrectRate={(staff, rate) => {
          setDialogError(null);
          setRateDialog({ kind: "edit", rate, staff });
        }}
        onEdit={(staff) => {
          setDialogError(null);
          setStaffDialog({ kind: "edit", staff });
        }}
        onRetry={() => void load()}
        onToggle={(userId) =>
          setExpandedUserId((current) => (current === userId ? null : userId))
        }
        pending={pending}
        state={state}
        vocabulary={<VocabularyManagement />}
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
        onCreate={(input) => void createStaff(input)}
        onUpdate={(userId, input) => void updateStaff(userId, input)}
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
    </>
  );
}

export function ManageStaffView({
  expandedUserId,
  notice,
  onActive,
  onAdd,
  onAddRate,
  onCorrectRate,
  onEdit,
  onRetry,
  onToggle,
  pending,
  state,
  vocabulary,
}: {
  expandedUserId: string | null;
  notice: string | null;
  onActive(staff: AdminStaffRecord, active: boolean): void;
  onAdd(): void;
  onAddRate(staff: AdminStaffRecord): void;
  onCorrectRate(staff: AdminStaffRecord, rate: AdminStaffRecord["rates"][number]): void;
  onEdit(staff: AdminStaffRecord): void;
  onRetry(): void;
  onToggle(userId: string): void;
  pending: boolean;
  state: ManageStaffState;
  vocabulary?: React.ReactNode;
}) {
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

  return (
    <section className="staff-page" aria-labelledby="staff-page-title">
      <header className="staff-page-header">
        <div>
          <p>Account administration</p>
          <h1 id="staff-page-title">Manage Staff</h1>
        </div>
        <button className="staff-primary-action" disabled={pending} onClick={onAdd} type="button">
          Add staff
        </button>
      </header>

      {notice !== null ? <p className="staff-notice" role="status">{notice}</p> : null}

      {state.items.length === 0 ? (
        <div className="staff-empty">
          <h2>No staff accounts yet</h2>
          <p>Add the first employee or producer account.</p>
        </div>
      ) : (
        <div className="staff-roster" role="list">
          {state.items.map((staff) => {
            const expanded = expandedUserId === staff.userId;
            return (
              <article className={`staff-row${staff.isActive ? "" : " is-inactive"}`} key={staff.userId} role="listitem">
                <div className="staff-row-main">
                  <div className="staff-identity">
                    <span className="staff-initials" aria-hidden="true">{initials(staff.displayName)}</span>
                    <div>
                      <h2>{staff.displayName}</h2>
                      <p>{staff.email}</p>
                    </div>
                  </div>
                  <div className="staff-badges" aria-label="Account classification">
                    <span>{staffRoleLabel(staff.role)}</span>
                    <span className={staff.isActive ? "is-active" : "is-inactive"}>
                      {staff.isActive ? "Active" : "Inactive"}
                    </span>
                    {staff.rateState === "not_applicable" ? null : (
                      <span className={`is-rate-${staff.rateState}`}>
                        {staffRateStateLabel(staff.rateState)}
                      </span>
                    )}
                  </div>
                  <div className="staff-row-actions">
                    <button disabled={pending} onClick={() => onEdit(staff)} type="button">Edit</button>
                    <button disabled={pending} onClick={() => onActive(staff, !staff.isActive)} type="button">
                      {staff.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                    {staff.rateState === "not_applicable" ? null : (
                      <button
                        aria-expanded={expanded}
                        disabled={pending}
                        onClick={() => onToggle(staff.userId)}
                        type="button"
                      >
                        {expanded ? "Hide rates" : "Rate history"}
                      </button>
                    )}
                  </div>
                </div>
                {expanded && staff.rateState !== "not_applicable" ? (
                  <RateHistory
                    onAdd={() => onAddRate(staff)}
                    onCorrect={(rate) => onCorrectRate(staff, rate)}
                    pending={pending}
                    staff={staff}
                  />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      {vocabulary}
    </section>
  );
}

function RateHistory({
  onAdd,
  onCorrect,
  pending,
  staff,
}: {
  onAdd(): void;
  onCorrect(rate: AdminStaffRecord["rates"][number]): void;
  pending: boolean;
  staff: AdminStaffRecord;
}) {
  const rates = newestRatesFirst(staff.rates);
  return (
    <section className="staff-rates" aria-label={`${staff.displayName} producer rate history`}>
      <header>
        <div>
          <h3>Producer rate history</h3>
          <p>
            {staff.role === "producer"
              ? "New rows become immutable after a closed pay sheet snapshots them."
              : "This history is dormant while the account remains an employee."}
          </p>
        </div>
        {staff.role === "producer" ? (
          <button disabled={pending} onClick={onAdd} type="button">Add rate</button>
        ) : null}
      </header>
      {rates.length === 0 ? (
        <p className="staff-rates-empty">
          {staff.role === "producer"
            ? "No rate configured. Add an explicit effective rate before payout work."
            : "No producer rate history."}
        </p>
      ) : (
        <div className="staff-rate-table-wrap">
          <table className="staff-rate-table">
            <thead>
              <tr>
                <th>Effective</th>
                <th>New commission</th>
                <th>New broker</th>
                <th>Renewal commission</th>
                <th>Renewal broker</th>
                <th>State</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id}>
                  <td>{formatStaffDate(rate.effectiveDate)}</td>
                  <td>{formatRate(rate.newCommissionRate)}</td>
                  <td>{formatRate(rate.newBrokerRate)}</td>
                  <td>{formatRate(rate.renewalCommissionRate)}</td>
                  <td>{formatRate(rate.renewalBrokerRate)}</td>
                  <td>
                    {rate.lockedAt === null ? (
                      <span className="staff-rate-state is-open">Unlocked</span>
                    ) : (
                      <span className="staff-rate-state is-locked" title={`Locked ${formatStaffTimestamp(rate.lockedAt)}`}>
                        Locked
                      </span>
                    )}
                  </td>
                  <td>
                    {rate.lockedAt === null && staff.role === "producer" ? (
                      <button disabled={pending} onClick={() => onCorrect(rate)} type="button">Correct</button>
                    ) : (
                      <span className="staff-rate-immutable">Read only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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
