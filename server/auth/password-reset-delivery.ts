export interface PasswordResetDeliveryInput {
  email: string;
  expiresAt: Date;
  token: string;
}

export interface PasswordResetDelivery {
  send(input: PasswordResetDeliveryInput): Promise<void>;
}

export class PasswordResetDeliveryUnavailableError extends Error {
  constructor() {
    super("Password reset delivery is not configured");
    this.name = "PasswordResetDeliveryUnavailableError";
  }
}

export const unavailablePasswordResetDelivery: PasswordResetDelivery = {
  async send() {
    throw new PasswordResetDeliveryUnavailableError();
  },
};
