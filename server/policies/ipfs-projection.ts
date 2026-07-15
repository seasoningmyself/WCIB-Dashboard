import type { IpfsPriorFinancingResponse } from "../../shared/ipfs.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { IpfsPriorFinancingSource } from "./ipfs-history.js";

export function projectIpfsPriorFinancing(
  source: Readonly<IpfsPriorFinancingSource>,
  context: AuthorizedRequestContext,
): IpfsPriorFinancingResponse | null {
  const { principal } = context;
  const allowed =
    principal.userActive &&
    (principal.capabilities.includes("admin") ||
      principal.staffRole === "employee" ||
      principal.staffRole === "producer");
  if (!allowed) return null;

  return {
    priorFinancing:
      source.priorFinancing === null
        ? null
        : { lastFinancedAt: source.priorFinancing.approvedAt.toISOString() },
  };
}
