import { z } from "zod";
import {
  officeSelectionModeMatches,
  officeSelectionModeSchema,
  type OfficeSelectionMode,
} from "./office-selection.js";

export const OFFICE_LOCATION_NAME_MAX_LENGTH = 200;
export const ADMIN_OFFICE_LOCATION_MAX_RESULTS = 500;

const uuidSchema = z.string().uuid();
const timestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);
const officeNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(OFFICE_LOCATION_NAME_MAX_LENGTH);

export const adminOfficeLocationSchema = z
  .object({
    createdAt: timestampSchema,
    id: uuidSchema,
    isActive: z.boolean(),
    name: officeNameSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const adminOfficeModeSchema = officeSelectionModeSchema;

export const adminOfficeManagementResponseSchema = z
  .object({
    items: z.array(adminOfficeLocationSchema).max(ADMIN_OFFICE_LOCATION_MAX_RESULTS),
    mode: adminOfficeModeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const activeOffices = value.items.filter(({ isActive }) => isActive);
    if (!officeSelectionModeMatches(value.mode, activeOffices)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Office mode must match the active office rows",
        path: ["mode"],
      });
    }
  });

export const createAdminOfficeRequestSchema = z
  .object({ name: officeNameSchema })
  .strict();

export const renameAdminOfficeRequestSchema = z
  .object({ name: officeNameSchema })
  .strict();

export const adminOfficeParamsSchema = z
  .object({ officeLocationId: uuidSchema })
  .strict();

export type AdminOfficeLocation = z.output<typeof adminOfficeLocationSchema>;
export type AdminOfficeMode = OfficeSelectionMode;
export type AdminOfficeManagementResponse = z.output<
  typeof adminOfficeManagementResponseSchema
>;
export type CreateAdminOfficeRequest = z.output<
  typeof createAdminOfficeRequestSchema
>;
export type RenameAdminOfficeRequest = z.output<
  typeof renameAdminOfficeRequestSchema
>;
