import type { LoginRequest } from "../../shared/login.js";
import type { UserAccount, UserCredentials } from "./users.js";

const DUMMY_PASSWORD_HASH =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";

export interface LoginCredentialDependencies {
  findCredentialsByEmail(email: string): Promise<UserCredentials | null>;
  verifyPassword(password: string, passwordHash: string): Promise<boolean>;
}

export async function authenticateLoginCredentials(
  request: LoginRequest,
  dependencies: LoginCredentialDependencies,
): Promise<UserAccount | null> {
  const credentials = await dependencies.findCredentialsByEmail(request.email);
  const passwordMatches = await dependencies.verifyPassword(
    request.password,
    credentials?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (
    credentials === null ||
    !passwordMatches ||
    !credentials.account.isActive
  ) {
    return null;
  }

  return credentials.account;
}
