import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MyItemsResponse } from "../../../shared/my-items.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { createMyItemsApi, MyItemsApiError } from "./api.js";
import {
  MY_ITEM_FILTERS,
  countMyItems,
  filterMyItems,
  isEditableMyItem,
  isMyItemsStaff,
  myItemFilterLabel,
  myItemStatusLabel,
  type MyItemFilter,
} from "./view-state.js";

export type MyItemsState =
  | { status: "denied" }
  | { status: "error" }
  | { status: "loading" }
  | { data: MyItemsResponse; status: "ready" };

export function MyItems({ user }: { user: CurrentUser }) {
  return isMyItemsStaff(user) ? (
    <StaffMyItems />
  ) : (
    <MyItemsMessage
      body="This page is not available for your account."
      title="My Items unavailable"
    />
  );
}

function StaffMyItems() {
  const client = useApiClient();
  const api = useMemo(() => createMyItemsApi(client), [client]);
  const [filter, setFilter] = useState<MyItemFilter>("all");
  const [state, setState] = useState<MyItemsState>({ status: "loading" });
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setState({ status: "loading" });
    try {
      const data = await api.list();
      if (requestVersion.current === version) {
        setState({ data, status: "ready" });
      }
    } catch (error) {
      if (requestVersion.current !== version) return;
      setState({
        status:
          error instanceof MyItemsApiError && error.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
    };
  }, [load]);

  const clearSensitiveState = useCallback(() => {
    requestVersion.current += 1;
    setState({ status: "loading" });
    setFilter("all");
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  return (
    <MyItemsView
      filter={filter}
      onFilter={setFilter}
      onRetry={() => void load()}
      state={state}
    />
  );
}

export function MyItemsView({
  filter,
  onFilter,
  onRetry,
  state,
}: {
  filter: MyItemFilter;
  onFilter(filter: MyItemFilter): void;
  onRetry(): void;
  state: MyItemsState;
}) {
  if (state.status === "loading") {
    return (
      <MyItemsMessage
        body="Retrieving your latest turn-in statuses..."
        busy
        title="Loading My Items"
      />
    );
  }
  if (state.status === "error") {
    return (
      <MyItemsMessage
        action={<button onClick={onRetry} type="button">Try again</button>}
        body="Your turn-in statuses could not be loaded."
        title="My Items unavailable"
      />
    );
  }
  if (state.status === "denied") {
    return (
      <MyItemsMessage
        body="This page is not available for your account."
        title="My Items unavailable"
      />
    );
  }

  const counts = countMyItems(state.data.items);
  const visibleItems = filterMyItems(state.data.items, filter);
  return (
    <section className="my-items-page" aria-labelledby="my-items-title">
      <header className="my-items-header">
        <div>
          <p>Turn-in activity</p>
          <h1 id="my-items-title">My Items</h1>
        </div>
        <a href="#/turn-in">New turn-in</a>
      </header>

      {state.data.items.length === 0 ? (
        <div className="my-items-empty">
          <h2>No turn-ins yet</h2>
          <p>Saved drafts and submitted turn-ins will appear here.</p>
          <a href="#/turn-in">Start a turn-in</a>
        </div>
      ) : (
        <>
          <div className="my-items-filters" aria-label="My Items filters" role="tablist">
            {MY_ITEM_FILTERS.map((option) => (
              <button
                aria-selected={filter === option}
                key={option}
                onClick={() => onFilter(option)}
                role="tab"
                type="button"
              >
                <span>{myItemFilterLabel(option)}</span>
                <strong>{counts[option]}</strong>
              </button>
            ))}
          </div>

          {visibleItems.length === 0 ? (
            <div className="my-items-filter-empty">
              <h2>No {myItemFilterLabel(filter).toLocaleLowerCase("en-US")} items</h2>
              <p>Your other turn-ins are still available in the filters above.</p>
            </div>
          ) : (
            <div className="my-items-list">
              {visibleItems.map((item) => (
                <article className="my-item-row" key={item.id}>
                  <div className="my-item-status-line">
                    <span className={`draft-status is-${item.status}`}>
                      {myItemStatusLabel(item.status)}
                    </span>
                    <time dateTime={item.lastActivityAt}>
                      {formatTimestamp(item.lastActivityAt)}
                    </time>
                  </div>
                  <div className="my-item-main">
                    <div>
                      <h2>{item.title}</h2>
                      {item.submittedAt === null ? null : (
                        <p>
                          Submitted <time dateTime={item.submittedAt}>{formatTimestamp(item.submittedAt)}</time>
                        </p>
                      )}
                    </div>
                    {isEditableMyItem(item) ? (
                      <a href={`#/my-drafts?draft=${encodeURIComponent(item.id)}`}>
                        {item.status === "sent_back" ? "Review changes" : "Continue draft"}
                      </a>
                    ) : (
                      <span className="my-item-status-only">Status only</span>
                    )}
                  </div>
                  {item.reason === null ? null : (
                    <div className="my-item-reason">
                      <strong>{item.status === "sent_back" ? "Changes requested" : "Help request"}</strong>
                      <p>{item.reason}</p>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MyItemsMessage({
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
    <section
      className="my-items-message"
      aria-busy={busy}
      aria-labelledby="my-items-message-title"
    >
      <h1 id="my-items-message-title">{title}</h1>
      <p>{body}</p>
      {action}
    </section>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
