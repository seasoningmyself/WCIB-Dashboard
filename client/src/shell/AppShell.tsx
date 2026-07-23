import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { CheckTurnInForm } from "../drafts/CheckTurnInForm.js";
import { MyDrafts } from "../drafts/MyDrafts.js";
import { ApprovalQueue } from "../approvals/ApprovalQueue.js";
import { HelpRequests } from "../approvals/HelpRequests.js";
import { ReviewQueueTabs } from "../approvals/ReviewQueueTabs.js";
import { PolicyLedger } from "../ledger/PolicyLedger.js";
import { MgaPayables } from "../mga-payables/MgaPayables.js";
import { PaySheets } from "../pay-sheets/PaySheets.js";
import { MyCommissions } from "../commissions/MyCommissions.js";
import { MyItems } from "../my-items/MyItems.js";
import { ManageStaff } from "../staff/ManageStaff.js";
import { SettingsSurface } from "../settings/AccountSettings.js";
import { KpisGoals } from "../kpis/KpisGoals.js";
import { SupportDashboard } from "../support/SupportDashboard.js";
import { PageHeader } from "../ui/PageHeader.js";
import { resolveDraftSelection } from "../drafts/my-drafts-state.js";
import { VocabularyProvider } from "../vocabulary/context.js";
import {
  activeNavigationId,
  groupAuthorizedNavigation,
  resolveAuthorizedNavigation,
  resolveShellRoute,
  type ShellNavigationGroup,
  type ShellNavigationItem,
} from "./navigation.js";
import {
  loadNavigationCounts,
  reviewQueueNavigationCount,
  visibleNavigationCount,
  type NavigationCounts,
} from "./navigation-counts.js";

interface AppShellProps {
  onLogout(): void;
  onUserChanged?(user: CurrentUser): void;
  user: CurrentUser;
}

interface AppShellViewProps extends AppShellProps {
  currentPath: string;
  mainRef?: React.RefObject<HTMLElement>;
  navigationCounts?: NavigationCounts;
  onNavigate?(path: string): void;
}

export function AppShell({ onLogout, onUserChanged, user }: AppShellProps) {
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
      onUserChanged={(nextUser) => onUserChanged?.(nextUser)}
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
  onUserChanged,
  user,
}: AppShellViewProps) {
  const navigation = useMemo(
    () => resolveAuthorizedNavigation(user.allowedNavigation),
    [user.allowedNavigation],
  );
  const navigationGroups = useMemo(
    () => groupAuthorizedNavigation(navigation),
    [navigation],
  );
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const route = resolveShellRoute(currentPath, navigation);
  const activeId =
    route.status === "ready"
      ? activeNavigationId(route.item.id, navigation)
      : null;
  const name = user.displayName ?? user.email;

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const panel = mobilePanelRef.current;
    const focusable = () => Array.from(
      panel?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavigationOpen(false);
        mobileMenuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavigationOpen]);

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <WorkspaceBrand />
        <GroupedNavigation
          activeId={activeId}
          counts={navigationCounts}
          groups={navigationGroups}
          label="Primary navigation"
        />
        <WorkspaceUser capabilities={user.capabilities} name={name} onLogout={onLogout} role={user.role} />
      </aside>

      <div className="workspace-main">
        <header className="workspace-mobile-header">
          <WorkspaceBrand />
          <button
            aria-controls="workspace-mobile-panel"
            aria-expanded={mobileNavigationOpen}
            aria-label={`${mobileNavigationOpen ? "Close" : "Open"} navigation and account menu`}
            className="workspace-mobile-menu-button"
            onClick={() => setMobileNavigationOpen((open) => !open)}
            ref={mobileMenuButtonRef}
            type="button"
          >
            <span className="workspace-avatar" aria-hidden="true">{initials(name)}</span>
            <span>{mobileNavigationOpen ? "Close" : "Menu"}</span>
          </button>
        </header>

        {mobileNavigationOpen ? (
          <>
            <button
              aria-label="Close navigation"
              className="workspace-mobile-backdrop"
              onClick={() => {
                setMobileNavigationOpen(false);
                mobileMenuButtonRef.current?.focus();
              }}
              tabIndex={-1}
              type="button"
            />
            <div
              aria-label="Navigation and account menu"
              aria-modal="true"
              className="workspace-mobile-panel"
              id="workspace-mobile-panel"
              ref={mobilePanelRef}
              role="dialog"
            >
              <GroupedNavigation
                activeId={activeId}
                counts={navigationCounts}
                groups={navigationGroups}
                label="Mobile primary navigation"
                onNavigate={(path) => {
                  setMobileNavigationOpen(false);
                  onNavigate?.(path);
                }}
              />
              <WorkspaceUser capabilities={user.capabilities} name={name} onLogout={onLogout} role={user.role} />
            </div>
          </>
        ) : null}

        <main
          className="workspace-content"
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
        >
          <ShellContent
            currentPath={currentPath}
            navigation={navigation}
            navigationCounts={navigationCounts}
            onUserChanged={onUserChanged}
            route={route}
            user={user}
          />
        </main>
      </div>
    </div>
  );
}

function GroupedNavigation({
  activeId,
  counts,
  groups,
  label,
  onNavigate,
}: {
  activeId: ShellNavigationItem["id"] | null;
  counts: NavigationCounts;
  groups: readonly ShellNavigationGroup[];
  label: string;
  onNavigate?(path: string): void;
}) {
  return (
    <nav className="workspace-nav" aria-label={label}>
      {groups.map((group) => (
        <section className="workspace-nav-group" key={group.id}>
          <h2>{group.label}</h2>
          {group.items.map((item) => {
            const count =
              item.id === "approvals"
                ? reviewQueueNavigationCount(counts)
                : visibleNavigationCount(counts, item.id);
            return (
              <a
                aria-current={activeId === item.id ? "page" : undefined}
                className="workspace-nav-link"
                href={`#${item.path}`}
                key={item.id}
                onClick={() => onNavigate?.(item.path)}
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
        </section>
      ))}
    </nav>
  );
}

function WorkspaceBrand() {
  return (
    <a className="workspace-brand" href="#/" aria-label="West Coast Insurance Brokers home">
      <strong>West Coast</strong>
      <span>Insurance Brokers</span>
    </a>
  );
}

function WorkspaceUser({
  capabilities,
  name,
  onLogout,
  role,
}: {
  capabilities: CurrentUser["capabilities"];
  name: string;
  onLogout(): void;
  role: CurrentUser["role"];
}) {
  return (
    <div className="workspace-user" aria-label="Current user">
      <span className="workspace-avatar" aria-hidden="true">{initials(name)}</span>
      <span className="workspace-user-copy">
        <strong>{name}</strong>
        <span>{roleLabel(role, capabilities)}</span>
      </span>
      <button className="workspace-logout" onClick={onLogout} type="button">
        Sign out
      </button>
    </div>
  );
}

function ShellContent({
  currentPath,
  navigation,
  navigationCounts,
  onUserChanged,
  route,
  user,
}: {
  currentPath: string;
  navigation: readonly ShellNavigationItem[];
  navigationCounts: NavigationCounts;
  onUserChanged?(user: CurrentUser): void;
  route: ReturnType<typeof resolveShellRoute>;
  user: CurrentUser;
}) {
  if (route.status === "ready") {
    const hasCompleteReviewQueue =
      navigation.some(({ id }) => id === "approvals") &&
      navigation.some(({ id }) => id === "help_requests");
    const reviewNavigation =
      hasCompleteReviewQueue &&
      (route.item.id === "approvals" || route.item.id === "help_requests") ? (
        <ReviewQueueTabs
          active={route.item.id}
          approvalCount={navigationCounts.approvals}
          helpRequestCount={navigationCounts.help_requests}
        />
      ) : undefined;
    if (route.item.id === "approvals") {
      return (
        <VocabularyProvider>
          <ApprovalQueue
            reviewNavigation={reviewNavigation}
            user={user}
          />
        </VocabularyProvider>
      );
    }
    if (route.item.id === "help_requests") {
      return (
        <VocabularyProvider>
          <HelpRequests
            reviewNavigation={reviewNavigation}
            user={user}
          />
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
        return <MyItems currentPath={currentPath} user={user} />;
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
      return (
        <SettingsSurface
          onDisplayNameChange={(displayName) =>
            onUserChanged?.({ ...user, displayName })
          }
          onMfaChange={(mfa) => onUserChanged?.({ ...user, mfa })}
          user={user}
        />
      );
    }
    if (route.item.id === "kpis") {
      return <KpisGoals user={user} />;
    }
    if (route.item.id === "support") {
      return <SupportDashboard user={user} />;
    }
    return (
      <section className="workspace-page" aria-labelledby="workspace-page-title">
        <PageHeader
          eyebrow="WCIB workspace"
          status={<>The <strong>{route.item.label}</strong> workspace is available.</>}
          title={route.item.label}
          titleId="workspace-page-title"
        />
      </section>
    );
  }
  if (route.status === "empty") {
    return (
      <section className="workspace-message" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title">No pages available for this account</h1>
        <p>Ask an administrator to check your role and access.</p>
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

function roleLabel(
  role: CurrentUser["role"],
  capabilities: CurrentUser["capabilities"],
): string {
  if (capabilities.includes("support_engineer") && role === null) {
    return "Support engineer";
  }
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
