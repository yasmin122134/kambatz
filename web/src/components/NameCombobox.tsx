"use client";

import { useEffect, useId, useState } from "react";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

export function NameCombobox({
  id,
  value,
  onChange,
  required,
  placeholder = "הקלידו שם…",
  className,
}: Props) {
  const rawId = useId();
  const listId = `names-${rawId.replace(/:/g, "")}`;
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/people")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setNames(data.map((p: { name: string }) => p.name));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <input
        id={id}
        list={listId}
        required={required}
        autoComplete="off"
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {names.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}
