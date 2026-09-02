import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import { formatDate } from "@/lib/crm/types";
import { getDailyPriorities, urgentCount } from "@/lib/ai/daily";
import { Assistant } from "./Assistant";

/**
 * §11U OASIS PRO AI — « L'IA doit être profondément intégrée. Pas
 * uniquement un chatbot. »
 *
 * D'où l'ordre de cette page. OASIS DAILY VIENT EN PREMIER, et il ne
 * passe par aucun modèle : c'est la même fonction Postgres que
 * l'assistant appelle (`ai_get_daily_priorities`), lue directement.
 * Elle marche sans clé OpenAI, sans latence, sans risque d'invention —
 * et elle dit exactement la même chose que l'assistant, puisque c'est
 * la même source.
 *
 * La conversation vient ensuite, pour ce qui demande de croiser
 * plusieurs sources : « quels végétaux commander pour les chantiers
 * signés » suppose de comparer chantiers, stock, réservations et
 * commandes. Là, le modèle sert vraiment à quelque chose.
 */
export default async function OasisAIPage() {
  const organization = await requireOrganization();
  const daily = await getDailyPriorities(organization.organizationId);
  const total = urgentCount(daily);

  const supabase = await createClient();
  const { data: usage } = await supabase
    .from("ai_pro_usage")
    .select("used")
    .eq("organization_id", organization.organizationId)
    .eq("period", new Date().toISOString().slice(0, 7))
    .maybeSingle();

  const pending = daily.pointagesAValider;

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Oasis AI</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Votre assistant lit les données de {organization.name} — devis,
          chantiers, stock, factures — et répond à partir d&apos;elles.
        </p>
      </header>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Oasis Daily</h2>
          <span className="text-xs text-ink-faint">
            {new Date().toLocaleDateString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
        </div>

        {daily.failed ? (
          /* « Rien à signaler » serait un mensonge rassurant : la liste
             n'a pas pu être établie, et elle porte sur des factures en
             retard et des interventions du jour. On le dit. */
          <Card className="border-warning/30 bg-warning-wash px-4 py-6 text-center">
            <p className="text-sm font-medium text-warning">
              Impossible d&apos;établir vos priorités du jour.
            </p>
            <p className="mt-1 text-xs text-warning">
              Ce n&apos;est pas « rien à signaler » : la liste n&apos;a pas pu être
              calculée. Rechargez la page ; si le message revient, vos
              interventions et vos factures restent consultables depuis leurs
              écrans.
            </p>
          </Card>
        ) : total === 0 ? (
          <Card className="px-4 py-6 text-center">
            <p className="text-sm font-medium">Rien ne réclame votre attention aujourd&apos;hui.</p>
            <p className="mt-1 text-xs text-ink-soft">
              Aucune intervention prévue, aucun devis à relancer, aucune facture
              en retard.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            <DailyBlock
              title="Interventions du jour"
              count={daily.interventionsDuJour.length}
              href="/planning"
            >
              {daily.interventionsDuJour.map((item, index) => (
                <Row
                  key={index}
                  main={item.titre}
                  detail={[
                    item.client,
                    new Date(item.debut).toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              ))}
            </DailyBlock>

            <DailyBlock
              title="Factures en retard"
              count={daily.facturesEnRetard.length}
              tone="critical"
              href="/factures"
            >
              {daily.facturesEnRetard.map((item, index) => (
                <Row
                  key={index}
                  main={`${item.numero} — ${item.client ?? "client inconnu"}`}
                  detail={`Échue le ${formatDate(item.echeance)}`}
                  amount={formatCents(item.resteADevoir)}
                />
              ))}
            </DailyBlock>

            <DailyBlock
              title="Devis à relancer"
              count={daily.devisARelancer.length}
              tone="warning"
              href="/devis"
            >
              {daily.devisARelancer.map((item, index) => (
                <Row
                  key={index}
                  main={`${item.numero} — ${item.titre}`}
                  detail={`Envoyé le ${formatDate(item.envoyeLe)}, sans réponse`}
                />
              ))}
            </DailyBlock>

            <DailyBlock
              title="Devis qui expirent"
              count={daily.devisQuiExpirent.length}
              tone="warning"
              href="/devis"
            >
              {daily.devisQuiExpirent.map((item, index) => (
                <Row
                  key={index}
                  main={item.numero}
                  detail={`Valable jusqu'au ${formatDate(item.valableJusquAu)}`}
                />
              ))}
            </DailyBlock>

            <DailyBlock
              title="Chantiers en retard"
              count={daily.chantiersEnRetard.length}
              tone="warning"
              href="/projets"
            >
              {daily.chantiersEnRetard.map((item, index) => (
                <Row
                  key={index}
                  main={`${item.numero} — ${item.nom}`}
                  detail={`Fin prévue le ${formatDate(item.finPrevue)}`}
                />
              ))}
            </DailyBlock>

            <DailyBlock
              title="Réceptions attendues"
              count={daily.receptionsAttendues.length}
              href="/achats"
            >
              {daily.receptionsAttendues.map((item, index) => (
                <Row
                  key={index}
                  main={item.commande}
                  detail={`Attendue le ${formatDate(item.attendueLe)}`}
                />
              ))}
            </DailyBlock>

            {(pending.nombre ?? 0) > 0 && (
              <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Badge tone="warning">Pointages</Badge>
                <p className="min-w-0 flex-1 text-sm">
                  <strong className="tabular">{pending.heures ?? 0} h</strong> pointées
                  attendent une validation. Tant qu&apos;elles ne sont pas validées,
                  elles n&apos;entrent dans aucun budget de chantier.
                </p>
                <Link href="/projets/interventions" className="text-sm text-accent hover:underline">
                  Valider
                </Link>
              </Card>
            )}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Demander à Oasis</h2>
        <Assistant />
        <p className="mt-4 text-[11px] text-ink-faint">
          {usage?.used ? `${usage.used} question(s) ce mois-ci. ` : ""}
          Oasis peut préparer un brouillon de devis, jamais l&apos;envoyer. Les
          montants qu&apos;il cite viennent de vos données, mais relisez-les avant
          de vous engager dessus.
        </p>
      </section>
    </div>
  );
}

function DailyBlock({
  title, count, children, tone, href,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  tone?: "warning" | "critical";
  href?: string;
}) {
  // Un bloc vide ne s'affiche pas : une liste de titres suivis de
  // « aucun » remplit l'écran sans rien dire.
  if (count === 0) return null;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="flex-1 text-sm font-medium">{title}</h3>
        <Badge tone={tone ?? "neutral"}>{count}</Badge>
        {href && (
          <Link href={href} className="text-xs text-accent hover:underline">
            Ouvrir
          </Link>
        )}
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </Card>
  );
}

function Row({ main, detail, amount }: { main: string; detail?: string; amount?: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{main}</span>
        {detail && <span className="block truncate text-xs text-ink-soft">{detail}</span>}
      </span>
      {amount && <span className="tabular shrink-0 text-sm font-medium">{amount}</span>}
    </li>
  );
}

export const dynamic = "force-dynamic";
