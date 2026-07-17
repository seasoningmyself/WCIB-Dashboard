import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  MY_COMMISSION_SORTS,
  type MyCommissionItem,
  type MyCommissionsListQuery,
  type MyCommissionsResponse,
} from "../../../shared/my-commissions.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import {
  createMyCommissionsApi,
  MyCommissionsApiError,
} from "./api.js";
import {
  formatCommissionMoney,
  formatReceiptDate,
  groupMyCommissionItems,
  isMyCommissionsProducer,
} from "./view-state.js";

export type MyCommissionsState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { data: MyCommissionsResponse; status: "ready" };

const INITIAL_QUERY: MyCommissionsListQuery = {
  search: "",
  sort: "insured",
};

export function MyCommissions({ user }: { user: CurrentUser }) {
  return isMyCommissionsProducer(user) ? (
    <ProducerMyCommissions />
  ) : (
    <CommissionMessage
      body="This page is not available for your account."
      title="My Commissions unavailable"
    />
  );
}

function ProducerMyCommissions() {
  const client = useApiClient();
  const api = useMemo(() => createMyCommissionsApi(client), [client]);
  const [query, setQuery] = useState<MyCommissionsListQuery>(INITIAL_QUERY);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<MyCommissionsState>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });
    try {
      const data = await api.list(query);
      if (requestVersion.current === version) {
        setState({ data, status: "ready" });
      }
    } catch (error) {
      if (requestVersion.current !== version) return;
      setState({
        status:
          error instanceof MyCommissionsApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api, query]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const clearSensitiveState = useCallback(() => {
    requestVersion.current += 1;
    setState({ status: "loading" });
    setNotice(null);
    pendingRef.current = null;
    setPendingId(null);
    setSearch("");
    setQuery(INITIAL_QUERY);
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const setReceipt = useCallback(
    async (item: MyCommissionItem, received: boolean) => {
      if (pendingRef.current !== null) return;
      pendingRef.current = item.id;
      setPendingId(item.id);
      setNotice(null);
      try {
        await api.setReceipt(item.id, { received });
        setNotice(received ? "Commission marked paid." : "Commission returned to owed.");
        await load();
      } catch (error) {
        if (error instanceof MyCommissionsApiError && error.kind === "denied") {
          requestVersion.current += 1;
          setState({ status: "denied" });
          setNotice(null);
        } else if (
          error instanceof MyCommissionsApiError &&
          error.kind === "conflict"
        ) {
          setNotice("That commission changed. The server view has been refreshed.");
          await load();
        } else {
          setNotice("The receipt change could not be completed. Try again.");
        }
      } finally {
        pendingRef.current = null;
        setPendingId(null);
      }
    },
    [api, load],
  );

  const updateSearch = (value: string) => {
    setNotice(null);
    setSearch(value);
    setQuery((current) => ({ ...current, search: value.trim() }));
  };

  return (
    <MyCommissionsView
      notice={notice}
      onReceipt={(item, received) => void setReceipt(item, received)}
      onRetry={() => void load()}
      onSearchChange={updateSearch}
      onSort={(sort) => {
        if (pendingRef.current !== null) return;
        setNotice(null);
        setQuery((current) => ({ ...current, sort }));
      }}
      pendingId={pendingId}
      query={query}
      search={search}
      state={state}
    />
  );
}

export function MyCommissionsView({
  notice,
  onReceipt,
  onRetry,
  onSearchChange,
  onSort,
  pendingId,
  query,
  search,
  state,
}: {
  notice: string | null;
  onReceipt(item: MyCommissionItem, received: boolean): void;
  onRetry(): void;
  onSearchChange(value: string): void;
  onSort(sort: MyCommissionsListQuery["sort"]): void;
  pendingId: string | null;
  query: MyCommissionsListQuery;
  search: string;
  state: MyCommissionsState;
}) {
  if (state.status === "loading") {
    return <CommissionMessage body="Retrieving your payout items..." busy title="Loading commissions" />;
  }
  if (state.status === "error") {
    return (
      <CommissionMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="Your commissions could not be loaded."
        title="My Commissions unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <CommissionMessage
        body="This page is not available for your account."
        title="My Commissions unavailable"
      />
    );
  }

  const sections = groupMyCommissionItems(state.data);
  return (
    <div className="my-commissions-page">
      <section
        className="my-commissions-screen-content"
        aria-labelledby="my-commissions-title"
      >
        <header className="my-commissions-header">
          <div>
            <p>Producer payout workspace</p>
            <h1 id="my-commissions-title">My Commissions</h1>
          </div>
          <span>Private to your account</span>
        </header>

        <div className="my-commissions-summary" aria-label="Commission summary">
          <CommissionMetric
            label="Owed to you"
            meta={`${state.data.summary.owedCount} item${state.data.summary.owedCount === 1 ? "" : "s"}`}
            tone="owed"
            value={formatCommissionMoney(state.data.summary.owedAmount)}
          />
          <CommissionMetric
            label="Paid last 30 days"
            meta={`${state.data.summary.paidLast30DaysCount} item${state.data.summary.paidLast30DaysCount === 1 ? "" : "s"}`}
            tone="paid"
            value={formatCommissionMoney(state.data.summary.paidLast30DaysAmount)}
          />
          <CommissionMetric
            label="In review"
            meta="Estimated until approved"
            tone="review"
            value={String(state.data.summary.inReviewCount)}
          />
        </div>

        <div className="my-commissions-toolbar">
          <form onSubmit={(event) => event.preventDefault()} role="search">
            <label htmlFor="commission-search">Search insured</label>
            <div className={search === "" ? undefined : "has-clear"}>
              <input
                autoComplete="off"
                id="commission-search"
                maxLength={200}
                onChange={(event) => onSearchChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onSearchChange("");
                  }
                }}
                placeholder="Insured name"
                type="search"
                value={search}
              />
              {search === "" ? null : (
                <button
                  aria-label="Clear commission search"
                  onClick={() => onSearchChange("")}
                  type="button"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
          <div className="my-commissions-sort" aria-label="Commission sort order">
            <span>Sort by</span>
            {MY_COMMISSION_SORTS.map((sort) => (
              <button
                aria-pressed={query.sort === sort}
                disabled={pendingId !== null}
                key={sort}
                onClick={() => onSort(sort)}
                type="button"
              >
                {sort === "insured" ? "Insured" : "Account"}
              </button>
            ))}
          </div>
        </div>

        {query.search === "" ? null : (
          <p className="my-commissions-filter-note">
            Showing results for <strong>{query.search}</strong>
          </p>
        )}
        {notice === null ? null : (
          <div className="my-commissions-notice" role="status">{notice}</div>
        )}

        {state.data.items.length === 0 ? (
          <div className="my-commissions-empty">
            <h2>{query.search === "" ? "No commission items yet" : "No matching commission items"}</h2>
            <p>
              {query.search === ""
                ? "Approved and submitted producer items will appear here."
                : "Try another insured name."}
            </p>
          </div>
        ) : (
          <div className="my-commissions-sections">
            <CommissionSection
              empty="No commissions are currently awaiting payment."
              items={sections.owed}
              onReceipt={onReceipt}
              pendingId={pendingId}
              title="Awaiting payment"
            />
            <CommissionSection
              empty="No submitted items are currently in review."
              items={sections.inReview}
              onReceipt={onReceipt}
              pendingId={pendingId}
              title="In review"
            />
            <CommissionSection
              empty="No commissions were marked paid in the last 30 days."
              items={sections.paid}
              onReceipt={onReceipt}
              pendingId={pendingId}
              title="Paid"
            />
          </div>
        )}
      </section>
      <p className="my-commissions-print-notice">
        Confidential commission details are available only in the secure WCIB Dashboard and are not included in printed output.
      </p>
    </div>
  );
}

function CommissionSection({
  empty,
  items,
  onReceipt,
  pendingId,
  title,
}: {
  empty: string;
  items: readonly MyCommissionItem[];
  onReceipt(item: MyCommissionItem, received: boolean): void;
  pendingId: string | null;
  title: string;
}) {
  return (
    <section className="my-commission-section" aria-label={title}>
      <header>
        <h2>{title}</h2>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="my-commission-section-empty">{empty}</p>
      ) : (
        <div className="my-commission-list">
          {items.map((item) => (
            <CommissionRow
              item={item}
              key={item.id}
              onReceipt={onReceipt}
              pending={pendingId === item.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CommissionRow({
  item,
  onReceipt,
  pending,
}: {
  item: MyCommissionItem;
  onReceipt(item: MyCommissionItem, received: boolean): void;
  pending: boolean;
}) {
  const receiptDate = formatReceiptDate(item.receivedAt);
  return (
    <article className="my-commission-row">
      <div className="my-commission-identity">
        <strong>{item.insuredName}</strong>
        <span>{item.policyType}</span>
      </div>
      <div className="my-commission-transaction">
        <span>{item.transactionType}</span>
        <small>{statusLabel(item)}</small>
      </div>
      <div className="my-commission-payout">
        <strong>{formatCommissionMoney(item.payout)}</strong>
        {item.estimate ? <span>Estimate</span> : null}
      </div>
      <div className="my-commission-receipt">
        {item.section === "owed" ? (
          <button
            disabled={pending}
            onClick={() => onReceipt(item, true)}
            type="button"
          >
            {pending ? "Saving..." : "Mark paid"}
          </button>
        ) : item.section === "paid" ? (
          <>
            <span>{receiptDate === null ? "Paid recently" : `Paid ${receiptDate}`}</span>
            <button
              disabled={pending}
              onClick={() => onReceipt(item, false)}
              type="button"
            >
              {pending ? "Saving..." : "Undo"}
            </button>
          </>
        ) : (
          <span>Awaiting admin review</span>
        )}
      </div>
    </article>
  );
}

function CommissionMetric({
  label,
  meta,
  tone,
  value,
}: {
  label: string;
  meta: string;
  tone: "owed" | "paid" | "review";
  value: string;
}) {
  return (
    <div className={`my-commission-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function CommissionMessage({
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
    <section className="my-commissions-message" aria-busy={busy || undefined}>
      <h1>{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function statusLabel(item: MyCommissionItem): string {
  if (item.status === "pending_approval") return "Pending approval";
  if (item.status === "received") return "Received";
  return "Awaiting payment";
}
