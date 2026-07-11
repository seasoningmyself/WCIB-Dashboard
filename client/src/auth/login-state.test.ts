import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthApiError } from "./api.js";
import {
  createSingleFlight,
  loginErrorText,
  loginFailureState,
} from "./login-state.js";

test("single-flight login suppresses duplicate pending submissions", async () => {
  const gate = createSingleFlight();
  let complete: ((value: string) => void) | undefined;
  let calls = 0;
  const operation = () => {
    calls += 1;
    return new Promise<string>((resolve) => {
      complete = resolve;
    });
  };

  const first = gate.run(operation);
  const duplicate = gate.run(operation);

  assert.ok(first);
  assert.equal(duplicate, null);
  assert.equal(gate.isPending(), true);
  assert.equal(calls, 1);
  complete?.("complete");
  assert.equal(await first, "complete");
  assert.equal(gate.isPending(), false);
});

test("login failures clear the password and retain only safe categories", () => {
  assert.deepEqual(
    loginFailureState(new AuthApiError("invalid_credentials")),
    { error: "invalid_credentials", password: "" },
  );
  assert.deepEqual(loginFailureState(new Error("private server body")), {
    error: "server",
    password: "",
  });
  assert.equal(
    loginErrorText("invalid_credentials"),
    "Email or password is incorrect.",
  );
  assert.match(loginErrorText("network"), /connection/i);
  assert.doesNotMatch(loginErrorText("network"), /incorrect/i);
});
