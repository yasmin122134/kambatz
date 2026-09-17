"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** מסך צר או מסך מגע — תפריטים כגיליון, בלי הסתמכות על hover. */
export function useCompactOverlay(): boolean {
  return useMediaQuery("(max-width: 640px), (pointer: coarse)");
}
