import { z } from "zod";
import { passwordSchema } from "./password-policy.js";

export const userEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Email must be valid")
  .max(320, "Email must be 320 characters or fewer");

export const createUserCredentialsSchema = z.object({
  email: userEmailSchema,
  password: passwordSchema,
});

export type CreateUserCredentials = z.output<
  typeof createUserCredentialsSchema
>;
