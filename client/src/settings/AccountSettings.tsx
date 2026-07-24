import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  changeOwnPasswordRequestSchema,
  updateOwnProfileRequestSchema,
  type OwnSettings,
} from "../../../shared/account-settings.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { MfaState } from "../../../shared/mfa-scaffold.js";
import { normalizePassword } from "../../../shared/password-policy.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import { PasswordRequirements } from "../auth/PasswordRequirements.js";
import { PageHeader } from "../ui/PageHeader.js";
import { createSettingsApi, SettingsApiError } from "./api.js";
import { createMfaApi } from "../auth/mfa-api.js";
import { MfaSettingsPanel } from "../auth/MfaEnrollment.js";
import {
  AgencySettings,
  type AgencySettingsTab,
} from "./AgencySettings.js";

export type SettingsSection =
  | AgencySettingsTab
  | "profile"
  | "security";

const PERSONAL_SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Password & MFA" },
] as const satisfies readonly { id: SettingsSection; label: string }[];

const AGENCY_SETTINGS_SECTIONS = [
  { id: "offices", label: "Offices" },
  { id: "assignments", label: "Assignment options" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "account-security", label: "Account security" },
  { id: "data-recovery", label: "Data recovery" },
] as const satisfies readonly { id: SettingsSection; label: string }[];

type AccountState =
  | { status: "denied" | "error" | "loading" }
  | { settings: OwnSettings; status: "ready" };

export function SettingsSurface({
  currentPath = "/settings",
  onDisplayNameChange,
  onMfaChange,
  user,
}: {
  currentPath?: string;
  onDisplayNameChange(displayName: string): void;
  onMfaChange(mfa: MfaState): void;
  user: CurrentUser;
}) {
  const isAdmin = user.role === "admin" && user.capabilities.includes("admin");
  const section = settingsSectionFromPath(currentPath, isAdmin);
  const agencySection = isAgencySettingsSection(section);
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <PageHeader
        eyebrow={agencySection ? "Agency administration" : "Personal account"}
        status={agencySection
          ? <>Manage <strong>agency configuration and recovery controls</strong>.</>
          : <>Manage the profile and security settings for <strong>{user.email}</strong>.</>}
        title="Settings"
        titleId="settings-title"
      />
      <div className="settings-layout">
        <SettingsSubNavigation activeSection={section} isAdmin={isAdmin} />
        <div className="settings-content">
          {agencySection ? (
            <AgencySettings activeTab={section} user={user} />
          ) : (
            <OwnSettingsController
              activeTab={section === "security" ? "security" : "account"}
              canManageStaff={isAdmin}
              onDisplayNameChange={onDisplayNameChange}
              onMfaChange={onMfaChange}
              user={user}
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function settingsSectionFromPath(
  currentPath: string,
  isAdmin: boolean,
): SettingsSection {
  const query = currentPath.split("?", 2)[1]?.split("#", 1)[0] ?? "";
  const params = new URLSearchParams(query);
  const requested = normalizeSettingsSection(params.get("section"));
  if (requested !== null) {
    return !isAdmin && isAgencySettingsSection(requested)
      ? "profile"
      : requested;
  }
  return isAdmin && params.get("scope") === "agency"
    ? "offices"
    : "profile";
}

export function SettingsSubNavigation({
  activeSection,
  isAdmin,
}: {
  activeSection: SettingsSection;
  isAdmin: boolean;
}) {
  const navigationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const navigation = navigationRef.current;
    if (navigation === null) return;
    const revealActiveLink = () => {
      const activeLink = navigation.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      if (activeLink === null) return;
      const navigationRect = navigation.getBoundingClientRect();
      const activeRect = activeLink.getBoundingClientRect();
      const nextScrollLeft = settingsSubnavScrollLeft({
        activeLeft: activeRect.left,
        activeRight: activeRect.right,
        containerLeft: navigationRect.left,
        containerRight: navigationRect.right,
        currentScrollLeft: navigation.scrollLeft,
        maximumScrollLeft: navigation.scrollWidth - navigation.clientWidth,
      });
      if (nextScrollLeft !== navigation.scrollLeft) {
        navigation.scrollLeft = nextScrollLeft;
      }
    };
    revealActiveLink();
    window.addEventListener("resize", revealActiveLink);
    return () => {
      window.removeEventListener("resize", revealActiveLink);
    };
  }, [activeSection]);

  return (
    <nav
      aria-label="Settings sections"
      className="settings-subnav"
      ref={navigationRef}
    >
      <SettingsSubNavigationGroup
        activeSection={activeSection}
        label="Personal"
        sections={PERSONAL_SETTINGS_SECTIONS}
      />
      {isAdmin ? (
        <SettingsSubNavigationGroup
          activeSection={activeSection}
          label="Agency"
          sections={AGENCY_SETTINGS_SECTIONS}
        />
      ) : null}
    </nav>
  );
}

function SettingsSubNavigationGroup({
  activeSection,
  label,
  sections,
}: {
  activeSection: SettingsSection;
  label: string;
  sections: readonly { id: SettingsSection; label: string }[];
}) {
  return (
    <div className="settings-subnav-group">
      <p>{label}</p>
      <div>
        {sections.map(({ id, label: sectionLabel }) => (
          <a
            aria-current={activeSection === id ? "page" : undefined}
            href={`#/settings?section=${encodeURIComponent(id)}`}
            key={id}
          >
            {sectionLabel}
          </a>
        ))}
      </div>
    </div>
  );
}

export function settingsSubnavScrollLeft({
  activeLeft,
  activeRight,
  containerLeft,
  containerRight,
  currentScrollLeft,
  maximumScrollLeft,
}: {
  activeLeft: number;
  activeRight: number;
  containerLeft: number;
  containerRight: number;
  currentScrollLeft: number;
  maximumScrollLeft: number;
}): number {
  if (activeLeft < containerLeft) {
    return Math.max(0, currentScrollLeft - (containerLeft - activeLeft));
  }
  if (activeRight > containerRight) {
    return Math.min(
      maximumScrollLeft,
      currentScrollLeft + activeRight - containerRight,
    );
  }
  return currentScrollLeft;
}

function normalizeSettingsSection(value: string | null): SettingsSection | null {
  if (value === null) return null;
  if (value === "account") return "profile";
  if (value === "password-mfa") return "security";
  return [...PERSONAL_SETTINGS_SECTIONS, ...AGENCY_SETTINGS_SECTIONS].some(
    ({ id }) => id === value,
  )
    ? value as SettingsSection
    : null;
}

function isAgencySettingsSection(
  section: SettingsSection,
): section is AgencySettingsTab {
  return AGENCY_SETTINGS_SECTIONS.some(({ id }) => id === section);
}

function OwnSettingsController({
  activeTab,
  canManageStaff,
  onDisplayNameChange,
  onMfaChange,
  user,
}: {
  activeTab: "account" | "security";
  canManageStaff: boolean;
  onDisplayNameChange(displayName: string): void;
  onMfaChange(mfa: MfaState): void;
  user: CurrentUser;
}) {
  const client = useApiClient();
  const api = useMemo(() => createSettingsApi(client), [client]);
  const [state, setState] = useState<AccountState>({ status: "loading" });
  const [profilePending, setProfilePending] = useState(false);
  const [passwordPending, setPasswordPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(() => {
    setState({ status: "loading" });
    setProfilePending(false);
    setPasswordPending(false);
    setNotice(null);
    setError(null);
  }, []);
  useSensitiveSessionCleanup(clear);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ settings: await api.load(), status: "ready" });
    } catch (caught) {
      setState({
        status:
          caught instanceof SettingsApiError && caught.kind === "denied"
            ? "denied"
            : "error",
      });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status !== "ready") {
    return <SettingsMessage kind={state.status} onRetry={() => void load()} />;
  }

  return activeTab === "account" ? (
    <AccountPanel
      canManageStaff={canManageStaff}
      error={error}
      notice={notice}
      onSave={async (displayName) => {
        if (profilePending) return;
        setProfilePending(true);
        setError(null);
        setNotice(null);
        try {
          const settings = await api.updateProfile({ displayName });
          setState({ settings, status: "ready" });
          onDisplayNameChange(settings.displayName);
          setNotice("Display name updated.");
        } catch (caught) {
          setError(profileError(caught));
        } finally {
          setProfilePending(false);
        }
      }}
      pending={profilePending}
      settings={state.settings}
    />
  ) : (
    <div className="settings-security-stack">
      <SecurityPanel
        error={error}
        notice={notice}
        onSave={async (currentPassword, newPassword, confirmation) => {
          if (passwordPending) return false;
          setPasswordPending(true);
          setError(null);
          setNotice(null);
          try {
            await api.changePassword({
              confirmation,
              currentPassword,
              newPassword,
            });
            setNotice("Password changed. Other signed-in sessions were ended.");
            return true;
          } catch (caught) {
            setError(passwordError(caught));
            return false;
          } finally {
            setPasswordPending(false);
          }
        }}
        pending={passwordPending}
      />
      <MfaSettingsPanel
        api={createMfaApi()}
        initialMfa={user.mfa ?? emptyMfaState(user.role === "admin")}
        onMfaChange={onMfaChange}
        userId={user.id}
      />
    </div>
  );
}

export function AccountPanel({
  canManageStaff = false,
  error,
  notice,
  onSave,
  pending,
  settings,
}: {
  canManageStaff?: boolean;
  error: string | null;
  notice: string | null;
  onSave(displayName: string): void;
  pending: boolean;
  settings: OwnSettings;
}) {
  const [displayName, setDisplayName] = useState(settings.displayName);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = updateOwnProfileRequestSchema.safeParse({ displayName });
    if (parsed.success) onSave(parsed.data.displayName);
  };
  return (
    <section className="settings-panel" aria-labelledby="account-settings-title">
      <header>
        <h2 id="account-settings-title">Personal profile</h2>
        <p>Your display name is the only account detail you can change here.</p>
      </header>
      <form className="settings-form" onSubmit={submit}>
        <label>
          <span>Display name</span>
          <input
            autoComplete="name"
            disabled={pending}
            maxLength={200}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            required
            value={displayName}
          />
          <small>This name appears throughout the dashboard.</small>
        </label>
        <label>
          <span>Email</span>
          <input readOnly type="email" value={settings.email} />
          <small>
            {canManageStaff ? (
              <>Sign-in email changes require MFA confirmation in <a href="#/staff">Manage Staff</a>.</>
            ) : (
              "Ask an administrator to change your sign-in email."
            )}
          </small>
        </label>
        <label>
          <span>Assigned office</span>
          <input
            readOnly
            value={settings.officeLocation?.name ?? "Not assigned"}
          />
          <small>
            {canManageStaff ? (
              <>Update office assignments in <a href="#/staff">Manage Staff</a>.</>
            ) : (
              "Ask an administrator to change your office assignment."
            )}
          </small>
        </label>
        <SettingsFeedback error={error} notice={notice} />
        <button
          className="settings-primary-action"
          disabled={
            pending ||
            displayName.trim() === settings.displayName ||
            !updateOwnProfileRequestSchema.safeParse({ displayName }).success
          }
          type="submit"
        >
          {pending ? "Saving..." : "Save display name"}
        </button>
      </form>
    </section>
  );
}

export function SecurityPanel({
  error,
  notice,
  onSave,
  pending,
}: {
  error: string | null;
  notice: string | null;
  onSave(
    currentPassword: string,
    newPassword: string,
    confirmation: string,
  ): Promise<boolean>;
  pending: boolean;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [reuseRejected, setReuseRejected] = useState(false);
  const valid = changeOwnPasswordRequestSchema.safeParse({
    confirmation,
    currentPassword,
    newPassword,
  }).success;
  const knownReuse =
    currentPassword.length > 0 &&
    normalizePassword(currentPassword) === normalizePassword(newPassword);
  useEffect(() => {
    if (/different|used/i.test(error ?? "")) {
      setReuseRejected(true);
    }
  }, [error]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid || knownReuse) return;
    void onSave(currentPassword, newPassword, confirmation).then((changed) => {
      if (changed) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        setReuseRejected(false);
      }
    });
  };
  return (
    <section className="settings-panel" aria-labelledby="security-settings-title">
      <header>
        <h2 id="security-settings-title">Change password</h2>
        <p>Changing your password ends every other signed-in session.</p>
      </header>
      <form className="settings-form" onSubmit={submit}>
        <label>
          <span>Current password</span>
          <input
            autoComplete="current-password"
            disabled={pending}
            maxLength={1_024}
            onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>
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
          priorPassword={currentPassword}
          reuseRejected={reuseRejected}
        />
        <SettingsFeedback error={error} notice={notice} />
        <button
          className="settings-primary-action"
          disabled={pending || !valid || knownReuse}
          type="submit"
        >
          {pending ? "Changing password..." : "Change password"}
        </button>
      </form>
    </section>
  );
}

function SettingsFeedback({
  error,
  notice,
}: {
  error: string | null;
  notice: string | null;
}) {
  if (error !== null) return <p className="settings-error" role="alert">{error}</p>;
  if (notice !== null) return <p className="settings-notice" role="status">{notice}</p>;
  return null;
}

function SettingsMessage({
  kind,
  onRetry,
}: {
  kind: "denied" | "error" | "loading";
  onRetry(): void;
}) {
  if (kind === "loading") {
    return <section className="settings-message" aria-busy="true"><h2>Loading settings</h2><p>Retrieving your account details...</p></section>;
  }
  return (
    <section className="settings-message">
      <h2>{kind === "denied" ? "Settings unavailable" : "Unable to load settings"}</h2>
      <p>{kind === "denied" ? "Your account cannot access this page." : "Your account details could not be loaded."}</p>
      {kind === "error" ? <button onClick={onRetry} type="button">Try again</button> : null}
    </section>
  );
}

function profileError(error: unknown): string {
  if (error instanceof SettingsApiError && error.kind === "conflict") {
    return "That display name is already in use.";
  }
  if (error instanceof SettingsApiError && error.kind === "rejected") {
    return "Enter a valid display name.";
  }
  return "Your display name could not be saved. Try again.";
}

function passwordError(error: unknown): string {
  if (
    error instanceof SettingsApiError &&
    error.kind === "invalid_current_password"
  ) {
    return "Current password is incorrect.";
  }
  if (error instanceof SettingsApiError && error.kind === "reuse") {
    return "The new password must be different from the current password.";
  }
  if (error instanceof SettingsApiError && error.kind === "rejected") {
    return "Review the password requirements and try again.";
  }
  return "Your password could not be changed. Try again.";
}

function emptyMfaState(adminRecommended: boolean): MfaState {
  return {
    adminEnforcementEnabled: false,
    adminRecommended,
    enrolled: false,
    enrollmentRequired: false,
    policyRequired: false,
    methods: [],
    recoveryCodesAcknowledged: false,
    recoveryCodesRemaining: 0,
  };
}
