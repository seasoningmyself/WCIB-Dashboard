import { z } from "zod";

const uuidSchema = z.string().uuid();

export const officeSelectionModeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      activeCount: z.literal(0),
      kind: z.literal("unconfigured"),
      soleOfficeId: z.null(),
    })
    .strict(),
  z
    .object({
      activeCount: z.literal(1),
      kind: z.literal("single"),
      soleOfficeId: uuidSchema,
    })
    .strict(),
  z
    .object({
      activeCount: z.number().int().min(2).max(500),
      kind: z.literal("multiple"),
      soleOfficeId: z.null(),
    })
    .strict(),
]);

export type OfficeSelectionMode = z.output<typeof officeSelectionModeSchema>;

export function deriveOfficeSelectionMode(
  activeOffices: readonly { id: string }[],
): OfficeSelectionMode {
  if (activeOffices.length === 0) {
    return { activeCount: 0, kind: "unconfigured", soleOfficeId: null };
  }
  if (activeOffices.length === 1) {
    return {
      activeCount: 1,
      kind: "single",
      soleOfficeId: activeOffices[0]!.id,
    };
  }
  return {
    activeCount: activeOffices.length,
    kind: "multiple",
    soleOfficeId: null,
  };
}

export function officeSelectionModeMatches(
  mode: OfficeSelectionMode,
  activeOffices: readonly { id: string }[],
): boolean {
  if (mode.activeCount !== activeOffices.length) {
    return false;
  }
  return mode.kind !== "single" || activeOffices[0]?.id === mode.soleOfficeId;
}
