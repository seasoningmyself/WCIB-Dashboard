import React, { type ReactNode } from "react";
import type {
  PolicyTypeOption,
  VocabularyOption,
} from "../../../shared/vocabulary.js";
import { useVocabulary } from "./context.js";
import { VocabularyPicker } from "./VocabularyPicker.js";

interface CommonPickerProps {
  disabled?: boolean;
  id: string;
  label?: string;
  name?: string;
  onChange(value: string | null): void;
  onValidityChange?(valid: boolean): void;
  renderNoMatchAction?(query: string): ReactNode;
  required?: boolean;
  value: string | null;
}

export interface CarrierPickerProps extends CommonPickerProps {
  onConvenienceMgaChange?(mgaId: string): void;
}

const CARRIER_MGA_CONVENIENCES = new Map<string, string>([
  ["western surety", "CNA"],
  ["progressive", "Progressive"],
  ["geico", "GEICO"],
  ["travelers", "Travelers"],
]);

export function CarrierPicker({
  label = "Insurance company",
  onChange,
  onConvenienceMgaChange,
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
      onChange={(option) => {
        onChange(option?.id ?? null);
        if (option !== null && onConvenienceMgaChange !== undefined) {
          const target = resolveCarrierConvenienceMga(
            option.name,
            readyOptions(vocabulary.state, "mgas"),
          );
          if (target !== null) {
            onConvenienceMgaChange(target.id);
          }
        }
      }}
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
      getMeta={(option) => option.classTag}
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
): VocabularyOption | null {
  const targetName = CARRIER_MGA_CONVENIENCES.get(carrierName.toLowerCase());
  if (targetName === undefined) {
    return null;
  }
  return (
    activeMgas.find(
      ({ name }) => name.toLowerCase() === targetName.toLowerCase(),
    ) ?? null
  );
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
  key: keyof NonNullable<Extract<typeof state, { status: "ready" }>["data"]>,
): readonly VocabularyOption[] | readonly PolicyTypeOption[] {
  return state.status === "ready" ? state.data[key] : [];
}
