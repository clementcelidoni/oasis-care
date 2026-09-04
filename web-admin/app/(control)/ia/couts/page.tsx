import type { Metadata } from "next";

import { EcranIaFerme } from "@/components/ia/socle";
import { ReadFailure } from "@/components/customers/read-failure";
import { UnknownsPanel } from "@/components/dashboard/unknowns";
import {
  Badge,
  ButtonLink,
  DataTable,
  MetricCard,
  Notice,
  PageHeader,
  Panel,
  StatStrip,
  UnknownValue,
  type Column,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { readPlatformKpis } from "@/lib/dashboard/source";
import type { PlatformKpisRow } from "@/lib/dashboard/types";
import { formatCount } from "@/lib/format";
import {
  LIBELLES_INCONNUS_COUTS,
  MOTIFS_INCONNUS_COUTS,
  MOTIF_ALERTE_RENTABILITE,
  VARIABLES_TARIF,
} from "@/lib/ia/inconnus";
import { CIBLE_RATIO, LIBELLES_NIVEAU, NIVEAUX } from "@/lib/ia/modeles";
import { diagnostiquerSocleIa, listerEntreprises } from "@/lib/ia/source";
import type { Entreprise } from "@/lib/ia/types";

/**
 * ==================================================================
 * AI CONTROL CENTER — spec p.15-17, ET CE QU'IL PEUT HONNÊTEMENT DIRE
 * ==================================================================
 *
 * La spec p.15 demande neuf chiffres : requêtes du jour, jetons, coût
 * estimé, coût par organisation, par utilisateur, par agent, par
 * modèle, latence, erreurs. La p.16 en ajoute six par agent, la p.17
 * l'alerte de rentabilité.
 *
 * UN SEUL de ces chiffres se calcule aujourd'hui : le nombre de
 * requêtes d'assistant du mois, par organisation. Tout le reste est
 * INCONNU, et cet écran l'écrit — il n'affiche pas de zéro.
 *
 * ------------------------------------------------------------------
 * L'INCONNU N'EST PAS CELUI QU'ON CROIT, ET LE MOTIF COMPTE
 * ------------------------------------------------------------------
 * `admin_platform_kpis()` rend encore, pour `ai_cost_cents` :
 * « Aucune table du projet n'enregistre de tokens, de modèle, de
 * latence ni de coût » (0075, recopié en 0077). C'est FAUX depuis la
 * migration 0076 : `ai_usage_events` porte tout cela.
 *
 * Ce qui manque n'est donc pas la donnée, c'est le CHEMIN DE LECTURE.
 * La table ne porte qu'une politique — « Members read », soit
 * `is_organization_member` — et un administrateur de plateforme n'est
 * membre d'aucune entreprise cliente. Il lit zéro ligne. Une somme sur
 * zéro ligne vaut zéro, et « 0 € de coût IA » se lirait « l'IA ne coûte
 * rien » : c'est exactement le mensonge que toute cette application
 * refuse.
 *
 * La migration 0080 a ouvert `ai_model_overrides` et `ai_cost_limits` à
 * l'éditeur ; elle n'a pas touché au grand livre, et le dit elle-même.
 * Ce qu'il faut écrire est nommé dans `lib/ia/inconnus.ts` : une
 * fonction `security definer` d'agrégation gardée par
 * `platform_admin_can('ai.config.read')`, qui rende des NOMBRES et non
 * des lignes — parce qu'une ligne d'`ai_usage_events` porte un
 * `user_id` et un `decision_id` de client (règle R5 de 0075).
 *
 * ------------------------------------------------------------------
 * ET MÊME APRÈS : DEUX INCONNUS, PAS UN
 * ------------------------------------------------------------------
 * Le jour où ce chemin existera, les MONTANTS resteront inconnus tant
 * que les six variables `OASIS_AI_TARIF_…` ne sont pas posées sur le
 * serveur d'Oasis Care Pro : `estimated_cost_cents` est alors écrit à
 * NULL. Un tableau qui compterait ces appels pour zéro ferait croire
 * que l'IA est gratuite — d'autant plus facilement que le NOMBRE
 * d'appels, lui, serait juste.
 */

export const metadata: Metadata = {
  title: "Coûts IA — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function CoutsIaPage() {
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleIa(admin.permissions);

  if (socle.etat !== "ok") {
    return (
      <EcranIaFerme
        etat={socle.etat}
        titre="Coûts IA"
        sousTitre="Ce que l'intelligence artificielle consomme, toutes organisations confondues."
      />
    );
  }

  let kpis: PlatformKpisRow;
  let entreprises: Awaited<ReturnType<typeof listerEntreprises>>;
  try {
    [kpis, entreprises] = await Promise.all([readPlatformKpis(), listerEntreprises()]);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="IA" title="Coûts IA" />
        <ReadFailure error={error} />
      </>
    );
  }

  // Les entreprises qui ont RÉELLEMENT un compteur ce mois-ci, les plus
  // consommatrices d'abord. Une entreprise sans compteur n'est pas à
  // zéro : elle n'a pas encore de ligne, et le tableau le dit.
  const parConsommation = [...entreprises.entreprises].sort((a, b) => {
    const ga = a.requetesAssistantCeMois;
    const gb = b.requetesAssistantCeMois;
    if (ga === null && gb === null) return a.nom.localeCompare(b.nom, "fr");
    if (ga === null) return 1;
    if (gb === null) return -1;
    return gb - ga;
  });

  const colonnes: Column<Entreprise>[] = [
    { key: "nom", header: "Entreprise", cell: (ligne) => ligne.nom },
    {
      key: "forfait",
      header: "Forfait",
      secondary: true,
      cell: (ligne) =>
        ligne.forfait !== null ? (
          <Badge tone="neutral">{ligne.forfait}</Badge>
        ) : (
          <UnknownValue compact reason={MOTIFS_INCONNUS_COUTS.revenu_abonnement} />
        ),
    },
    {
      key: "requetes",
      header: "Requêtes assistant ce mois",
      numeric: true,
      cell: (ligne) =>
        ligne.requetesAssistantCeMois !== null ? (
          formatCount(ligne.requetesAssistantCeMois)
        ) : (
          <UnknownValue
            compact
            reason="Aucune ligne dans ai_pro_usage pour ce mois : le compteur n'est créé qu'au premier appel. Ce n'est pas « zéro requête », c'est « pas encore de compteur »."
          />
        ),
    },
    {
      key: "cout",
      header: "Coût IA ce mois",
      numeric: true,
      cell: () => <UnknownValue compact reason={MOTIFS_INCONNUS_COUTS.cout_par_organisation} />,
    },
    {
      key: "revenu",
      header: "Revenu abonnement",
      numeric: true,
      secondary: true,
      cell: () => <UnknownValue compact reason={MOTIFS_INCONNUS_COUTS.revenu_abonnement} />,
    },
    {
      key: "rentabilite",
      header: "Rentabilité",
      cell: () => <UnknownValue compact reason={MOTIF_ALERTE_RENTABILITE} />,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="IA"
        title="Coûts IA"
        subtitle="Ce que l'intelligence artificielle consomme, toutes organisations confondues. Un seul des neuf chiffres de la spec p.15 se calcule aujourd'hui ; les huit autres sont inconnus, et le motif est plus intéressant qu'il n'y paraît."
        action={
          <ButtonLink href="/ia" variant="secondary">
            Routeur de modèles
          </ButtonLink>
        }
      />

      <Notice tone="warning" title="Le motif d'inconnu du tableau de bord est périmé">
        La carte « Coût de l&apos;IA » de l&apos;accueil affiche encore « aucune table du projet
        n&apos;enregistre de tokens, de modèle, de latence ni de coût » (0075, recopié en 0077).
        C&apos;est faux depuis la migration 0076 : <code className="font-mono text-[11px]">ai_usage_events</code>{" "}
        porte <code className="font-mono text-[11px]">input_tokens</code>,{" "}
        <code className="font-mono text-[11px]">output_tokens</code>,{" "}
        <code className="font-mono text-[11px]">model</code>,{" "}
        <code className="font-mono text-[11px]">duration_ms</code> et{" "}
        <code className="font-mono text-[11px]">estimated_cost_cents</code>. Ce qui manque est le
        chemin de lecture, pas la donnée — corriger la carte demande de toucher{" "}
        <code className="font-mono text-[11px]">admin_platform_kpis()</code>, ce qu&apos;aucune
        migration n&apos;a encore fait.
      </Notice>

      {/* ---------------------------------------------------------- */}
      {/* Les grands chiffres                                         */}
      {/* ---------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Requêtes assistant Pro, ce mois"
          value={formatCount(kpis.pro_ai_requests_this_month)}
          unknownReason={
            "ai_pro_usage ne porte aucune ligne pour ce mois. Le compteur naît au premier appel."
          }
          hint="Compté par ai_pro_usage, période UTC. Ce sont des QUESTIONS d'assistant, pas des exécutions d'agent."
        />
        <MetricCard
          label="Requêtes IA mobile, ce mois"
          value={formatCount(kpis.mobile_ai_requests_this_month)}
          unknownReason="usage_counters ne porte aucune ligne pour ce mois."
          hint="L'application iPhone, comptée à part : elle n'appelle pas les mêmes agents."
        />
        <MetricCard
          label="Coût IA du mois"
          value={null}
          unknownReason={MOTIFS_INCONNUS_COUTS.cout_total}
        />
        <MetricCard
          label="Jetons consommés"
          value={null}
          unknownReason={MOTIFS_INCONNUS_COUTS.jetons}
        />
      </div>

      <div className="mt-3">
        <StatStrip
          items={[
            { label: "Requêtes du jour", value: null, unknownReason: MOTIFS_INCONNUS_COUTS.requetes_du_jour },
            { label: "Latence moyenne", value: null, unknownReason: MOTIFS_INCONNUS_COUTS.latence },
            { label: "Appels en échec", value: null, unknownReason: MOTIFS_INCONNUS_COUTS.erreurs },
            {
              label: "Coût moyen par organisation",
              value: null,
              unknownReason: MOTIFS_INCONNUS_COUTS.cout_par_organisation,
            },
            {
              label: "Coût par utilisateur",
              value: null,
              unknownReason: MOTIFS_INCONNUS_COUTS.cout_par_utilisateur,
            },
            {
              label: "Coût par agent",
              value: null,
              unknownReason: MOTIFS_INCONNUS_COUTS.cout_par_agent,
            },
            {
              label: "Coût par modèle",
              value: null,
              unknownReason: MOTIFS_INCONNUS_COUTS.cout_par_modele,
            },
            {
              label: "Entreprises Pro",
              value: formatCount(entreprises.entreprises.length),
              note: entreprises.tronquee ? "Liste tronquée à 1 000." : undefined,
            },
          ]}
        />
      </div>

      {/* ---------------------------------------------------------- */}
      {/* L'alerte de rentabilité — spec p.17                         */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Alerte de rentabilité"
          description="« ⚠ Organisation XYZ — coût IA ce mois 168 €, revenu abonnement 149 €, ratio non rentable » (spec p.17). C'est la fonction qui justifie tout cet écran."
        >
          <div className="px-4 py-4">
            <UnknownValue label="Aucune alerte calculable" reason={MOTIF_ALERTE_RENTABILITE} />
            <p className="mt-3 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              Ce n&apos;est pas « aucune entreprise n&apos;est non rentable ». Les deux termes du
              ratio manquent, et pour des raisons différentes : le numérateur faute de chemin de
              lecture vers <code className="font-mono text-[11px]">ai_usage_events</code>, le
              dénominateur parce qu&apos;aucun abonnement n&apos;est enregistré —{" "}
              <code className="font-mono text-[11px]">organization_subscriptions</code> est vide,
              et aucune ligne du dépôt ne l&apos;écrit. Un ratio calculé avec un zéro à la place
              d&apos;un inconnu désignerait des entreprises « non rentables » au hasard, et
              l&apos;écran servirait alors exactement à l&apos;inverse de ce pour quoi il est
              demandé.
            </p>
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Le ratio des trois niveaux — spec p.17                      */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Répartition des trois niveaux"
          description="La cible de la spec p.17. L'écart réel se calculerait en groupant ai_usage_events par modèle, puis en ramenant chaque identifiant à son niveau."
        >
          <ul className="divide-y divide-line">
            {NIVEAUX.map((niveau) => (
              <li
                key={niveau}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="font-medium text-ink">{LIBELLES_NIVEAU[niveau]}</span>
                <span className="flex items-center gap-4">
                  <span className="tabular text-[var(--text-secondary)] text-ink-soft">
                    Cible {CIBLE_RATIO[niveau]} %
                  </span>
                  <UnknownValue
                    label="Réel inconnu"
                    inline
                    reason={MOTIFS_INCONNUS_COUTS.ratio_niveaux}
                  />
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Cette cible est un arbitrage de COÛT de l&apos;éditeur, et c&apos;est pour cela
            qu&apos;elle vit ici : l&apos;écart se lit en euros sur la facture du fournisseur, pas
            sur la qualité perçue d&apos;un devis. Un quatrième agent passé en « Avancé » ferait
            passer les 5 % au double.
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Par organisation                                            */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Par organisation"
          description="Ce qu'on sait vraiment : le nombre de questions posées à l'assistant ce mois-ci. Le reste attend un chemin de lecture."
          count={entreprises.entreprises.length}
        >
          <DataTable
            columns={colonnes}
            rows={parConsommation}
            rowKey={(ligne) => ligne.id}
            rowHref={(ligne) => `/ia/organisations/${ligne.id}`}
            empty={
              <div className="px-4 py-8 text-center text-[var(--text-body)] text-ink-soft">
                Aucune entreprise Pro. Il n&apos;y a donc rien à consommer.
              </div>
            }
          />
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Le quota codé en dur                                        */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Le quota d'assistant, et où il vit aujourd'hui"
          description="500 questions par mois et par entreprise — une constante TypeScript, pas un réglage."
        >
          <div className="px-4 py-3 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            <p>
              Le plafond est écrit dans{" "}
              <code className="font-mono text-[11px]">
                web-pro/app/api/oasis-ai/identite.ts
              </code>{" "}
              (<code className="font-mono text-[11px]">QUESTIONS_PAR_MOIS = 500</code>) et
              consommé par <code className="font-mono text-[11px]">consume_pro_ai_quota</code>{" "}
              (migration 0058, qui le décrit elle-même comme « un garde-fou de coût, pas une offre
              commerciale »). Ni l&apos;éditeur ni le client ne peut le changer sans déploiement,
              et le client ne l&apos;apprend qu&apos;au refus.
            </p>
            <p className="mt-2">
              C&apos;est une borne de dépense de l&apos;éditeur : sa place est ici, en réglage par
              plan. Tant qu&apos;elle n&apos;y est pas, cet écran ne prétend pas la piloter — il
              dit où elle se trouve.
            </p>
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Les tarifs                                                  */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="La grille tarifaire des jetons"
          description="Six variables d'environnement, sans valeur par défaut, posées sur le serveur d'Oasis Care Pro — pas sur celui-ci."
        >
          <ul className="divide-y divide-line">
            {VARIABLES_TARIF.map((variable) => (
              <li key={variable} className="flex items-center justify-between gap-3 px-4 py-2">
                <code className="font-mono text-[11px] text-ink-soft">{variable}</code>
                <UnknownValue
                  label="Non lisible d'ici"
                  inline
                  reason="Cette variable est lue par le serveur d'Oasis Care Pro au moment d'écrire ai_usage_events. Le Control Center ne partage pas cet environnement : il ne peut ni la lire ni affirmer qu'elle est absente."
                />
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Sans elles, <code className="font-mono text-[11px]">estimated_cost_cents</code> est
            écrit à NULL et <code className="font-mono text-[11px]">cost_basis</code> dit
            pourquoi. Le jour où l&apos;agrégation existera, ces appels devront être comptés comme
            « sans tarif connu » à côté du total — jamais pour zéro. C&apos;est déjà la doctrine
            de la base : <code className="font-mono text-[11px]">ai_cost_budget_remaining</code>{" "}
            (0076) rend <code className="font-mono text-[11px]">unpriced_events_today</code> À
            CÔTÉ de la dépense, pour cette raison exacte.
          </div>
        </Panel>
      </div>

      <div className="mt-5">
        <UnknownsPanel
          reasons={MOTIFS_INCONNUS_COUTS}
          labels={LIBELLES_INCONNUS_COUTS}
        />
      </div>
    </>
  );
}
