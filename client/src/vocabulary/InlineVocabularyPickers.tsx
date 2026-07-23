import React, { useMemo, useRef, useState } from "react";
import type { CurrentUserRole } from "../../../shared/current-user.js";
import {
  isPolicyTypeClass,
  POLICY_TYPE_CLASSES,
  policyTypeClassLabel,
  type PolicyTypeClass,
} from "../../../shared/policy-types.js";
import type {
  MgaMutationResponse,
  VocabularyOption,
} from "../../../shared/vocabulary.js";
import { useApiClient } from "../api/context.js";
import { useVocabulary } from "./context.js";
import {
  createSingleFlightRunner,
  createVocabularyMutationApi,
  VocabularyMutationApiError,
  type VocabularyMutationApi,
  type VocabularyMutationErrorKind,
} from "./mutation-api.js";
import {
  CarrierPicker,
  MgaPicker,
  PolicyTypePicker,
  resolveCarrierConvenienceMga,
  type CarrierPickerProps,
  type CommonPickerProps,
} from "./pickers.js";

type AddableRole = CurrentUserRole | null;

interface InlineRoleProps {
  allowCreate?: boolean;
  role: AddableRole;
}

export type InlineCarrierPickerProps = CarrierPickerProps &
  InlineRoleProps & {
    onConvenienceMgaChange?(mgaId: string): void;
  };
export type InlinePolicyTypePickerProps = CommonPickerProps & InlineRoleProps;
export type InlineMgaPickerProps = CommonPickerProps & InlineRoleProps;

type Feedback =
  | {
      errorKind: VocabularyMutationErrorKind;
      name: string;
      type: "error";
    }
  | { message: string; type: "status" }
  | null;

interface MgaConfirmation {
  candidates: VocabularyOption[];
  name: string;
}

export function InlineCarrierPicker({
  allowCreate = true,
  onChange,
  onConvenienceMgaChange,
  role,
  ...pickerProps
}: InlineCarrierPickerProps) {
  const api = useMutationApi();
  const vocabulary = useVocabulary();
  const mutation = useMutationRunner();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);

  const applyConvenienceMga = async (carrierName: string) => {
    if (
      onConvenienceMgaChange === undefined ||
      vocabulary.state.status !== "ready"
    ) {
      return;
    }
    const target = resolveCarrierConvenienceMga(
      carrierName,
      vocabulary.state.data.mgas,
    );
    if (target === null) {
      return;
    }
    if (target.item !== null) {
      onConvenienceMgaChange(target.item.id);
      return;
    }
    if (role !== "admin") {
      setFeedback({
        message: `${target.name} is not active. Ask an administrator to add this MGA.`,
        type: "status",
      });
      return;
    }
    setFeedback(null);
    try {
      const execution = await mutation.run(() =>
        createMissingConvenienceMga(api, target.name),
      );
      if (!execution.started || execution.result === undefined) {
        return;
      }
      onConvenienceMgaChange(execution.result.id);
      setFeedback({
        message: `${target.name} added and selected automatically.`,
        type: "status",
      });
      vocabulary.retry();
    } catch (error) {
      setFeedback({
        message: safeMutationErrorMessage(mutationErrorKind(error), "MGA"),
        type: "status",
      });
    }
  };

  const submit = async (name: string) => {
    setFeedback(null);
    try {
      const execution = await mutation.run(() => api.createCarrier({ name }));
      if (!execution.started || execution.result === undefined) {
        return;
      }
      const result = execution.result;
      onChange(result.item.id);
      setFeedback({
        message:
          result.outcome === "created"
            ? "Carrier added and selected."
            : "Existing carrier selected.",
        type: "status",
      });
      setFocusRequestKey((value) => value + 1);
      vocabulary.retry();
      await applyConvenienceMga(result.item.name);
    } catch (error) {
      setFeedback({
        errorKind: mutationErrorKind(error),
        name,
        type: "error",
      });
    }
  };

  return (
    <div className="inline-vocabulary-picker">
      <CarrierPicker
        {...pickerProps}
        disabled={pickerProps.disabled || mutation.pending}
        focusRequestKey={focusRequestKey}
        onChange={(value) => {
          setFeedback(null);
          onChange(value);
          if (value !== null && vocabulary.state.status === "ready") {
            const carrier = vocabulary.state.data.carriers.find(
              ({ id }) => id === value,
            );
            if (carrier !== undefined) {
              void applyConvenienceMga(carrier.name);
            }
          }
        }}
        renderInlineAction={
          allowCreate
            ? (query) => (
                <InlineVocabularyAction
                  errorMessage={feedbackError(feedback, query, "carrier")}
                  kind="carrier"
                  onSubmit={() => void submit(query)}
                  pending={mutation.pending}
                  query={query}
                  role={role}
                />
              )
            : undefined
        }
      />
      <MutationStatus feedback={feedback} />
    </div>
  );
}

export async function createMissingConvenienceMga(
  api: Pick<VocabularyMutationApi, "createMga">,
  name: string,
): Promise<VocabularyOption> {
  let result = await api.createMga({
    confirmNearDuplicate: false,
    name,
  });
  if (result.outcome === "confirmation_required") {
    result = await api.createMga({
      confirmNearDuplicate: true,
      name,
    });
  }
  if (result.outcome === "confirmation_required") {
    throw new VocabularyMutationApiError("rejected");
  }
  return result.item;
}

export function InlinePolicyTypePicker({
  allowCreate = true,
  onChange,
  role,
  ...pickerProps
}: InlinePolicyTypePickerProps) {
  const api = useMutationApi();
  const vocabulary = useVocabulary();
  const mutation = useMutationRunner();
  const [classTag, setClassTag] = useState<PolicyTypeClass | "">("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);

  const submit = async (name: string) => {
    if (!isPolicyTypeClass(classTag)) {
      return;
    }
    setFeedback(null);
    try {
      const execution = await mutation.run(() =>
        api.createPolicyType({ classTag, name }),
      );
      if (!execution.started || execution.result === undefined) {
        return;
      }
      const result = execution.result;
      onChange(result.item.id);
      setFeedback({
        message:
          result.outcome === "created"
            ? "Policy type added and selected."
            : "Existing policy type selected.",
        type: "status",
      });
      setClassTag("");
      setFocusRequestKey((value) => value + 1);
      vocabulary.retry();
    } catch (error) {
      setFeedback({
        errorKind: mutationErrorKind(error),
        name,
        type: "error",
      });
    }
  };

  return (
    <div className="inline-vocabulary-picker">
      <PolicyTypePicker
        {...pickerProps}
        disabled={pickerProps.disabled || mutation.pending}
        focusRequestKey={focusRequestKey}
        onChange={(value) => {
          setClassTag("");
          setFeedback(null);
          onChange(value);
        }}
        renderInlineAction={
          allowCreate
            ? (query) => (
                <InlineVocabularyAction
                  classTag={classTag}
                  errorMessage={feedbackError(feedback, query, "policy type")}
                  kind="policy_type"
                  onClassChange={setClassTag}
                  onSubmit={() => void submit(query)}
                  pending={mutation.pending}
                  query={query}
                  role={role}
                />
              )
            : undefined
        }
      />
      <MutationStatus feedback={feedback} />
    </div>
  );
}

export function InlineMgaPicker({
  allowCreate = true,
  onChange,
  role,
  ...pickerProps
}: InlineMgaPickerProps) {
  const api = useMutationApi();
  const vocabulary = useVocabulary();
  const mutation = useMutationRunner();
  const [confirmation, setConfirmation] = useState<MgaConfirmation | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);

  const finish = (
    result: Exclude<MgaMutationResponse, { outcome: "confirmation_required" }>,
  ) => {
    onChange(result.item.id);
    setConfirmation(null);
    setFeedback({
      message:
        result.outcome === "created"
          ? "MGA added and selected."
          : "Existing MGA selected.",
      type: "status",
    });
    setFocusRequestKey((value) => value + 1);
    vocabulary.retry();
  };

  const submit = async (name: string, confirmNearDuplicate: boolean) => {
    setFeedback(null);
    try {
      const execution = await mutation.run(() =>
        api.createMga({ confirmNearDuplicate, name }),
      );
      if (!execution.started || execution.result === undefined) {
        return;
      }
      const result = execution.result;
      if (result.outcome === "confirmation_required") {
        setConfirmation({ candidates: result.candidates, name });
        return;
      }
      finish(result);
    } catch (error) {
      setFeedback({
        errorKind: mutationErrorKind(error),
        name,
        type: "error",
      });
    }
  };

  return (
    <div className="inline-vocabulary-picker">
      <MgaPicker
        {...pickerProps}
        disabled={pickerProps.disabled || mutation.pending}
        focusRequestKey={focusRequestKey}
        onChange={(value) => {
          setConfirmation(null);
          setFeedback(null);
          onChange(value);
        }}
        renderInlineAction={
          allowCreate
            ? (query) => (
                <InlineVocabularyAction
                  confirmation={
                    confirmation?.name === query ? confirmation : null
                  }
                  errorMessage={feedbackError(feedback, query, "MGA")}
                  kind="mga"
                  onCancel={() => {
                    setConfirmation(null);
                    setFocusRequestKey((value) => value + 1);
                  }}
                  onConfirm={() => void submit(query, true)}
                  onSubmit={() => void submit(query, false)}
                  pending={mutation.pending}
                  query={query}
                  role={role}
                />
              )
            : undefined
        }
      />
      <MutationStatus feedback={feedback} />
    </div>
  );
}

export type InlineVocabularyActionProps =
  | {
      errorMessage: string | null;
      kind: "carrier";
      onSubmit(): void;
      pending: boolean;
      query: string;
      role: AddableRole;
    }
  | {
      classTag: PolicyTypeClass | "";
      errorMessage: string | null;
      kind: "policy_type";
      onClassChange(value: PolicyTypeClass | ""): void;
      onSubmit(): void;
      pending: boolean;
      query: string;
      role: AddableRole;
    }
  | {
      confirmation: MgaConfirmation | null;
      errorMessage: string | null;
      kind: "mga";
      onCancel(): void;
      onConfirm(): void;
      onSubmit(): void;
      pending: boolean;
      query: string;
      role: AddableRole;
    };

export function InlineVocabularyAction(props: InlineVocabularyActionProps) {
  if (props.kind === "mga" && props.role !== "admin") {
    return (
      <span className="vocabulary-admin-note">
        Ask an administrator to add this MGA.
      </span>
    );
  }
  if (!canAddStandardVocabulary(props.role)) {
    return (
      <span className="vocabulary-admin-note">
        Ask an administrator to add this option.
      </span>
    );
  }
  if (props.kind === "mga" && props.confirmation !== null) {
    return (
      <div className="vocabulary-confirmation" aria-label="Similar MGAs found">
        <strong>Similar MGAs found</strong>
        <ul>
          {props.confirmation.candidates.map((candidate) => (
            <li key={candidate.id}>{candidate.name}</li>
          ))}
        </ul>
        <div className="vocabulary-action-row">
          <button autoFocus onClick={props.onCancel} type="button">
            Cancel
          </button>
          <button
            className="is-emphasis"
            disabled={props.pending}
            onClick={props.onConfirm}
            type="button"
          >
            {props.pending ? "Adding..." : "Add anyway"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="vocabulary-create-action">
      {props.kind === "policy_type" ? (
        <label>
          <span>Class</span>
          <select
            aria-label="Policy class"
            disabled={props.pending}
            onChange={(event) => {
              const value = event.currentTarget.value;
              props.onClassChange(isPolicyTypeClass(value) ? value : "");
            }}
            value={props.classTag}
          >
            <option value="">Choose class</option>
            {POLICY_TYPE_CLASSES.map((value) => (
              <option key={value} value={value}>
                {policyTypeClassLabel(value)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {props.errorMessage === null ? null : (
        <span className="vocabulary-create-error" role="alert">
          {props.errorMessage}
        </span>
      )}
      <button
        className="is-emphasis"
        disabled={
          props.pending ||
          (props.kind === "policy_type" && props.classTag === "")
        }
        onClick={props.onSubmit}
        type="button"
      >
        {props.pending
          ? "Adding..."
          : props.errorMessage === null
            ? `Add ${actionLabel(props.kind)}`
            : "Try again"}
      </button>
    </div>
  );
}

export function safeMutationErrorMessage(
  kind: VocabularyMutationErrorKind,
  entityLabel: string,
): string {
  if (kind === "forbidden") {
    return `You do not have permission to add this ${entityLabel}.`;
  }
  if (kind === "rejected") {
    return `Check this ${entityLabel} and try again.`;
  }
  return `Could not add this ${entityLabel}. Try again.`;
}

function useMutationApi() {
  const client = useApiClient();
  return useMemo(() => createVocabularyMutationApi(client), [client]);
}

function useMutationRunner() {
  const [pending, setPending] = useState(false);
  const runnerRef = useRef<ReturnType<typeof createSingleFlightRunner> | null>(
    null,
  );
  if (runnerRef.current === null) {
    runnerRef.current = createSingleFlightRunner(setPending);
  }
  return { pending, run: runnerRef.current.run };
}

function MutationStatus({ feedback }: { feedback: Feedback }) {
  return feedback?.type === "status" ? (
    <div className="vocabulary-mutation-status" role="status">
      {feedback.message}
    </div>
  ) : null;
}

function feedbackError(
  feedback: Feedback,
  query: string,
  entityLabel: string,
): string | null {
  return feedback?.type === "error" && feedback.name === query
    ? safeMutationErrorMessage(feedback.errorKind, entityLabel)
    : null;
}

function mutationErrorKind(error: unknown): VocabularyMutationErrorKind {
  return error instanceof VocabularyMutationApiError
    ? error.kind
    : "unavailable";
}

function canAddStandardVocabulary(role: AddableRole): boolean {
  return role === "admin" || role === "employee" || role === "producer";
}

function actionLabel(kind: InlineVocabularyActionProps["kind"]): string {
  switch (kind) {
    case "carrier":
      return "carrier";
    case "mga":
      return "MGA";
    case "policy_type":
      return "policy type";
  }
}
