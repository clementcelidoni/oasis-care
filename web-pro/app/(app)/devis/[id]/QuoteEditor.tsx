"use client";

import { useMemo, useState } from "react";
import { addSection, deleteSection, addLine, updateLine, deleteLine, updateQuote } from "@/lib/quotes/actions";
import {
  formatCents, formatPercent, formatQuantity, centsToInput, marginTone,
  COMMON_UNITS, VAT_RATES, CATALOG_ITEM_TYPE_LABELS,
  type Quote, type QuoteLine, type QuoteSection, type QuoteTotals, type CatalogItem,
  type BadgeTone,
} from "@/lib/quotes/types";

/**
 * §11E — le corps du devis : sections, lignes, rentabilité.
 *
 * Chaque ligne est un formulaire autonome qui s'enregistre au `blur`.
 * Pas d'état local dupliquant la base : ce qui s'affiche est ce qui est
 * enregistré. Un tableau de chiffrage tenu en mémoire côté navigateur
 * finit toujours par diverger de la base après une erreur réseau, et
 * l'utilisateur ne s'en aperçoit qu'en rouvrant le devis.
 */
export function QuoteEditor({
  quote, sections, lines, totals, catalog, editable,
}: {
  quote: Quote;
  sections: QuoteSection[];
  lines: QuoteLine[];
  totals: QuoteTotals;
  catalog: CatalogItem[];
  editable: boolean;
}) {
  // Les lignes sans section forment un bloc à part, en tête : elles
  // existent dès qu'on ajoute une ligne avant d'avoir créé un poste.
  const grouped = useMemo(() => {
    const bySection = new Map<string | null, QuoteLine[]>();
    for (const line of lines) {
      const key = line.section_id;
      bySection.set(key, [...(bySection.get(key) ?? []), line]);
    }
    return bySection;
  }, [lines]);

  const loose = grouped.get(null) ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px] lg:items-start">
      <div className="min-w-0">
        {loose.length > 0 && (
          <SectionBlock
            quote={quote} title="Sans poste" sectionId={null}
            lines={loose} sections={sections} catalog={catalog} editable={editable}
          />
        )}

        {sections.map((section) => (
          <SectionBlock
            key={section.id}
            quote={quote}
            title={section.title}
            sectionId={section.id}
            lines={grouped.get(section.id) ?? []}
            sections={sections}
            catalog={catalog}
            editable={editable}
          />
        ))}

        {editable && (
          <form action={addSection} className="mt-2 flex items-center gap-2">
            <input type="hidden" name="quote_id" value={quote.id} />
            <input
              name="title"
              required
              placeholder="Nouveau poste — Terrassement, Plantation, Irrigation…"
              className="min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink-soft hover:border-accent hover:text-accent"
            >
              Ajouter un poste
            </button>
          </form>
        )}

        {lines.length === 0 && (
          <p className="mt-4 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-soft">
            Ce devis est vide. Ajoutez un poste, puis des lignes — ou versez-y le métré
            d&apos;un plan depuis le Digital Twin.
          </p>
        )}
      </div>

      <Totals quote={quote} totals={totals} editable={editable} />
    </div>
  );
}

function SectionBlock({
  quote, title, sectionId, lines, sections, catalog, editable,
}: {
  quote: Quote;
  title: string;
  sectionId: string | null;
  lines: QuoteLine[];
  sections: QuoteSection[];
  catalog: CatalogItem[];
  editable: boolean;
}) {
  const subtotal = lines.reduce((sum, l) => sum + l.sale_total_cents, 0);

  return (
    <section className="mb-5 overflow-hidden rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line bg-canvas px-4 py-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-3">
          <span className="tabular text-sm font-medium">{formatCents(subtotal)} HT</span>
          {editable && sectionId && (
            <form action={deleteSection}>
              <input type="hidden" name="quote_id" value={quote.id} />
              <input type="hidden" name="section_id" value={sectionId} />
              <button
                type="submit"
                title="Supprimer ce poste. Ses lignes sont conservées, sans poste."
                className="text-xs text-ink-faint hover:text-critical"
              >
                Supprimer le poste
              </button>
            </form>
          )}
        </div>
      </header>

      {/*
        Les formulaires vivent HORS du tableau, et les champs s'y
        rattachent par l'attribut `form`. C'est la seule façon propre
        d'avoir une ligne éditable dans un `<table>` : un `<form>` n'est
        pas un enfant valide de `<tbody>`, et une table imbriquée par
        ligne désalignerait les colonnes de l'en-tête.
      */}
      {editable && lines.map((line) => (
        <div key={`f-${line.id}`} hidden>
          <form id={`line-${line.id}`} action={updateLine}>
            <input type="hidden" name="quote_id" value={quote.id} />
            <input type="hidden" name="line_id" value={line.id} />
          </form>
          <form id={`del-${line.id}`} action={deleteLine}>
            <input type="hidden" name="quote_id" value={quote.id} />
            <input type="hidden" name="line_id" value={line.id} />
          </form>
        </div>
      ))}

      {lines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-1.5 pl-4 pr-2 font-medium">Désignation</th>
                <th className="w-20 px-2 py-1.5 text-right font-medium">Qté</th>
                <th className="w-16 px-2 py-1.5 font-medium">Unité</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">Achat</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">Vente</th>
                <th className="w-16 px-2 py-1.5 text-right font-medium">TVA</th>
                <th className="w-16 px-2 py-1.5 text-right font-medium">Rem.</th>
                <th className="w-28 px-2 py-1.5 text-right font-medium">Total HT</th>
                <th className="w-8 py-1.5 pr-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <LineRow key={line.id} line={line} editable={editable} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editable && (
        <AddLineForm quote={quote} sectionId={sectionId} catalog={catalog} hasSections={sections.length > 0} />
      )}
    </section>
  );
}

/**
 * Une ligne = un formulaire.
 *
 * `onBlur={submit}` : on enregistre quand le champ perd le focus, pas à
 * chaque frappe. Enregistrer à chaque touche enverrait vingt requêtes
 * pour un prix à quatre chiffres, et afficherait des totaux
 * intermédiaires absurdes pendant la saisie.
 */
function LineRow({ line, editable }: { line: QuoteLine; editable: boolean }) {
  const margin = line.sale_total_cents - line.cost_total_cents;

  if (!editable) {
    return (
      <tr className="border-b border-line last:border-0">
        <td className="py-2 pl-4 pr-2">{line.description}</td>
        <td className="px-2 py-2 text-right tabular">{formatQuantity(line.quantity)}</td>
        <td className="px-2 py-2 text-ink-soft">{line.unit}</td>
        <td className="px-2 py-2 text-right tabular text-ink-soft">{formatCents(line.unit_cost_cents)}</td>
        <td className="px-2 py-2 text-right tabular">{formatCents(line.unit_sale_price_cents)}</td>
        <td className="px-2 py-2 text-right tabular text-ink-soft">{line.vat_rate} %</td>
        <td className="px-2 py-2 text-right tabular text-ink-soft">
          {line.discount_percent > 0 ? `${line.discount_percent} %` : "—"}
        </td>
        <td className="px-2 py-2 text-right tabular font-medium">{formatCents(line.sale_total_cents)}</td>
        <td />
      </tr>
    );
  }

  const form = `line-${line.id}`;

  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1 pl-4 pr-2">
        <Cell form={form} name="description" defaultValue={line.description} />
      </td>
      <td className="px-2 py-1">
        <Cell form={form} name="quantity" defaultValue={formatQuantity(line.quantity)} align="right" />
      </td>
      <td className="px-2 py-1">
        <Cell form={form} name="unit" defaultValue={line.unit} />
      </td>
      <td className="px-2 py-1">
        <Cell form={form} name="unit_cost" defaultValue={centsToInput(line.unit_cost_cents)} align="right" />
      </td>
      <td className="px-2 py-1">
        <Cell form={form} name="unit_sale_price" defaultValue={centsToInput(line.unit_sale_price_cents)} align="right" />
      </td>
      <td className="px-2 py-1">
        <Cell form={form} name="vat_rate" defaultValue={String(line.vat_rate)} align="right" />
      </td>
      <td className="px-2 py-1">
        <Cell form={form} name="discount_percent" defaultValue={String(line.discount_percent)} align="right" />
      </td>
      <td className="px-2 py-1 text-right">
        <span className="tabular font-medium">{formatCents(line.sale_total_cents)}</span>
        <span
          className={`block text-[10px] tabular ${margin < 0 ? "text-critical" : "text-ink-faint"}`}
          title="Marge dégagée sur cette ligne"
        >
          {formatCents(margin)}
        </span>
      </td>
      <td className="py-1 pr-3 text-right">
        <button
          type="submit"
          form={`del-${line.id}`}
          title="Supprimer la ligne"
          className="px-1 text-xs text-ink-faint hover:text-critical"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function Cell({
  form, name, defaultValue, align = "left",
}: {
  form: string;
  name: string;
  defaultValue: string;
  align?: "left" | "right";
}) {
  return (
    <input
      form={form}
      name={name}
      defaultValue={defaultValue}
      // Enregistre en quittant le champ, pas à chaque frappe.
      // `requestSubmit` respecte la validation du formulaire,
      // contrairement à `submit()`.
      onBlur={(e) => e.currentTarget.form?.requestSubmit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={`w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-line focus:border-accent focus:bg-surface ${
        align === "right" ? "text-right tabular" : ""
      }`}
    />
  );
}

/**
 * Ajouter une ligne, depuis le catalogue ou en saisie libre.
 *
 * Le catalogue PROPOSE, il n'impose pas : choisir un article remplit la
 * désignation, l'unité et les prix, et tout reste modifiable ensuite.
 * §"NE PAS ajouter silencieusement des coûts."
 */
function AddLineForm({
  quote, sectionId, catalog, hasSections,
}: {
  quote: Quote;
  sectionId: string | null;
  catalog: CatalogItem[];
  hasSections: boolean;
}) {
  const [catalogItemId, setCatalogItemId] = useState("");
  const selected = catalog.find((c) => c.id === catalogItemId);

  return (
    <form action={addLine} className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5">
      <input type="hidden" name="quote_id" value={quote.id} />
      {sectionId && <input type="hidden" name="section_id" value={sectionId} />}

      {catalog.length > 0 && (
        <select
          name="catalog_item_id"
          value={catalogItemId}
          onChange={(e) => setCatalogItemId(e.target.value)}
          className="max-w-56 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
        >
          <option value="">Saisie libre…</option>
          {catalog.map((item) => (
            <option key={item.id} value={item.id}>
              {CATALOG_ITEM_TYPE_LABELS[item.item_type]} · {item.name}
              {item.sale_price_cents !== null ? ` — ${formatCents(item.sale_price_cents)}` : ""}
            </option>
          ))}
        </select>
      )}

      <input
        name="description"
        placeholder={selected ? selected.name : "Désignation"}
        required={!selected}
        className="min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
      />
      <input
        name="quantity"
        defaultValue="1"
        title="Quantité"
        className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none focus:border-accent"
      />
      <input
        name="unit"
        list="units"
        defaultValue={selected?.unit ?? "u"}
        key={selected?.unit ?? "u"}
        title="Unité"
        className="w-16 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent"
      />
      <datalist id="units">
        {COMMON_UNITS.map((u) => <option key={u} value={u} />)}
      </datalist>
      <input
        name="unit_sale_price"
        placeholder="Prix HT"
        defaultValue={selected?.sale_price_cents !== null && selected?.sale_price_cents !== undefined
          ? centsToInput(selected.sale_price_cents) : ""}
        key={`price-${catalogItemId}`}
        className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-right text-xs tabular outline-none placeholder:text-ink-faint focus:border-accent"
      />
      <select
        name="vat_rate"
        defaultValue={String(selected?.vat_rate ?? 20)}
        key={`vat-${catalogItemId}`}
        title="Taux de TVA"
        className="rounded-md border border-line-strong bg-surface px-1.5 py-1.5 text-xs outline-none focus:border-accent"
      >
        {VAT_RATES.map((r) => <option key={r} value={r}>{r} %</option>)}
      </select>

      <button
        type="submit"
        className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
      >
        Ajouter{hasSections && !sectionId ? " (sans poste)" : ""}
      </button>
    </form>
  );
}

/** §RENTABILITÉ — « Coût estimé / Prix HT / Marge € / Marge % », puis TVA et TTC. */
function Totals({
  quote, totals, editable,
}: {
  quote: Quote;
  totals: QuoteTotals;
  editable: boolean;
}) {
  return (
    <aside className="lg:sticky lg:top-6">
      <div className="rounded-lg border border-line bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          Rentabilité
        </h2>

        <Row label="Coût estimé" value={formatCents(totals.total_cost_cents)} muted />
        <Row label="Total HT" value={formatCents(totals.total_excluding_vat_cents)} strong />
        <Row
          label="Marge"
          value={formatCents(totals.margin_cents)}
          tone={marginTone(totals.margin_cents)}
        />
        <Row
          label="Taux de marque"
          value={formatPercent(totals.margin_percent)}
          tone={marginTone(totals.margin_cents)}
        />

        <div className="my-3 border-t border-line" />

        <Row label="TVA" value={formatCents(totals.total_vat_cents)} muted />
        <Row label="Total TTC" value={formatCents(totals.total_including_vat_cents)} strong />

        {totals.margin_cents < 0 && (
          <p className="mt-3 rounded bg-critical-wash px-2 py-1.5 text-[11px] text-critical">
            Ce devis est vendu à perte : le coût dépasse le prix de vente.
          </p>
        )}
      </div>

      {editable && (
        <form action={updateQuote} className="mt-3 rounded-lg border border-line bg-surface p-4">
          <input type="hidden" name="quote_id" value={quote.id} />
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint">Remise commerciale globale (%)</span>
            <input
              name="global_discount_percent"
              defaultValue={String(quote.global_discount_percent)}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm tabular outline-none focus:border-accent"
            />
          </label>
          <p className="mt-2 text-[11px] text-ink-faint">
            Appliquée après les remises de ligne, au prorata de chaque taux de TVA.
          </p>

          <label className="mt-3 flex flex-col gap-1">
            <span className="text-[11px] text-ink-faint">Valable jusqu&apos;au</span>
            <input
              type="date"
              name="valid_until"
              defaultValue={quote.valid_until ?? ""}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              className="rounded-md border border-line-strong bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
            />
          </label>
        </form>
      )}
    </aside>
  );
}

function Row({
  label, value, strong, muted, tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  tone?: BadgeTone;
}) {
  const colour =
    tone === "critical" ? "text-critical"
      : tone === "warning" ? "text-warning"
        : tone === "positive" ? "text-positive"
          : muted ? "text-ink-soft" : "";

  return (
    <div className="flex items-baseline justify-between py-0.5 text-sm">
      <span className={muted ? "text-ink-soft" : "text-ink-soft"}>{label}</span>
      <span className={`tabular ${strong ? "text-base font-semibold" : "font-medium"} ${colour}`}>
        {value}
      </span>
    </div>
  );
}
