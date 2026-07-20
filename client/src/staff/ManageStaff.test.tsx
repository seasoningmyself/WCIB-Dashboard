import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { AdminStaffRecord } from "../../../shared/admin-staff.js";
import {
  RateEditorDialog,
  StaffActiveDialog,
  StaffEditorDialog,
  TemporaryPasswordDialog,
} from "./StaffDialogs.js";
import { ManageStaff, ManageStaffView } from "./ManageStaff.js";
import { employeeFixture, staffFixture, uuid } from "./test-fixture.js";

const noOp = () => {};

test("Manage Staff renders active and inactive identities with immutable rate history", () => {
  const producer = staffFixture();
  const producerWithoutRates = staffFixture({
    displayName: "Producer Missing Rates",
    rateState: "missing",
    rates: [],
    userId: uuid(3),
  });
  const neverProducer = employeeFixture();
  const inactive = employeeFixture({
    displayName: "Long Historical Employee Name That Must Remain Readable",
    email: "long.historical.employee.address@example.test",
    isActive: false,
    rateState: "dormant",
    rates: [producer.rates[0]!],
  });
  const markup = renderView(
    [producer, producerWithoutRates, neverProducer, inactive],
    producer.userId,
  );

  for (const visible of [
    "Manage Staff",
    "Kaylee Producer",
    "Long Historical Employee Name That Must Remain Readable",
    "Rate configured",
    "⚠ No rates set, Pay Sheet will not calculate",
    "Rate history dormant",
    "New commission",
    "26.00%",
    "Locked",
    "Unlocked",
    "Read only",
    "Correct",
    "Add rate",
    "Deactivate",
    "Reactivate",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(visible)));
  }
  assert.doesNotMatch(
    markup,
    /Staff account summary|Active accounts|Inactive accounts/,
  );
  assert.equal((markup.match(/>Correct</g) ?? []).length, 1);
  const neverProducerRow = staffRowMarkup(markup, "Mercedes Employee");
  assert.doesNotMatch(
    neverProducerRow,
    /No producer rate|Rate history|Hide rates|Producer rate history/,
  );
  assert.match(
    staffRowMarkup(markup, "Producer Missing Rates"),
    /⚠ No rates set, Pay Sheet will not calculate/,
  );
  assert.match(
    staffRowMarkup(markup, "Long Historical Employee Name That Must Remain Readable"),
    /Rate history dormant|Hide rates/,
  );
  assert.doesNotMatch(markup, />Delete<|hard delete|localStorage/i);
});

test("screen exposes loading, empty, failure, denied, and safe non-admin states", () => {
  assert.match(renderState({ status: "loading" }), /Loading staff/);
  assert.match(renderState({ status: "error" }), /Try again/);
  assert.match(renderState({ status: "denied" }), /Staff management unavailable/);
  assert.match(renderState({ items: [], status: "ready" }), /No staff accounts yet/);

  for (const role of ["employee", "producer"] as const) {
    const user: CurrentUser = {
      allowedNavigation: role === "producer" ? ["my_commissions"] : ["my_items"],
      capabilities: [],
      displayName: "Private Staff",
      email: `${role}@example.test`,
      id: uuid(role === "employee" ? 91 : 92),
      passwordChangeRequired: false,
      role,
    };
    const markup = renderToStaticMarkup(<ManageStaff user={user} />);
    assert.match(markup, /Staff management unavailable/);
    assert.doesNotMatch(markup, /Loading staff|Rate history|Add staff/);
  }
});

test("staff editor keeps temporary credentials masked and creation-only", () => {
  const creation = renderToStaticMarkup(
    <StaffEditorDialog
      dialog={{ kind: "create" }}
      error={null}
      onCancel={noOp}
      onCreate={noOp}
      onUpdate={noOp}
      pending={false}
    />,
  );
  const editing = renderToStaticMarkup(
    <StaffEditorDialog
      dialog={{ kind: "edit", staff: staffFixture() }}
      error={null}
      onCancel={noOp}
      onCreate={noOp}
      onUpdate={noOp}
      pending={false}
    />,
  );
  assert.match(creation, /type="password"/);
  assert.match(creation, /autoComplete="new-password"/i);
  assert.match(creation, /At least 12 characters/);
  assert.doesNotMatch(creation, /ValidPassword|passwordHash/);
  assert.doesNotMatch(creation, /Pronoun|Her|His|Their/);
  assert.doesNotMatch(editing, /Temporary password|type="password"|passwordHash/);
  assert.doesNotMatch(editing, /Pronoun|Her|His|Their/);
});

test("staff editor manages office assignment and admin temporary-password recovery", () => {
  const staff = staffFixture();
  const editor = renderToStaticMarkup(
    <StaffEditorDialog
      dialog={{ kind: "edit", staff }}
      error={null}
      officeOptions={[
        {
          createdAt: "2026-07-19T12:00:00.000Z",
          id: uuid(20),
          isActive: true,
          name: "West Coast",
          updatedAt: "2026-07-19T12:00:00.000Z",
        },
      ]}
      onCancel={noOp}
      onCreate={noOp}
      onUpdate={noOp}
      pending={false}
    />,
  );
  const recovery = renderToStaticMarkup(
    <TemporaryPasswordDialog
      dialog={{ staff }}
      error={null}
      onCancel={noOp}
      onConfirm={noOp}
      pending={false}
    />,
  );

  assert.match(editor, />Office</);
  assert.match(editor, />Not assigned</);
  assert.match(editor, />West Coast</);
  assert.match(recovery, /Issue temporary password/);
  assert.match(recovery, /Existing sessions will end/);
  assert.match(recovery, /must replace this password at the next sign-in/);
  assert.match(recovery, /type="password"/);
  assert.doesNotMatch(recovery, /passwordHash|sessionVersion/);
});

test("role and active dialogs explain dormant history and session invalidation", () => {
  const deactivation = renderToStaticMarkup(
    <StaffActiveDialog
      dialog={{ active: false, staff: staffFixture() }}
      error={null}
      onCancel={noOp}
      onConfirm={noOp}
      pending={false}
    />,
  );
  const producerRate = renderToStaticMarkup(
    <RateEditorDialog
      dialog={{ kind: "edit", rate: staffFixture().rates[1]!, staff: staffFixture() }}
      error={null}
      onCancel={noOp}
      onCreate={noOp}
      onUpdate={noOp}
      pending={false}
    />,
  );
  assert.match(deactivation, /ends active sessions/);
  assert.match(deactivation, /history will be retained/);
  assert.match(producerRate, /Correct rate history/);
  assert.match(producerRate, /becomes immutable/);
  assert.match(producerRate, /Confirm correction/);
  assert.doesNotMatch(producerRate, /Delete/);
});

function renderView(
  items: readonly AdminStaffRecord[],
  expandedUserId: string,
): string {
  return renderToStaticMarkup(
    <ManageStaffView
      currentUserId={uuid(99)}
      expandedUserId={expandedUserId}
      notice={null}
      onActive={noOp}
      onAdd={noOp}
      onAddRate={noOp}
      onCorrectRate={noOp}
      onEdit={noOp}
      onTemporaryPassword={noOp}
      onRetry={noOp}
      onToggle={noOp}
      pending={false}
      state={{ items, status: "ready" }}
    />,
  );
}

function renderState(state: Parameters<typeof ManageStaffView>[0]["state"]): string {
  return renderToStaticMarkup(
    <ManageStaffView
      currentUserId={uuid(99)}
      expandedUserId={null}
      notice={null}
      onActive={noOp}
      onAdd={noOp}
      onAddRate={noOp}
      onCorrectRate={noOp}
      onEdit={noOp}
      onTemporaryPassword={noOp}
      onRetry={noOp}
      onToggle={noOp}
      pending={false}
      state={state}
    />,
  );
}

function staffRowMarkup(markup: string, displayName: string): string {
  const nameIndex = markup.indexOf(displayName);
  assert.notEqual(nameIndex, -1);
  const start = markup.lastIndexOf("<article", nameIndex);
  const end = markup.indexOf("</article>", nameIndex);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return markup.slice(start, end + "</article>".length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
