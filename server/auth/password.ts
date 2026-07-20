import bcrypt from "bcryptjs";
import {
  argon2id,
  hash as hashWithArgon2,
  needsRehash as argon2NeedsRehash,
  verify as verifyWithArgon2,
} from "argon2";
import {
  normalizePassword,
  passwordSchema,
} from "../../shared/password-policy.js";

export const PASSWORD_HASH_ROUNDS = 10;
export const ARGON2ID_OPTIONS = Object.freeze({
  memoryCost: 19_456,
  parallelism: 1,
  timeCost: 2,
  type: argon2id,
});

const BCRYPT_MAX_PASSWORD_BYTES = 72;

export async function hashPassword(password: string): Promise<string> {
  const validatedPassword = passwordSchema.parse(password);
  return hashWithArgon2(validatedPassword, ARGON2ID_OPTIONS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    if (passwordHash.startsWith("$argon2id$")) {
      return await verifyWithArgon2(passwordHash, normalizePassword(password));
    }
    if (passwordHash.startsWith("$2")) {
      return await bcrypt.compare(password, passwordHash);
    }
    return false;
  } catch {
    return false;
  }
}

export function passwordHashNeedsUpgrade(passwordHash: string): boolean {
  if (passwordHash.startsWith("$2")) {
    return true;
  }
  if (!passwordHash.startsWith("$argon2id$")) {
    return false;
  }
  try {
    return argon2NeedsRehash(passwordHash, ARGON2ID_OPTIONS);
  } catch {
    return false;
  }
}

export async function hashAuthenticatedPasswordForUpgrade(
  password: string,
): Promise<string | null> {
  const normalized = normalizePassword(password);
  if (Buffer.byteLength(normalized, "utf8") > BCRYPT_MAX_PASSWORD_BYTES) {
    return null;
  }
  return hashWithArgon2(normalized, ARGON2ID_OPTIONS);
}
