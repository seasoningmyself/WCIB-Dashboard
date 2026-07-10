export const KPI_TARGET_SCOPE_TYPES = ["company", "producer"] as const;

export type KpiTargetScopeType = (typeof KPI_TARGET_SCOPE_TYPES)[number];
