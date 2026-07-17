import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RequestHandler, Response } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  adminLedgerPolicySchema,
  policyLedgerLabelsSchema,
} from "../../shared/policy-ledger.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  ipfsWorkQueueCsvChunks,
  type ProjectedIpfsWorkQueueRow,
} from "../policies/ipfs-work-queue-csv.js";
import {
  PolicyLedgerBoundsError,
  type IpfsWorkQueueSourceItem,
} from "../policies/ledger.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import {
  projectAdminPolicy,
  projectAdminPolicyFinancialSplit,
} from "../policies/projection.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const IPFS_WORK_QUEUE_EXPORT_PATH = "/api/ipfs/work-queue.csv";

export type IpfsWorkQueueCsvStreamer = (
  response: Response,
  rows: readonly ProjectedIpfsWorkQueueRow[],
) => Promise<number>;

export interface IpfsWorkQueueHandlerDependencies {
  clock?(): Date;
  list(context: AuthorizedRequestContext): Promise<readonly IpfsWorkQueueSourceItem[]>;
  logger: AppLogger;
  stream?: IpfsWorkQueueCsvStreamer;
}

export interface RegisterIpfsWorkQueueRouteOptions
  extends IpfsWorkQueueHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createIpfsWorkQueueHandler(
  dependencies: IpfsWorkQueueHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    let source: readonly IpfsWorkQueueSourceItem[];
    try {
      source = await dependencies.list(context);
    } catch (error) {
      if (error instanceof PolicyLedgerBoundsError) {
        throw new HttpError(409, apiErrorCodes.badRequest, "IPFS work queue is too large");
      }
      throw error;
    }
    if (source.length === 0) {
      throw new HttpError(404, apiErrorCodes.notFound, "No IPFS work is pending");
    }
    const rows = source.map((item) => projectWorkQueueRow(res, item));
    const generatedAt = dependencies.clock?.() ?? new Date();
    setCsvHeaders(res, generatedAt);
    const stream = dependencies.stream ?? streamIpfsWorkQueueCsvResponse;
    let byteCount: number;
    try {
      byteCount = await stream(res, rows);
    } catch (error) {
      dependencies.logger.error("IPFS work-queue export failed", {
        component: "ipfs_work_queue",
        event: "ipfs_work_queue_export_failed",
        resultCount: rows.length,
        userId: context.principal.userId,
      }, error);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      clearCsvHeaders(res);
      throw error;
    }
    dependencies.logger.info("IPFS work-queue export streamed", {
      byteCount,
      component: "ipfs_work_queue",
      event: "ipfs_work_queue_export_streamed",
      resultCount: rows.length,
      userId: context.principal.userId,
    });
  });
}

export function registerIpfsWorkQueueRoute(
  routes: RouteRegistrar,
  options: RegisterIpfsWorkQueueRouteOptions,
): void {
  routes.get(
    IPFS_WORK_QUEUE_EXPORT_PATH,
    { authorization: options.authorization.require(POLICY_LEDGER_ADMIN_ACCESS) },
    createIpfsWorkQueueHandler(options),
  );
}

export async function streamIpfsWorkQueueCsvResponse(
  response: Response,
  rows: readonly ProjectedIpfsWorkQueueRow[],
): Promise<number> {
  const counter = new ByteCounter();
  await pipeline(Readable.from(ipfsWorkQueueCsvChunks(rows)), counter, response);
  return counter.byteCount;
}

function projectWorkQueueRow(
  response: Response,
  source: IpfsWorkQueueSourceItem,
): ProjectedIpfsWorkQueueRow {
  const policy = projectAuthorizedFields(response, source.policy, projectAdminPolicy);
  if (policy === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  const split = projectAuthorizedFields(
    response,
    source,
    projectAdminPolicyFinancialSplit,
  );
  if (split === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return {
    labels: policyLedgerLabelsSchema.parse(source.labels),
    policy: adminLedgerPolicySchema.parse(policy),
    ...split,
  };
}

function setCsvHeaders(response: Response, generatedAt: Date): void {
  if (Number.isNaN(generatedAt.getTime())) {
    throw new HttpError(500, apiErrorCodes.internal, "Export could not be generated");
  }
  response.status(200).set({
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="WCIB_IPFS_Financed_${generatedAt.toISOString().slice(0, 10)}.csv"`,
    "Content-Type": "text/csv; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
}

function clearCsvHeaders(response: Response): void {
  for (const header of [
    "Cache-Control",
    "Content-Disposition",
    "Content-Type",
    "Cross-Origin-Resource-Policy",
    "Pragma",
    "Referrer-Policy",
    "X-Content-Type-Options",
  ]) response.removeHeader(header);
}

class ByteCounter extends Transform {
  byteCount = 0;

  override _transform(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.byteCount += Buffer.byteLength(chunk);
    callback(null, chunk);
  }
}
