import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "./password.js";

test("hashPassword creates salted hashes that verify", async () => {
  const password = "StrongPass123!";
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.notEqual(firstHash, password);
  assert.notEqual(secondHash, firstHash);
  assert.match(firstHash, /^\$2[aby]\$10\$/);
  assert.equal(await verifyPassword(password, firstHash), true);
  assert.equal(await verifyPassword("WrongPass123!", firstHash), false);
});

test("hashPassword rejects weak passwords before hashing", async () => {
  await assert.rejects(
    hashPassword("weak"),
    /Password must be at least 12 characters/,
  );
});

test("verifyPassword fails closed for malformed hashes", async () => {
  assert.equal(await verifyPassword("StrongPass123!", "not-a-hash"), false);
});
