import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { MfaEncryptionKey } from "../config/mfa.js";

const ENVELOPE_PREFIX = "wcibenc";
const ENVELOPE_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export interface MfaEncryptionKeyRing {
  all: readonly MfaEncryptionKey[];
  current: MfaEncryptionKey;
}

export function encryptMfaSecret(
  plaintext: string,
  context: Readonly<Record<string, string>>,
  keyRing: MfaEncryptionKeyRing,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyRing.current.key, iv);
  cipher.setAAD(serializeContext(context));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    ENVELOPE_PREFIX,
    ENVELOPE_VERSION,
    keyRing.current.id,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptMfaSecret(
  envelope: string,
  context: Readonly<Record<string, string>>,
  keyRing: MfaEncryptionKeyRing,
): string {
  const parts = envelope.split(":");
  if (
    parts.length !== 6 ||
    parts[0] !== ENVELOPE_PREFIX ||
    parts[1] !== ENVELOPE_VERSION
  ) {
    throw new Error("Invalid MFA secret envelope");
  }
  const key = keyRing.all.find((candidate) => candidate.id === parts[2]);
  if (key === undefined) {
    throw new Error(`No MFA encryption key is configured for key id ${parts[2]}`);
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key.key,
    Buffer.from(parts[3] ?? "", "base64url"),
  );
  decipher.setAAD(serializeContext(context));
  decipher.setAuthTag(Buffer.from(parts[4] ?? "", "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[5] ?? "", "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function mfaSecretContext(
  userId: string,
  methodId: string,
): Readonly<Record<string, string>> {
  return Object.freeze({ methodId, purpose: "mfa-totp-secret", userId });
}

export function hashMfaValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializeContext(context: Readonly<Record<string, string>>): Buffer {
  const normalized = Object.keys(context)
    .sort()
    .reduce<Record<string, string>>((result, key) => {
      result[key] = context[key] ?? "";
      return result;
    }, {});
  return Buffer.from(JSON.stringify(normalized), "utf8");
}
