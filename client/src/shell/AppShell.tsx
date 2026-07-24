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
import {
  ReviewQueueTabs,
  reviewQueueTabFromPath,
} from "../approvals/ReviewQueueTabs.js";
import { PolicyLedger } from "../ledger/PolicyLedger.js";
import { MgaPayables } from "../mga-payables/MgaPayables.js";
import { PaySheets } from "../pay-sheets/PaySheets.js";
import { MyCommissions } from "../commissions/MyCommissions.js";
import { MyItems } from "../my-items/MyItems.js";
import { ManageStaff } from "../staff/ManageStaff.js";
import { SettingsSurface } from "../settings/AccountSettings.js";
import { KpisGoals } from "../kpis/KpisGoals.js";
import { SupportDashboard } from "../support/SupportDashboard.js";
import { BrandArtwork } from "../ui/BrandIdentity.js";
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
import {
  goToDestination,
  isTypingTarget,
} from "./keyboard-shortcuts.js";
import {
  WorkspaceCommandOverlay,
  type WorkspaceOverlay,
} from "./WorkspaceCommandOverlay.js";

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
    window.scrollTo({ left: 0, top: 0 });
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
  const [mobileNavigationMounted, setMobileNavigationMounted] = useState(false);
  const [workspaceOverlay, setWorkspaceOverlay] =
    useState<WorkspaceOverlay>(null);
  const [goSequenceActive, setGoSequenceActive] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLDivElement>(null);
  const localMainRef = useRef<HTMLElement>(null);
  const goSequenceRef = useRef(false);
  const goSequenceTimerRef = useRef<number | null>(null);
  const resolvedMainRef = mainRef ?? localMainRef;
  const route = resolveShellRoute(currentPath, navigation);
  const activeId =
    route.status === "ready"
      ? activeNavigationId(route.item.id, navigation)
      : null;
  const name = user.displayName ?? user.email;
  const settingsAvailable = navigation.some(({ id }) => id === "settings");
  const navigate = useCallback(
    (path: string) => {
      if (onNavigate !== undefined) {
        onNavigate(path);
      } else if (typeof window !== "undefined") {
        window.location.hash = path;
      }
    },
    [onNavigate],
  );

  const openMobileNavigation = () => {
    setMobileNavigationMounted(true);
    window.requestAnimationFrame(() => setMobileNavigationOpen(true));
  };

  const closeMobileNavigation = (restoreFocus = false) => {
    setMobileNavigationOpen(false);
    if (restoreFocus) mobileMenuButtonRef.current?.focus();
  };

  useEffect(() => {
    closeMobileNavigation();
    setWorkspaceOverlay(null);
  }, [currentPath]);

  useEffect(() => {
    const clearGoSequence = () => {
      goSequenceRef.current = false;
      setGoSequenceActive(false);
      if (goSequenceTimerRef.current !== null) {
        window.clearTimeout(goSequenceTimerRef.current);
        goSequenceTimerRef.current = null;
      }
    };
    const beginGoSequence = () => {
      clearGoSequence();
      goSequenceRef.current = true;
      setGoSequenceActive(true);
      goSequenceTimerRef.current = window.setTimeout(clearGoSequence, 1_000);
    };
    const visibleRows = () =>
      Array.from(
        resolvedMainRef.current?.querySelectorAll<HTMLElement>(
          "[data-keyboard-row]",
        ) ?? [],
      ).filter((row) => row.getClientRects().length > 0);
    const focusTarget = (row: HTMLElement) =>
      row.querySelector<HTMLElement>("[data-row-focus-target]") ?? row;
    const focusedRow = () =>
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>("[data-keyboard-row]")
        : null;
    const rowNavigationFocused = () => {
      const row = focusedRow();
      const active = document.activeElement;
      return (
        row !== null &&
        active instanceof HTMLElement &&
        (active === row || active.hasAttribute("data-row-focus-target"))
      );
    };
    const focusRelativeRow = (direction: -1 | 1) => {
      const rows = visibleRows();
      if (rows.length === 0) return false;
      const current = focusedRow();
      const index = current === null ? -1 : rows.indexOf(current);
      const nextIndex =
        index < 0
          ? direction > 0
            ? 0
            : rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, index + direction));
      const target = rows[nextIndex];
      if (target === undefined) return false;
      focusTarget(target).focus();
      target.scrollIntoView({ block: "nearest" });
      return true;
    };
    const focusBoundaryRow = (boundary: "first" | "last") => {
      const rows = visibleRows();
      const target = boundary === "first" ? rows[0] : rows.at(-1);
      if (target === undefined) return false;
      focusTarget(target).focus();
      target.scrollIntoView({ block: "nearest" });
      return true;
    };
    const focusPageSearch = () => {
      const search = resolvedMainRef.current?.querySelector<HTMLInputElement>(
        "[data-primary-search]",
      );
      if (search === null || search === undefined) return false;
      search.focus();
      search.select();
      return true;
    };
    const clickRowControl = (selector: string) => {
      const row = focusedRow();
      const control =
        row?.matches(selector) === true
          ? row
          : row?.querySelector<HTMLElement>(selector);
      if (
        control === null ||
        control === undefined ||
        control.getAttribute("aria-disabled") === "true" ||
        (control instanceof HTMLButtonElement && control.disabled) ||
        (control instanceof HTMLInputElement && control.disabled)
      ) {
        return false;
      }
      control.click();
      return true;
    };
    const hasOtherModal = () =>
      document.querySelector(
        '[role="dialog"][aria-modal="true"]:not(.workspace-command-dialog)',
      ) !== null;

    const handleWorkspaceKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.metaKey || event.ctrlKey;
      if (workspaceOverlay !== null) {
        if (commandKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setWorkspaceOverlay(null);
        }
        return;
      }
      if (mobileNavigationOpen || hasOtherModal()) return;
      if (commandKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        clearGoSequence();
        setWorkspaceOverlay((current) =>
          current === "commands" ? null : "commands"
        );
        return;
      }
      if (isTypingTarget(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        clearGoSequence();
        setWorkspaceOverlay("shortcuts");
        return;
      }
      if (goSequenceRef.current) {
        if (event.altKey || event.metaKey || event.ctrlKey) {
          clearGoSequence();
          return;
        }
        event.preventDefault();
        const destination = goToDestination(event.key, navigation);
        clearGoSequence();
        if (destination !== null) navigate(destination.path);
        return;
      }
      if (
        event.key.toLowerCase() === "g" &&
        !event.altKey &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        beginGoSequence();
        return;
      }
      if (event.key === "/") {
        if (focusPageSearch()) event.preventDefault();
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        if (focusRelativeRow(1)) event.preventDefault();
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        if (focusRelativeRow(-1)) event.preventDefault();
        return;
      }
      if (event.key === "Home" && focusedRow() !== null) {
        if (focusBoundaryRow("first")) event.preventDefault();
        return;
      }
      if (event.key === "End" && focusedRow() !== null) {
        if (focusBoundaryRow("last")) event.preventDefault();
        return;
      }
      if (event.key.toLowerCase() === "x") {
        if (rowNavigationFocused() && clickRowControl("[data-row-select]")) {
          event.preventDefault();
        }
        return;
      }
      if (
        event.shiftKey &&
        event.key.toLowerCase() === "a" &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        const bulkApprove =
          resolvedMainRef.current?.querySelector<HTMLButtonElement>(
            "[data-bulk-approve]",
          );
        if (bulkApprove !== null && bulkApprove !== undefined && !bulkApprove.disabled) {
          event.preventDefault();
          bulkApprove.click();
        }
        return;
      }
      if (event.key === "Enter" && event.shiftKey) {
        if (
          rowNavigationFocused() &&
          clickRowControl("[data-row-approve-action]")
        ) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Enter") {
        const active = document.activeElement;
        if (!rowNavigationFocused()) return;
        if (active instanceof HTMLElement && active.matches("summary")) return;
        if (clickRowControl("[data-row-primary-action]")) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "Escape") {
        const row = focusedRow();
        if (row instanceof HTMLDetailsElement && row.open) {
          event.preventDefault();
          row.open = false;
        }
      }
    };

    window.addEventListener("keydown", handleWorkspaceKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWorkspaceKeyDown);
      clearGoSequence();
    };
  }, [
    mobileNavigationOpen,
    navigate,
    navigation,
    resolvedMainRef,
    workspaceOverlay,
  ]);

  useEffect(() => {
    mobilePanelRef.current?.toggleAttribute("inert", !mobileNavigationOpen);
  }, [mobileNavigationMounted, mobileNavigationOpen]);

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
        <button
          className="workspace-shortcuts-button"
          onClick={() => setWorkspaceOverlay("shortcuts")}
          title="Keyboard shortcuts (?)"
          type="button"
        >
          <kbd>?</kbd>
          <span>Keyboard shortcuts</span>
        </button>
        <WorkspaceUser
          capabilities={user.capabilities}
          name={name}
          onLogout={onLogout}
          onNavigate={onNavigate}
          role={user.role}
          settingsAvailable={settingsAvailable}
        />
      </aside>

      <div className="workspace-main">
        <header className="workspace-mobile-header">
          <WorkspaceBrand />
          <button
            aria-controls="workspace-mobile-panel"
            aria-expanded={mobileNavigationOpen}
            aria-label={`${mobileNavigationOpen ? "Close" : "Open"} navigation and account menu`}
            className="workspace-mobile-menu-button"
            onClick={() => {
              if (mobileNavigationOpen) {
                closeMobileNavigation(true);
              } else {
                openMobileNavigation();
              }
            }}
            ref={mobileMenuButtonRef}
            type="button"
          >
            <span className="workspace-avatar" aria-hidden="true">{initials(name)}</span>
            <span>{mobileNavigationOpen ? "Close" : "Menu"}</span>
          </button>
        </header>

        {mobileNavigationMounted ? (
          <>
            <button
              aria-label="Close navigation"
              className="workspace-mobile-backdrop"
              data-open={mobileNavigationOpen}
              onClick={() => {
                closeMobileNavigation(true);
              }}
              tabIndex={-1}
              type="button"
            />
            <div
              aria-hidden={!mobileNavigationOpen}
              aria-label="Navigation and account menu"
              aria-modal={mobileNavigationOpen || undefined}
              className="workspace-mobile-panel"
              data-open={mobileNavigationOpen}
              id="workspace-mobile-panel"
              onTransitionEnd={(event) => {
                if (
                  event.currentTarget === event.target &&
                  event.propertyName === "transform" &&
                  !mobileNavigationOpen
                ) {
                  setMobileNavigationMounted(false);
                }
              }}
              ref={mobilePanelRef}
              role="dialog"
            >
              <GroupedNavigation
                activeId={activeId}
                counts={navigationCounts}
                groups={navigationGroups}
                label="Mobile primary navigation"
                onNavigate={(path) => {
                  closeMobileNavigation();
                  onNavigate?.(path);
                }}
              />
              <button
                className="workspace-shortcuts-button"
                onClick={() => {
                  closeMobileNavigation(true);
                  setWorkspaceOverlay("shortcuts");
                }}
                type="button"
              >
                <kbd>?</kbd>
                <span>Keyboard shortcuts</span>
              </button>
              <WorkspaceUser
                capabilities={user.capabilities}
                name={name}
                onLogout={onLogout}
                onNavigate={(path) => {
                  closeMobileNavigation();
                  onNavigate?.(path);
                }}
                role={user.role}
                settingsAvailable={settingsAvailable}
              />
            </div>
          </>
        ) : null}

        <main
          className="workspace-content"
          id="main-content"
          ref={resolvedMainRef}
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
      {goSequenceActive ? (
        <div aria-live="polite" className="workspace-keyboard-sequence">
          <kbd>G</kbd> then a destination key
        </div>
      ) : null}
      {workspaceOverlay === null ? null : (
        <WorkspaceCommandOverlay
          mode={workspaceOverlay}
          navigation={navigation}
          onClose={() => setWorkspaceOverlay(null)}
          onFocusSearch={() => {
            const search = resolvedMainRef.current?.querySelector<HTMLInputElement>(
              "[data-primary-search]",
            );
            search?.focus();
            search?.select();
          }}
          onMode={setWorkspaceOverlay}
          onNavigate={navigate}
        />
      )}
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
      <BrandArtwork variant="mark" />
      <span className="workspace-brand-copy">
        <strong>West Coast</strong>
        <span>Insurance Brokers</span>
      </span>
    </a>
  );
}

function WorkspaceUser({
  capabilities,
  name,
  onLogout,
  onNavigate,
  role,
  settingsAvailable,
}: {
  capabilities: CurrentUser["capabilities"];
  name: string;
  onLogout(): void;
  onNavigate?(path: string): void;
  role: CurrentUser["role"];
  settingsAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isAdmin = role === "admin" && capabilities.includes("admin");

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const navigate = (path: string) => {
    setOpen(false);
    onNavigate?.(path);
  };

  return (
    <div className="workspace-user" aria-label="Current user" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${open ? "Close" : "Open"} account menu for ${name}`}
        className="workspace-user-trigger"
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span className="workspace-avatar" aria-hidden="true">{initials(name)}</span>
        <span className="workspace-user-copy">
          <strong>{name}</strong>
          <span>{roleLabel(role, capabilities)}</span>
        </span>
        <span className="workspace-user-chevron" aria-hidden="true">^</span>
      </button>
      <div
        aria-label="Account menu"
        className="workspace-user-menu"
        hidden={!open}
        role="menu"
      >
        {settingsAvailable ? (
          <a href="#/settings" onClick={() => navigate("/settings")} role="menuitem">
            Profile &amp; security
          </a>
        ) : null}
        {settingsAvailable && isAdmin ? (
          <a
            href="#/settings?scope=agency"
            onClick={() => navigate("/settings?scope=agency")}
            role="menuitem"
          >
            Agency settings
          </a>
        ) : null}
        <button onClick={onLogout} role="menuitem" type="button">
          Sign out
        </button>
      </div>
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
    const canReviewApprovals = navigation.some(({ id }) => id === "approvals");
    const canReviewHelpRequests = navigation.some(
      ({ id }) => id === "help_requests",
    );
    const activeReviewTab =
      route.item.id === "approvals" || route.item.id === "help_requests"
        ? reviewQueueTabFromPath(currentPath, route.item.id)
        : null;
    const reviewNavigation =
      activeReviewTab === null ? undefined : (
        <ReviewQueueTabs
          active={activeReviewTab}
          helpRequestCount={navigationCounts.help_requests}
          policyChangeCount={navigationCounts.policy_change_requests}
          showHelpRequests={canReviewHelpRequests}
          showSubmittedTurnIns={canReviewApprovals}
          submittedTurnInCount={navigationCounts.approvals}
        />
      );
    if (route.item.id === "approvals") {
      return (
        <VocabularyProvider>
          <ApprovalQueue
            activeView={
              activeReviewTab === "policy_changes"
                ? "policy_changes"
                : "submitted_turn_ins"
            }
            key={activeReviewTab}
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
          currentPath={currentPath}
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
