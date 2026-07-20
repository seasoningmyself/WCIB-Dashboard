import assert from "node:assert/strict";
import { test } from "node:test";
import bcrypt from "bcryptjs";
import {
  hashAuthenticatedPasswordForUpgrade,
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "./password.js";

test("hashPassword creates salted Argon2id hashes that verify", async () => {
  const password = "four quiet words";
  const firstHash = await hashPassword(password);
  const secondHash = await hashPassword(password);

  assert.notEqual(firstHash, password);
  assert.notEqual(secondHash, firstHash);
  assert.match(firstHash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
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

test("bcrypt hashes remain verifiable and are marked for upgrade", async () => {
  const bcryptHash = await bcrypt.hash("Legacy password phrase", 10);

  assert.equal(await verifyPassword("Legacy password phrase", bcryptHash), true);
  assert.equal(passwordHashNeedsUpgrade(bcryptHash), true);
  assert.equal(passwordHashNeedsUpgrade(await hashPassword("new secure phrase")), false);
});

test("bcrypt passwords over 72 bytes are not opportunistically rehashed", async () => {
  assert.equal(
    await hashAuthenticatedPasswordForUpgrade("\ud83d\udd10".repeat(40)),
    null,
  );
  assert.match(
    (await hashAuthenticatedPasswordForUpgrade("legacy safe phrase")) ?? "",
    /^\$argon2id\$/,
  );
});
