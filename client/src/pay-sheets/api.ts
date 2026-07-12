import { z } from "zod";
import {
  paySheetAdjustmentInputSchema,
  paySheetAdjustmentMutationResponseSchema,
  type PaySheetAdjustmentInput,
} from "../../../shared/pay-sheet-adjustment-api.js";
import {
  paySheetCloseRequestSchema,
  paySheetCloseResponseSchema,
  paySheetDetailResponseSchema,
  paySheetListResponseSchema,
  type PaySheetCloseResponse,
  type PaySheetDetailResponse,
  type PaySheetListResponse,
} from "../../../shared/pay-sheet-api.js";
import {
  draftAssignmentOptionsResponseSchema,
  type DraftAssignmentOptionsResponse,
} from "../../../shared/draft-assignment-options.js";
import {
  paySheetExportQuerySchema,
  type PaySheetExportFormat,
  type PaySheetExportQuery,
} from "../../../shared/pay-sheet-export.js";
import type { ApiClient } from "../api/client.js";

export type PaySheetsApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class PaySheetsApiError extends Error {
  constructor(readonly kind: PaySheetsApiErrorKind) {
    super("Pay-sheet request could not be completed");
    this.name = "PaySheetsApiError";
  }
}

export interface PaySheetExportDocument {
  blob: Blob;
  filename: string;
  format: PaySheetExportFormat;
}

export interface PaySheetsApi {
  close(paySheetId: string): Promise<PaySheetCloseResponse>;
  createAdjustment(
    paySheetId: string,
    input: PaySheetAdjustmentInput,
  ): Promise<PaySheetDetailResponse>;
  deleteAdjustment(adjustmentId: string): Promise<PaySheetDetailResponse>;
  exportDocument(
    format: PaySheetExportFormat,
    query: PaySheetExportQuery,
    signal?: AbortSignal,
  ): Promise<PaySheetExportDocument>;
  get(paySheetId: string): Promise<PaySheetDetailResponse>;
  list(): Promise<PaySheetListResponse>;
  listAssignmentOptions(): Promise<DraftAssignmentOptionsResponse>;
  updateAdjustment(
    adjustmentId: string,
    input: PaySheetAdjustmentInput,
  ): Promise<PaySheetDetailResponse>;
}

export function createPaySheetsApi(client: ApiClient): PaySheetsApi {
  return {
    close: (paySheetId) =>
      mutate(
        client,
        `/pay-sheets/${encodeURIComponent(paySheetId)}/close`,
        "POST",
        paySheetCloseRequestSchema.parse({}),
        paySheetCloseResponseSchema,
      ),
    async createAdjustment(paySheetId, input) {
      const normalized = parseRequest(paySheetAdjustmentInputSchema, input);
      const response = await mutate(
        client,
        `/pay-sheets/${encodeURIComponent(paySheetId)}/adjustments`,
        "POST",
        normalized,
        paySheetAdjustmentMutationResponseSchema,
      );
      return paySheetDetailResponseSchema.parse({ sheet: response.sheet });
    },
    async deleteAdjustment(adjustmentId) {
      const response = await mutate(
        client,
        `/pay-sheet-adjustments/${encodeURIComponent(adjustmentId)}`,
        "DELETE",
        {},
        paySheetAdjustmentMutationResponseSchema,
      );
      return paySheetDetailResponseSchema.parse({ sheet: response.sheet });
    },
    exportDocument: (format, query, signal) =>
      readExport(client, format, query, signal),
    get: (paySheetId) =>
      read(
        client,
        `/pay-sheets/${encodeURIComponent(paySheetId)}`,
        paySheetDetailResponseSchema,
      ),
    list: () =>
      read(
        client,
        "/pay-sheets?ownerType=all&status=all",
        paySheetListResponseSchema,
      ),
    listAssignmentOptions: () =>
      read(
        client,
        "/draft-assignment-options",
        draftAssignmentOptionsResponseSchema,
      ),
    async updateAdjustment(adjustmentId, input) {
      const normalized = parseRequest(paySheetAdjustmentInputSchema, input);
      const response = await mutate(
        client,
        `/pay-sheet-adjustments/${encodeURIComponent(adjustmentId)}`,
        "PUT",
        normalized,
        paySheetAdjustmentMutationResponseSchema,
      );
      return paySheetDetailResponseSchema.parse({ sheet: response.sheet });
    },
  };
}

async function readExport(
  client: ApiClient,
  format: PaySheetExportFormat,
  rawQuery: PaySheetExportQuery,
  signal?: AbortSignal,
): Promise<PaySheetExportDocument> {
  const parsed = paySheetExportQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw new PaySheetsApiError("rejected");
  const query = new URLSearchParams({
    periodMonth: String(parsed.data.periodMonth),
    periodYear: String(parsed.data.periodYear),
  });
  if (parsed.data.ownerUserId !== null) {
    query.set("ownerUserId", parsed.data.ownerUserId);
  }

  let response: Response;
  try {
    response = await client.request(
      `/pay-sheets/exports/${format === "excel" ? "excel" : "print"}?${query}`,
      {
        cache: "no-store",
        headers: {
          Accept: format === "excel"
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/html",
        },
        method: "GET",
        signal,
      },
    );
  } catch {
    throw new PaySheetsApiError("unavailable");
  }
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new PaySheetsApiError("denied");
    }
    if (response.status === 400) throw new PaySheetsApiError("rejected");
    if (response.status === 404 || response.status === 409) {
      throw new PaySheetsApiError("conflict");
    }
    throw new PaySheetsApiError("unavailable");
  }

  const filename = exportFilenameFromHeaders(response.headers, format);
  if (filename === null) throw new PaySheetsApiError("invalid_response");
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new PaySheetsApiError("unavailable");
  }
  if (blob.size === 0) throw new PaySheetsApiError("invalid_response");
  return Object.freeze({ blob, filename, format });
}

function exportFilenameFromHeaders(
  headers: Headers,
  format: PaySheetExportFormat,
): string | null {
  const expectedType = format === "excel"
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/html";
  if (headers.get("content-type")?.split(";", 1)[0]?.trim() !== expectedType) {
    return null;
  }
  const mode = format === "excel" ? "attachment" : "inline";
  const disposition = headers.get("content-disposition");
  const match = disposition === null
    ? null
    : new RegExp(`^${mode}; filename=\"(WCIB_Pay_Sheets?_\\d{4}-\\d{2}\\.${format === "excel" ? "xlsx" : "html"})\"$`).exec(disposition);
  return match?.[1] ?? null;
}

async function read<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await client.request(path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  } catch {
    throw new PaySheetsApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function mutate<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  method: "DELETE" | "POST" | "PUT",
  body: unknown,
  schema: Schema,
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await client.request(path, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method,
    });
  } catch {
    throw new PaySheetsApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new PaySheetsApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new PaySheetsApiError("conflict");
    }
    if (response.status === 400) {
      throw new PaySheetsApiError("rejected");
    }
    throw new PaySheetsApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PaySheetsApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PaySheetsApiError("invalid_response");
  }
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PaySheetsApiError("rejected");
  return parsed.data;
}
