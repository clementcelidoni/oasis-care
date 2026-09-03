import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { Card, Badge, Panel, PageHeader, SubmitButton, type Tone } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import { formatDate } from "@/lib/crm/types";
import { getOasisDaily, briefingCount, type DailyPriorities } from "@/lib/ai/daily";
import { runExecutiveScan } from "@/lib/ai/scan";
import { CONFIDENCE_LABELS, CONFIDENCE_TONES, type BriefItem } from "@/lib/ai/types";
import { OasisTabs } from "./OasisTabs";
import { Explanation } from "./Explanation";

/**
 * §11V — OASIS DAILY, ET C'EST LE PREMIER CRITÈRE DE VALIDATION.
 *
 * Spec p. 49 : « Je dois pouvoir ouvrir Oasis Care Pro le matin et voir
 * OASIS DAILY avec de vraies recommandations basées sur les données. »
 *
 * TROIS CHOSES SONT NON NÉGOCIABLES SUR CET ÉCRAN.
 *
 *   1. AUCUN MODÈLE N'EST APPELÉ. Le briefing est du SQL
 *      (`ai_oasis_daily`, 0073), composé de faits datés et de sommes
 *      lues. Il marche sans clé OpenAI, sans latence, et sans risque
 *      d'invention. Le modèle sert ailleurs — dans « Demander à Oasis »,
 *      pour ce qui demande de croiser plusieurs sources.
 *
 *   2. CHAQUE LIGNE PORTE SON « POURQUOI ? ». Le briefing n'affiche pas
 *      une conclusion : il affiche une conclusion, ses données, sa
 *      confiance, et ce qui se passe si on l'ignore. C'est ce qui
 *      distingue une recommandation qu'on peut contester d'un oracle.
 *
 *   3. « RIEN À SIGNALER » NE S'AFFICHE QUE QUAND C'EST VRAI. Un
 *      briefing qui n'a pas pu être établi le dit ; il ne se déguise
 *      pas en matinée calme. C'est le même principe que le drapeau
 *      `failed` des priorités du jour, et il porte ici sur des factures
 *      en retard et des chantiers à facturer.
 */
export default async function OasisDailyPage() {
  const organization = await requireOrganization();
  const { briefing, priorities } = await getOasisDaily(organization.organizationId);

  const supabase = await createClient();

  const [{ count: openDecisions }, { data: usage }] = await Promise.all([
    supabase
      .from("ai_decisions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.organizationId)
      .in("status", ["new", "reviewed", "snoozed"]),
    supabase
      .from("ai_pro_usage")
      .select("used")
      .eq("organization_id", organization.organizationId)
      .eq("period", new Date().toISOString().slice(0, 7))
      .maybeSingle(),
  ]);

  const recommendations = briefingCount(briefing);
  const today = briefing.date ? new Date(briefing.date) : new Date();

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Oasis AI"
        subtitle={`Le copilote de direction de ${organization.name}. Il lit vos données avec VOS droits, explique ce qu'il conclut, et n'écrit rien sans votre clic.`}
        action={
          <form action={runExecutiveScan}>
            <SubmitButton variant="secondary">Lancer l&apos;analyse</SubmitButton>
          </form>
        }
      />

      <OasisTabs current="/oasis-ai" openDecisions={openDecisions ?? 0} />

      {/* ---- Le bonjour, la date, la confiance ---- */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[length:var(--text-section)] font-semibold tracking-tight">
            {briefing.salutation}.
          </h2>
          <p className="mt-1 text-[var(--text-body)] text-ink-soft">
            {today.toLocaleDateString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {recommendations > 0 &&
              ` — ${recommendations} recommandation${recommendations > 1 ? "s" : ""} ce matin.`}
          </p>
        </div>
        {/* La confiance ne s'affiche QUE s'il y a quelque chose à
            qualifier. Sur un matin sans rien à signaler,
            `ai_oasis_daily` rend « insufficient_data » — c'est exact
            (zéro candidat analysé) mais illisible : la pastille dirait
            « données insuffisantes » à côté d'une phrase qui dit « tout
            va bien ». L'état vide s'explique tout seul, plus bas. */}
        {!briefing.failed && recommendations > 0 && (
          <Badge tone={CONFIDENCE_TONES[briefing.confiance]}>
            {CONFIDENCE_LABELS[briefing.confiance]}
          </Badge>
        )}
      </div>

      {/* ---- Ce qu'Oasis n'a pas pu regarder ---- */}
      {briefing.failed && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            Le briefing du matin n&apos;a pas pu être établi.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-warning">
            {briefing.failureReason} Ce n&apos;est pas « rien à signaler » : c&apos;est
            « je n&apos;ai pas pu regarder ».
          </p>
        </Card>
      )}

      {briefing.droitsManquants.length > 0 && (
        /* §"un agent agit avec les permissions de l'utilisateur" : un
           brief amputé qui se nomme vaut mieux qu'un brief complet
           mensonger. On dit lesquels manquent, pas « certaines
           données ». */
        <Card className="mb-6 border-info/30 bg-info-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-info">
            Briefing partiel : {briefing.droitsManquants.join(", ")}.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-info">
            Votre rôle n&apos;ouvre pas ces données. Les recommandations correspondantes
            sont absentes — pas nulles, absentes. Un administrateur peut vous accorder
            le droit manquant.
          </p>
        </Card>
      )}

      {/* ---- Les rubriques ---- */}
      {briefing.rubriques.length > 0 ? (
        <div className="mb-10 flex flex-col gap-4">
          {briefing.rubriques.map((rubrique) => (
            <Panel
              key={rubrique.code}
              title={rubrique.titre}
              count={rubrique.elements.length}
              action={<Badge tone={rubricTone(rubrique.code)}>{rubrique.code}</Badge>}
            >
              <ul className="divide-y divide-line">
                {rubrique.elements.map((element, index) => (
                  <BriefLine key={`${rubrique.code}-${index}`} item={element} />
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      ) : (
        !briefing.failed && (
          <Card className="mb-10 px-5 py-10 text-center">
            <p className="text-[length:var(--text-card)] font-medium">
              Rien ne réclame une décision ce matin.
            </p>
            <p className="mx-auto mt-2 max-w-md text-[var(--text-body)] text-ink-soft">
              {briefing.note ??
                "Aucun chantier prêt à facturer, aucune facture en retard, aucun devis à relancer sur le périmètre lisible par ce compte."}
            </p>
          </Card>
        )
      )}

      {/* ---- Les faits du jour, sous les recommandations ---- */}
      <DayDetail priorities={priorities} />

      <p className="mt-8 text-[11px] text-ink-faint">
        {usage?.used ? `${usage.used} question(s) posées à Oasis ce mois-ci. ` : ""}
        Les montants viennent de vos données, mais relisez-les avant de vous engager
        dessus. Chaque écriture d&apos;Oasis est signée dans{" "}
        <Link href="/oasis-ai/historique" className="text-accent hover:underline">
          l&apos;historique
        </Link>
        , avec l&apos;agent, votre nom et l&apos;heure.
      </p>
    </div>
  );
}

function rubricTone(code: string): Tone {
  switch (code) {
    case "URGENT":
      return "critical";
    case "COMMERCIAL":
      return "accent";
    case "FINANCE":
      return "warning";
    case "PLANNING":
      return "info";
    default:
      return "neutral";
  }
}

/**
 * Une ligne du briefing, et son explication repliée.
 *
 * `<details>` natif plutôt qu'un état React : la page reste un composant
 * serveur, l'ouverture marche sans JavaScript, et la recherche du
 * navigateur (Ctrl+F) trouve le texte replié. Le « Pourquoi ? » n'est
 * donc jamais à un chargement de distance.
 */
function BriefLine({ item }: { item: BriefItem }) {
  return (
    <li className="px-5 py-3.5">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="min-w-0 flex-1 text-[var(--text-body)] font-medium">
            {item.titre}
          </span>
          {/* Un tiret, jamais « 0 € » : « on ne sait pas chiffrer » et
              « ça ne vaut rien » ne se lisent pas pareil. */}
          <span
            className={`tabular shrink-0 text-[var(--text-body)] font-medium ${
              item.impactCents === null ? "text-ink-faint" : ""
            }`}
          >
            {formatCents(item.impactCents)}
          </span>
          <span className="shrink-0 text-[var(--text-secondary)] text-accent group-open:hidden">
            Pourquoi ?
          </span>
          <span className="hidden shrink-0 text-[var(--text-secondary)] text-ink-faint group-open:inline">
            Replier
          </span>
        </summary>

        <div className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-4 py-3.5">
          <Explanation
            pourquoi={item.pourquoi}
            impactCents={item.impactCents}
            impactTexte={item.impactTexte}
            donneesUtilisees={item.donneesUtilisees}
            confiance={item.confiance}
            siRienNestFait={item.siRienNestFait}
            actionRecommandee={item.actionRecommandee}
          />
          <p className="mt-3 border-t border-line pt-2.5 text-[var(--text-secondary)] text-ink-faint">
            Pour agir dessus, lancez l&apos;analyse : elle porte cette ligne dans{" "}
            <Link href="/oasis-ai/decisions" className="text-accent hover:underline">
              le centre de décision
            </Link>
            , où elle reçoit ses boutons.
          </p>
        </div>
      </details>
    </li>
  );
}

/**
 * Les sept listes de faits datés, telles que cet écran les affichait
 * déjà. Elles viennent de la MÊME réponse que le briefing
 * (`sources.prioritesDuJour`), donc elles ne peuvent pas le
 * contredire.
 *
 * Elles restent sous les recommandations, et non au-dessus : le
 * briefing dit ce qu'il faut faire, le détail dit sur quoi. Un écran
 * qui commence par une liste d'interventions oblige à conclure
 * soi-même — c'est exactement ce que cette phase remplace.
 */
function DayDetail({ priorities }: { priorities: DailyPriorities }) {
  const pending = priorities.pointagesAValider;
  const total =
    priorities.interventionsDuJour.length +
    priorities.devisARelancer.length +
    priorities.devisQuiExpirent.length +
    priorities.facturesEnRetard.length +
    priorities.chantiersEnRetard.length +
    priorities.receptionsAttendues.length;

  if (priorities.failed) {
    return (
      <Card className="border-warning/30 bg-warning-wash px-4 py-3.5">
        <p className="text-[var(--text-body)] font-medium text-warning">
          Le détail du jour n&apos;a pas pu être établi.
        </p>
        <p className="mt-1 text-[var(--text-secondary)] text-warning">
          Vos interventions et vos factures restent consultables depuis leurs écrans.
        </p>
      </Card>
    );
  }

  if (total === 0 && (pending.nombre ?? 0) === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-[length:var(--text-section)] font-semibold tracking-tight">
        Le détail du jour
      </h2>
      <div className="flex flex-col gap-3">
        <DailyBlock
          title="Interventions du jour"
          count={priorities.interventionsDuJour.length}
          href="/planning"
        >
          {priorities.interventionsDuJour.map((item, index) => (
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
          count={priorities.facturesEnRetard.length}
          tone="critical"
          href="/factures"
        >
          {priorities.facturesEnRetard.map((item, index) => (
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
          count={priorities.devisARelancer.length}
          tone="warning"
          href="/devis"
        >
          {priorities.devisARelancer.map((item, index) => (
            <Row
              key={index}
              main={`${item.numero} — ${item.titre}`}
              detail={`Envoyé le ${formatDate(item.envoyeLe)}, sans réponse`}
            />
          ))}
        </DailyBlock>

        <DailyBlock
          title="Devis qui expirent"
          count={priorities.devisQuiExpirent.length}
          tone="warning"
          href="/devis"
        >
          {priorities.devisQuiExpirent.map((item, index) => (
            <Row
              key={index}
              main={item.numero}
              detail={`Valable jusqu'au ${formatDate(item.valableJusquAu)}`}
            />
          ))}
        </DailyBlock>

        <DailyBlock
          title="Chantiers en retard"
          count={priorities.chantiersEnRetard.length}
          tone="warning"
          href="/projets"
        >
          {priorities.chantiersEnRetard.map((item, index) => (
            <Row
              key={index}
              main={`${item.numero} — ${item.nom}`}
              detail={`Fin prévue le ${formatDate(item.finPrevue)}`}
            />
          ))}
        </DailyBlock>

        <DailyBlock
          title="Réceptions attendues"
          count={priorities.receptionsAttendues.length}
          href="/achats"
        >
          {priorities.receptionsAttendues.map((item, index) => (
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
            <p className="min-w-0 flex-1 text-[var(--text-body)]">
              <strong className="tabular">{pending.heures ?? 0} h</strong> pointées
              attendent une validation. Tant qu&apos;elles ne sont pas validées, elles
              n&apos;entrent dans aucun budget de chantier — et la marge affichée est
              incomplète.
            </p>
            <Link
              href="/projets/interventions"
              className="text-[var(--text-body)] text-accent hover:underline"
            >
              Valider
            </Link>
          </Card>
        )}
      </div>
    </section>
  );
}

function DailyBlock({
  title,
  count,
  children,
  tone,
  href,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  // Un bloc vide ne s'affiche pas : une liste de titres suivis de
  // « aucun » remplit l'écran sans rien dire.
  if (count === 0) return null;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="flex-1 text-[var(--text-body)] font-medium">{title}</h3>
        <Badge tone={tone ?? "neutral"}>{count}</Badge>
        {href && (
          <Link href={href} className="text-[var(--text-secondary)] text-accent hover:underline">
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
        <span className="block truncate text-[var(--text-body)]">{main}</span>
        {detail && (
          <span className="block truncate text-[var(--text-secondary)] text-ink-soft">
            {detail}
          </span>
        )}
      </span>
      {amount && (
        <span className="tabular shrink-0 text-[var(--text-body)] font-medium">{amount}</span>
      )}
    </li>
  );
}

export const dynamic = "force-dynamic";
