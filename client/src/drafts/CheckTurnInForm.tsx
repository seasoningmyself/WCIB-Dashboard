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
import { PageHeader } from "../ui/PageHeader.js";
import {
  InlineCarrierPicker,
  InlineMgaPicker,
  InlinePolicyTypePicker,
} from "../vocabulary/InlineVocabularyPickers.js";
import { useVocabulary } from "../vocabulary/context.js";
import { OfficeLocationPicker } from "../vocabulary/pickers.js";
import { VocabularyPicker } from "../vocabulary/VocabularyPicker.js";
import { normalizeTurnInOfficeSelection } from "../offices/turn-in-office.js";
import { createDraftApi, DraftApiError } from "./api.js";
import { createAutomaticSaveQueue } from "./autosave.js";
import { canRequestDraftHelp, parseHelpReason } from "./help-request.js";
import { buildTurnInPrintModel, printTurnInModel } from "./turn-in-print.js";
import {
  assignmentKey,
  applyIpfsReturningDetection,
  buildAssignmentChoices,
  calculateTurnInSummary,
  confirmBrokerFeeOnlySubmission,
  createEmptyTurnInState,
  getTurnInWording,
  getTurnInPaymentGuidance,
  isInvoiceTransaction,
  isStandardTurnInTransactionType,
  normalizeTurnInDate,
  suggestAnnualExpiration,
  TURN_IN_TRANSACTION_TYPE_KEY,
  TURN_IN_TRANSACTION_TYPES,
  turnInFormToDraftInput,
  turnInFormHasContent,
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
  onDraftDiscard?(draftId: string): void;
  user: CurrentUser;
}

type SaveState = "dirty" | "error" | "idle" | "saved" | "saving";
type AssignmentLoadState = "error" | "loading" | "ready";
type IpfsHistoryState =
  | { status: "idle" | "loading" | "none" | "error" }
  | { lastFinancedAt: string; status: "matched" };

const BLUR_AUTOSAVE_DELAY_MS = 150;
const BACKUP_AUTOSAVE_INTERVAL_MS = 30_000;
const EMPTY_TOUCHED_FIELDS: ReadonlySet<string> = new Set();

export function CheckTurnInForm({
  initialDraft = null,
  onDraftChange,
  onDraftDiscard,
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
  const [touchedFields, setTouchedFields] = useState<ReadonlySet<string>>(
    EMPTY_TOUCHED_FIELDS,
  );
  const [submitAttempted, setSubmitAttempted] = useState(false);
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
  const [ipfsHistory, setIpfsHistory] = useState<IpfsHistoryState>({ status: "idle" });
  const pendingRef = useRef(false);
  const ipfsHistoryVersionRef = useRef(0);
  const ipfsReturningUserSetRef = useRef(initialDraft?.ipfsReturning != null);
  const autoExpirationRef = useRef<string | null>(null);
  const expirationSuggestionKeyRef = useRef("");
  const helpReasonRef = useRef<HTMLTextAreaElement>(null);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const completionRef = useRef<HTMLHeadingElement>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const automaticSaveQueueRef = useRef(createAutomaticSaveQueue());
  const lastPersistedInputRef = useRef<string | null>(
    initialDraft === null
      ? null
      : draftInputSignature(turnInStateFromDraft(initialDraft), initialDraft),
  );
  const latestSaveRef = useRef<
    (options?: { automatic?: boolean }) => Promise<DraftResponse | null>
  >(async () => null);

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
    setTouchedFields(EMPTY_TOUCHED_FIELDS);
    setSubmitAttempted(false);
    setSaveState(initialDraft === null ? "idle" : "saved");
    setHelpOpen(false);
    setHelpReason("");
    setHelpError(null);
    setHelpPending(false);
    setIpfsHistory({ status: "idle" });
    ipfsHistoryVersionRef.current += 1;
    ipfsReturningUserSetRef.current = initialDraft?.ipfsReturning != null;
    autoExpirationRef.current = null;
    expirationSuggestionKeyRef.current = "";
    lastPersistedInputRef.current = initialDraft === null
      ? null
      : draftInputSignature(turnInStateFromDraft(initialDraft), initialDraft);
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    automaticSaveQueueRef.current.clear();
  }, [initialDraft]);

  useEffect(() => {
    const active =
      form.paymentMode === "deposit" &&
      form.ipfsFinanced === "yes" &&
      form.insuredName.trim().length > 0;
    const version = ipfsHistoryVersionRef.current + 1;
    ipfsHistoryVersionRef.current = version;
    if (!active) {
      setIpfsHistory({ status: "idle" });
      return;
    }

    setIpfsHistory({ status: "loading" });
    const timer = window.setTimeout(() => {
      void api
        .lookupPriorIpfsFinancing(form.insuredName)
        .then(({ priorFinancing }) => {
          if (ipfsHistoryVersionRef.current !== version) return;
          const matched = priorFinancing !== null;
          setIpfsHistory(
            matched
              ? {
                  lastFinancedAt: priorFinancing.lastFinancedAt,
                  status: "matched",
                }
              : { status: "none" },
          );
          setForm((current) =>
            applyIpfsReturningDetection(
              current,
              matched,
              ipfsReturningUserSetRef.current,
            ),
          );
        })
        .catch(() => {
          if (ipfsHistoryVersionRef.current === version) {
            setIpfsHistory({ status: "error" });
          }
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [api, form.insuredName, form.ipfsFinanced, form.paymentMode]);

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
    setTouchedFields(EMPTY_TOUCHED_FIELDS);
    setSubmitAttempted(false);
    setProducerOptions([]);
    setSaveState("idle");
    setHelpOpen(false);
    setHelpReason("");
    setHelpError(null);
    setHelpPending(false);
    setIpfsHistory({ status: "idle" });
    ipfsHistoryVersionRef.current += 1;
    ipfsReturningUserSetRef.current = false;
    autoExpirationRef.current = null;
    expirationSuggestionKeyRef.current = "";
    lastPersistedInputRef.current = null;
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    automaticSaveQueueRef.current.clear();
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
      if (field === "ipfsReturning") {
        ipfsReturningUserSetRef.current = true;
      }
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

  const touchField = useCallback((field: string) => {
    setTouchedFields((current) => {
      if (current.has(field)) {
        return current;
      }
      const next = new Set(current);
      next.add(field);
      return next;
    });
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

  const save = useCallback(async (
    { automatic = false }: { automatic?: boolean } = {},
  ) => {
    if (pendingRef.current) {
      if (automatic) automaticSaveQueueRef.current.queue();
      return null;
    }
    if (
      officeConfigurationBlocked ||
      (draft !== null && !isEditableDraft(draft))
    ) {
      return null;
    }
    if (automatic && !turnInFormHasContent(form)) {
      return null;
    }
    const inputSignature = draftInputSignature(form, draft);
    if (automatic && inputSignature === lastPersistedInputRef.current) {
      return draft;
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
      lastPersistedInputRef.current = inputSignature;
      acceptDraft(result.draft);
      setSaveState("saved");
      return result.draft;
    } catch (error) {
      setErrors(errorsFromApi(error));
      setSaveState("error");
      return null;
    } finally {
      pendingRef.current = false;
      if (automaticSaveQueueRef.current.take()) {
        if (autosaveTimerRef.current !== null) {
          window.clearTimeout(autosaveTimerRef.current);
        }
        autosaveTimerRef.current = window.setTimeout(() => {
          autosaveTimerRef.current = null;
          void latestSaveRef.current({ automatic: true });
        }, 0);
      }
    }
  }, [acceptDraft, api, draft, form, officeConfigurationBlocked]);

  useEffect(() => {
    latestSaveRef.current = save;
  }, [save]);

  const scheduleBlurAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void latestSaveRef.current({ automatic: true });
    }, BLUR_AUTOSAVE_DELAY_MS);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void latestSaveRef.current({ automatic: true });
    }, BACKUP_AUTOSAVE_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      automaticSaveQueueRef.current.clear();
    };
  }, []);

  const clearForm = useCallback(() => {
    if (!window.confirm("Clear all turn-in fields?")) {
      return;
    }
    setForm(freshForm());
    setErrors({});
    setTouchedFields(EMPTY_TOUCHED_FIELDS);
    setSubmitAttempted(false);
    setSaveState(draft === null ? "idle" : "dirty");
    setIpfsHistory({ status: "idle" });
    ipfsHistoryVersionRef.current += 1;
    ipfsReturningUserSetRef.current = false;
    autoExpirationRef.current = null;
    expirationSuggestionKeyRef.current = "";
  }, [draft, freshForm]);

  const discardDraft = useCallback(async () => {
    if (
      draft === null ||
      draft.status !== "draft" ||
      pendingRef.current ||
      !window.confirm(
        "Discard this draft? An administrator can restore it from deleted work.",
      )
    ) {
      return;
    }
    pendingRef.current = true;
    setErrors({});
    setSaveState("saving");
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    automaticSaveQueueRef.current.clear();
    try {
      await api.discard(draft.id, {
        expectedLastEditedAt: draft.lastEditedAt,
      });
      onDraftDiscard?.(draft.id);
      setDraft(null);
      setForm(freshForm());
      setTouchedFields(EMPTY_TOUCHED_FIELDS);
      setSubmitAttempted(false);
      lastPersistedInputRef.current = null;
      setSaveState("idle");
      setIpfsHistory({ status: "idle" });
      ipfsHistoryVersionRef.current += 1;
      ipfsReturningUserSetRef.current = false;
      autoExpirationRef.current = null;
      expirationSuggestionKeyRef.current = "";
      if (window.location.hash.startsWith("#/my-drafts")) {
        window.location.hash = "#/turn-in";
      }
    } catch (error) {
      setErrors(errorsFromApi(error));
      setSaveState("error");
    } finally {
      pendingRef.current = false;
    }
  }, [api, draft, freshForm, onDraftDiscard]);

  const printTurnIn = useCallback(() => {
    if (!turnInFormHasContent(form)) return;
    const selectedAssignment = assignmentKey(
      form.accountAssignment,
      form.producerUserId,
    );
    const assignmentLabel =
      choices.find(({ key }) => key === selectedAssignment)?.label ??
      roleLabel(user.role);
    printTurnInModel(buildTurnInPrintModel({
      assignmentLabel,
      form,
      user,
      vocabulary:
        vocabulary.state.status === "ready" ? vocabulary.state.data : null,
    }));
  }, [choices, form, user, vocabulary.state]);

  const saveAndStartNew = useCallback(async () => {
    const saved = await save();
    if (saved === null) {
      return;
    }
    setDraft(null);
    setForm(freshForm());
    lastPersistedInputRef.current = null;
    setErrors({});
    setTouchedFields(EMPTY_TOUCHED_FIELDS);
    setSubmitAttempted(false);
    setSaveState("idle");
    setIpfsHistory({ status: "idle" });
    ipfsHistoryVersionRef.current += 1;
    ipfsReturningUserSetRef.current = false;
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
    setSubmitAttempted(true);
    const validation = validateTurnInForSubmit(form);
    if (Object.keys(validation).length > 0) {
      setErrors({});
      setSaveState("error");
      focusFirstError(validation);
      return;
    }
    if (!confirmBrokerFeeOnlySubmission(form.basePremium, window.confirm)) {
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
      ipfsHistory={ipfsHistory}
      onAssignmentChange={changeAssignment}
      onBlurAutosave={scheduleBlurAutosave}
      onClear={clearForm}
      onDiscard={() => void discardDraft()}
      onFieldChange={changeField}
      onFieldBlur={touchField}
      onPrint={printTurnIn}
      onRetryAssignments={() => setAssignmentAttempt((value) => value + 1)}
      onSave={() => void save()}
      onSaveAndStartNew={() => void saveAndStartNew()}
      onSubmit={() => void submit()}
      saveState={saveState}
      submitAttempted={submitAttempted}
      touchedFields={touchedFields}
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
  ipfsHistory?: IpfsHistoryState;
  onAssignmentChange(choice: AssignmentChoice | null): void;
  onBlurAutosave?(): void;
  onClear(): void;
  onDiscard?(): void;
  onFieldChange<Key extends keyof TurnInFormState>(
    field: Key,
    value: TurnInFormState[Key],
  ): void;
  onFieldBlur?(field: string): void;
  onPrint?(): void;
  onRetryAssignments(): void;
  onSave(): void;
  onSaveAndStartNew(): void;
  onSubmit(): void;
  saveState: SaveState;
  submitAttempted?: boolean;
  touchedFields?: ReadonlySet<string>;
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
  errors: reportedErrors,
  form,
  help,
  ipfsHistory = { status: "idle" },
  onAssignmentChange,
  onBlurAutosave,
  onClear,
  onDiscard,
  onFieldChange,
  onFieldBlur,
  onPrint,
  onRetryAssignments,
  onSave,
  onSaveAndStartNew,
  onSubmit,
  saveState,
  submitAttempted = false,
  touchedFields = EMPTY_TOUCHED_FIELDS,
  user,
}: CheckTurnInFormViewProps) {
  const vocabulary = useVocabulary();
  const summary = calculateTurnInSummary(form);
  const wording = getTurnInWording(form.transactionType);
  const paymentGuidance = getTurnInPaymentGuidance(form);
  const clientErrors = useMemo(
    () => visibleTurnInValidationErrors(form, touchedFields, submitAttempted),
    [form, submitAttempted, touchedFields],
  );
  const errors = useMemo(
    () => ({ ...clientErrors, ...reportedErrors }),
    [clientErrors, reportedErrors],
  );
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
      <PageHeader
        eyebrow="Policy intake"
        status={(
          <>
            <strong>{draftStatusLabel(draft)}</strong> for {assignmentLabel}. {saveMessage(saveState, sentBack)}
          </>
        )}
        title="Check Turn-In"
        titleId="turn-in-title"
      />

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
        onBlur={(event) => {
          if (event.target instanceof HTMLElement && event.target.matches("input, select, textarea")) {
            const fieldContainer = event.target.closest<HTMLElement>("[data-turn-in-field]");
            if (
              fieldContainer !== null &&
              !(
                event.relatedTarget instanceof Node &&
                fieldContainer.contains(event.relatedTarget)
              )
            ) {
              const field = fieldContainer.dataset.turnInField;
              if (field !== undefined) {
                onFieldBlur?.(field);
              }
            }
            onBlurAutosave?.();
          }
        }}
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
            <TextField
              error={errors.insuredName}
              field="insuredName"
              label="Insured name"
              onChange={(value) => onFieldChange("insuredName", value)}
              placeholder="Full legal name of insured"
              required
              value={form.insuredName}
            />
            <TextField
              field="companyName"
              label="Company name"
              onChange={(value) => onFieldChange("companyName", value)}
              placeholder="DBA or company name"
              value={form.companyName}
            />
            <FormField error={errors.policyTypeId} field="policyTypeId">
              <InlinePolicyTypePicker
                allowCreate={false}
                disabled={pending}
                id={fieldId("policyTypeId")}
                onChange={(value) => onFieldChange("policyTypeId", value)}
                required
                role={user.role}
                value={form.policyTypeId}
              />
            </FormField>
            <TransactionTypeField
              error={errors.transactionType}
              onChange={(value) => onFieldChange("transactionType", value)}
              pending={pending}
              value={form.transactionType}
            />
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
              label={wording.notesLabel}
              onChange={(value) => onFieldChange("transactionNotes", value)}
              placeholder={wording.notesPlaceholder}
              value={form.transactionNotes}
              wide
            />
          </div>
        </FormSection>

        {showFinancialFields ? (
          <FormSection title={wording.proposalSectionTitle}>
          <div className="turn-in-grid turn-in-grid-four">
            <MoneyField error={errors.proposalTotal} field="proposalTotal" label={wording.proposalInputLabel} onChange={(value) => onFieldChange("proposalTotal", value)} placeholder={wording.proposalInputPlaceholder} required value={form.proposalTotal} />
            <ReadOnlyAmount label={wording.calculatedTotalLabel} value={summary.proposalTotal} />
            <MoneyField field="depositOption" hint={wording.depositHint} label={wording.depositLabel} onChange={(value) => onFieldChange("depositOption", value)} value={form.depositOption} />
          </div>
          </FormSection>
        ) : null}

        {showFinancialFields ? (
          <FormSection title="Amount collected — from ePayPolicy receipt">
          <div className="turn-in-grid turn-in-grid-four">
            <MoneyField error={errors.amountPaid} field="amountPaid" label="Amount collected" onChange={(value) => onFieldChange("amountPaid", value)} required value={form.amountPaid} />
            {paymentGuidance === null ? null : (
              <div className={`turn-in-payment-guidance is-${paymentGuidance.tone}`} role="status">
                {paymentGuidance.tone === "good" ? "✓ " : null}{paymentGuidance.text}
              </div>
            )}
          </div>
          </FormSection>
        ) : null}

        <FormSection title="Carrier invoice — insurance company, MGA, policy # & dates">
          <div className="turn-in-grid turn-in-grid-three">
            <FormField error={errors.carrierId} field="carrierId">
              <InlineCarrierPicker
                allowCreate={false}
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
                allowCreate={false}
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
              { label: "TBD — paid later by carrier", value: "tbd" },
              { label: "N/A — broker fee only", value: "na" },
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
                    max="100"
                    min="0"
                    onChange={(event) => onFieldChange("commissionRate", event.currentTarget.value)}
                    onFocus={selectNumericContents}
                    onWheel={preventNumericWheelChange}
                    step="0.01"
                    type="number"
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
            <MoneyField error={errors.brokerFee} field="brokerFee" label="Broker fee (our fee)" onChange={(value) => onFieldChange("brokerFee", value)} required value={form.brokerFee} />
            <ReadOnlyAmount label={wording.calculatedTotalLabel} value={summary.proposalTotal} />
          </div>
          {form.commissionMode === "pct" ? (
            <label
              className="turn-in-check turn-in-commission-confirmation"
              data-turn-in-field="commissionConfirmed"
            >
              <input
                aria-describedby={fieldErrorId(
                  "commissionConfirmed",
                  errors.commissionConfirmed,
                )}
                aria-invalid={errors.commissionConfirmed !== undefined}
                  checked={form.commissionConfirmed}
                  disabled={pending}
                  id={fieldId("commissionConfirmed")}
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
              { label: "Deposit — financing may apply", value: "deposit" },
              { label: "Direct bill — not financed", value: "direct" },
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
                      <IpfsPriorFinancingNotice
                        insuredName={form.insuredName}
                        state={ipfsHistory}
                      />
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

        <TurnInValidationSummary errors={submitAttempted ? errors : {}} />

        <footer className="turn-in-actions">
          <div aria-live="polite" className="turn-in-action-status">
            {saveMessage(saveState, sentBack)}
          </div>
          <TurnInActionMenu
            canPrint={onPrint !== undefined && turnInFormHasContent(form)}
            canSaveAndStartNew={!formLocked}
            onClear={onClear}
            onDiscard={
              draft?.status === "draft" && onDiscard !== undefined
                ? onDiscard
                : undefined
            }
            onPrint={onPrint}
            onSaveAndStartNew={onSaveAndStartNew}
            pending={pending}
          />
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

function IpfsPriorFinancingNotice({
  insuredName,
  state,
}: {
  insuredName: string;
  state: IpfsHistoryState;
}) {
  if (state.status === "matched") {
    return (
      <div className="turn-in-ipfs-history is-match" role="status">
        <strong>Prior IPFS financing found</strong>
        <span>
          We financed {insuredName.trim()} with IPFS before (last financed {formatHeaderDate(new Date(state.lastFinancedAt))}). Choose Returning to keep the existing account and auto-pay setup.
        </span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="turn-in-ipfs-history is-error" role="status">
        Financing history could not be checked. Select New or Returning manually.
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="turn-in-ipfs-history" role="status">
        Checking prior IPFS financing...
      </div>
    );
  }
  return null;
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

function TransactionTypeField({
  error,
  onChange,
  pending,
  value,
}: {
  error?: string;
  onChange(value: string): void;
  pending: boolean;
  value: string;
}) {
  const options = useMemo(
    () => [
      ...TURN_IN_TRANSACTION_TYPES.map((type) => ({ id: type, name: type })),
      ...(value !== "" && !isStandardTurnInTransactionType(value)
        ? [{ id: value, name: value }]
        : []),
    ],
    [value],
  );

  return (
    <div
      className="turn-in-field turn-in-wide"
      data-turn-in-field="transactionType"
    >
      <div className="turn-in-transaction-layout">
        <div className="turn-in-transaction-control">
          <VocabularyPicker
            disabled={pending}
            helpText="Search and choose a standard transaction type."
            id={fieldId("transactionType")}
            label="Transaction type"
            loadStatus="ready"
            onChange={(option) => onChange(option?.id ?? "")}
            options={options}
            placeholder="Search transaction types"
            required
            value={value === "" ? null : value}
          />
          <FieldError error={error} field="transactionType" />
        </div>
        <ul className="turn-in-transaction-key">
          <li className="turn-in-transaction-key-title">Transaction type key</li>
          {TURN_IN_TRANSACTION_TYPE_KEY.map(([term, definition]) => (
            <li key={term}>
              <strong>{term}</strong>
              <span>{definition}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
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

function TurnInValidationSummary({ errors }: { errors: TurnInValidationErrors }) {
  const issues = Object.entries(errors).filter(([field]) => field !== "form");
  if (issues.length === 0) {
    return null;
  }
  const hasInvalidValue = issues.some(([, message]) =>
    validationIssueTone(message) === "error"
  );
  return (
    <section
      aria-atomic="false"
      aria-labelledby="turn-in-validation-title"
      aria-live="polite"
      className={`turn-in-validation ${hasInvalidValue ? "is-error" : "is-warning"}`}
      role="status"
    >
      <h2 id="turn-in-validation-title">Issues to fix before submitting</h2>
      <p>{issues.length} {issues.length === 1 ? "item needs" : "items need"} attention.</p>
      <ul>
        {issues.map(([field, message]) => (
          <li className={`is-${validationIssueTone(message)}`} key={field}>
            <button onClick={() => focusTurnInField(field)} title="Go to this field" type="button">
              <span>{message}</span>
              <strong>Fix →</strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function visibleTurnInValidationErrors(
  form: TurnInFormState,
  touchedFields: ReadonlySet<string>,
  submitAttempted: boolean,
): TurnInValidationErrors {
  const errors = validateTurnInForSubmit(form);
  if (submitAttempted) {
    return errors;
  }
  return Object.fromEntries(
    Object.entries(errors).filter(([field]) => touchedFields.has(field)),
  );
}

function TurnInActionMenu({
  canPrint,
  canSaveAndStartNew,
  onClear,
  onDiscard,
  onPrint,
  onSaveAndStartNew,
  pending,
}: {
  canPrint: boolean;
  canSaveAndStartNew: boolean;
  onClear(): void;
  onDiscard?(): void;
  onPrint?(): void;
  onSaveAndStartNew(): void;
  pending: boolean;
}) {
  const invoke = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
    action();
  };
  return (
    <details className="turn-in-action-menu">
      <summary>More actions</summary>
      <div>
        <button
          disabled={!canSaveAndStartNew}
          onClick={(event) => invoke(event, onSaveAndStartNew)}
          type="button"
        >
          Save &amp; start new
        </button>
        {onPrint === undefined ? null : (
          <button
            disabled={pending || !canPrint}
            onClick={(event) => invoke(event, onPrint)}
            type="button"
          >
            Download PDF
          </button>
        )}
        <button
          className="is-danger"
          disabled={pending}
          onClick={(event) => invoke(event, onClear)}
          type="button"
        >
          Clear form
        </button>
        {onDiscard === undefined ? null : (
          <button
            className="is-danger"
            disabled={pending}
            onClick={(event) => invoke(event, onDiscard)}
            type="button"
          >
            Discard draft
          </button>
        )}
      </div>
    </details>
  );
}

function validationIssueTone(message: string): "error" | "warning" {
  return /\b(cannot|exceed|must match|negative)\b/i.test(message)
    ? "error"
    : "warning";
}

function FormField({ children, error, field, label, required = false }: {
  children: ReactNode;
  error?: string;
  field: string;
  label?: string;
  required?: boolean;
}) {
  return (
    <div className="turn-in-field" data-turn-in-field={field}>
      {label === undefined ? null : (
        <label htmlFor={fieldId(field)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      )}
      {children}
      <FieldError error={error} field={field} />
    </div>
  );
}

function TextField({ error, field, label, onChange, placeholder, required = false, type = "text", value }: {
  error?: string;
  field: keyof TurnInFormState;
  label: string;
  onChange(value: string): void;
  placeholder?: string;
  required?: boolean;
  type?: "email" | "text";
  value: string;
}) {
  return (
    <FormField error={error} field={field} label={label} required={required}>
      <input aria-describedby={fieldErrorId(field, error)} aria-invalid={error !== undefined} aria-required={required} id={fieldId(field)} maxLength={maxLengthForField(field)} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} type={type} value={value} />
    </FormField>
  );
}

function DateField(props: Omit<Parameters<typeof TextField>[0], "type">) {
  const { error, field, label, onChange, required, value } = props;
  return (
    <FormField error={error} field={field} label={label} required={required}>
      <input
        aria-describedby={fieldErrorId(field, error)}
        aria-invalid={error !== undefined}
        aria-required={required}
        autoComplete="off"
        id={fieldId(field)}
        inputMode="numeric"
        onBlur={(event) => onChange(normalizeTurnInDate(event.currentTarget.value))}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="MM/DD/YYYY — type or say it"
        type="text"
        value={value}
      />
    </FormField>
  );
}

function MoneyField(props: Omit<Parameters<typeof TextField>[0], "type"> & { hint?: string; placeholder?: string }) {
  const { error, field, hint, label, onChange, placeholder, required, value } = props;
  return (
    <FormField error={error} field={field} label={label} required={required}>
      <div className="turn-in-input-affix">
        <span aria-hidden="true">$</span>
        <input aria-describedby={fieldErrorId(field, error)} aria-invalid={error !== undefined} aria-required={required} id={fieldId(field)} inputMode="decimal" min="0" onChange={(event) => onChange(event.currentTarget.value)} onFocus={selectNumericContents} onWheel={preventNumericWheelChange} placeholder={placeholder} step="0.01" type="number" value={value} />
      </div>
      {hint === undefined ? null : <span className="turn-in-hint">{hint}</span>}
    </FormField>
  );
}

function TextAreaField({ error, field, label, onChange, placeholder, required = false, value, wide = false }: Omit<Parameters<typeof TextField>[0], "type"> & { placeholder?: string; wide?: boolean }) {
  return (
    <div
      className={wide ? "turn-in-field turn-in-wide" : "turn-in-field"}
      data-turn-in-field={field}
    >
      <label htmlFor={fieldId(field)}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label>
      <textarea aria-describedby={fieldErrorId(field, error)} aria-invalid={error !== undefined} aria-required={required} id={fieldId(field)} maxLength={maxLengthForField(field)} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} rows={3} value={value} />
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
      data-turn-in-field={field}
      id={fieldId(field)}
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

function selectNumericContents(event: React.FocusEvent<HTMLInputElement>): void {
  event.currentTarget.select();
}

function preventNumericWheelChange(event: React.WheelEvent<HTMLInputElement>): void {
  if (document.activeElement === event.currentTarget) {
    event.preventDefault();
  }
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
    requestAnimationFrame(() => focusTurnInField(field));
  }
}

function focusTurnInField(field: string): void {
  const target = document.getElementById(fieldId(field));
  if (target === null) {
    return;
  }
  const focusTarget = target.matches("input, select, textarea, button")
    ? target as HTMLElement
    : target.querySelector<HTMLElement>("input, select, textarea, button") ?? target;
  const highlight = target.closest<HTMLElement>(".turn-in-field, .turn-in-segmented") ?? target;
  const y = window.scrollY + target.getBoundingClientRect().top - 100;
  window.scrollTo({ behavior: "smooth", top: Math.max(0, y) });
  highlight.classList.add("turn-in-jump-flash");
  window.setTimeout(() => highlight.classList.remove("turn-in-jump-flash"), 2_400);
  focusTarget.focus({ preventScroll: true });
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

function draftInputSignature(
  form: TurnInFormState,
  draft: DraftResponse | null,
): string {
  return JSON.stringify(
    draft?.status === "sent_back"
      ? turnInFormToNonfinancialDraftUpdate(form)
      : turnInFormToDraftInput(form),
  );
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
