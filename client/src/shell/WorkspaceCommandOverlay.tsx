import React, { useEffect, useMemo, useRef, useState } from "react";
import { useModalFocusTrap } from "../auth/dialog-focus.js";
import {
  availableGoToShortcuts,
} from "./keyboard-shortcuts.js";
import type { ShellNavigationItem } from "./navigation.js";

export type WorkspaceOverlay = "commands" | "shortcuts" | null;

export function WorkspaceCommandOverlay({
  mode,
  navigation,
  onClose,
  onFocusSearch,
  onMode,
  onNavigate,
}: {
  mode: Exclude<WorkspaceOverlay, null>;
  navigation: readonly ShellNavigationItem[];
  onClose(): void;
  onFocusSearch(): void;
  onMode(mode: Exclude<WorkspaceOverlay, null>): void;
  onNavigate(path: string): void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLInputElement & HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useModalFocusTrap(dialogRef, initialFocusRef, onClose);
  useEffect(
    () => () => {
      if (returnFocusRef.current?.isConnected) {
        returnFocusRef.current.focus();
      }
    },
    [],
  );

  return (
    <div
      className="workspace-command-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
      role="presentation"
    >
      <div
        aria-label={mode === "commands" ? "Command palette" : "Keyboard shortcuts"}
        aria-modal="true"
        className="workspace-command-dialog"
        ref={dialogRef}
        role="dialog"
      >
        {mode === "commands" ? (
          <CommandPalette
            initialFocusRef={initialFocusRef}
            navigation={navigation}
            onClose={onClose}
            onFocusSearch={onFocusSearch}
            onMode={onMode}
            onNavigate={onNavigate}
          />
        ) : (
          <ShortcutGuide
            initialFocusRef={initialFocusRef}
            navigation={navigation}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function CommandPalette({
  initialFocusRef,
  navigation,
  onClose,
  onFocusSearch,
  onMode,
  onNavigate,
}: {
  initialFocusRef: React.RefObject<HTMLInputElement & HTMLButtonElement>;
  navigation: readonly ShellNavigationItem[];
  onClose(): void;
  onFocusSearch(): void;
  onMode(mode: "shortcuts"): void;
  onNavigate(path: string): void;
}) {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return navigation.filter(({ label }) =>
      normalized === "" || label.toLocaleLowerCase().includes(normalized)
    );
  }, [navigation, query]);
  const shortcutKeys = useMemo(
    () =>
      new Map<ShellNavigationItem["id"], string>(
        availableGoToShortcuts(navigation).map(({ id, key }) => [
          id,
          `G ${key.toUpperCase()}`,
        ]),
      ),
    [navigation],
  );

  const runFirst = () => {
    const first = commands[0];
    if (first === undefined) return;
    onNavigate(first.path);
    onClose();
  };

  return (
    <>
      <header>
        <div>
          <p>Quick navigation</p>
          <h2>Command palette</h2>
        </div>
        <button aria-label="Close command palette" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <input
        aria-label="Search commands"
        autoComplete="off"
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          runFirst();
        }}
        placeholder="Go to a page"
        ref={initialFocusRef}
        type="search"
        value={query}
      />
      <div className="workspace-command-list" role="list">
        {commands.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              onNavigate(item.path);
              onClose();
            }}
            role="listitem"
            type="button"
          >
            <span>{item.label}</span>
            {shortcutKeys.has(item.id) ? (
              <kbd>{shortcutKeys.get(item.id)}</kbd>
            ) : null}
          </button>
        ))}
        <button
          onClick={() => {
            onClose();
            window.requestAnimationFrame(onFocusSearch);
          }}
          role="listitem"
          type="button"
        >
          <span>Focus page search</span>
          <kbd>/</kbd>
        </button>
        <button
          onClick={() => onMode("shortcuts")}
          role="listitem"
          type="button"
        >
          <span>Show keyboard shortcuts</span>
          <kbd>?</kbd>
        </button>
      </div>
      {commands.length === 0 ? (
        <p className="workspace-command-empty">No matching page is available.</p>
      ) : null}
    </>
  );
}

function ShortcutGuide({
  initialFocusRef,
  navigation,
  onClose,
}: {
  initialFocusRef: React.RefObject<HTMLInputElement & HTMLButtonElement>;
  navigation: readonly ShellNavigationItem[];
  onClose(): void;
}) {
  return (
    <>
      <header>
        <div>
          <p>Keyboard reference</p>
          <h2>Shortcuts</h2>
        </div>
        <button
          aria-label="Close keyboard shortcuts"
          onClick={onClose}
          ref={initialFocusRef}
          type="button"
        >
          ×
        </button>
      </header>
      <div className="workspace-shortcut-groups">
        <ShortcutGroup
          items={[
            ["⌘/Ctrl K", "Open command palette"],
            ["/", "Focus the page search"],
            ["?", "Open this guide"],
            ["Esc", "Close, collapse, or clear search"],
          ]}
          title="Anywhere"
        />
        <ShortcutGroup
          items={[
            ["J / ↓", "Move to next row"],
            ["K / ↑", "Move to previous row"],
            ["Home / End", "Move to first or last row"],
            ["Enter", "Open or expand focused row"],
            ["X", "Select focused review row"],
            ["Shift Enter", "Open approval confirmation"],
            ["Shift A", "Open bulk-approval confirmation"],
          ]}
          title="Work lists"
        />
        <ShortcutGroup
          items={availableGoToShortcuts(navigation).map(({ key, label }) => [
            `G ${key.toUpperCase()}`,
            label,
          ])}
          title="Go to"
        />
      </div>
    </>
  );
}

function ShortcutGroup({
  items,
  title,
}: {
  items: readonly (readonly [string, string])[];
  title: string;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{title}</h3>
      <dl>
        {items.map(([keys, label]) => (
          <div key={keys}>
            <dt><kbd>{keys}</kbd></dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
