import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoginRequest } from "../../shared/login.js";
import {
  authenticateLoginCredentials,
  type LoginCredentialDependencies,
} from "./login.js";
import type { UserAccount, UserCredentials } from "./users.js";

const request: LoginRequest = {
  email: "user@example.test",
  password: "StrongPass123!",
};

function account(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    displayName: "Login User",
    email: request.email,
    id: "00000000-0000-4000-8000-000000000001",
    isActive: true,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
    ...overrides,
  };
}

function dependencies(options: {
  credentials: UserCredentials | null;
  passwordMatches: boolean;
  verifiedHashes: string[];
}): LoginCredentialDependencies {
  return {
    async findCredentialsByEmail() {
      return options.credentials;
    },
    async verifyPassword(_password, passwordHash) {
      options.verifiedHashes.push(passwordHash);
      return options.passwordMatches;
    },
  };
}

test("unknown login identities still execute a bounded password comparison", async () => {
  const verifiedHashes: string[] = [];
  const result = await authenticateLoginCredentials(
    request,
    dependencies({ credentials: null, passwordMatches: false, verifiedHashes }),
  );

  assert.equal(result, null);
  assert.equal(verifiedHashes.length, 1);
  assert.match(verifiedHashes[0] ?? "", /^\$2b\$10\$/);
});

test("wrong passwords and disabled users use the same failed result", async () => {
  const activeCredentials = {
    account: account(),
    passwordHash: "$2b$10$active",
  };
  const disabledCredentials = {
    account: account({ isActive: false }),
    passwordHash: "$2b$10$disabled",
  };

  assert.equal(
    await authenticateLoginCredentials(
      request,
      dependencies({
        credentials: activeCredentials,
        passwordMatches: false,
        verifiedHashes: [],
      }),
    ),
    null,
  );
  assert.equal(
    await authenticateLoginCredentials(
      request,
      dependencies({
        credentials: disabledCredentials,
        passwordMatches: true,
        verifiedHashes: [],
      }),
    ),
    null,
  );
});

test("active users with valid passwords authenticate", async () => {
  const activeAccount = account();
  const result = await authenticateLoginCredentials(
    request,
    dependencies({
      credentials: {
        account: activeAccount,
        passwordHash: "$2b$10$active",
      },
      passwordMatches: true,
      verifiedHashes: [],
    }),
  );

  assert.deepEqual(result, {
    account: activeAccount,
    verifiedPasswordHash: "$2b$10$active",
  });
});
