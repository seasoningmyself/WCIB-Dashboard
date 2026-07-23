import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  policyTypeClassLabel,
  type PolicyTypeClass,
} from "../../../shared/policy-types.js";
import type {
  AdminPolicyTypeItem,
  AdminVocabularyItem,
  AdminVocabularyKind,
  AdminVocabularyManagementResponse,
} from "../../../shared/vocabulary.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import {
  AdminVocabularyApiError,
  createAdminVocabularyApi,
} from "../vocabulary/admin-api.js";
import {
  createVocabularyMutationApi,
  VocabularyMutationApiError,
} from "../vocabulary/mutation-api.js";

export type VocabularyManagementState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { data: AdminVocabularyManagementResponse; status: "ready" };

export function VocabularyManagement() {
  const client = useApiClient();
  const adminApi = useMemo(() => createAdminVocabularyApi(client), [client]);
  const mutationApi = useMemo(
    () => createVocabularyMutationApi(client),
    [client],
  );
  const [state, setState] = useState<VocabularyManagementState>({
    status: "loading",
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    try {
      const data = await adminApi.list();
      if (requestVersion.current === version) {
        setState({ data, status: "ready" });
      }
    } catch (error) {
      if (requestVersion.current !== version) return;
      setState({
        status:
          error instanceof AdminVocabularyApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [adminApi]);

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
    setNotice(null);
    setState({ status: "loading" });
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const run = useCallback(
    async (operation: () => Promise<string>) => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPending(true);
      setNotice(null);
      try {
        setNotice(await operation());
        await load();
      } catch (error) {
        if (
          (error instanceof AdminVocabularyApiError &&
            error.kind === "denied") ||
          (error instanceof VocabularyMutationApiError &&
            error.kind === "forbidden")
        ) {
          setState({ status: "denied" });
        } else if (
          error instanceof AdminVocabularyApiError &&
          error.kind === "conflict"
        ) {
          setNotice("That entry is used by the active ledger and remains available.");
          await load();
        } else {
          setNotice("The vocabulary change could not be completed.");
        }
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [load],
  );

  const createCarrier = useCallback(
    async (name: string) => {
      let clear = false;
      await run(async () => {
        const result = await mutationApi.createCarrier({ name });
        clear = result.outcome === "created";
        return result.outcome === "created"
          ? "Insurance company added."
          : "That insurance company is already on the list.";
      });
      return clear;
    },
    [mutationApi, run],
  );

  const createMga = useCallback(
    async (name: string) => {
      let clear = false;
      await run(async () => {
        let result = await mutationApi.createMga({
          confirmNearDuplicate: false,
          name,
        });
        if (result.outcome === "confirmation_required") {
          const candidates = result.candidates.map((item) => item.name).join(", ");
          if (
            !window.confirm(
              `This looks similar to ${candidates}. Add ${name} anyway?`,
            )
          ) {
            return "MGA addition cancelled; no entry was created.";
          }
          result = await mutationApi.createMga({
            confirmNearDuplicate: true,
            name,
          });
        }
        clear = result.outcome === "created";
        return result.outcome === "created"
          ? "MGA added."
          : "That MGA is already on the list.";
      });
      return clear;
    },
    [mutationApi, run],
  );

  const createPolicyType = useCallback(
    async (name: string, classTag: PolicyTypeClass) => {
      let clear = false;
      await run(async () => {
        const result = await mutationApi.createPolicyType({ classTag, name });
        clear = result.outcome === "created";
        return result.outcome === "created"
          ? "Policy type added."
          : "That policy type is already on the list.";
      });
      return clear;
    },
    [mutationApi, run],
  );

  const setActive = useCallback(
    async (
      kind: AdminVocabularyKind,
      item: AdminVocabularyItem,
      active: boolean,
    ) => {
      if (
        !active &&
        !window.confirm(
          `Deactivate ${item.name}? It will leave new turn-in pickers but historical records stay unchanged.`,
        )
      ) {
        return;
      }
      await run(async () => {
        const data = await adminApi.setActive(kind, item.id, { active });
        setState({ data, status: "ready" });
        return active ? "Vocabulary entry reactivated." : "Vocabulary entry deactivated.";
      });
    },
    [adminApi, run],
  );

  return (
    <VocabularyManagementView
      notice={notice}
      onAddCarrier={createCarrier}
      onAddMga={createMga}
      onAddPolicyType={createPolicyType}
      onRetry={() => {
        setState({ status: "loading" });
        void load();
      }}
      onSetActive={(kind, item, active) =>
        void setActive(kind, item, active)}
      pending={pending}
      state={state}
    />
  );
}

export function VocabularyManagementView({
  notice,
  onAddCarrier,
  onAddMga,
  onAddPolicyType,
  onRetry,
  onSetActive,
  pending,
  state,
}: {
  notice: string | null;
  onAddCarrier(name: string): Promise<boolean>;
  onAddMga(name: string): Promise<boolean>;
  onAddPolicyType(name: string, classTag: PolicyTypeClass): Promise<boolean>;
  onRetry(): void;
  onSetActive(
    kind: AdminVocabularyKind,
    item: AdminVocabularyItem,
    active: boolean,
  ): void;
  pending: boolean;
  state: VocabularyManagementState;
}) {
  const [kind, setKind] = useState<AdminVocabularyKind>("carrier");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<"active" | "inactive">(
    "active",
  );
  const [page, setPage] = useState(1);

  if (state.status === "loading") {
    return <VocabularyMessage body="Loading managed lists..." title="Vocabulary" />;
  }
  if (state.status === "error") {
    return (
      <VocabularyMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="Managed vocabulary could not be loaded."
        title="Vocabulary unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <VocabularyMessage
        body="This section is restricted to administrators."
        title="Vocabulary unavailable"
      />
    );
  }

  const config = vocabularySectionConfig(state.data, kind);
  const filteredItems = filterVocabularyItems(
    config.items,
    search,
    stateFilter,
  );
  const pageCount = Math.max(
    1,
    Math.ceil(filteredItems.length / VOCABULARY_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const pageItems = filteredItems.slice(
    (currentPage - 1) * VOCABULARY_PAGE_SIZE,
    currentPage * VOCABULARY_PAGE_SIZE,
  );
  const activeItems = config.items.filter(({ isActive }) => isActive).length;
  const inactiveItems = config.items.length - activeItems;
  const changeKind = (nextKind: AdminVocabularyKind) => {
    setKind(nextKind);
    setSearch("");
    setStateFilter("active");
    setPage(1);
  };
  const changeStateFilter = (next: "active" | "inactive") => {
    setStateFilter(next);
    setPage(1);
  };

  return (
    <section className="staff-vocabulary" aria-labelledby="staff-vocabulary-title">
      <header>
        <div>
          <p>Turn-in configuration</p>
          <h2 id="staff-vocabulary-title">Managed vocabulary</h2>
        </div>
        <span>{activeCount(state.data)} active entries</span>
      </header>
      {notice !== null ? <p className="staff-notice" role="status">{notice}</p> : null}
      <div
        aria-label="Managed vocabulary categories"
        className="staff-vocabulary-tabs"
        role="tablist"
      >
        {(
          [
            ["carrier", "Insurance companies"],
            ["mga", "MGA / payees"],
            ["policy_type", "Policy types"],
          ] as const
        ).map(([value, label]) => (
          <button
            aria-selected={kind === value}
            className={kind === value ? "is-active" : undefined}
            key={value}
            onClick={() => changeKind(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="staff-vocabulary-sections">
        <VocabularySection
          activeCount={activeItems}
          inactiveCount={inactiveItems}
          items={pageItems}
          kind={kind}
          onNext={() => setPage((current) => Math.min(pageCount, current + 1))}
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          onSetActive={onSetActive}
          onStateFilter={changeStateFilter}
          page={currentPage}
          pageCount={pageCount}
          pending={pending}
          searchAdd={(
            <VocabularySearchAdd
              disabled={pending}
              items={config.items}
              key={kind}
              kind={kind}
              onAddCarrier={onAddCarrier}
              onAddMga={onAddMga}
              onAddPolicyType={onAddPolicyType}
              onQuery={(value) => {
                setSearch(value);
                setPage(1);
              }}
              query={search}
              title={config.title}
            />
          )}
          stateFilter={stateFilter}
          title={config.title}
          totalShown={filteredItems.length}
        />
      </div>
    </section>
  );
}

function VocabularySection({
  activeCount,
  inactiveCount,
  items,
  kind,
  onNext,
  onPrevious,
  onSetActive,
  onStateFilter,
  page,
  pageCount,
  pending,
  searchAdd,
  stateFilter,
  title,
  totalShown,
}: {
  activeCount: number;
  inactiveCount: number;
  items: readonly (AdminVocabularyItem | AdminPolicyTypeItem)[];
  kind: AdminVocabularyKind;
  onNext(): void;
  onPrevious(): void;
  onSetActive(
    kind: AdminVocabularyKind,
    item: AdminVocabularyItem,
    active: boolean,
  ): void;
  onStateFilter(value: "active" | "inactive"): void;
  page: number;
  pageCount: number;
  pending: boolean;
  searchAdd: React.ReactNode;
  stateFilter: "active" | "inactive";
  title: string;
  totalShown: number;
}) {
  return (
    <section className="staff-vocabulary-section">
      <header>
        <h3>{title}</h3>
        <span>{totalShown} shown</span>
      </header>
      {searchAdd}
      <div
        aria-label={`${title} status`}
        className="staff-vocabulary-state-tabs"
        role="tablist"
      >
        <button
          aria-selected={stateFilter === "active"}
          className={stateFilter === "active" ? "is-active" : undefined}
          onClick={() => onStateFilter("active")}
          role="tab"
          type="button"
        >
          Active ({activeCount})
        </button>
        <button
          aria-selected={stateFilter === "inactive"}
          className={stateFilter === "inactive" ? "is-active" : undefined}
          onClick={() => onStateFilter("inactive")}
          role="tab"
          type="button"
        >
          Inactive ({inactiveCount})
        </button>
      </div>
      <div className="staff-vocabulary-list" role="list">
        {items.length === 0 ? (
          <p>No matches</p>
        ) : (
          items.map((item) => (
            <div className={`staff-vocabulary-row${item.isActive ? "" : " is-inactive"}`} key={item.id} role="listitem">
              <div>
                <strong>{item.name}</strong>
                {"classTag" in item ? (
                  <span className={`staff-vocabulary-class is-${item.classTag.toLowerCase()}`}>
                    {policyTypeClassLabel(item.classTag)}
                  </span>
                ) : null}
              </div>
              <div className="staff-vocabulary-state">
                <span>{item.isActive ? "Active" : "Inactive"}</span>
                {item.inUse ? <span className="is-in-use">In use</span> : null}
              </div>
              <button
                disabled={pending || (item.isActive && item.inUse)}
                onClick={() => onSetActive(kind, item, !item.isActive)}
                title={item.isActive && item.inUse ? "Used by the active ledger" : undefined}
                type="button"
              >
                {item.isActive ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ))
        )}
      </div>
      <footer className="staff-vocabulary-pagination">
        <span>
          Page {page} of {pageCount}
        </span>
        <div>
          <button
            disabled={pending || page === 1}
            onClick={onPrevious}
            type="button"
          >
            Previous
          </button>
          <button
            disabled={pending || page === pageCount}
            onClick={onNext}
            type="button"
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );
}

function VocabularySearchAdd({
  disabled,
  items,
  kind,
  onAddCarrier,
  onAddMga,
  onAddPolicyType,
  onQuery,
  query,
  title,
}: {
  disabled: boolean;
  items: readonly (AdminVocabularyItem | AdminPolicyTypeItem)[];
  kind: AdminVocabularyKind;
  onAddCarrier(name: string): Promise<boolean>;
  onAddMga(name: string): Promise<boolean>;
  onAddPolicyType(name: string, classTag: PolicyTypeClass): Promise<boolean>;
  onQuery(value: string): void;
  query: string;
  title: string;
}) {
  const [classTag, setClassTag] = useState<PolicyTypeClass>("Commercial");
  const name = query.trim();
  const exactMatch = findVocabularyExactMatch(items, query);
  const canAdd = name !== "" && exactMatch === null;
  const add = async () => {
    const created =
      kind === "carrier"
        ? await onAddCarrier(name)
        : kind === "mga"
          ? await onAddMga(name)
          : await onAddPolicyType(name, classTag);
    if (created) {
      onQuery("");
    }
  };

  return (
    <div className="staff-vocabulary-search-add">
      <label>
        <span>Search or add {title.toLowerCase()}</span>
        <input
          disabled={disabled}
          maxLength={200}
          onChange={(event) => onQuery(event.currentTarget.value)}
          placeholder={`Search or add ${title.toLowerCase()}`}
          type="search"
          value={query}
        />
      </label>
      {canAdd ? (
        <div className="staff-vocabulary-search-add-actions">
          {kind === "policy_type" ? (
            <select
              aria-label="Policy type class"
              disabled={disabled}
              onChange={(event) =>
                setClassTag(event.currentTarget.value as PolicyTypeClass)}
              value={classTag}
            >
              <option value="Personal">Personal</option>
              <option value="Commercial">Commercial</option>
              <option value="Life-Health">Health</option>
            </select>
          ) : null}
          <button
            disabled={disabled}
            onClick={() => void add()}
            type="button"
          >
            {kind === "carrier"
              ? "Add company"
              : kind === "mga"
                ? "Add MGA"
                : "Add policy type"}
          </button>
        </div>
      ) : exactMatch === null ? null : (
        <p className="staff-vocabulary-existing">
          {exactMatch.name} already exists under{" "}
          {exactMatch.isActive ? "Active" : "Inactive"}.
        </p>
      )}
    </div>
  );
}

function VocabularyMessage({
  action,
  body,
  title,
}: {
  action?: React.ReactNode;
  body: string;
  title: string;
}) {
  return (
    <section className="staff-vocabulary-message">
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}

const VOCABULARY_PAGE_SIZE = 25;

export function filterVocabularyItems<T extends AdminVocabularyItem>(
  items: readonly T[],
  query: string,
  stateFilter: "active" | "inactive",
): readonly T[] {
  const normalized = query.trim().toLocaleLowerCase();
  return items.filter(
    ({ isActive, name }) =>
      isActive === (stateFilter === "active") &&
      (normalized === "" ||
        name.toLocaleLowerCase().includes(normalized)),
  );
}

export function findVocabularyExactMatch<T extends AdminVocabularyItem>(
  items: readonly T[],
  query: string,
): T | null {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized === "") {
    return null;
  }
  return (
    items.find(
      ({ name }) => name.trim().toLocaleLowerCase() === normalized,
    ) ?? null
  );
}

function activeCount(data: AdminVocabularyManagementResponse): number {
  return [...data.carriers, ...data.mgas, ...data.policyTypes].filter(
    ({ isActive }) => isActive,
  ).length;
}

function vocabularySectionConfig(
  data: AdminVocabularyManagementResponse,
  kind: AdminVocabularyKind,
): {
  items: readonly (AdminVocabularyItem | AdminPolicyTypeItem)[];
  title: string;
} {
  switch (kind) {
    case "carrier":
      return { items: data.carriers, title: "Insurance companies" };
    case "mga":
      return { items: data.mgas, title: "MGA / payees" };
    case "policy_type":
      return { items: data.policyTypes, title: "Policy types" };
  }
}
