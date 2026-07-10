export const MGA_PAYMENT_STATUSES = ["unpaid", "paid"] as const;

export type MgaPaymentStatus = (typeof MGA_PAYMENT_STATUSES)[number];
