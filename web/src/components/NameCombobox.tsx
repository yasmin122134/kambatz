"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
  /** אם מוגדר — רק שמות אלו מוצעים (למשל קצינים תורנים) */
  allowedNames?: string[];
  /** שומר רק בבחירה מהרשימה / Enter / יציאה עם שם מדויק — לא בכל הקשה */
  commitOnSelect?: boolean;
};

function matchesName(name: string, query: string): boolean {
  if (!query) return true;
  return name.toLowerCase().includes(query.toLowerCase());
}

export function NameCombobox({
  id,
  value,
  onChange,
  required,
  placeholder = "הקלידו שם…",
  className,
  allowedNames,
  commitOnSelect = false,
}: Props) {
  const rawId = useId();
  const listId = `names-${rawId.replace(/:/g, "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [names, setNames] = useState<string[]>(allowedNames || []);
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (allowedNames?.length) {
      setNames(allowedNames);
      return;
    }
    fetch("/api/people")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setNames(data.map((p: { name: string }) => p.name));
        }
      })
      .catch(() => {});
  }, [allowedNames]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const shown = commitOnSelect ? draft : value;
  const query = shown.trim();
  const filtered = names.filter((name) => matchesName(name, query));

  function commit(next: string) {
    onChange(next);
    setDraft(next);
    setOpen(false);
  }

  function tryCommitDraft() {
    if (!commitOnSelect) return;
    const q = draft.trim();
    if (!q) {
      if (value) commit("");
      else setOpen(false);
      return;
    }
    const exact =
      names.find((n) => n === q) ??
      names.find((n) => n.toLowerCase() === q.toLowerCase());
    if (exact) commit(exact);
    else setDraft(value);
    setOpen(false);
  }

  function updateMenuBox() {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const maxHeight = Math.min(280, Math.max(spaceBelow, spaceAbove, 120));
    const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
    setMenuBox({
      top: openUp ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
      left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 180) - 8),
      width: Math.max(rect.width, 180),
      maxHeight,
    });
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuBox(null);
      return;
    }
    updateMenuBox();
    const onWin = () => updateMenuBox();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (inputRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const menu =
    open &&
    menuBox &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={menuRef}
        id={listId}
        role="listbox"
        className="name-combobox-menu"
        style={{
          top: menuBox.top,
          left: menuBox.left,
          width: menuBox.width,
          maxHeight: menuBox.maxHeight,
        }}
      >
        {filtered.length === 0 ? (
          <li className="name-combobox-empty">אין התאמה — אפשר להקליד שם חופשי</li>
        ) : (
          filtered.map((name) => (
            <li key={name} role="option">
              <button
                type="button"
                className="name-combobox-option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(name)}
              >
                {name}
              </button>
            </li>
          ))
        )}
      </ul>,
      document.body,
    );

  return (
    <div className={className}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        autoComplete="off"
        required={required}
        className="w-full"
        placeholder={placeholder}
        value={shown}
        onChange={(e) => {
          if (commitOnSelect) setDraft(e.target.value);
          else onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (commitOnSelect) tryCommitDraft();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (commitOnSelect) setDraft(value);
            setOpen(false);
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (commitOnSelect) {
              const exact =
                filtered.find((n) => n === query) ??
                (filtered.length === 1 ? filtered[0] : undefined);
              if (exact) commit(exact);
              else tryCommitDraft();
            } else if (filtered.length === 1) {
              onChange(filtered[0]);
              setOpen(false);
            }
          }
        }}
      />
      {menu}
    </div>
  );
}
