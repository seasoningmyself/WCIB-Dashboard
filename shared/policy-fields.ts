export const DRAFT_STATUSES = [
  "draft",
  "submitted",
  "flagged",
  "sent_back",
  "approved",
] as const;

export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const COMMISSION_MODES = ["pct", "tbd", "na"] as const;

export type CommissionMode = (typeof COMMISSION_MODES)[number];

export const PAYMENT_MODES = ["full", "deposit", "direct"] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

// These values intentionally preserve v15's business-specific assignment model.
export const ACCOUNT_ASSIGNMENTS = ["none", "book", "house"] as const;

export type AccountAssignment = (typeof ACCOUNT_ASSIGNMENTS)[number];

export const IPFS_FINANCING_CHOICES = ["yes", "no"] as const;

export type IpfsFinancingChoice = (typeof IPFS_FINANCING_CHOICES)[number];

export const IPFS_CUSTOMER_TYPES = ["new", "returning"] as const;

export type IpfsCustomerType = (typeof IPFS_CUSTOMER_TYPES)[number];

export const APPROVAL_QUEUE_STATUSES = [
  "pending",
  "sent_back",
  "flagged",
] as const;

export type ApprovalQueueStatus = (typeof APPROVAL_QUEUE_STATUSES)[number];

export const KAYLEE_PRODUCER_SHARE_PERCENT = 25 as const;

export const RECEIVABLE_STATUSES = ["paid", "partial", "open"] as const;

export type ReceivableStatus = (typeof RECEIVABLE_STATUSES)[number];

export const PAYABLE_STATUSES = [
  "paid",
  "partially_remitted",
  "unpaid",
] as const;

export type PayableStatus = (typeof PAYABLE_STATUSES)[number];
