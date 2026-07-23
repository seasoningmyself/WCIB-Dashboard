import React, { useState } from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import { BusinessStateSettings } from "../business-state/BusinessStateSettings.js";
import { OfficeLocationsSettings } from "../offices/OfficeLocationsSettings.js";
import { AssignmentSettings } from "../staff/AssignmentSettings.js";
import { VocabularyManagement } from "../staff/VocabularyManagement.js";
import { AccountSecurityPanel } from "./AccountSecurity.js";

export type AgencySettingsTab =
  | "account_security"
  | "assignments"
  | "data_recovery"
  | "offices"
  | "vocabulary";

const AGENCY_SETTINGS_TABS: readonly {
  id: AgencySettingsTab;
  label: string;
}[] = [
  { id: "offices", label: "Offices" },
  { id: "assignments", label: "Assignment options" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "account_security", label: "Account security" },
  { id: "data_recovery", label: "Data recovery" },
];

export function AgencySettings({ user }: { user: CurrentUser }) {
  const isAdmin =
    user.role === "admin" && user.capabilities.includes("admin");
  const [tab, setTab] = useState<AgencySettingsTab>("offices");

  if (!isAdmin) {
    return (
      <section className="settings-message" aria-labelledby="agency-settings-denied">
        <h2 id="agency-settings-denied">Agency settings unavailable</h2>
        <p>This section is restricted to administrators.</p>
      </section>
    );
  }

  return (
    <>
      <AgencySettingsNavigation activeTab={tab} onSelect={setTab} />
      <div className="agency-settings-content" role="tabpanel">
        {tab === "offices" ? (
          <OfficeLocationsSettings
            embedded
            eyebrow="Agency settings"
            includeBusinessState={false}
            user={user}
          />
        ) : tab === "assignments" ? (
          <AssignmentSettings user={user} />
        ) : tab === "vocabulary" ? (
          <VocabularyManagement />
        ) : tab === "account_security" ? (
          <AccountSecurityPanel user={user} />
        ) : (
          <BusinessStateSettings />
        )}
      </div>
    </>
  );
}

export function AgencySettingsNavigation({
  activeTab,
  onSelect,
}: {
  activeTab: AgencySettingsTab;
  onSelect(tab: AgencySettingsTab): void;
}) {
  return (
    <div
      aria-label="Agency settings sections"
      className="settings-tabs is-agency"
      role="tablist"
    >
      {AGENCY_SETTINGS_TABS.map(({ id, label }) => (
        <button
          aria-selected={activeTab === id}
          className={activeTab === id ? "is-active" : undefined}
          key={id}
          onClick={() => onSelect(id)}
          role="tab"
          type="button"
        >
          {label}
        </button>
      ))}
    </div>
  );
}
