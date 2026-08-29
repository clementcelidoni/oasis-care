import { createClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { SupplierTable } from "./SupplierTable";

/**
 * §11M — les fournisseurs.
 *
 * La table existe depuis le Milestone 5 : c'est d'elle que viennent les
 * prix d'achat du catalogue. Elle n'avait simplement pas d'écran.
 */
export default async function SuppliersPage() {
  const supabase = await createClient();

  const [{ data: suppliers }, { data: orders }] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id, name, email, phone, city, payment_terms, notes")
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("purchase_orders")
      .select("supplier_id, status")
      .is("archived_at", null),
  ]);

  const all = (suppliers ?? []) as {
    id: string; name: string; email: string | null; phone: string | null;
    city: string | null; payment_terms: string | null; notes: string | null;
  }[];

  // Combien de commandes en cours chez chacun : c'est ce qu'on regarde
  // avant de décrocher son téléphone.
  const openBySupplier = new Map<string, number>();
  for (const o of orders ?? []) {
    if (o.status === "received" || o.status === "cancelled") continue;
    const key = o.supplier_id as string;
    openBySupplier.set(key, (openBySupplier.get(key) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Fournisseurs"
        subtitle={`${all.length} fournisseur${all.length > 1 ? "s" : ""}`}
      />

      {all.length === 0 ? (
        <>
          <SupplierTable suppliers={[]} openOrders={openBySupplier} />
          <EmptyState
            title="Aucun fournisseur"
            description="Ajoutez-en un ci-dessus. Ses prix d'achat pourront ensuite alimenter votre bibliothèque de prix."
          />
        </>
      ) : (
        <SupplierTable suppliers={all} openOrders={openBySupplier} />
      )}
    </div>
  );
}
