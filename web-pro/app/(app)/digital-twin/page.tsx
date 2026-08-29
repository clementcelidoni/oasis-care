import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, EmptyState, SubmitButton, Field } from "@/components/ui";
import { createGarden } from "@/lib/twin/actions";

/**
 * Choix du jardin à modéliser.
 *
 * Les jardins listés ici sont ceux de la table `gardens` — les mêmes
 * que l'app iPhone. Un jardin créé sur le terrain apparaît donc ici, et
 * inversement : §11C "Le Digital Twin Web doit lire et écrire LES MÊMES
 * données métier que le Digital Twin iPhone."
 */
export default async function DigitalTwinIndexPage() {
  const supabase = await createClient();
  const { data: gardens } = await supabase
    .from("gardens")
    .select("id, name, address, updated_at")
    .is("deleted_at", null)
    .order("name");

  const list = gardens ?? [];

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Digital Twin"
        subtitle="Modélisez un jardin depuis votre ordinateur. Les plans sont partagés avec l'application iPhone."
      />

      {list.length === 0 ? (
        <EmptyState
          title="Aucun jardin"
          description="Créez un jardin pour commencer à le modéliser. Il apparaîtra aussi dans l'application iPhone."
        />
      ) : (
        <Card className="mb-6">
          <ul className="divide-y divide-line">
            {list.map((garden) => (
              <li key={garden.id}>
                <Link
                  href={`/digital-twin/${garden.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{garden.name}</p>
                    {garden.address && (
                      <p className="truncate text-sm text-ink-soft">{garden.address}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm text-accent">Ouvrir le plan →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold">Nouveau jardin</h2>
        <form action={createGarden} className="flex items-end gap-2">
          <div className="flex-1">
            <Field label="Nom" name="name" required placeholder="Jardin Martin" />
          </div>
          <SubmitButton>Créer</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
