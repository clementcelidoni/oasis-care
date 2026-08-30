import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requirePortal } from "@/lib/portal/access";
import { Card, Badge, EmptyState, SubmitButton } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { GARDEN_ROLE_LABELS } from "@/lib/portal/types";
import { revokeProfessionalAccess } from "@/lib/portal/actions";

/**
 * §JARDIN PRO → PARTICULIER, côté client — et §PERMISSIONS JARDIN.
 *
 * Le jardin livré est DANS SON ESPACE : `deliver_garden_to_client` a
 * déplacé le plan dans son espace de travail personnel, celui que son
 * iPhone synchronise. Cet écran ne « donne pas accès » à un jardin
 * hébergé ailleurs — il montre ce qui lui appartient, et qui d'autre y
 * touche.
 *
 * C'est cette différence qui rend la révocation réelle. Tant que le
 * jardin vivait dans l'espace de l'entreprise, retirer l'accès du
 * professionnel n'aurait rien retiré du tout : la politique de
 * l'espace de travail lui suffisait pour le lire.
 */
export default async function PortalGardensPage() {
  const companies = await requirePortal();
  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data: gardens } = await supabase
    .from("gardens")
    .select("id, name, address, updated_at")
    .is("deleted_at", null)
    .order("name");

  const list = gardens ?? [];

  const { data: access } = await supabase
    .from("garden_access")
    .select("id, garden_id, user_id, role, organization_id, created_at")
    .is("revoked_at", null);

  const accessByGarden = new Map<string, typeof access>();
  for (const row of access ?? []) {
    const bucket = accessByGarden.get(row.garden_id) ?? [];
    bucket.push(row);
    accessByGarden.set(row.garden_id, bucket);
  }

  const companyName = (organizationId: string | null) =>
    companies.find((c) => c.id === organizationId)?.name ?? "Un professionnel";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Mes jardins</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Les plans que votre professionnel vous a livrés. Ils sont à vous :
          vous les retrouvez dans l&apos;application Oasis Care sur votre
          téléphone, et vous décidez qui peut encore y toucher.
        </p>
      </header>

      {list.length === 0 ? (
        <EmptyState
          title="Aucun jardin livré"
          description="Quand votre professionnel vous livrera le plan de votre jardin, il apparaîtra ici et dans votre application Oasis Care."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((garden) => {
            const rows = accessByGarden.get(garden.id) ?? [];
            const mine = rows.find((r) => r.user_id === user?.id);
            const others = rows.filter((r) => r.user_id !== user?.id);
            const iAmOwner = mine?.role === "owner";

            return (
              <Card key={garden.id}>
                <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
                  <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {garden.name}
                  </h2>
                  {mine && (
                    <Badge tone={iAmOwner ? "accent" : "neutral"}>
                      {GARDEN_ROLE_LABELS[mine.role] ?? mine.role}
                    </Badge>
                  )}
                  <span className="text-xs text-ink-faint">
                    Modifié le {formatDate(garden.updated_at)}
                  </span>
                </div>

                {garden.address && (
                  <p className="px-4 pt-3 text-sm text-ink-soft">{garden.address}</p>
                )}

                <div className="px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                    Qui a accès
                  </p>

                  {others.length === 0 ? (
                    <p className="mt-1.5 text-sm text-ink-soft">
                      Vous seul. Aucun professionnel ne peut modifier ce plan.
                    </p>
                  ) : (
                    <ul className="mt-1.5 flex flex-col gap-2">
                      {others.map((row) => (
                        <li
                          key={row.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-2"
                        >
                          <span className="min-w-0 flex-1 text-sm">
                            {row.role === "professional"
                              ? companyName(row.organization_id)
                              : GARDEN_ROLE_LABELS[row.role] ?? row.role}
                            <span className="ml-2 text-xs text-ink-faint">
                              depuis le {formatDate(row.created_at)}
                            </span>
                          </span>
                          <Badge>{GARDEN_ROLE_LABELS[row.role] ?? row.role}</Badge>

                          {iAmOwner && (
                            <form action={revokeProfessionalAccess}>
                              <input type="hidden" name="garden_id" value={garden.id} />
                              <input type="hidden" name="user_id" value={row.user_id} />
                              <SubmitButton variant="secondary">
                                Retirer l&apos;accès
                              </SubmitButton>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {iAmOwner && others.length > 0 && (
                    <p className="mt-3 text-xs text-ink-faint">
                      Retirer l&apos;accès ne touche qu&apos;au plan de ce jardin. Vos
                      devis, vos factures et le suivi de vos chantiers restent
                      visibles dans votre espace — ils appartiennent à
                      l&apos;entreprise, pas au jardin.
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
