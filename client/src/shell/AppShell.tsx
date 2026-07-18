import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { CheckTurnInForm } from "../drafts/CheckTurnInForm.js";
import { MyDrafts } from "../drafts/MyDrafts.js";
import { ApprovalQueue } from "../approvals/ApprovalQueue.js";
import { HelpRequests } from "../approvals/HelpRequests.js";
import { PolicyLedger } from "../ledger/PolicyLedger.js";
import { MgaPayables } from "../mga-payables/MgaPayables.js";
import { PaySheets } from "../pay-sheets/PaySheets.js";
import { MyCommissions } from "../commissions/MyCommissions.js";
import { MyItems } from "../my-items/MyItems.js";
import { ManageStaff } from "../staff/ManageStaff.js";
import { OfficeLocationsSettings } from "../offices/OfficeLocationsSettings.js";
import { KpisGoals } from "../kpis/KpisGoals.js";
import { resolveDraftSelection } from "../drafts/my-drafts-state.js";
import { VocabularyProvider } from "../vocabulary/context.js";
import {
  resolveAuthorizedNavigation,
  resolveShellRoute,
  type ShellNavigationItem,
} from "./navigation.js";
import {
  loadNavigationCounts,
  visibleNavigationCount,
  type NavigationCounts,
} from "./navigation-counts.js";

interface AppShellProps {
  onLogout(): void;
  user: CurrentUser;
}

interface AppShellViewProps extends AppShellProps {
  currentPath: string;
  mainRef?: React.RefObject<HTMLElement>;
  navigationCounts?: NavigationCounts;
  onNavigate?(path: string): void;
}

export function AppShell({ onLogout, user }: AppShellProps) {
  const client = useApiClient();
  const [currentPath, setCurrentPath] = useState(readHashPath);
  const [navigationCounts, setNavigationCounts] =
    useState<NavigationCounts>({});
  const mainRef = useRef<HTMLElement>(null);
  const countRequestVersion = useRef(0);

  const refreshNavigationCounts = useCallback(async () => {
    const version = countRequestVersion.current + 1;
    countRequestVersion.current = version;
    const counts = await loadNavigationCounts(client, user);
    if (countRequestVersion.current === version) {
      setNavigationCounts(counts);
    }
  }, [client, user]);

  useEffect(() => {
    const handleHashChange = () => setCurrentPath(readHashPath());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    mainRef.current?.focus();
  }, [currentPath]);

  useEffect(() => {
    void refreshNavigationCounts();
    return () => {
      countRequestVersion.current += 1;
    };
  }, [currentPath, refreshNavigationCounts]);

  const clearSensitiveCounts = useCallback(() => {
    countRequestVersion.current += 1;
    setNavigationCounts({});
  }, []);
  useSensitiveSessionCleanup(clearSensitiveCounts);

  return (
    <AppShellView
      currentPath={currentPath}
      mainRef={mainRef}
      navigationCounts={navigationCounts}
      onNavigate={(path) => {
        window.location.hash = path;
        setCurrentPath(path);
      }}
      onLogout={onLogout}
      user={user}
    />
  );
}

export function AppShellView({
  currentPath,
  mainRef,
  navigationCounts = {},
  onNavigate,
  onLogout,
  user,
}: AppShellViewProps) {
  const navigation = useMemo(
    () => resolveAuthorizedNavigation(user.allowedNavigation),
    [user.allowedNavigation],
  );
  const route = resolveShellRoute(currentPath, navigation);
  const activeId = route.status === "ready" ? route.item.id : null;
  const name = user.displayName ?? user.email;

  const handleMobileNavigation = (event: ChangeEvent<HTMLSelectElement>) => {
    const selected = navigation.find(
      ({ id }) => id === event.currentTarget.value,
    );
    if (selected !== undefined) {
      onNavigate?.(selected.path);
    }
  };

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <a className="workspace-brand" href="#/" aria-label="WCIB Dashboard home">
          <span className="workspace-brand-mark">WCIB</span>
          <span className="workspace-brand-name">Dashboard</span>
        </a>
        <div className="workspace-user" aria-label="Current user">
          <span className="workspace-avatar" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="workspace-user-copy">
            <strong>{name}</strong>
            <span>{roleLabel(user.role)}</span>
          </span>
          <button
            className="workspace-logout"
            onClick={onLogout}
            type="button"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="workspace-body">
        <nav className="workspace-nav" aria-label="Primary navigation">
          <div className="workspace-nav-label">Workspace</div>
          {navigation.map((item) => {
            const count = visibleNavigationCount(
              navigationCounts,
              item.id,
            );
            return (
              <a
                aria-current={activeId === item.id ? "page" : undefined}
                className="workspace-nav-link"
                href={`#${item.path}`}
                key={item.id}
              >
                <span>{item.label}</span>
                {count === null ? null : (
                  <span
                    aria-label={`${count} items need attention`}
                    className="workspace-nav-count"
                  >
                    {count}
                  </span>
                )}
              </a>
            );
          })}
        </nav>

        <div className="workspace-mobile-nav">
          <label htmlFor="workspace-section">Workspace</label>
          <select
            id="workspace-section"
            onChange={handleMobileNavigation}
            value={activeId ?? ""}
          >
            {activeId === null ? <option value="">Select a page</option> : null}
            {navigation.map((item) => (
              <option key={item.id} value={item.id}>
                {mobileNavigationLabel(item, navigationCounts)}
              </option>
            ))}
          </select>
        </div>

        <main
          className="workspace-content"
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
        >
          <ShellContent currentPath={currentPath} route={route} user={user} />
        </main>
      </div>
    </div>
  );
}

function mobileNavigationLabel(
  item: ShellNavigationItem,
  counts: NavigationCounts,
): string {
  const count = visibleNavigationCount(counts, item.id);
  return count === null ? item.label : `${item.label} (${count})`;
}

function ShellContent({
  currentPath,
  route,
  user,
}: {
  currentPath: string;
  route: ReturnType<typeof resolveShellRoute>;
  user: CurrentUser;
}) {
  if (route.status === "ready") {
    if (route.item.id === "approvals") {
      return (
        <VocabularyProvider>
          <ApprovalQueue user={user} />
        </VocabularyProvider>
      );
    }
    if (route.item.id === "help_requests") {
      return (
        <VocabularyProvider>
          <HelpRequests user={user} />
        </VocabularyProvider>
      );
    }
    if (route.item.id === "turn_in") {
      return (
        <VocabularyProvider>
          <CheckTurnInForm user={user} />
        </VocabularyProvider>
      );
    }
    if (route.item.id === "my_items") {
      const draftSelection = resolveDraftSelection(currentPath);
      if (user.role !== "admin" && draftSelection.status === "list") {
        return <MyItems user={user} />;
      }
      return (
        <VocabularyProvider>
          <MyDrafts currentPath={currentPath} user={user} />
        </VocabularyProvider>
      );
    }
    if (route.item.id === "policy_ledger") {
      return (
        <VocabularyProvider>
          <PolicyLedger user={user} />
        </VocabularyProvider>
      );
    }
    if (route.item.id === "mga_payables") {
      return <MgaPayables user={user} />;
    }
    if (route.item.id === "pay_sheets") {
      return (
        <VocabularyProvider>
          <PaySheets user={user} />
        </VocabularyProvider>
      );
    }
    if (route.item.id === "my_commissions") {
      return <MyCommissions user={user} />;
    }
    if (route.item.id === "manage_staff") {
      return <ManageStaff user={user} />;
    }
    if (route.item.id === "settings") {
      return <OfficeLocationsSettings user={user} />;
    }
    if (route.item.id === "kpis") {
      return <KpisGoals user={user} />;
    }
    return (
      <section className="workspace-page" aria-labelledby="workspace-page-title">
        <header className="workspace-page-header">
          <p>WCIB workspace</p>
          <h1 id="workspace-page-title">{route.item.label}</h1>
        </header>
      </section>
    );
  }
  if (route.status === "empty") {
    return (
      <section className="workspace-message" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title">Workspace access unavailable</h1>
        <p>Your account has no assigned workspace pages.</p>
      </section>
    );
  }
  return (
    <section className="workspace-message" aria-labelledby="workspace-missing-title">
      <h1 id="workspace-missing-title">Page not available</h1>
      <p>Choose an available page from the navigation.</p>
    </section>
  );
}

function readHashPath(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  const value = window.location.hash.slice(1);
  return value === "" ? "/" : value;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "W";
}

function roleLabel(role: CurrentUser["role"]): string {
  switch (role) {
    case "admin":
      return "Administrator";
    case "employee":
      return "Employee";
    case "producer":
      return "Producer";
    case null:
      return "Account";
  }
}
