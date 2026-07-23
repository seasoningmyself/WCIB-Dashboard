import React from "react";
import type {
  AdminStaffRecord,
  UpdateAdminStaffRequest,
} from "../../../shared/admin-staff.js";
import { EmptyState } from "../ui/EmptyState.js";

export function AssignmentManagement({
  onUpdate,
  pending,
  staff,
}: {
  onUpdate(
    staff: AdminStaffRecord,
    input: UpdateAdminStaffRequest,
  ): void;
  pending: boolean;
  staff: readonly AdminStaffRecord[];
}) {
  const producers = staff.filter(
    ({ isActive, role }) => isActive && role === "producer",
  );

  return (
    <section
      aria-labelledby="staff-assignment-title"
      className="staff-assignment-management"
    >
      <header>
        <div>
          <p>Turn-in configuration</p>
          <h2 id="staff-assignment-title">Assignment options</h2>
        </div>
        <span>
          {producers.length} active{" "}
          {producers.length === 1 ? "producer" : "producers"}
        </span>
      </header>
      <p className="staff-assignment-intro">
        Choose which producer assignments are available on new turn-ins.
        Existing policies and historical labels are not changed.
      </p>
      <section className="staff-assignment-agency">
        <div>
          <span>Agency account</span>
          <strong>Sophia&apos;s account</strong>
        </div>
        <span>Always available</span>
      </section>
      {producers.length === 0 ? (
        <EmptyState
          body="Promote a staff account to Producer before adding book or first-year assignment choices."
          className="staff-empty is-compact"
          heading="No active producers"
        />
      ) : (
        <div className="staff-assignment-list" role="list">
          {producers.map((producer) => (
            <article
              className="staff-assignment-row"
              key={producer.userId}
              role="listitem"
            >
              <div>
                <strong>{producer.displayName}</strong>
                <span>{producer.email}</span>
              </div>
              <label>
                <input
                  checked={producer.bookAssignmentEnabled}
                  disabled={pending}
                  onChange={(event) =>
                    onUpdate(producer, {
                      bookAssignmentEnabled: event.currentTarget.checked,
                    })}
                  type="checkbox"
                />
                <span>Book available</span>
              </label>
              <label>
                <input
                  checked={producer.firstYearAssignmentEnabled}
                  disabled={pending}
                  onChange={(event) =>
                    onUpdate(producer, {
                      firstYearAssignmentEnabled:
                        event.currentTarget.checked,
                    })}
                  type="checkbox"
                />
                <span>First-year house available</span>
              </label>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
