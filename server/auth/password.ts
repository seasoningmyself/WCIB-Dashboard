import bcrypt from "bcryptjs";
import { passwordSchema } from "../../shared/password-policy.js";

export const PASSWORD_HASH_ROUNDS = 10;

export async function hashPassword(password: string): Promise<string> {
  const validatedPassword = passwordSchema.parse(password);
  return bcrypt.hash(validatedPassword, PASSWORD_HASH_ROUNDS);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}
