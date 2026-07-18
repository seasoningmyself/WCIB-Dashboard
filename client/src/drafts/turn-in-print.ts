import type { CurrentUser } from "../../../shared/current-user.js";
import type { ActiveVocabularyResponse } from "../../../shared/vocabulary.js";
import {
  calculateTurnInSummary,
  getTurnInWording,
  type TurnInFormState,
} from "./turn-in-state.js";

export interface TurnInPrintRow {
  label: string;
  value: string;
}

export interface TurnInPrintSection {
  rows: readonly TurnInPrintRow[];
  title: string;
}

export interface TurnInPrintModel {
  printedAt: string;
  sections: readonly TurnInPrintSection[];
  submitter: string;
  title: string;
}

export function buildTurnInPrintModel({
  assignmentLabel,
  form,
  printedAt = new Date(),
  user,
  vocabulary,
}: {
  assignmentLabel: string;
  form: TurnInFormState;
  printedAt?: Date;
  user: CurrentUser;
  vocabulary: ActiveVocabularyResponse | null;
}): TurnInPrintModel {
  const summary = calculateTurnInSummary(form);
  const wording = getTurnInWording(form.transactionType);
  const policyRows = compactRows([
    row("Insured", form.insuredName),
    row("Company", form.companyName),
    row("Policy number", form.policyNumber),
    row("Policy type", vocabularyName(vocabulary?.policyTypes, form.policyTypeId)),
    row("Transaction", form.transactionType),
    row("Invoice number", form.invoiceNumber),
    row(wording.notesLabel, form.transactionNotes),
    row("Effective date", form.effectiveDate),
    row("Expiration date", form.expirationDate),
    row("Carrier", vocabularyName(vocabulary?.carriers, form.carrierId)),
    row("MGA", vocabularyName(vocabulary?.mgas, form.mgaId)),
    row("Account", assignmentLabel),
    row("Office", vocabularyName(vocabulary?.officeLocations, form.officeLocationId)),
  ]);
  const premiumRows = compactRows([
    moneyRow("Base premium", form.basePremium),
    moneyRow("Taxes", form.taxes),
    moneyRow("MGA fee", form.mgaFee),
    moneyRow("Broker fee", form.brokerFee),
    moneyRow(
      wording.invoiceTransaction ? "WCIB Invoiced Total" : "Proposal total",
      form.proposalTotal,
    ),
    moneyRow(
      wording.invoiceTransaction
        ? "Deposit option (from carrier)"
        : "Deposit option (from quote)",
      form.depositOption,
    ),
    moneyRow("Net due to MGA", summary.netDue),
  ]);
  const commissionRows = compactRows([
    row("Commission type", commissionModeLabel(form.commissionMode)),
    form.commissionMode === "pct" && form.commissionRate.trim() !== ""
      ? row("Carrier commission rate", `${form.commissionRate}%`)
      : null,
    moneyRow("Agency commission total", summary.commissionAmount),
  ]);
  const paymentRows = compactRows([
    row("Payment type", paymentModeLabel(form.paymentMode)),
    moneyRow("Amount collected", form.amountPaid),
    form.paymentMode === "deposit"
      ? moneyRow("Financed balance", summary.financeBalance)
      : null,
    form.paymentMode === "deposit"
      ? row("Finance reference", form.financeReference)
      : null,
  ]);

  return {
    printedAt: formatPrintDate(printedAt),
    sections: [
      { rows: policyRows, title: "Policy" },
      { rows: premiumRows, title: "Premium detail" },
      { rows: commissionRows, title: "Commission" },
      { rows: paymentRows, title: "Payment" },
      { rows: compactRows([row("General notes", form.notes)]), title: "Notes" },
    ].filter(({ rows }) => rows.length > 0),
    submitter: user.displayName ?? user.email,
    title: "Internal - New Check Turn-In",
  };
}

export function printTurnInModel(model: TurnInPrintModel): void {
  const sheet = document.createElement("section");
  sheet.className = "turn-in-print-sheet";
  sheet.setAttribute("aria-hidden", "true");

  const header = document.createElement("header");
  const title = document.createElement("h1");
  title.textContent = model.title;
  const meta = document.createElement("p");
  meta.textContent = `Submitter: ${model.submitter} | Date: ${model.printedAt}`;
  header.append(title, meta);
  sheet.append(header);

  for (const section of model.sections) {
    const sectionElement = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = section.title;
    const list = document.createElement("dl");
    for (const item of section.rows) {
      const term = document.createElement("dt");
      term.textContent = item.label;
      const description = document.createElement("dd");
      description.textContent = item.value;
      list.append(term, description);
    }
    sectionElement.append(heading, list);
    sheet.append(sectionElement);
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("print-turn-in");
    sheet.remove();
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  document.body.classList.add("print-turn-in");
  document.body.append(sheet);
  window.print();
  window.setTimeout(cleanup, 1_500);
}

function compactRows(
  rows: readonly (TurnInPrintRow | null)[],
): TurnInPrintRow[] {
  return rows.filter((item): item is TurnInPrintRow => item !== null);
}

function row(label: string, rawValue: string | null | undefined): TurnInPrintRow | null {
  const value = rawValue?.trim() ?? "";
  return value === "" ? null : { label, value };
}

function moneyRow(label: string, value: string | null): TurnInPrintRow | null {
  if (value === null || value.trim() === "" || !Number.isFinite(Number(value))) {
    return null;
  }
  return {
    label,
    value: new Intl.NumberFormat("en-US", {
      currency: "USD",
      style: "currency",
    }).format(Number(value)),
  };
}

function vocabularyName(
  items: readonly { id: string; name: string }[] | undefined,
  id: string | null,
): string {
  return items?.find((item) => item.id === id)?.name ?? "";
}

function commissionModeLabel(mode: TurnInFormState["commissionMode"]): string {
  if (mode === "pct") return "Percentage";
  if (mode === "tbd") return "TBD";
  return "N/A";
}

function paymentModeLabel(mode: TurnInFormState["paymentMode"]): string {
  if (mode === "deposit") return "Deposit";
  if (mode === "direct") return "Direct bill";
  return "Paid in full";
}

function formatPrintDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
