export class SupportDashboardAccessDeniedError extends Error {
  constructor() {
    super("Support dashboard access denied");
    this.name = "SupportDashboardAccessDeniedError";
  }
}

export class SupportDashboardBoundsError extends Error {
  constructor() {
    super("Support dashboard result exceeds its supported bound");
    this.name = "SupportDashboardBoundsError";
  }
}
