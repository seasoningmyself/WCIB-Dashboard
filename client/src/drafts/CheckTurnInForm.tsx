import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import { useApiClient, useSensitiveSessionCleanup } from "../api/context.js";
import {
  InlineCarrierPicker,
  InlineMgaPicker,
  InlinePolicyTypePicker,
} from "../vocabulary/InlineVocabularyPickers.js";
import { useVocabulary } from "../vocabulary/context.js";
import { OfficeLocationPicker } from "../vocabulary/pickers.js";
import { normalizeTurnInOfficeSelection } from "../offices/turn-in-office.js";
import { createDraftApi, DraftApiError } from "./api.js";
import { canRequestDraftHelp, parseHelpReason } from "./help-request.js";
import {
  assignmentKey,
  buildAssignmentChoices,
  calculateTurnInSummary,
  createEmptyTurnInState,
  isInvoiceTransaction,
  suggestAnnualExpiration,
  TURN_IN_TRANSACTION_TYPES,
  turnInFormToDraftInput,
  turnInFormToNonfinancialDraftUpdate,
  turnInStateFromDraft,
  updateTurnInField,
  validateTurnInForSubmit,
  type AssignmentChoice,
  type TurnInFormState,
  type TurnInValidationErrors,
} from "./turn-in-state.js";

interface CheckTurnInFormProps {
  initialDraft?: DraftResponse | null;
  onDraftChange?(draft: DraftResponse): void;
  user: CurrentUser;
}

type SaveState = "dirty" | "error" | "idle" | "saved" | "saving";
type AssignmentLoadState = "error" | "loading" | "ready";

export function CheckTurnInForm({
  initialDraft = null,
  onDraftChange,
  user,
}: CheckTurnInFormProps) {
  const client = useApiClient();
  const api = useMemo(() => createDraftApi(client), [client]);
  const vocabulary = useVocabulary();
  const [draft, setDraft] = useState<DraftResponse | null>(initialDraft);
  const [form, setForm] = useState<TurnInFormState>(() =>
    initialDraft === null
      ? createEmptyTurnInState()
      : turnInStateFromDraft(initialDraft),
  );
  const [errors, setErrors] = useState<TurnInValidationErrors>({});
  const [saveState, setSaveState] = useState<SaveState>(
    initialDraft === null ? "idle" : "saved",
  );
  const [assignmentState, setAssignmentState] =
    useState<AssignmentLoadState>("loading");
  const [assignmentAttempt, setAssignmentAttempt] = useState(0);
  const [producerOptions, setProducerOptions] = useState<
    Awaited<ReturnType<typeof api.listAssignmentOptions>>["producers"]
  >([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpReason, setHelpReason] = useState("");
  const [helpError, setHelpError] = useState<string | null>(null);
  const [helpPending, setHelpPending] = useState(false);
  const pendingRef = useRef(false);
  const autoExpirationRef = useRef<string | null>(null);
  const expirationSuggestionKeyRef = useRef("");
  const helpReasonRef = useRef<HTMLTextAreaElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const completionRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setDraft(initialDraft);
    setForm(
      initialDraft === null
        ? createEmptyTurnInState()
        : isEditableDraft(initialDraft)
          ? turnInStateFromDraft(initialDraft)
          : createEmptyTurnInState(),
    );
    setErrors({});
    setSaveState(initialDraft === null ? "idle" : "saved");
    setHelpOpen(false);
    setHelpReason("");
    setHelpError(null);
    setHelpPending(false);
    autoExpirationRef.current = null;
    expirationSuggestionKeyRef.current = "";
  }, [initialDraft]);

  useEffect(() => {
    if (!helpOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => helpReasonRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [helpOpen]);

  useEffect(() => {
    if (draft !== null && !isEditableDraft(draft)) {
      requestAnimationFrame(() => completionRef.current?.focus());
    }
  }, [draft]);

  useEffect(() => {
    let active = true;
    setAssignmentState("loading");
    void api
      .listAssignmentOptions()
      .then(({ producers }) => {
        if (active) {
          setProducerOptions(producers);
          setAssignmentState("ready");
        }
      })
      .catch(() => {
        if (active) {
          setAssignmentState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [api, assignmentAttempt]);

  useEffect(() => {
    if (vocabulary.state.status === "ready") {
      const data = vocabulary.state.data;
      setForm((current) => {
        const officeLocationId = normalizeTurnInOfficeSelection(
          data,
          current.officeLocationId,
        );
        return current.officeLocationId === officeLocationId
          ? current
          : { ...current, officeLocationId };
      });
    }
  }, [vocabulary.state]);

  useEffect(() => {
    if (vocabulary.state.status !== "ready") {
      return;
    }
    const policyType = vocabulary.state.data.policyTypes.find(
      ({ id }) => id === form.policyTypeId,
    );
    const key = `${form.effectiveDate}:${form.policyTypeId ?? ""}`;
    if (key === expirationSuggestionKeyRef.current) {
      return;
    }
    expirationSuggestionKeyRef.current = key;
    const suggestion = suggestAnnualExpiration(
      form.effectiveDate,
      policyType?.name ?? "",
    );
    if (
      suggestion !== null &&
      (form.expirationDate === "" ||
        form.expirationDate === autoExpirationRef.current)
    ) {
      autoExpirationRef.current = suggestion;
      setForm((current) => ({ ...current, expirationDate: suggestion }));
      setSaveState("dirty");
    }
  }, [form.effectiveDate, form.expirationDate, form.policyTypeId, vocabulary.state]);

  const clearSensitiveState = useCallback(() => {
    pendingRef.current = false;
    setDraft(null);
    setForm(createEmptyTurnInState());
    setErrors({});
    setProducerOptions([]);
    setSaveState("idle");
    setHelpOpen(false);
    setHelpReason("");
    setHelpError(null);
    setHelpPending(false);
    autoExpirationRef.current = null;
    expirationSuggestionKeyRef.current = "";
  }, []);
  useSensitiveSessionCleanup(clearSensitiveState);

  const choices = useMemo(
    () => buildAssignmentChoices(user, producerOptions),
    [producerOptions, user],
  );
  const canRequestHelp = canRequestDraftHelp(user, draft);
  const officeConfigurationBlocked =
    vocabulary.state.status === "ready" &&
    vocabulary.state.data.officeMode.kind === "unconfigured";

  const changeField = useCallback(
    <Key extends keyof TurnInFormState>(
      field: Key,
      value: TurnInFormState[Key],
    ) => {
      setForm((current) => updateTurnInField(current, field, value));
      if (field === "expirationDate") {
        autoExpirationRef.current = null;
      }
      setErrors((current) => omitError(current, field));
      setSaveState("dirty");
    },
    [],
  );

  const changeAssignment = useCallback((choice: AssignmentChoice | null) => {
    setForm((current) => ({
      ...current,
      accountAssignment: choice?.accountAssignment ?? "",
      producerUserId: choice?.producerUserId ?? null,
    }));
    setErrors((current) => omitError(current, "accountAssignment"));
    setSaveState("dirty");
  }, []);

  const freshForm = useCallback(() => {
    const next = createEmptyTurnInState();
    if (vocabulary.state.status === "ready") {
      next.officeLocationId = normalizeTurnInOfficeSelection(
        vocabulary.state.data,
        next.officeLocationId,
      );
    }
    return next;
  }, [vocabulary.state]);

  const acceptDraft = useCallback(
    (next: DraftResponse) => {
      setDraft(next);
      autoExpirationRef.current = null;
      setForm(
        isEditableDraft(next)
          ? turnInStateFromDraft(next)
          : createEmptyTurnInState(),
      );
      onDraftChange?.(next);
    },
    [onDraftChange],
  );

  const save = useCallback(async () => {
    if (
      pendingRef.current ||
      officeConfigurationBlocked ||
      (draft !== null && !isEditableDraft(draft))
    ) {
      return null;
    }
    pendingRef.current = true;
    setErrors({});
    setSaveState("saving");
    try {
      const input =
        draft?.status === "sent_back"
          ? turnInFormToNonfinancialDraftUpdate(form)
          : turnInFormToDraftInput(form);
      const result =
        draft === null
          ? await api.create(input)
          : await api.edit(draft.id, input);
      acceptDraft(result.draft);
      setSaveState("saved");
      return result.draft;
    } catch (error) {
      setErrors(errorsFromApi(error));
      setSaveState("error");
      return null;
    } finally {
      pendingRef.current = false;
    }
  }, [acceptDraft, api, draft, form, officeConfigurationBlocked]);

  const clearForm = useCallback(() => {
    if (!window.confirm("Clear all turn-in fields?")) {
      return;
    }
    setForm(freshForm());
    setErrors({});
    setSaveState(draft === null ? "idle" : "dirty");
    autoExpirationRef.current = null;
    expirationSuggestionKeyRef.current = "";
  }, [draft, freshForm]);

  const saveAndStartNew = useCallback(async () => {
    const saved = await save();
    if (saved === null) {
      return;
    }
    setDraft(null);
    setForm(freshForm());
    setErrors({});
    setSaveState("idle");
    autoExpirationRef.current = null;
    expirationSuggestionKeyRef.current = "";
    if (window.location.hash.startsWith("#/my-drafts")) {
      window.location.hash = "#/turn-in";
    }
  }, [freshForm, save]);

  const submit = useCallback(async () => {
    if (
      pendingRef.current ||
      officeConfigurationBlocked ||
      (draft !== null && draft.status !== "draft")
    ) {
      return;
    }
    const validation = validateTurnInForSubmit(form);
    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      setSaveState("error");
      focusFirstError(validation);
      return;
    }
    pendingRef.current = true;
    setErrors({});
    setSaveState("saving");
    try {
      const input = turnInFormToDraftInput(form);
      const saved =
        draft === null
          ? await api.create(input)
          : await api.edit(draft.id, input);
      acceptDraft(saved.draft);
      const submitted = await api.submit(saved.draft.id);
      acceptDraft(submitted.draft);
      setSaveState("saved");
    } catch (error) {
      setErrors(errorsFromApi(error));
      setSaveState("error");
    } finally {
      pendingRef.current = false;
    }
  }, [acceptDraft, api, draft, form, officeConfigurationBlocked]);

  const openHelp = useCallback(() => {
    if (!canRequestHelp || pendingRef.current) {
      return;
    }
    setHelpError(null);
    setHelpOpen(true);
  }, [canRequestHelp]);

  const cancelHelp = useCallback(() => {
    if (helpPending) {
      return;
    }
    setHelpOpen(false);
    setHelpReason("");
    setHelpError(null);
    requestAnimationFrame(() => helpTriggerRef.current?.focus());
  }, [helpPending]);

  const requestHelp = useCallback(async () => {
    if (!canRequestHelp || draft === null || pendingRef.current) {
      return;
    }
    const reason = parseHelpReason(helpReason);
    if (!reason.success) {
      setHelpError(reason.error);
      requestAnimationFrame(() => helpReasonRef.current?.focus());
      return;
    }
    pendingRef.current = true;
    setHelpPending(true);
    setHelpError(null);
    setSaveState("saving");
    try {
      const saved = await api.edit(draft.id, turnInFormToDraftInput(form));
      const flagged = await api.flag(saved.draft.id, { reason: reason.reason });
      setHelpReason("");
      setHelpError(null);
      setHelpOpen(false);
      acceptDraft(flagged.draft);
      setSaveState("saved");
    } catch (error) {
      setHelpError(helpFailureMessage(error));
      setSaveState("error");
      requestAnimationFrame(() => helpReasonRef.current?.focus());
    } finally {
      pendingRef.current = false;
      setHelpPending(false);
    }
  }, [acceptDraft, api, canRequestHelp, draft, form, helpReason]);

  return (
    <CheckTurnInFormView
      assignmentChoices={choices}
      assignmentState={assignmentState}
      completionRef={completionRef}
      draft={draft}
      errors={errors}
      form={form}
      help={{
        canRequest: canRequestHelp,
        error: helpError,
        onCancel: cancelHelp,
        onOpen: openHelp,
        onReasonChange: setHelpReason,
        onSubmit: () => void requestHelp(),
        open: helpOpen,
        pending: helpPending,
        reason: helpReason,
        reasonRef: helpReasonRef,
        triggerRef: helpTriggerRef,
      }}
      onAssignmentChange={changeAssignment}
      onClear={clearForm}
      onFieldChange={changeField}
      onRetryAssignments={() => setAssignmentAttempt((value) => value + 1)}
      onSave={() => void save()}
      onSaveAndStartNew={() => void saveAndStartNew()}
      onSubmit={() => void submit()}
      saveState={saveState}
      user={user}
    />
  );
}

interface CheckTurnInFormViewProps {
  assignmentChoices: readonly AssignmentChoice[];
  assignmentState: AssignmentLoadState;
  completionRef?: React.RefObject<HTMLHeadingElement>;
  draft: DraftResponse | null;
  errors: TurnInValidationErrors;
  form: TurnInFormState;
  help?: DraftHelpControl;
  onAssignmentChange(choice: AssignmentChoice | null): void;
  onClear(): void;
  onFieldChange<Key extends keyof TurnInFormState>(
    field: Key,
    value: TurnInFormState[Key],
  ): void;
  onRetryAssignments(): void;
  onSave(): void;
  onSaveAndStartNew(): void;
  onSubmit(): void;
  saveState: SaveState;
  user: CurrentUser;
}

export interface DraftHelpControl {
  canRequest: boolean;
  error: string | null;
  onCancel(): void;
  onOpen(): void;
  onReasonChange(value: string): void;
  onSubmit(): void;
  open: boolean;
  pending: boolean;
  reason: string;
  reasonRef?: React.RefObject<HTMLTextAreaElement>;
  triggerRef?: React.RefObject<HTMLButtonElement>;
}

export function CheckTurnInFormView({
  assignmentChoices,
  assignmentState,
  completionRef,
  draft,
  errors,
  form,
  help,
  onAssignmentChange,
  onClear,
  onFieldChange,
  onRetryAssignments,
  onSave,
  onSaveAndStartNew,
  onSubmit,
  saveState,
  user,
}: CheckTurnInFormViewProps) {
  const vocabulary = useVocabulary();
  const summary = calculateTurnInSummary(form);
  const pending = saveState === "saving";
  const completed = draft !== null && !isEditableDraft(draft);
  const sentBack = draft?.status === "sent_back";
  const showFinancialFields = draft === null || draft.status === "draft";
  const offices =
    vocabulary.state.status === "ready"
      ? vocabulary.state.data.officeLocations
      : [];
  const officeMode =
    vocabulary.state.status === "ready"
      ? vocabulary.state.data.officeMode
      : null;
  const officeConfigurationBlocked = officeMode?.kind === "unconfigured";
  const soleOffice =
    officeMode?.kind === "single"
      ? offices.find(({ id }) => id === officeMode.soleOfficeId) ?? null
      : null;
  const formLocked = pending || officeConfigurationBlocked;

  if (completed) {
    const copy = completionCopy(draft.status);
    return (
      <section className="turn-in-complete" aria-labelledby="turn-in-title">
        <p className="turn-in-kicker">Policy intake</p>
        <h1 id="turn-in-title" ref={completionRef} tabIndex={-1}>{copy.title}</h1>
        <p>{copy.body}</p>
        <a href="#/my-drafts">View My Drafts</a>
      </section>
    );
  }

  const selectedAssignment = assignmentKey(
    form.accountAssignment,
    form.producerUserId,
  );
  const assignmentLabel =
    assignmentChoices.find(({ key }) => key === selectedAssignment)?.label ??
    roleLabel(user.role);

  return (
    <section className="turn-in-page" aria-labelledby="turn-in-title">
      <header className="turn-in-header">
        <div className="turn-in-heading">
          <p className="turn-in-kicker">Policy intake</p>
          <h1 id="turn-in-title">Check Turn-In</h1>
        </div>
      </header>

      <div className="turn-in-status-strip" aria-label="Turn-in status">
        <StatusValue label="Date" value={formatHeaderDate(new Date())} />
        <StatusValue label="Submitter" value={user.displayName ?? user.email} />
        <StatusValue label="Account" value={assignmentLabel} />
        <StatusValue label="Status" value={draftStatusLabel(draft)} />
        <div className="turn-in-status-value">
          <span>Saved</span>
          <SaveIndicator draft={draft} state={saveState} />
        </div>
      </div>

      <div className="turn-in-draft-actions" aria-label="Draft actions">
        <button disabled={formLocked} onClick={onSaveAndStartNew} type="button">
          Save &amp; start new
        </button>
        <button className="is-clear" disabled={pending} onClick={onClear} type="button">
          Clear form
        </button>
        {help?.canRequest ? (
          <button className="turn-in-help" disabled={pending} onClick={help.onOpen} type="button">
            Request help
          </button>
        ) : null}
      </div>

      {errors.form === undefined ? null : (
        <div className="turn-in-alert" role="alert">{errors.form}</div>
      )}

      {officeConfigurationBlocked ? (
        <div className="turn-in-configuration-alert" role="alert">
          <strong>Office setup required</strong>
          <span>
            A turn-in cannot be saved or submitted until an active office location exists.
          </span>
          {user.capabilities.includes("admin") ? (
            <a href="#/settings">Manage office locations</a>
          ) : (
            <span>Ask an administrator to activate an office location.</span>
          )}
        </div>
      ) : null}

      {sentBack ? (
        <div className="turn-in-sent-back" role="status">
          <strong>Changes requested</strong>
          <p>{draft.sentBackReason ?? "Review the turn-in details before reopening it."}</p>
          <span>Save once to reopen this draft. Financial fields return only after the server confirms active draft status.</span>
        </div>
      ) : null}

      {help?.open && help.canRequest ? (
        <DraftHelpDialog control={help} />
      ) : null}

      <form
        className="turn-in-form"
        noValidate
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (!officeConfigurationBlocked) {
            onSave();
          }
        }}
      >
        <fieldset
          aria-label="Turn-in details"
          className="turn-in-controls"
          disabled={formLocked}
        >
        <FormSection title="Account assignment">
          <div className="turn-in-grid turn-in-grid-three">
            <FormField
              error={errors.accountAssignment}
              field="accountAssignment"
              label="Assignment"
              required
            >
              <select
                aria-describedby={errorId("accountAssignment", errors)}
                aria-invalid={errors.accountAssignment !== undefined}
                aria-required="true"
                disabled={pending || (assignmentState !== "ready" && assignmentChoices.length === 0)}
                id={fieldId("accountAssignment")}
                onChange={(event) =>
                  onAssignmentChange(
                    assignmentChoices.find(
                      ({ key }) => key === event.currentTarget.value,
                    ) ?? null,
                  )
                }
                value={selectedAssignment}
              >
                <option value="">Select assignment</option>
                {assignmentChoices.map((choice) => (
                  <option key={choice.key} value={choice.key}>
                    {choice.label}
                  </option>
                ))}
              </select>
              {assignmentState === "error" && assignmentChoices.length === 0 ? (
                <button className="turn-in-inline-retry" onClick={onRetryAssignments} type="button">
                  Retry producer list
                </button>
              ) : null}
            </FormField>

            {officeConfigurationBlocked ? (
              <FormField field="officeLocationId" label="Office location">
                <output className="turn-in-readonly">No active office configured</output>
              </FormField>
            ) : soleOffice === null ? (
              <FormField error={errors.officeLocationId} field="officeLocationId">
                <OfficeLocationPicker
                  disabled={formLocked}
                  id={fieldId("officeLocationId")}
                  onChange={(value) => onFieldChange("officeLocationId", value)}
                  required
                  value={form.officeLocationId}
                />
              </FormField>
            ) : (
              <FormField field="officeLocationId" label="Office location">
                <output className="turn-in-readonly">{soleOffice.name}</output>
              </FormField>
            )}

          </div>
        </FormSection>

        <FormSection title="Policy information">
          <div className="turn-in-grid turn-in-grid-three">
            <TextField error={errors.insuredName} field="insuredName" label="Insured name" onChange={(value) => onFieldChange("insuredName", value)} required value={form.insuredName} />
            <TextField
              field="companyName"
              label="Company name"
              onChange={(value) => onFieldChange("companyName", value)}
              value={form.companyName}
            />
            <FormField error={errors.policyTypeId} field="policyTypeId">
              <InlinePolicyTypePicker
                disabled={pending}
                id={fieldId("policyTypeId")}
                onChange={(value) => onFieldChange("policyTypeId", value)}
                required
                role={user.role}
                value={form.policyTypeId}
              />
            </FormField>
            <FormField
              error={errors.transactionType}
              field="transactionType"
              label="Transaction type"
              required
            >
              <input
                aria-describedby={errorId("transactionType", errors)}
                aria-invalid={errors.transactionType !== undefined}
                aria-required="true"
                disabled={pending}
                id={fieldId("transactionType")}
                list="turn-in-transaction-types"
                maxLength={100}
                onChange={(event) => onFieldChange("transactionType", event.currentTarget.value)}
                value={form.transactionType}
              />
              <datalist id="turn-in-transaction-types">
                {TURN_IN_TRANSACTION_TYPES.map((type) => <option key={type} value={type} />)}
              </datalist>
            </FormField>
            {isInvoiceTransaction(form.transactionType) ? (
              <TextField
                error={errors.invoiceNumber}
                field="invoiceNumber"
                label="Invoice number"
                onChange={(value) => onFieldChange("invoiceNumber", value)}
                required
                value={form.invoiceNumber}
              />
            ) : null}
            <TextAreaField
              field="transactionNotes"
              label="Transaction notes"
              onChange={(value) => onFieldChange("transactionNotes", value)}
              value={form.transactionNotes}
              wide
            />
          </div>
        </FormSection>

        {showFinancialFields ? (
          <FormSection title="Proposal total — verify against the quote">
          <div className="turn-in-grid turn-in-grid-four">
            <MoneyField error={errors.proposalTotal} field="proposalTotal" label="Proposal total from quote" onChange={(value) => onFieldChange("proposalTotal", value)} required value={form.proposalTotal} />
            <ReadOnlyAmount label="Calculated total" value={summary.proposalTotal} />
            {form.paymentMode === "deposit" ? (
              <MoneyField field="depositOption" label="Deposit option from quote" onChange={(value) => onFieldChange("depositOption", value)} value={form.depositOption} />
            ) : null}
          </div>
          </FormSection>
        ) : null}

        {showFinancialFields ? (
          <FormSection title="Amount collected — from ePayPolicy receipt">
          <div className="turn-in-grid turn-in-grid-four">
            <MoneyField error={errors.amountPaid} field="amountPaid" label="Amount collected" onChange={(value) => onFieldChange("amountPaid", value)} required value={form.amountPaid} />
          </div>
          </FormSection>
        ) : null}

        <FormSection title="Carrier invoice — insurance company, MGA, policy # & dates">
          <div className="turn-in-grid turn-in-grid-three">
            <FormField error={errors.carrierId} field="carrierId">
              <InlineCarrierPicker
                disabled={pending}
                id={fieldId("carrierId")}
                onChange={(value) => onFieldChange("carrierId", value)}
                onConvenienceMgaChange={(value) => onFieldChange("mgaId", value)}
                required
                role={user.role}
                value={form.carrierId}
              />
            </FormField>
            <FormField error={errors.mgaId} field="mgaId">
              <InlineMgaPicker
                disabled={pending}
                id={fieldId("mgaId")}
                onChange={(value) => onFieldChange("mgaId", value)}
                required
                role={user.role}
                value={form.mgaId}
              />
            </FormField>
            <TextField error={errors.policyNumber} field="policyNumber" label="Policy number" onChange={(value) => onFieldChange("policyNumber", value)} required value={form.policyNumber} />
            <DateField error={errors.effectiveDate} field="effectiveDate" label="Effective date" onChange={(value) => onFieldChange("effectiveDate", value)} required value={form.effectiveDate} />
            <DateField error={errors.expirationDate} field="expirationDate" label="Expiration date" onChange={(value) => onFieldChange("expirationDate", value)} required value={form.expirationDate} />
          </div>
        </FormSection>

        {showFinancialFields ? (
          <FormSection title="Commission">
          <SegmentedField
            legend="Agency commission"
            name="commission-mode"
            onChange={(value) => onFieldChange("commissionMode", value as TurnInFormState["commissionMode"])}
            options={[
              { label: "Percentage", value: "pct" },
              { label: "TBD", value: "tbd" },
              { label: "N/A", value: "na" },
            ]}
            value={form.commissionMode}
          />
          <div className="turn-in-grid turn-in-grid-three turn-in-subgrid">
            {form.commissionMode === "pct" ? (
              <FormField error={errors.commissionRate} field="commissionRate" label="Carrier commission rate" required>
                <div className="turn-in-input-affix">
                  <input
                    aria-describedby={errorId("commissionRate", errors)}
                    aria-invalid={errors.commissionRate !== undefined}
                    disabled={pending}
                    id={fieldId("commissionRate")}
                    inputMode="decimal"
                    onChange={(event) => onFieldChange("commissionRate", event.currentTarget.value)}
                    value={form.commissionRate}
                  />
                  <span aria-hidden="true">%</span>
                </div>
              </FormField>
            ) : null}
            <ReadOnlyAmount label="Agency commission total" value={summary.commissionAmount} />
          </div>
          </FormSection>
        ) : null}

        {showFinancialFields ? (
          <FormSection title="Premium detail — from carrier invoice & binding docs">
          <div className="turn-in-grid turn-in-grid-four">
            <MoneyField field="basePremium" label="Base premium" onChange={(value) => onFieldChange("basePremium", value)} value={form.basePremium} />
            <MoneyField field="taxes" label="Taxes" onChange={(value) => onFieldChange("taxes", value)} value={form.taxes} />
            <MoneyField field="mgaFee" label="MGA fee" onChange={(value) => onFieldChange("mgaFee", value)} value={form.mgaFee} />
            <MoneyField error={errors.brokerFee} field="brokerFee" label="Broker fee" onChange={(value) => onFieldChange("brokerFee", value)} required value={form.brokerFee} />
            <ReadOnlyAmount label="Proposal total (incl. broker fee)" value={summary.proposalTotal} />
          </div>
          {form.commissionMode === "pct" ? (
            <label className="turn-in-check turn-in-commission-confirmation">
              <input
                aria-describedby={fieldErrorId(
                  "commissionConfirmed",
                  errors.commissionConfirmed,
                )}
                aria-invalid={errors.commissionConfirmed !== undefined}
                checked={form.commissionConfirmed}
                disabled={pending}
                onChange={(event) => onFieldChange("commissionConfirmed", event.currentTarget.checked)}
                type="checkbox"
              />
              <span>Commission confirmed against carrier invoice</span>
              <FieldError error={errors.commissionConfirmed} field="commissionConfirmed" />
            </label>
          ) : null}
          </FormSection>
        ) : null}

        {showFinancialFields ? (
          <FormSection title="Payment type — confirm against ePayPolicy receipt">
          <SegmentedField
            legend="Payment mode"
            name="payment-mode"
            onChange={(value) => onFieldChange("paymentMode", value as TurnInFormState["paymentMode"])}
            options={[
              { label: "Paid in full", value: "full" },
              { label: "Deposit", value: "deposit" },
              { label: "Direct bill", value: "direct" },
            ]}
            value={form.paymentMode}
          />

          {form.paymentMode === "deposit" ? (
            <div className="turn-in-conditional">
              <div className="turn-in-grid turn-in-grid-three">
                <ReadOnlyAmount label="Finance balance" value={summary.financeBalance} />
                <TextField field="financeReference" label="Finance reference" onChange={(value) => onFieldChange("financeReference", value)} value={form.financeReference} />
              </div>
              <SegmentedField
                error={errors.ipfsFinanced}
                errorField="ipfsFinanced"
                legend="IPFS financing"
                name="ipfs-financed"
                onChange={(value) => onFieldChange("ipfsFinanced", value as TurnInFormState["ipfsFinanced"])}
                options={[
                  { label: "Yes", value: "yes" },
                  { label: "No", value: "no" },
                ]}
                value={form.ipfsFinanced}
              />
              {form.ipfsFinanced === "yes" ? (
                <>
                  <label className="turn-in-check turn-in-manual-check">
                    <input checked={form.ipfsManual} disabled={pending} onChange={(event) => onFieldChange("ipfsManual", event.currentTarget.checked)} type="checkbox" />
                    <span>Handle IPFS manually</span>
                  </label>
                  {!form.ipfsManual ? (
                    <div className="turn-in-finance-details">
                      <SegmentedField
                        error={errors.ipfsReturning}
                        errorField="ipfsReturning"
                        legend="IPFS insured"
                        name="ipfs-returning"
                        onChange={(value) => onFieldChange("ipfsReturning", value as TurnInFormState["ipfsReturning"])}
                        options={[
                          { label: "New", value: "new" },
                          { label: "Returning", value: "returning" },
                        ]}
                        value={form.ipfsReturning}
                      />
                      <div className="turn-in-grid turn-in-grid-three">
                        <TextField error={errors.financeMobile} field="financeMobile" label="Insured mobile" onChange={(value) => onFieldChange("financeMobile", value)} required value={form.financeMobile} />
                        <TextField error={errors.financeEmail} field="financeEmail" label="Insured email" onChange={(value) => onFieldChange("financeEmail", value)} required type="email" value={form.financeEmail} />
                        <TextAreaField error={errors.financeAddress} field="financeAddress" label="Insured mailing address" onChange={(value) => onFieldChange("financeAddress", value)} required value={form.financeAddress} />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          </FormSection>
        ) : null}

        {showFinancialFields ? (
          <FormSection title="Net due to MGA">
            <ReadOnlyAmount label="Net due to MGA" value={summary.netDue} />
          </FormSection>
        ) : null}

        <FormSection title="General notes">
          <TextAreaField field="notes" label="General notes" onChange={(value) => onFieldChange("notes", value)} value={form.notes} wide />
        </FormSection>
        </fieldset>

        <footer className="turn-in-actions">
          <div aria-live="polite" className="turn-in-action-status">
            {saveMessage(saveState, sentBack)}
          </div>
          <button className="turn-in-clear" disabled={pending} onClick={onClear} type="button">
            Clear
          </button>
          {help?.canRequest ? (
            <button
              className="turn-in-help"
              disabled={pending}
              onClick={help.onOpen}
              ref={help.triggerRef}
              type="button"
            >
              Request help
            </button>
          ) : null}
          <button className="turn-in-save" disabled={formLocked} type="submit">
            {saveActionLabel(pending, sentBack, draft)}
          </button>
          {sentBack ? null : (
            <button className="turn-in-submit" disabled={formLocked} onClick={onSubmit} type="button">
              {user.capabilities.includes("admin") ? "Submit to ledger" : "Submit for approval"}
            </button>
          )}
        </footer>
      </form>
    </section>
  );
}

function DraftHelpDialog({ control }: { control: DraftHelpControl }) {
  return (
    <div className="turn-in-dialog-backdrop">
      <section
        aria-describedby="turn-in-help-description"
        aria-labelledby="turn-in-help-title"
        aria-modal="true"
        className="turn-in-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            control.onCancel();
            return;
          }
          containDialogFocus(event);
        }}
        role="dialog"
      >
        <header>
          <p>Admin assistance</p>
          <h2 id="turn-in-help-title">Request help with this draft</h2>
        </header>
        <p id="turn-in-help-description">
          Your current draft will be saved and moved to Help Requests for admin review.
        </p>
        <label htmlFor="turn-in-help-reason">What do you need help with?</label>
        <textarea
          aria-describedby={control.error === null ? "turn-in-help-description" : "turn-in-help-error"}
          aria-invalid={control.error !== null}
          autoFocus
          disabled={control.pending}
          id="turn-in-help-reason"
          maxLength={500}
          onChange={(event) => control.onReasonChange(event.currentTarget.value)}
          ref={control.reasonRef}
          rows={5}
          value={control.reason}
        />
        <div aria-live="polite" className="turn-in-dialog-error" id="turn-in-help-error">
          {control.error}
        </div>
        <footer>
          <button disabled={control.pending} onClick={control.onCancel} type="button">
            Cancel
          </button>
          <button
            className="turn-in-dialog-submit"
            disabled={control.pending}
            onClick={control.onSubmit}
            type="button"
          >
            {control.pending ? "Requesting..." : "Send help request"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function FormSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="turn-in-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function StatusValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="turn-in-status-value">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FormField({ children, error, field, label, required = false }: {
  children: ReactNode;
  error?: string;
  field: string;
  label?: string;
  required?: boolean;
}) {
  return (
    <div className="turn-in-field">
      {label === undefined ? null : (
        <label htmlFor={fieldId(field)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      )}
      {children}
      <FieldError error={error} field={field} />
    </div>
  );
}

function TextField({ error, field, label, onChange, required = false, type = "text", value }: {
  error?: string;
  field: keyof TurnInFormState;
  label: string;
  onChange(value: string): void;
  required?: boolean;
  type?: "email" | "text";
  value: string;
}) {
  return (
    <FormField error={error} field={field} label={label} required={required}>
      <input aria-describedby={fieldErrorId(field, error)} aria-invalid={error !== undefined} aria-required={required} id={fieldId(field)} maxLength={maxLengthForField(field)} onChange={(event) => onChange(event.currentTarget.value)} type={type} value={value} />
    </FormField>
  );
}

function DateField(props: Omit<Parameters<typeof TextField>[0], "type">) {
  const { error, field, label, onChange, required, value } = props;
  return (
    <FormField error={error} field={field} label={label} required={required}>
      <input aria-describedby={fieldErrorId(field, error)} aria-invalid={error !== undefined} aria-required={required} id={fieldId(field)} onChange={(event) => onChange(event.currentTarget.value)} type="date" value={value} />
    </FormField>
  );
}

function MoneyField(props: Omit<Parameters<typeof TextField>[0], "type">) {
  const { error, field, label, onChange, required, value } = props;
  return (
    <FormField error={error} field={field} label={label} required={required}>
      <div className="turn-in-input-affix">
        <span aria-hidden="true">$</span>
        <input aria-describedby={fieldErrorId(field, error)} aria-invalid={error !== undefined} aria-required={required} id={fieldId(field)} inputMode="decimal" maxLength={15} onChange={(event) => onChange(event.currentTarget.value)} value={value} />
      </div>
    </FormField>
  );
}

function TextAreaField({ error, field, label, onChange, required = false, value, wide = false }: Omit<Parameters<typeof TextField>[0], "type"> & { wide?: boolean }) {
  return (
    <div className={wide ? "turn-in-field turn-in-wide" : "turn-in-field"}>
      <label htmlFor={fieldId(field)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <textarea aria-describedby={fieldErrorId(field, error)} aria-invalid={error !== undefined} aria-required={required} id={fieldId(field)} maxLength={maxLengthForField(field)} onChange={(event) => onChange(event.currentTarget.value)} rows={3} value={value} />
      <FieldError error={error} field={field} />
    </div>
  );
}

function SegmentedField({ error, errorField, legend, name, onChange, options, value }: {
  error?: string;
  errorField?: string;
  legend: string;
  name: string;
  onChange(value: string): void;
  options: readonly { label: string; value: string }[];
  value: string;
}) {
  const field = errorField ?? name;
  return (
    <fieldset
      aria-describedby={fieldErrorId(field, error)}
      aria-invalid={error !== undefined}
      className="turn-in-segmented"
    >
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label key={option.value}>
            <input checked={value === option.value} name={name} onChange={() => onChange(option.value)} type="radio" value={option.value} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <FieldError error={error} field={field} />
    </fieldset>
  );
}

function ReadOnlyAmount({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="turn-in-field">
      <span className="turn-in-output-label">{label}</span>
      <output className="turn-in-readonly turn-in-money-output">{formatMoney(value)}</output>
    </div>
  );
}

function FieldError({ error, field }: { error?: string; field: string }) {
  return error === undefined ? null : <span className="turn-in-error" id={`${fieldId(field)}-error`}>{error}</span>;
}

function SaveIndicator({ draft, state }: { draft: DraftResponse | null; state: SaveState }) {
  return (
    <span className={`turn-in-save-indicator is-${state}`}>
      {state === "saving" ? "Saving" : state === "dirty" ? "Unsaved changes" : state === "error" ? "Needs attention" : draft === null ? "New draft" : draft.status === "sent_back" ? "Changes requested" : "Draft saved"}
    </span>
  );
}

function draftStatusLabel(draft: DraftResponse | null): string {
  if (draft === null) {
    return "New draft";
  }
  return draft.status === "sent_back"
    ? "Changes requested"
    : draft.status.replaceAll("_", " ");
}

function roleLabel(role: CurrentUser["role"]): string {
  return role === "admin" ? "Admin account" : role === "producer" ? "Producer account" : "Employee account";
}

export function formatHeaderDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function errorsFromApi(error: unknown): TurnInValidationErrors {
  if (error instanceof DraftApiError) {
    if (error.kind === "rejected" && error.details.length > 0) {
      return Object.fromEntries(
        error.details.map(({ field, message }) => [clientField(field), message]),
      );
    }
    if (error.kind === "conflict") {
      return { form: "This draft changed or is no longer editable. Reload My Drafts before trying again." };
    }
  }
  return { form: "The draft could not be saved. Check your connection and try again." };
}

function helpFailureMessage(error: unknown): string {
  if (error instanceof DraftApiError && error.kind === "conflict") {
    return "This draft changed or is no longer active. Return to My Drafts and refresh before trying again.";
  }
  return "The help request could not be sent. Your draft remains available; check your connection and try again.";
}

function containDialogFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
    "textarea:not([disabled]), button:not([disabled])",
  )];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    return;
  }
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function omitError(errors: TurnInValidationErrors, field: PropertyKey): TurnInValidationErrors {
  const next = { ...errors };
  delete next[String(field)];
  delete next.form;
  return next;
}

function focusFirstError(errors: TurnInValidationErrors): void {
  const field = Object.keys(errors)[0];
  if (field !== undefined && typeof document !== "undefined") {
    requestAnimationFrame(() => document.getElementById(fieldId(field))?.focus());
  }
}

function fieldId(field: PropertyKey): string {
  return `turn-in-${String(field)}`;
}

function errorId(field: PropertyKey, errors: TurnInValidationErrors): string | undefined {
  return errors[String(field)] === undefined ? undefined : `${fieldId(field)}-error`;
}

function fieldErrorId(
  field: PropertyKey,
  error: string | undefined,
): string | undefined {
  return error === undefined ? undefined : `${fieldId(field)}-error`;
}

function formatMoney(value: string | null): string {
  if (value === null || !Number.isFinite(Number(value))) {
    return "Not available";
  }
  return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(Number(value));
}

function saveMessage(state: SaveState, sentBack: boolean): string {
  if (state === "error") return "Review the highlighted fields and try again.";
  if (state === "saving") return "Saving securely...";
  if (sentBack && state === "saved") return "Ready to reopen.";
  if (state === "saved") return "All changes saved.";
  if (state === "dirty") return "Unsaved changes.";
  return "Draft not yet saved.";
}

function clientField(field: string): string {
  return {
    "financeContact.address": "financeAddress",
    "financeContact.email": "financeEmail",
    "financeContact.mobile": "financeMobile",
  }[field] ?? field;
}

function maxLengthForField(field: keyof TurnInFormState): number {
  switch (field) {
    case "financeMobile":
      return 50;
    case "transactionType":
      return 100;
    case "invoiceNumber":
    case "policyNumber":
      return 200;
    case "transactionNotes":
      return 2_000;
    case "notes":
      return 4_000;
    case "financeAddress":
      return 500;
    case "financeEmail":
      return 320;
    default:
      return 300;
  }
}

function isEditableDraft(draft: DraftResponse): boolean {
  return draft.status === "draft" || draft.status === "sent_back";
}

function completionCopy(status: DraftResponse["status"]): {
  body: string;
  title: string;
} {
  switch (status) {
    case "flagged":
      return {
        body: "This turn-in is in the admin Help Requests queue.",
        title: "Help requested",
      };
    case "submitted":
      return {
        body: "This turn-in is in the approval queue.",
        title: "Turn-in submitted",
      };
    case "approved":
      return {
        body: "This turn-in has moved to the policy ledger.",
        title: "Turn-in approved",
      };
    case "draft":
      return { body: "This turn-in is ready to edit.", title: "Draft saved" };
    case "sent_back":
      return {
        body: "This turn-in needs changes before it can be resubmitted.",
        title: "Changes requested",
      };
  }
}

function saveActionLabel(
  pending: boolean,
  sentBack: boolean,
  draft: DraftResponse | null,
): string {
  if (pending) return "Saving...";
  if (sentBack) return "Reopen draft";
  return draft === null ? "Save draft" : "Save changes";
}
