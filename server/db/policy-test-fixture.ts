import { randomUUID } from "node:crypto";
import { createUser, type AuthDatabase } from "../auth/users.js";
import {
  carriers,
  drafts,
  mgas,
  officeLocations,
  policies,
  policyTypes,
  staffProfiles,
  type NewPolicyRecord,
} from "./schema.js";

export interface PolicyReferenceFixture {
  carrierId: string;
  mgaId: string;
  officeLocationId: string;
  policyTypeId: string;
  producerUserId: string;
  sourceDraftId: string;
  submittedByUserId: string;
}

export async function createPolicyReferenceFixture(
  database: AuthDatabase,
): Promise<PolicyReferenceFixture> {
  const suffix = randomUUID();
  const submitter = await createUser(database, {
    displayName: `Policy Submitter ${suffix}`,
    email: `policy-submitter-${suffix}@example.test`,
    password: "StrongPass123!",
  });
  const producer = await createUser(database, {
    displayName: `Policy Producer ${suffix}`,
    email: `policy-producer-${suffix}@example.test`,
    password: "StrongPass123!",
  });
  await database.insert(staffProfiles).values([
    { role: "employee", userId: submitter.id },
    { role: "producer", userId: producer.id },
  ]);

  const [office] = await database
    .insert(officeLocations)
    .values({ name: `Policy Office ${suffix}` })
    .returning({ id: officeLocations.id });
  const [mga] = await database
    .insert(mgas)
    .values({ name: `Policy MGA ${suffix}` })
    .returning({ id: mgas.id });
  const [carrier] = await database
    .insert(carriers)
    .values({ name: `Policy Carrier ${suffix}` })
    .returning({ id: carriers.id });
  const [policyType] = await database
    .insert(policyTypes)
    .values({ classTag: "Commercial", name: `Policy Type ${suffix}` })
    .returning({ id: policyTypes.id });
  const [sourceDraft] = await database
    .insert(drafts)
    .values({ ownerUserId: producer.id })
    .returning({ id: drafts.id });

  if (!office || !mga || !carrier || !policyType || !sourceDraft) {
    throw new Error("Policy reference fixture creation returned no row");
  }

  return {
    carrierId: carrier.id,
    mgaId: mga.id,
    officeLocationId: office.id,
    policyTypeId: policyType.id,
    producerUserId: producer.id,
    sourceDraftId: sourceDraft.id,
    submittedByUserId: submitter.id,
  };
}

export function policyTestInput(
  references: PolicyReferenceFixture,
  input: Partial<NewPolicyRecord> = {},
): NewPolicyRecord {
  const timestamp = new Date("2026-07-01T12:00:00.000Z");
  return {
    accountAssignment: "none",
    amountPaid: "0.00",
    approvedAt: timestamp,
    basePremium: "0.00",
    brokerFee: "0.00",
    carrierId: references.carrierId,
    commissionAmount: "0.00",
    commissionConfirmed: false,
    commissionMode: "na",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "0.00",
    insuredName: "Policy Test Insured",
    kayleeSplit: "none",
    mgaId: references.mgaId,
    netDue: "0.00",
    officeLocationId: references.officeLocationId,
    paymentMode: "full",
    policyNumber: `POLICY-${randomUUID()}`,
    policyTypeId: references.policyTypeId,
    proposalTotal: "0.00",
    sourceDraftId: references.sourceDraftId,
    submittedAt: timestamp,
    submittedByUserId: references.submittedByUserId,
    transactionType: "New",
    ...input,
  };
}
