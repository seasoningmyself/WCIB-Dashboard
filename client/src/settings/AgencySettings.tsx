import React from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import { BusinessStateSettings } from "../business-state/BusinessStateSettings.js";
import { OfficeLocationsSettings } from "../offices/OfficeLocationsSettings.js";
import { AssignmentSettings } from "../staff/AssignmentSettings.js";
import { VocabularyManagement } from "../staff/VocabularyManagement.js";
import { AccountSecurityPanel } from "./AccountSecurity.js";

export type AgencySettingsTab =
  | "account-security"
  | "assignments"
  | "data-recovery"
  | "offices"
  | "vocabulary";

export function AgencySettings({
  activeTab,
  user,
}: {
  activeTab: AgencySettingsTab;
  user: CurrentUser;
}) {
  const isAdmin =
    user.role === "admin" && user.capabilities.includes("admin");

  if (!isAdmin) {
    return (
      <section className="settings-message" aria-labelledby="agency-settings-denied">
        <h2 id="agency-settings-denied">Agency settings unavailable</h2>
        <p>This section is restricted to administrators.</p>
      </section>
    );
  }

  return (
    <div className="agency-settings-content">
      {activeTab === "offices" ? (
        <OfficeLocationsSettings
          embedded
          eyebrow="Agency settings"
          includeBusinessState={false}
          user={user}
        />
      ) : activeTab === "assignments" ? (
        <AssignmentSettings user={user} />
      ) : activeTab === "vocabulary" ? (
        <VocabularyManagement />
      ) : activeTab === "account-security" ? (
        <AccountSecurityPanel user={user} />
      ) : (
        <BusinessStateSettings />
      )}
    </div>
  );
}
