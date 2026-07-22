import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./mfa-webauthn.ts", import.meta.url), "utf8");

test("password-first WebAuthn requests tap-only presence without a key PIN", () => {
  assert.equal(source.match(/userVerification: "discouraged"/g)?.length, 2);
  assert.equal(source.match(/residentKey: "discouraged"/g)?.length, 1);
  assert.equal(source.match(/requireUserVerification: false/g)?.length, 2);
  assert.doesNotMatch(source, /userVerification: "(?:preferred|required)"/);
  assert.doesNotMatch(source, /residentKey: "(?:preferred|required)"/);
  assert.doesNotMatch(source, /requireUserVerification: true/);
  assert.match(source, /requireUserPresence: true/);
});
