import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { PolicyChangeRequestRecord } from "../db/schema.js";

const OWNER_CHANGE_REQUEST_FIELDS = [
  "id",
  "policyId",
  "reason",
  "status",
  "resolution",
  "resolutionReason",
  "requestedAt",
  "resolvedAt",
] as const satisfies readonly (keyof PolicyChangeRequestRecord)[];

const ADMIN_CHANGE_REQUEST_FIELDS = [
  "id",
  "policyId",
  "requestedByUserId",
  "reason",
  "status",
  "resolution",
  "resolutionReason",
  "mutationKind",
  "mutationId",
  "requestedAt",
  "resolvedByUserId",
  "resolvedAt",
] as const satisfies readonly (keyof PolicyChangeRequestRecord)[];

export interface AdminPolicyChangeRequestSource {
  insuredName: string;
  policyNumber: string;
  request: PolicyChangeRequestRecord;
  requesterDisplayName: string;
}

export type OwnerPolicyChangeRequestProjection = Pick<
  PolicyChangeRequestRecord,
  (typeof OWNER_CHANGE_REQUEST_FIELDS)[number]
>;

export type AdminPolicyChangeRequestProjection = Omit<
  AdminPolicyChangeRequestSource,
  "request"
> & {
  request: Pick<
    PolicyChangeRequestRecord,
    (typeof ADMIN_CHANGE_REQUEST_FIELDS)[number]
  >;
};

export function projectOwnerPolicyChangeRequest(
  source: Readonly<PolicyChangeRequestRecord>,
  context: AuthorizedRequestContext,
): OwnerPolicyChangeRequestProjection | null {
  const { principal } = context;
  if (
    !principal.userActive ||
    principal.userId !== source.requestedByUserId ||
    (principal.staffRole !== "employee" && principal.staffRole !== "producer")
  ) {
    return null;
  }
  return pickFields(source, OWNER_CHANGE_REQUEST_FIELDS);
}

export function projectAdminPolicyChangeRequest(
  source: Readonly<AdminPolicyChangeRequestSource>,
  context: AuthorizedRequestContext,
): AdminPolicyChangeRequestProjection | null {
  const { principal } = context;
  if (!principal.userActive || !principal.capabilities.includes("admin")) {
    return null;
  }
  return {
    insuredName: source.insuredName,
    policyNumber: source.policyNumber,
    request: pickFields(source.request, ADMIN_CHANGE_REQUEST_FIELDS),
    requesterDisplayName: source.requesterDisplayName,
  };
}

function pickFields<
  TSource extends object,
  const TKeys extends readonly (keyof TSource)[],
>(source: Readonly<TSource>, fields: TKeys): Pick<TSource, TKeys[number]> {
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as Pick<
    TSource,
    TKeys[number]
  >;
}
