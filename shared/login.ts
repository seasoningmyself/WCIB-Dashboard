import { z } from "zod";
import {
  ACCESS_CAPABILITIES,
  STAFF_ROLES,
  type AccessCapability,
  type StaffRole,
} from "./access.js";
import { userEmailSchema } from "./user-credentials.js";

export const loginRequestSchema = z
  .object({
    email: userEmailSchema,
    password: z
      .string()
      .min(1, "Password is required")
      .max(1_024, "Password must be 1024 characters or fewer"),
  })
  .strict();

export type LoginRequest = z.output<typeof loginRequestSchema>;

export interface LoginUserSummary {
  capabilities: readonly AccessCapability[];
  email: string;
  id: string;
  staffRole: StaffRole | null;
}

export interface LoginResponse {
  user: LoginUserSummary;
}

export const loginResponseSchema = z
  .object({
    user: z
      .object({
        capabilities: z.array(z.enum(ACCESS_CAPABILITIES)),
        email: z.string().email(),
        id: z.string().uuid(),
        staffRole: z.enum(STAFF_ROLES).nullable(),
      })
      .strict(),
  })
  .strict();
