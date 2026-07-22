import type { AccessCapability } from "./access.js";
import { z } from "zod";
import { ACCESS_CAPABILITIES } from "./access.js";
import {
  MFA_AUTHENTICATION_STATES,
  mfaStateSchema,
} from "./mfa-scaffold.js";

export const APP_NAVIGATION_IDS = [
  "approvals",
  "help_requests",
  "policy_ledger",
  "mga_payables",
  "pay_sheets",
  "kpis",
  "manage_staff",
  "settings",
  "turn_in",
  "my_items",
  "my_commissions",
] as const;

export type AppNavigationId = (typeof APP_NAVIGATION_IDS)[number];

export const CURRENT_USER_ROLES = [
  "admin",
  "employee",
  "producer",
] as const;

export type CurrentUserRole = (typeof CURRENT_USER_ROLES)[number];

export const currentUserResponseSchema = z
  .object({
    user: z
      .object({
        allowedNavigation: z.array(z.enum(APP_NAVIGATION_IDS)),
        authenticationState: z.enum(MFA_AUTHENTICATION_STATES).optional(),
        capabilities: z.array(z.enum(ACCESS_CAPABILITIES)),
        displayName: z.string().min(1),
        email: z.string().email(),
        id: z.string().uuid(),
        mfa: mfaStateSchema.optional(),
        passwordChangeRequired: z.boolean(),
        role: z.enum(CURRENT_USER_ROLES).nullable(),
      })
      .strict(),
  })
  .strict();

export type CurrentUserResponse = z.output<
  typeof currentUserResponseSchema
>;

export type CurrentUser = CurrentUserResponse["user"];
