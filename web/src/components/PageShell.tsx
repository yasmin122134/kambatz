import { ReactNode } from "react";
import { SiteHeader } from "./SiteHeader";

export function PageShell({
  children,
  title,
  lede,
}: {
  children: ReactNode;
  title: string;
  lede?: string;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className="card mb-6">
          <h2 className="font-display text-xl">{title}</h2>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {children}
      </main>
    </>
  );
}
