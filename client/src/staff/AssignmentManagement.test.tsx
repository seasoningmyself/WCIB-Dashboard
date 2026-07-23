import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssignmentManagement } from "./AssignmentManagement.js";
import { employeeFixture, staffFixture, uuid } from "./test-fixture.js";

const noOp = () => undefined;

test("assignment management shows fixed agency and per-producer availability", () => {
  const markup = renderToStaticMarkup(
    <AssignmentManagement
      onUpdate={noOp}
      pending={false}
      staff={[
        staffFixture({
          bookAssignmentEnabled: true,
          firstYearAssignmentEnabled: false,
        }),
        staffFixture({
          displayName: "Second Producer",
          userId: uuid(22),
        }),
        employeeFixture(),
        staffFixture({
          displayName: "Inactive Producer",
          isActive: false,
          userId: uuid(23),
        }),
      ]}
    />,
  );

  assert.match(markup, /Sophia&#x27;s account/);
  assert.match(markup, /Always available/);
  assert.match(markup, /Kaylee Producer/);
  assert.match(markup, /Second Producer/);
  assert.match(markup, /Book available/);
  assert.match(markup, /First-year house available/);
  assert.equal((markup.match(/type="checkbox"/g) ?? []).length, 4);
  assert.equal((markup.match(/checked=""/g) ?? []).length, 3);
  assert.doesNotMatch(markup, /Mercedes Employee|Inactive Producer/);
});

test("assignment management explains how to add the first producer", () => {
  const markup = renderToStaticMarkup(
    <AssignmentManagement
      onUpdate={noOp}
      pending={false}
      staff={[employeeFixture()]}
    />,
  );
  assert.match(markup, /No active producers/);
  assert.match(markup, /Promote a staff account to Producer/);
});
