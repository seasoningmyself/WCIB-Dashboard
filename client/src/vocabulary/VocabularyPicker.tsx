import React, {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface PickerOption {
  id: string;
  name: string;
}

export type PickerLoadStatus = "error" | "loading" | "ready";

export interface VocabularyPickerProps<TOption extends PickerOption> {
  disabled?: boolean;
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
  renderNoMatchAction?(query: string): ReactNode;
  required?: boolean;
  value: string | null;
}

export interface PickerKeyDecision {
  close: boolean;
  commitIndex: number | null;
  nextActiveIndex: number;
  preventDefault: boolean;
}

export function VocabularyPicker<TOption extends PickerOption>({
  disabled = false,
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
  renderNoMatchAction,
  required = false,
  value,
}: VocabularyPickerProps<TOption>) {
  const listboxSuffix = useId();
  const listboxId = `${id}-listbox-${listboxSuffix}`;
  const messageId = `${id}-message-${listboxSuffix}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.id === value) ?? null;
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

  const choose = (option: TOption) => {
    setQuery(option.name);
    setOpen(false);
    setActiveIndex(-1);
    onChange(option);
  };

  const closeAndRestore = () => {
    setOpen(false);
    setActiveIndex(-1);
    setQuery(selected?.name ?? "");
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
              closeAndRestore();
            }
          }}
          onChange={(event) => {
            if (selected !== null) {
              onChange(null);
            }
            setQuery(event.currentTarget.value);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
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
              <ul id={listboxId} role="listbox">
                {matches.map((option, index) => {
                  const meta = getMeta?.(option) ?? null;
                  return (
                    <li
                      aria-selected={option.id === selected?.id}
                      className={index === activeIndex ? "is-active" : undefined}
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
            ) : (
              <div className="vocabulary-no-match">
                <span>
                  {options.length === 0 ? "No options available" : "No matches"}
                </span>
                {query.trim().length > 0
                  ? renderNoMatchAction?.(query.trim())
                  : null}
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
