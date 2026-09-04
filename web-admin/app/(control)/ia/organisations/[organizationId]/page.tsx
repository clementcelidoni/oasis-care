import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { IdentifiantModele, NiveauBadge, Plafond } from "@/components/ia/affichage";
import { FormulaireModeles, type LigneFormulaireModele } from "@/components/ia/formulaire-modeles";
import { FormulairePlafonds } from "@/components/ia/formulaire-plafonds";
import { JournalIa } from "@/components/ia/journal";
import { EcranIaFerme } from "@/components/ia/socle";
import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  ButtonLink,
  Notice,
  PageHeader,
  Panel,
  StatStrip,
  TechnicalId,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { formatCount } from "@/lib/format";
import { choixCourant, construireCarte } from "@/lib/ia/carte";
import { lireEtatRouteur } from "@/lib/ia/modeles";
import { champDepuisCents, sansAucunPlafond } from "@/lib/ia/montants";
import {
  diagnostiquerSocleIa,
  lireJournalIa,
  lirePlafonds,
  lireSurcharges,
  resoudreAuteurs,
  trouverEntreprise,
} from "@/lib/ia/source";
import type { Entreprise, LigneJournal, LignePlafonds, LigneSurcharge } from "@/lib/ia/types";

/**
 * ==================================================================
 * LES RÉGLAGES IA D'UNE ENTREPRISE — la seule page qui écrit
 * ==================================================================
 *
 * Elle réunit ce qui, jusqu'à la migration 0080, vivait dans Oasis Care
 * Pro et appartenait au gestionnaire de l'entreprise elle-même : le
 * modèle de chaque agent, et les trois plafonds de dépense. Ce sont les
 * deux réglages dont la conséquence est une facture chez l'ÉDITEUR, pas
 * un devis parti trop vite chez le client.
 *
 * ------------------------------------------------------------------
 * CE QUI RESTE AU CLIENT, ET QUI N'EST PAS ICI
 * ------------------------------------------------------------------
 * Le niveau d'autonomie de chaque agent (`ai_agent_settings`) et les
 * règles d'autopilote (`ai_autopilot_rules`) gardent leurs politiques
 * de la migration 0072 : le client les règle, l'éditeur n'y touche pas.
 * Ils engagent SES données et SON travail. Un chantier de gouvernance
 * des coûts n'avait aucune raison de les emporter au passage, et 0080
 * le vérifie dans les deux sens.
 *
 * ------------------------------------------------------------------
 * DEUX FORMULAIRES, DEUX PERMISSIONS, ET C'EST TOUT LE SUJET
 * ------------------------------------------------------------------
 * `ai.models.write` au produit, `ai.costLimits.write` à la facturation,
 * et seul le super-administrateur cumule. Celui qui peut faire monter
 * la dépense ne tient pas la borne qui l'arrête : c'est la leçon du
 * défaut corrigé, écrite dans la matrice ET dans le déclencheur
 * `platform_admin_matrix_guard()`.
 *
 * Un rôle qui n'a pas la permission voit le formulaire DÉSACTIVÉ plutôt
 * que masqué : savoir qu'un réglage existe et qu'on ne l'a pas est une
 * information utile ; un écran amputé fait croire que le réglage
 * n'existe pas.
 */

export const metadata: Metadata = {
  title: "Réglages IA d'une entreprise — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function ReglagesIaOrganisationPage({
  params,
}: PageProps<"/ia/organisations/[organizationId]">) {
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleIa(admin.permissions);

  if (socle.etat !== "ok") {
    return (
      <EcranIaFerme
        etat={socle.etat}
        titre="Réglages IA d'une entreprise"
        sousTitre="Le modèle de chaque agent, et les trois plafonds de dépense."
      />
    );
  }

  const { organizationId } = await params;

  let entreprise: Entreprise | null;
  let surcharges: LigneSurcharge[];
  let plafonds: LignePlafonds[];
  let journal: LigneJournal[] | null;
  try {
    [entreprise, surcharges, plafonds, journal] = await Promise.all([
      trouverEntreprise(organizationId),
      lireSurcharges(organizationId),
      lirePlafonds(organizationId),
      lireJournalIa({
        organizationId,
        peutLire: admin.permissions.includes("platform.audit.read"),
      }),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="IA" title="Réglages IA d'une entreprise" />
        <ReadFailure error={error} />
      </>
    );
  }

  // Une entreprise introuvable est un 404, pas un écran vide : cette
  // page écrit, et un formulaire d'écriture pointé sur un identifiant
  // qui ne désigne rien est une invitation à l'erreur.
  if (entreprise === null) notFound();

  const etat = lireEtatRouteur();
  const carte = construireCarte(etat, surcharges);
  const ligne = plafonds[0] ?? null;

  const auteurs = await resoudreAuteurs([
    ...surcharges.map((s) => s.updated_by),
    ligne?.updated_by ?? null,
    ...(journal ?? []).map((entree) => entree.admin_user_id),
  ]);

  const lignesFormulaire: LigneFormulaireModele[] = carte.surchargeables.map((agent) => ({
    cleSql: agent.cleSql ?? agent.cle,
    libelle: agent.libelle,
    mission: agent.mission,
    niveauProduit: agent.niveauConfigure,
    modeleProduit: agent.modeleConfigure,
    choixCourant: choixCourant(agent),
    modeleEffectif: agent.modeleEffectif,
    decrochee: agent.decrochee,
  }));

  const peutModeles = admin.permissions.includes("ai.models.write");
  const peutPlafonds = admin.permissions.includes("ai.costLimits.write");
  const nonBornee = sansAucunPlafond(ligne);

  return (
    <>
      <PageHeader
        eyebrow="IA"
        breadcrumb={{ label: "Routeur de modèles", href: "/ia" }}
        title={entreprise.nom}
        subtitle="Le modèle de chaque agent, et les trois plafonds de dépense. Ces deux réglages engagent la facture de l'éditeur — c'est pour cela qu'ils ne sont plus chez le client."
        action={
          <ButtonLink href={`/organisations/${entreprise.id}`} variant="secondary">
            Fiche de l&apos;entreprise
          </ButtonLink>
        }
      />

      {entreprise.archiveeLe !== null && (
        <Notice tone="warning" title="Cette entreprise est archivée">
          <code className="font-mono text-[11px]">archived_at</code> est un effacement doux : la
          ligne existe toujours, et ses réglages IA aussi. Ils restent modifiables — c&apos;est
          souvent le moment où l&apos;on veut couper la dépense — mais un plafond posé ici
          n&apos;arrêtera rien si plus personne n&apos;appelle.
        </Notice>
      )}

      {nonBornee && (
        <Notice tone="warning" title="Cette entreprise n'est bornée par aucun plafond">
          {ligne === null
            ? "Aucune ligne dans ai_cost_limits : le contrôle de coût lira « aucune limite » et laissera passer tous les appels."
            : "La ligne existe, mais ses trois colonnes sont nulles — ce qui veut dire « aucune limite », et non « limite à zéro »."}
        </Notice>
      )}

      <StatStrip
        items={[
          {
            label: "Agents surchargés",
            value: formatCount(carte.nombreSurcharges),
            note: carte.nombreSurcharges === 0 ? "Suit entièrement la carte du produit." : undefined,
          },
          {
            label: "Surcharges décrochées",
            value: formatCount(carte.decrochees.length),
            tone: carte.decrochees.length > 0 ? "critical" : "neutral",
            note:
              carte.decrochees.length > 0
                ? "L'identifiant figé ne correspond plus à aucun niveau : l'IA de cette entreprise tombera en 404."
                : undefined,
          },
          {
            label: "Requêtes assistant ce mois",
            value: formatCount(entreprise.requetesAssistantCeMois),
            unknownReason:
              "Aucune ligne dans ai_pro_usage pour ce mois : le compteur naît au premier appel. Ce n'est pas « zéro requête ».",
            note: "Sur un quota de 500, codé en dur dans web-pro.",
          },
          {
            label: "Forfait",
            value: entreprise.forfait,
            unknownReason:
              "organization_subscriptions est vide et aucune ligne du dépôt ne l'écrit : le forfait d'une entreprise est inconnu, pas absent.",
          },
        ]}
      />

      {carte.decrochees.length > 0 && (
        <div className="mt-5">
          <Notice tone="critical" title="Une surcharge pointe un identifiant que plus personne ne sert">
            {carte.decrochees.map((agent) => (
              <span key={agent.cle} className="mr-3 inline-block">
                <strong className="text-ink">{agent.libelle}</strong> →{" "}
                <IdentifiantModele modele={agent.modeleEffectif} />
              </span>
            ))}
            <span className="mt-1 block">
              Cet identifiant a été figé le jour où la surcharge a été posée ; les trois
              identifiants en vigueur ont changé depuis. Choisir un niveau ci-dessous le
              remplacera, et « Suivre le produit » supprimera la surcharge.
            </span>
          </Notice>
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* Les modèles                                                 */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Le modèle de chaque agent"
          description={
            peutModeles
              ? "Quatre agents seulement acceptent une surcharge : ai_is_supported_agent (0072) refuse les dix autres. Un seul motif pour l'ensemble, une ligne de journal par agent réellement changé."
              : "Votre rôle ne porte pas ai.models.write. Les sélecteurs sont visibles mais inactifs : savoir qu'un réglage existe et qu'on ne l'a pas vaut mieux qu'un écran amputé."
          }
        >
          <FormulaireModeles
            organizationId={entreprise.id}
            lignes={lignesFormulaire}
            peutEcrire={peutModeles}
            modelesParNiveau={{ ...etat.modeles }}
          />
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Les dix agents non surchargeables                           */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Les autres agents, non surchargeables"
          description="Calibrés d'avance par la carte du produit, pour qu'un nouvel agent n'arrive jamais avec un modèle codé en dur dans son propre fichier. La base refuserait une surcharge sur eux."
          count={carte.autres.length}
        >
          <ul className="divide-y divide-line">
            {carte.autres.map((agent) => (
              <li
                key={agent.cle}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium text-ink">{agent.libelle}</span>
                  {agent.deplaceParEnvironnement && (
                    <Badge tone="info">Déplacé par {agent.variableEnvironnement}</Badge>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <NiveauBadge niveau={agent.niveauConfigure} />
                  <IdentifiantModele modele={agent.modeleConfigure} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* Les plafonds                                                */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Les trois plafonds de dépense"
          description={
            peutPlafonds
              ? "En euros. Un champ vide retire le plafond ; zéro coupe l'IA. Ce ne sont pas la même chose."
              : "Votre rôle ne porte pas ai.costLimits.write : le produit choisit le modèle, la facturation fixe le plafond, et aucun des deux ne tient les deux bouts."
          }
          footer={
            ligne !== null ? (
              <div className="flex flex-wrap items-center gap-4 text-[var(--text-secondary)] text-ink-faint">
                <span>
                  En vigueur : jour <Plafond cents={ligne.daily_organization_limit_cents} />
                </span>
                <span>
                  mois <Plafond cents={ligne.monthly_organization_limit_cents} />
                </span>
                <span>
                  par agent <Plafond cents={ligne.per_agent_limit_cents} />
                </span>
              </div>
            ) : undefined
          }
        >
          <FormulairePlafonds
            organizationId={entreprise.id}
            jour={champDepuisCents(ligne?.daily_organization_limit_cents ?? null)}
            mois={champDepuisCents(ligne?.monthly_organization_limit_cents ?? null)}
            parAgent={champDepuisCents(ligne?.per_agent_limit_cents ?? null)}
            ligneExistante={ligne !== null}
            peutEcrire={peutPlafonds}
          />
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* La trace                                                    */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <JournalIa lignes={journal} noms={auteurs} />
      </div>

      <div className="mt-5">
        <Panel title="Détails techniques">
          <div className="px-4 py-3 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            <p>
              Identifiant de l&apos;entreprise : <TechnicalId id={entreprise.id} />
            </p>
            <p className="mt-2">
              Ce que cette page NE règle PAS, et n&apos;a pas à régler : le niveau d&apos;autonomie
              de chaque agent (<code className="font-mono text-[11px]">ai_agent_settings</code>) et
              les règles d&apos;autopilote (
              <code className="font-mono text-[11px]">ai_autopilot_rules</code>). Ils décident
              jusqu&apos;où l&apos;IA agit seule sur les données du client : la conséquence
              d&apos;un mauvais réglage est un devis parti trop vite chez lui, pas une facture chez
              l&apos;éditeur. Ils restent dans Oasis Care Pro, et la migration 0080 vérifie dans
              les deux sens qu&apos;ils n&apos;ont pas bougé.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
