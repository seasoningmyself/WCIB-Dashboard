import { z } from "zod";
import type { AccessCapability, StaffRole } from "./access.js";
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
