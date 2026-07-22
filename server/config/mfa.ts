import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NodeEnvironment } from "./environment.js";

const DEFAULT_LOCAL_ORIGIN = "http://localhost:5173";
const DEFAULT_RP_NAME = "West Coast Insurance Brokers";

export interface MfaEncryptionKey {
  id: string;
  key: Buffer;
}

export interface MfaConfig {
  adminEnforcementEnabled: boolean;
  encryptionKeys: {
    all: readonly MfaEncryptionKey[];
    current: MfaEncryptionKey;
  };
  webAuthn: {
    origin: string;
    rpId: string;
    rpName: string;
  };
}

export function readMfaConfig(
  env: NodeJS.ProcessEnv,
  nodeEnv: NodeEnvironment,
  sessionSecret: string,
): MfaConfig {
  const current = readCurrentEncryptionKey(env, nodeEnv, sessionSecret);
  const previous = readPreviousEncryptionKeys(env.MFA_PREVIOUS_ENCRYPTION_KEYS);
  const ids = new Set<string>();
  for (const entry of [current, ...previous]) {
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate MFA encryption key id: ${entry.id}`);
    }
    ids.add(entry.id);
  }

  const origin = readOrigin(env.WEBAUTHN_ORIGIN, nodeEnv);
  const originHost = new URL(origin).hostname.toLowerCase();
  const rpId = readRpId(env.WEBAUTHN_RP_ID ?? originHost);
  if (!rpIdMatchesOrigin(rpId, originHost)) {
    throw new Error(
      "WEBAUTHN_RP_ID must match the WebAuthn origin host or a parent domain",
    );
  }
  const rpName = (env.WEBAUTHN_RP_NAME ?? DEFAULT_RP_NAME).trim();
  if (rpName.length === 0) {
    throw new Error("WEBAUTHN_RP_NAME must not be blank");
  }

  return Object.freeze({
    adminEnforcementEnabled: readBoolean(
      env.WCIB_ADMIN_MFA_REQUIRED,
      "WCIB_ADMIN_MFA_REQUIRED",
      false,
    ),
    encryptionKeys: Object.freeze({
      all: Object.freeze([current, ...previous]),
      current,
    }),
    webAuthn: Object.freeze({ origin, rpId, rpName }),
  });
}

function readCurrentEncryptionKey(
  env: NodeJS.ProcessEnv,
  nodeEnv: NodeEnvironment,
  sessionSecret: string,
): MfaEncryptionKey {
  const configured = env.MFA_ENCRYPTION_KEY?.trim();
  if (configured === undefined || configured.length === 0) {
    if (nodeEnv === "production") {
      throw new Error("MFA_ENCRYPTION_KEY is required in production");
    }
    return Object.freeze({
      id: "development",
      key: createHash("sha256")
        .update(`wcib-development-mfa:${sessionSecret}`)
        .digest(),
    });
  }

  return Object.freeze({
    id: readKeyId(env.MFA_ENCRYPTION_KEY_ID ?? "current", "MFA_ENCRYPTION_KEY_ID"),
    key: readKey(configured, "MFA_ENCRYPTION_KEY"),
  });
}

function readPreviousEncryptionKeys(value: string | undefined): MfaEncryptionKey[] {
  if (value?.trim() === undefined || value.trim().length === 0) {
    return [];
  }
  return value.split(",").map((rawEntry, index) => {
    const entry = rawEntry.trim();
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator === entry.length - 1) {
      throw new Error(
        `MFA_PREVIOUS_ENCRYPTION_KEYS entry ${index + 1} must be key-id:64-char-hex-key`,
      );
    }
    return Object.freeze({
      id: readKeyId(
        entry.slice(0, separator),
        `MFA_PREVIOUS_ENCRYPTION_KEYS entry ${index + 1}`,
      ),
      key: readKey(
        entry.slice(separator + 1),
        `MFA_PREVIOUS_ENCRYPTION_KEYS entry ${index + 1}`,
      ),
    });
  });
}

function readKey(value: string, name: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error(`${name} must be a 64-character hexadecimal key`);
  }
  return Buffer.from(value, "hex");
}

function readKeyId(value: string, name: string): string {
  const keyId = value.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(keyId)) {
    throw new Error(`${name} contains invalid characters`);
  }
  return keyId;
}

function readOrigin(
  value: string | undefined,
  nodeEnv: NodeEnvironment,
): string {
  const candidate = value?.trim() ||
    (nodeEnv === "production" ? undefined : DEFAULT_LOCAL_ORIGIN);
  if (candidate === undefined) {
    throw new Error("WEBAUTHN_ORIGIN is required in production");
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("WEBAUTHN_ORIGIN must be a valid URL");
  }
  if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error("WEBAUTHN_ORIGIN must contain only scheme, host, and port");
  }
  if (nodeEnv === "production" && url.protocol !== "https:") {
    throw new Error("WEBAUTHN_ORIGIN must use HTTPS in production");
  }
  if (url.protocol !== "https:" && !isLocalHost(url.hostname)) {
    throw new Error("HTTP WebAuthn origins are limited to local development");
  }
  return url.origin;
}

function readRpId(value: string): string {
  const rpId = value.trim().toLowerCase();
  if (
    rpId.length === 0 ||
    rpId.includes("://") ||
    rpId.includes(":") ||
    rpId.includes("/")
  ) {
    throw new Error("WEBAUTHN_RP_ID must be a hostname");
  }
  if (isIP(rpId) !== 0) {
    throw new Error("WEBAUTHN_RP_ID must be a hostname, not an IP address");
  }
  if (
    !isLocalHost(rpId) &&
    !rpId
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error("WEBAUTHN_RP_ID must be a valid hostname");
  }
  return rpId;
}

function rpIdMatchesOrigin(rpId: string, originHost: string): boolean {
  return (
    rpId === originHost ||
    (!isLocalHost(originHost) && originHost.endsWith(`.${rpId}`))
  );
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function readBoolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined || value.trim().length === 0) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}
