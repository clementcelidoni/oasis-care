"use client";

import { useState } from "react";
import { addProposedLinesToQuote } from "@/lib/quotes/fromTwinActions";
import { usedSections, type ProposedLine } from "@/lib/quotes/fromTwin";
import { formatQuantity } from "@/lib/quotes/types";

/**
 * La relecture avant écriture.
 *
 * Tout est coché au départ — l'utilisateur vient de demander l'import,
 * lui faire tout recocher serait absurde — mais tout est décochable, et
 * chaque quantité reste modifiable ici, avant de devenir une ligne.
 *
 * Aucun prix n'apparaît sur cet écran, et c'est délibéré : les prix se
 * fixent dans le devis, avec le catalogue sous la main. Montrer ici des
 * montants issus d'un rapprochement automatique donnerait à croire
 * qu'ils sont validés.
 */
export function ProposalForm({
  gardenId, lines, quotes,
}: {
  gardenId: string;
  lines: ProposedLine[];
  quotes: { id: string; label: string }[];
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(lines.map((l) => l.key)));
  const sections = usedSections(lines);

  const toggle = (key: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const toggleSection = (section: string, on: boolean) =>
    setChecked((current) => {
      const next = new Set(current);
      for (const line of lines) {
        if (line.section !== section) continue;
        if (on) next.add(line.key); else next.delete(line.key);
      }
      return next;
    });

  return (
    <form action={addProposedLinesToQuote} className="mt-6">
      <input type="hidden" name="garden_id" value={gardenId} />

      {sections.map((section) => {
        const sectionLines = lines.filter((l) => l.section === section);
        const allOn = sectionLines.every((l) => checked.has(l.key));

        return (
          <section key={section} className="mb-4 overflow-hidden rounded-lg border border-line bg-surface">
            <header className="flex items-center justify-between border-b border-line bg-canvas px-4 py-2">
              <h2 className="text-sm font-semibold">{section}</h2>
              <button
                type="button"
                onClick={() => toggleSection(section, !allOn)}
                className="text-xs text-ink-faint hover:text-accent"
              >
                {allOn ? "Tout décocher" : "Tout cocher"}
              </button>
            </header>

            <ul className="divide-y divide-line">
              {sectionLines.map((line) => {
                const on = checked.has(line.key);
                return (
                  <li key={line.key} className={`flex items-start gap-3 px-4 py-2.5 ${on ? "" : "opacity-50"}`}>
                    <input
                      type="checkbox"
                      name="line"
                      value={line.key}
                      checked={on}
                      onChange={() => toggle(line.key)}
                      className="mt-1.5"
                    />
                    <div className="min-w-0 flex-1">
                      <input
                        name={`description-${line.key}`}
                        defaultValue={line.description}
                        disabled={!on}
                        className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none hover:border-line focus:border-accent focus:bg-surface disabled:hover:border-transparent"
                      />
                      <p className="px-1 text-[11px] text-ink-faint">{line.origin}</p>
                    </div>
                    <input
                      name={`quantity-${line.key}`}
                      defaultValue={formatQuantity(line.quantity)}
                      disabled={!on}
                      className="w-20 shrink-0 rounded border border-line bg-surface px-1.5 py-1 text-right text-sm tabular outline-none focus:border-accent"
                    />
                    <input
                      name={`unit-${line.key}`}
                      defaultValue={line.unit}
                      disabled={!on}
                      className="w-14 shrink-0 rounded border border-line bg-surface px-1.5 py-1 text-sm outline-none focus:border-accent"
                    />
                    <input type="hidden" name={`section-${line.key}`} value={line.section} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-line bg-canvas px-1 py-3">
        <select
          name="quote_id"
          required
          defaultValue={quotes[0]?.id}
          className="min-w-64 rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-sm outline-none focus:border-accent"
        >
          {quotes.map((q) => (
            <option key={q.id} value={q.id}>{q.label}</option>
          ))}
        </select>

        <button
          type="submit"
          disabled={checked.size === 0}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink disabled:opacity-40"
        >
          Ajouter {checked.size} ligne{checked.size > 1 ? "s" : ""} au devis
        </button>

        <p className="text-[11px] text-ink-faint">
          Les prix seront repris du catalogue lorsqu&apos;un article correspond, et laissés à
          zéro sinon — à vous de les compléter dans le devis.
        </p>
      </div>
    </form>
  );
}
