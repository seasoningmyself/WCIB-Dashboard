import React, { type ReactNode } from "react";
import { policyTypeClassLabel } from "../../../shared/policy-types.js";
import type {
  PolicyTypeOption,
  VocabularyOption,
} from "../../../shared/vocabulary.js";
import { useVocabulary } from "./context.js";
import { VocabularyPicker } from "./VocabularyPicker.js";

export interface CommonPickerProps {
  disabled?: boolean;
  focusRequestKey?: number;
  id: string;
  label?: string;
  name?: string;
  onChange(value: string | null): void;
  onValidityChange?(valid: boolean): void;
  renderInlineAction?(query: string): ReactNode;
  required?: boolean;
  value: string | null;
}

export interface CarrierPickerProps extends CommonPickerProps {}

const CARRIER_MGA_CONVENIENCES = new Map<string, string>([
  ["western surety", "CNA"],
  ["progressive", "Progressive"],
  ["geico", "GEICO"],
  ["travelers", "Travelers"],
]);

export function CarrierPicker({
  label = "Insurance company",
  onChange,
  ...props
}: CarrierPickerProps) {
  const vocabulary = useVocabulary();
  const options = readyOptions(vocabulary.state, "carriers");
  return (
    <VocabularyPicker
      {...props}
      helpText="Select an active insurance company."
      label={label}
      loadStatus={vocabulary.state.status}
      onChange={(option) => onChange(option?.id ?? null)}
      onRetry={vocabulary.retry}
      options={options}
    />
  );
}

export function MgaPicker({
  label = "MGA",
  onChange,
  ...props
}: CommonPickerProps) {
  const vocabulary = useVocabulary();
  return (
    <VocabularyPicker
      {...props}
      helpText="Select the active MGA payable-to identity."
      label={label}
      loadStatus={vocabulary.state.status}
      onChange={(option) => onChange(option?.id ?? null)}
      onRetry={vocabulary.retry}
      options={readyOptions(vocabulary.state, "mgas")}
    />
  );
}

export function OfficeLocationPicker({
  label = "Office location",
  onChange,
  ...props
}: CommonPickerProps) {
  const vocabulary = useVocabulary();
  return (
    <VocabularyPicker
      {...props}
      helpText="Select an active office location."
      label={label}
      loadStatus={vocabulary.state.status}
      onChange={(option) => onChange(option?.id ?? null)}
      onRetry={vocabulary.retry}
      options={readyOptions(vocabulary.state, "officeLocations")}
    />
  );
}

export function PolicyTypePicker({
  label = "Policy type",
  onChange,
  ...props
}: CommonPickerProps) {
  const vocabulary = useVocabulary();
  return (
    <VocabularyPicker
      {...props}
      getMeta={(option) => policyTypeClassLabel(option.classTag)}
      helpText="Select an active policy type."
      label={label}
      loadStatus={vocabulary.state.status}
      onChange={(option) => onChange(option?.id ?? null)}
      onRetry={vocabulary.retry}
      options={readyOptions(vocabulary.state, "policyTypes")}
    />
  );
}

export function resolveCarrierConvenienceMga(
  carrierName: string,
  activeMgas: readonly VocabularyOption[],
): { item: VocabularyOption | null; name: string } | null {
  const normalizedCarrier = carrierName.toLowerCase();
  const targetName = [...CARRIER_MGA_CONVENIENCES].find(([fragment]) =>
    normalizedCarrier.includes(fragment)
  )?.[1];
  if (targetName === undefined) {
    return null;
  }
  return {
    item: activeMgas.find(
      ({ name }) => name.toLowerCase() === targetName.toLowerCase(),
    ) ?? null,
    name: targetName,
  };
}

function readyOptions(
  state: ReturnType<typeof useVocabulary>["state"],
  key: "carriers" | "mgas" | "officeLocations",
): readonly VocabularyOption[];
function readyOptions(
  state: ReturnType<typeof useVocabulary>["state"],
  key: "policyTypes",
): readonly PolicyTypeOption[];
function readyOptions(
  state: ReturnType<typeof useVocabulary>["state"],
  key: "carriers" | "mgas" | "officeLocations" | "policyTypes",
): readonly VocabularyOption[] | readonly PolicyTypeOption[] {
  return state.status === "ready" ? state.data[key] : [];
}
