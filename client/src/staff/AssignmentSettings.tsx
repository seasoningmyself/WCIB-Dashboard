import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AdminStaffRecord,
  UpdateAdminStaffRequest,
} from "../../../shared/admin-staff.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { AssignmentManagement } from "./AssignmentManagement.js";
import { AdminStaffApiError, createAdminStaffApi } from "./api.js";
import { isManageStaffAdmin } from "./view-state.js";

type AssignmentSettingsState =
  | { status: "denied" | "error" | "loading" }
  | { items: readonly AdminStaffRecord[]; status: "ready" };

export function AssignmentSettings({ user }: { user: CurrentUser }) {
  if (!isManageStaffAdmin(user)) {
    return <AssignmentSettingsMessage kind="denied" />;
  }
  return <AssignmentSettingsController />;
}

function AssignmentSettingsController() {
  const client = useApiClient();
  const api = useMemo(() => createAdminStaffApi(client), [client]);
  const [state, setState] = useState<AssignmentSettingsState>({
    status: "loading",
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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
      } catch (caught) {
        if (requestVersion.current !== version) return;
        setState({
          status:
            caught instanceof AdminStaffApiError && caught.kind === "denied"
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

  const clear = useCallback(() => {
    requestVersion.current += 1;
    setState({ status: "loading" });
    setNotice(null);
    setError(null);
    setPending(false);
  }, []);
  useSensitiveSessionCleanup(clear);

  if (state.status !== "ready") {
    return (
      <AssignmentSettingsMessage
        kind={state.status}
        onRetry={() => void load()}
      />
    );
  }

  const update = async (
    staff: AdminStaffRecord,
    input: UpdateAdminStaffRequest,
  ) => {
    if (pending) return;
    setPending(true);
    setNotice(null);
    setError(null);
    try {
      const updated = await api.update(staff.userId, input);
      setState((current) =>
        current.status === "ready"
          ? {
              items: current.items.map((item) =>
                item.userId === updated.userId ? updated : item,
              ),
              status: "ready",
            }
          : current,
      );
      setNotice(`Assignment options updated for ${updated.displayName}.`);
    } catch (caught) {
      if (caught instanceof AdminStaffApiError && caught.kind === "denied") {
        setState({ status: "denied" });
      } else if (
        caught instanceof AdminStaffApiError &&
        caught.kind === "conflict"
      ) {
        setError("That staff account changed. The current roster was reloaded.");
        await load(false);
      } else {
        setError("Assignment options could not be updated. Try again.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="agency-assignment-settings">
      {notice === null ? null : (
        <p className="settings-notice" role="status">{notice}</p>
      )}
      {error === null ? null : (
        <p className="settings-error" role="alert">{error}</p>
      )}
      <AssignmentManagement
        onUpdate={(staff, input) => void update(staff, input)}
        pending={pending}
        staff={state.items}
      />
    </div>
  );
}

function AssignmentSettingsMessage({
  kind,
  onRetry,
}: {
  kind: "denied" | "error" | "loading";
  onRetry?(): void;
}) {
  const copy =
    kind === "loading"
      ? {
          body: "Loading the producer choices available on new turn-ins.",
          title: "Loading assignment options",
        }
      : kind === "denied"
        ? {
            body: "This section is restricted to administrators.",
            title: "Assignment settings unavailable",
          }
        : {
            body: "Assignment options could not be loaded.",
            title: "Assignment settings unavailable",
          };
  return (
    <section className="settings-message" aria-labelledby="assignment-settings-message">
      <h2 id="assignment-settings-message">{copy.title}</h2>
      <p>{copy.body}</p>
      {kind === "error" && onRetry !== undefined ? (
        <button onClick={onRetry} type="button">Try again</button>
      ) : null}
    </section>
  );
}
