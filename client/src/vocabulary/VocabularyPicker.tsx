import React, {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { VOCABULARY_NAME_MAX_LENGTH } from "../../../shared/vocabulary.js";

export interface PickerOption {
  id: string;
  name: string;
}

export type PickerLoadStatus = "error" | "loading" | "ready";

export interface VocabularyPickerProps<TOption extends PickerOption> {
  disabled?: boolean;
  focusRequestKey?: number;
  getMeta?(option: TOption): string | null;
  helpText?: string;
  id: string;
  label: string;
  loadStatus: PickerLoadStatus;
  name?: string;
  onChange(option: TOption | null): void;
  onRetry?(): void;
  onValidityChange?(valid: boolean): void;
  options: readonly TOption[];
  placeholder?: string;
  renderInlineAction?(query: string): ReactNode;
  required?: boolean;
  value: string | null;
}

export interface PickerKeyDecision {
  close: boolean;
  commitIndex: number | null;
  nextActiveIndex: number;
  preventDefault: boolean;
}

export type PickerBlurDecision<TOption extends PickerOption> =
  | { action: "commit"; option: TOption }
  | { action: "restore"; option: TOption | null };

export function VocabularyPicker<TOption extends PickerOption>({
  disabled = false,
  focusRequestKey = 0,
  getMeta,
  helpText,
  id,
  label,
  loadStatus,
  name,
  onChange,
  onRetry,
  onValidityChange,
  options,
  placeholder = "Search and select",
  renderInlineAction,
  required = false,
  value,
}: VocabularyPickerProps<TOption>) {
  const listboxSuffix = useId();
  const listboxId = `${id}-listbox-${listboxSuffix}`;
  const messageId = `${id}-message-${listboxSuffix}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastHandledFocusRequest = useRef(focusRequestKey);
  const selected = options.find((option) => option.id === value) ?? null;
  const lastCommittedOption = useRef<TOption | null>(selected);
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const matches = useMemo(
    () => rankVocabularyOptions(options, query),
    [options, query],
  );
  const [activeIndex, setActiveIndex] = useState(-1);
  const stale = loadStatus === "ready" && value !== null && selected === null;
  const typedWithoutSelection =
    loadStatus === "ready" &&
    selected === null &&
    query.trim().length > 0;
  const invalid = stale || typedWithoutSelection;
  const valid =
    disabled ||
    (loadStatus === "ready" &&
      !invalid &&
      (!required || selected !== null));
  const selectedMeta = selected === null ? null : getMeta?.(selected) ?? null;
  const unavailable = disabled || loadStatus !== "ready";
  const inlineAction =
    shouldOfferInlineAction(options, query)
      ? renderInlineAction?.(query.trim())
      : null;

  useEffect(() => {
    if (selected !== null) {
      lastCommittedOption.current = selected;
    } else if (value !== null || !open) {
      lastCommittedOption.current = null;
    }
  }, [open, selected, value]);

  useEffect(() => {
    if (selected !== null) {
      setQuery(selected.name);
    } else if (value !== null || !open) {
      setQuery("");
    }
  }, [open, selected, value]);

  useEffect(() => {
    setActiveIndex(query.trim().length > 0 && matches.length > 0 ? 0 : -1);
  }, [matches.length, query]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      invalid ? "Choose an available option from the list." : "",
    );
    onValidityChange?.(valid);
  }, [invalid, onValidityChange, valid]);

  useEffect(() => {
    if (
      loadStatus === "ready" &&
      focusRequestKey !== lastHandledFocusRequest.current
    ) {
      lastHandledFocusRequest.current = focusRequestKey;
      inputRef.current?.focus();
    }
  }, [focusRequestKey, loadStatus]);

  const choose = (option: TOption) => {
    lastCommittedOption.current = option;
    setQuery(option.name);
    setOpen(false);
    setActiveIndex(-1);
    onChange(option);
  };

  const closeAndRestore = (
    option: TOption | null = selected ?? lastCommittedOption.current,
  ) => {
    lastCommittedOption.current = option;
    setOpen(false);
    setActiveIndex(-1);
    setQuery(option?.name ?? "");
    if (option !== null && selected?.id !== option.id) {
      onChange(option);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const decision = resolvePickerKey({
      activeIndex,
      canCommit: query.trim().length > 0,
      key: event.key,
      optionCount: matches.length,
    });
    if (decision.preventDefault) {
      event.preventDefault();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setOpen(true);
      setActiveIndex(decision.nextActiveIndex);
    }
    if (decision.commitIndex !== null) {
      const option = matches[decision.commitIndex];
      if (option !== undefined) {
        choose(option);
      }
    } else if (decision.close) {
      closeAndRestore();
    }
  };

  const showListbox = open && loadStatus === "ready";
  const message = pickerMessage({
    helpText,
    loadStatus,
    matchCount: matches.length,
    open,
    optionCount: options.length,
    query,
    selectedMeta,
    stale,
  });

  return (
    <div className="vocabulary-field" ref={rootRef}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div
        className={`vocabulary-combobox${invalid ? " is-invalid" : ""}`}
      >
        <input
          aria-activedescendant={
            showListbox && activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-busy={loadStatus === "loading" ? "true" : undefined}
          aria-controls={listboxId}
          aria-describedby={messageId}
          aria-expanded={showListbox}
          aria-invalid={invalid ? "true" : undefined}
          autoComplete="off"
          disabled={unavailable}
          id={id}
          onBlur={(event) => {
            if (!rootRef.current?.contains(event.relatedTarget)) {
              const decision = resolveVocabularyBlurDecision(
                options,
                query,
                selected ?? lastCommittedOption.current,
              );
              if (decision.action === "restore") {
                closeAndRestore(decision.option);
              } else {
                choose(decision.option);
              }
            }
          }}
          onChange={(event) => {
            if (selected !== null) {
              lastCommittedOption.current = selected;
              onChange(null);
            }
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onKeyDown={handleKeyDown}
          maxLength={VOCABULARY_NAME_MAX_LENGTH}
          placeholder={loadStatus === "loading" ? "Loading..." : placeholder}
          ref={inputRef}
          required={required}
          role="combobox"
          type="text"
          value={query}
        />
        {query.length > 0 || selected !== null || stale ? (
          <button
            aria-label={`Clear ${label}`}
            className="vocabulary-clear"
            disabled={unavailable}
            onClick={() => {
              lastCommittedOption.current = null;
              setQuery("");
              setOpen(true);
              setActiveIndex(-1);
              onChange(null);
              inputRef.current?.focus();
            }}
            onMouseDown={(event) => event.preventDefault()}
            title={`Clear ${label}`}
            type="button"
          >
            &times;
          </button>
        ) : null}
        <span className="vocabulary-chevron" aria-hidden="true" />

        {showListbox ? (
          <div className="vocabulary-popover">
            {matches.length > 0 ? (
              <>
                <ul id={listboxId} role="listbox">
                  {matches.map((option, index) => {
                    const meta = getMeta?.(option) ?? null;
                    return (
                      <li
                        aria-selected={option.id === selected?.id}
                        className={
                          index === activeIndex ? "is-active" : undefined
                        }
                        id={`${listboxId}-option-${index}`}
                        key={option.id}
                        onClick={() => choose(option)}
                        onMouseEnter={() => setActiveIndex(index)}
                        onPointerDown={(event) => event.preventDefault()}
                        role="option"
                      >
                        <span>{option.name}</span>
                        {meta === null ? null : <small>{meta}</small>}
                      </li>
                    );
                  })}
                </ul>
                {inlineAction === null ? null : (
                  <div className="vocabulary-inline-footer">
                    {inlineAction}
                  </div>
                )}
              </>
            ) : (
              <div className="vocabulary-no-match">
                <span>
                  {options.length === 0 ? "No options available" : "No matches"}
                </span>
                {inlineAction}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {name !== undefined ? (
        <input
          disabled={
            disabled ||
            loadStatus !== "ready" ||
            selected === null ||
            invalid
          }
          name={name}
          type="hidden"
          value={selected?.id ?? ""}
        />
      ) : null}

      <div
        className={`vocabulary-message${invalid ? " is-invalid" : ""}`}
        id={messageId}
        role={loadStatus === "error" ? "alert" : "status"}
      >
        <span>{message}</span>
        {loadStatus === "error" && onRetry !== undefined ? (
          <button onClick={onRetry} type="button">
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function rankVocabularyOptions<TOption extends PickerOption>(
  options: readonly TOption[],
  query: string,
): TOption[] {
  const normalizedQuery = normalize(query.trim());
  return options
    .map((option) => ({ option, rank: matchRank(option.name, normalizedQuery) }))
    .filter(
      (candidate): candidate is { option: TOption; rank: number } =>
        candidate.rank !== null,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank || compareOptions(left.option, right.option),
    )
    .map(({ option }) => option);
}

export function shouldOfferInlineAction(
  options: readonly PickerOption[],
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return (
    normalizedQuery.length > 0 &&
    !options.some(
      ({ name: optionName }) =>
        optionName.toLowerCase() === normalizedQuery,
    )
  );
}

export function resolveVocabularyBlurOption<TOption extends PickerOption>(
  options: readonly TOption[],
  query: string,
): TOption | null {
  const normalizedQuery = normalizeBlurValue(query);
  if (normalizedQuery === "") {
    return null;
  }

  const exact = options.find(
    (option) => normalizeBlurValue(option.name) === normalizedQuery,
  );
  if (exact !== undefined) {
    return exact;
  }

  const substringMatches = options.filter((option) =>
    normalizeBlurValue(option.name).includes(normalizedQuery),
  );
  return substringMatches.length === 1 ? substringMatches[0]! : null;
}

export function resolveVocabularyBlurDecision<TOption extends PickerOption>(
  options: readonly TOption[],
  query: string,
  restoreOption: TOption | null,
): PickerBlurDecision<TOption> {
  const resolved = resolveVocabularyBlurOption(options, query);
  if (resolved !== null) {
    return { action: "commit", option: resolved };
  }
  return { action: "restore", option: restoreOption };
}

export function resolvePickerKey({
  activeIndex,
  canCommit,
  key,
  optionCount,
}: {
  activeIndex: number;
  canCommit: boolean;
  key: string;
  optionCount: number;
}): PickerKeyDecision {
  const firstCommit = optionCount > 0 ? Math.max(activeIndex, 0) : null;
  if (key === "ArrowDown") {
    return {
      close: false,
      commitIndex: null,
      nextActiveIndex:
        optionCount === 0 ? -1 : (activeIndex + 1 + optionCount) % optionCount,
      preventDefault: true,
    };
  }
  if (key === "ArrowUp") {
    return {
      close: false,
      commitIndex: null,
      nextActiveIndex:
        optionCount === 0
          ? -1
          : (activeIndex - 1 + optionCount) % optionCount,
      preventDefault: true,
    };
  }
  if (key === "Enter" && firstCommit !== null) {
    return {
      close: false,
      commitIndex: firstCommit,
      nextActiveIndex: activeIndex,
      preventDefault: true,
    };
  }
  if (key === "Tab" && canCommit && firstCommit !== null) {
    return {
      close: false,
      commitIndex: firstCommit,
      nextActiveIndex: activeIndex,
      preventDefault: false,
    };
  }
  return {
    close: key === "Escape" || key === "Tab",
    commitIndex: null,
    nextActiveIndex: activeIndex,
    preventDefault: key === "Escape",
  };
}

export function pickerMessage({
  helpText,
  loadStatus,
  matchCount,
  open,
  optionCount,
  query,
  selectedMeta,
  stale,
}: {
  helpText?: string;
  loadStatus: PickerLoadStatus;
  matchCount: number;
  open: boolean;
  optionCount: number;
  query: string;
  selectedMeta: string | null;
  stale: boolean;
}): string {
  if (loadStatus === "loading") {
    return "Loading options...";
  }
  if (loadStatus === "error") {
    return "Options could not be loaded.";
  }
  if (stale) {
    return "This selection is no longer available. Choose another option.";
  }
  if (optionCount === 0) {
    return "No options are available yet.";
  }
  if (open && query.trim().length > 0 && matchCount === 0) {
    return "No matching options.";
  }
  return selectedMeta ?? helpText ?? "Type to filter available options.";
}

function matchRank(name: string, query: string): number | null {
  if (query === "") {
    return 0;
  }
  const normalizedName = normalize(name);
  if (normalizedName.startsWith(query)) {
    return 0;
  }
  if (
    normalizedName
      .split(/[^a-z0-9]+/)
      .some((word) => word.startsWith(query))
  ) {
    return 1;
  }
  return normalizedName.includes(query) ? 2 : null;
}

function compareOptions(left: PickerOption, right: PickerOption): number {
  const leftResidentialBondValue = residentialBondValue(left.name);
  const rightResidentialBondValue = residentialBondValue(right.name);
  if (
    leftResidentialBondValue !== null &&
    rightResidentialBondValue !== null &&
    leftResidentialBondValue !== rightResidentialBondValue
  ) {
    return rightResidentialBondValue - leftResidentialBondValue;
  }

  const leftName = normalize(left.name);
  const rightName = normalize(right.name);
  if (leftName < rightName) {
    return -1;
  }
  if (leftName > rightName) {
    return 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function normalizeBlurValue(value: string): string {
  return normalize(value.trim()).replace(/[.\s]+$/u, "");
}

function residentialBondValue(name: string): number | null {
  if (!/^bond - residential/i.test(name)) {
    return null;
  }
  const match = /\$(\d+)k/i.exec(name);
  return match === null ? 0 : Number.parseInt(match[1]!, 10);
}
