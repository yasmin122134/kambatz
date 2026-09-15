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
}: Props) {
  const rawId = useId();
  const listId = `names-${rawId.replace(/:/g, "")}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const [names, setNames] = useState<string[]>(allowedNames || []);
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

  const query = value.trim();
  const filtered = names.filter((name) => matchesName(name, query));

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
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
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
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {menu}
    </div>
  );
}
