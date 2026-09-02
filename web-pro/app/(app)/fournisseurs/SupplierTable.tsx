"use client";

import { createSupplier, updateSupplier, archiveSupplier } from "@/lib/trade/actions";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  payment_terms: string | null;
  notes: string | null;
};

/** Les fournisseurs, modifiables sur place. */
export function SupplierTable({
  suppliers, openOrders,
}: {
  suppliers: Supplier[];
  openOrders: Map<string, number>;
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-line bg-surface">
      {suppliers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="py-2 pl-4 pr-2 font-medium">Nom</th>
                <th className="px-2 py-2 font-medium">Ville</th>
                <th className="px-2 py-2 font-medium">Téléphone</th>
                <th className="px-2 py-2 font-medium">E-mail</th>
                <th className="px-2 py-2 font-medium">Règlement</th>
                <th className="w-24 px-2 py-2 text-right font-medium">En cours</th>
                <th className="w-8 py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-line last:border-0">
                  <td colSpan={5} className="p-0">
                    <form
                      action={updateSupplier}
                      className="flex items-center gap-1 px-2 py-1"
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          e.currentTarget.requestSubmit();
                        }
                      }}
                    >
                      <input type="hidden" name="supplier_id" value={s.id} />
                      <Cell name="name" defaultValue={s.name} />
                      <Cell name="city" defaultValue={s.city ?? ""} placeholder="Ville" />
                      <Cell name="phone" defaultValue={s.phone ?? ""} placeholder="Téléphone" />
                      <Cell name="email" defaultValue={s.email ?? ""} placeholder="E-mail" />
                      <Cell
                        name="payment_terms"
                        defaultValue={s.payment_terms ?? ""}
                        placeholder="30 jours"
                      />
                    </form>
                  </td>
                  <td className="tabular px-2 py-1 text-right text-xs text-ink-soft">
                    {openOrders.get(s.id) ?? 0}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    <form action={archiveSupplier}>
                      <input type="hidden" name="supplier_id" value={s.id} />
                      <button
                        type="submit"
                        title="Archiver. Les commandes passées et les lots reçus gardent son nom."
                        className="px-1 text-xs text-ink-faint hover:text-critical"
                      >
                        ✕
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        action={createSupplier}
        className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas px-4 py-2.5"
      >
        <input
          name="name"
          required
          placeholder="Nom du fournisseur"
          className="min-w-40 flex-1 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <input
          name="city"
          placeholder="Ville"
          className="w-28 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <input
          name="phone"
          placeholder="Téléphone"
          className="w-32 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <input
          name="email"
          type="email"
          placeholder="E-mail"
          className="w-44 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <input
          name="payment_terms"
          placeholder="30 jours"
          className="w-24 rounded-md border border-line-strong bg-surface px-2 py-1.5 text-xs outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink"
        >
          Ajouter
        </button>
      </form>
    </div>
  );
}

function Cell({
  name, defaultValue, placeholder,
}: { name: string; defaultValue: string; placeholder?: string }) {
  return (
    <input
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-faint hover:border-line focus:border-accent focus:bg-surface"
    />
  );
}
