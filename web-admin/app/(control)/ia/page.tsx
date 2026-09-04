import type { Metadata } from "next";
import Link from "next/link";

import { Auteur, EtatDisponibilite, IdentifiantModele, NiveauBadge } from "@/components/ia/affichage";
import { EcranIaFerme } from "@/components/ia/socle";
import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  ButtonLink,
  Card,
  DataTable,
  EmptyState,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  SubmitButton,
  type Column,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { formatDateTime } from "@/lib/format";
import { construireCarte, niveauDeLIdentifiant, surchargesOrphelines } from "@/lib/ia/carte";
import { verifierDisponibilite } from "@/lib/ia/disponibilite";
import {
  AGENTS_SURCHARGEABLES,
  CIBLE_RATIO,
  LIBELLES_NIVEAU,
  NIVEAUX,
  VARIABLES_MODELE,
  lireEtatRouteur,
} from "@/lib/ia/modeles";
import {
  diagnostiquerSocleIa,
  indexerEntreprises,
  listerEntreprises,
  lireSurcharges,
  resoudreAuteurs,
} from "@/lib/ia/source";
import type { LigneSurcharge } from "@/lib/ia/types";

/**
 * ==================================================================
 * MODEL ROUTER — spec Control Center p.16
 * ==================================================================
 *
 * « Depuis l'administration technique : Executive → Advanced, Finance →
 * Standard, Classification → Economy. Ne pas exposer cette
 * configuration aux clients ordinaires. »
 *
 * Cet écran est le déménagement de `web-pro/app/(app)/parametres/ia/`.
 * Ce qui y était offert au gestionnaire d'une entreprise cliente —
 * choisir le modèle que l'ÉDITEUR paie — est ici, chez celui qui reçoit
 * la facture.
 *
 * ------------------------------------------------------------------
 * TROIS CHOSES, ET ELLES N'ONT PAS LA MÊME AUTORITÉ
 * ------------------------------------------------------------------
 *   1. LES TROIS IDENTIFIANTS, lus dans l'environnement de CE serveur.
 *      Le contrôle de disponibilité les confronte à l'API — c'est ici,
 *      et nulle part ailleurs, qu'on apprend qu'un nom est faux.
 *   2. LA TABLE AGENT → NIVEAU, recopiée du produit. Elle DIT ce que le
 *      produit livre ; elle ne prouve pas ce que le serveur d'Oasis Care
 *      Pro applique, et l'écran ne le prétend pas.
 *   3. LES SURCHARGES PAR ENTREPRISE, lues en base — donc partagées par
 *      les deux applications, donc la seule des trois qui fasse
 *      autorité. C'est aussi la seule que cet écran écrit.
 *
 * ------------------------------------------------------------------
 * POURQUOI LE CONTRÔLE DE DISPONIBILITÉ NE PART PAS TOUT SEUL
 * ------------------------------------------------------------------
 * Trois requêtes HTTP, six secondes au pire, sur la clé de l'éditeur.
 * L'écran d'Oasis Care Pro les lançait à chaque affichage ; ici la page
 * sera ouverte par plusieurs administrateurs. Le déclenchement est donc
 * explicite — un bouton, un paramètre d'URL partageable — et la page se
 * charge sans rien appeler.
 */

export const metadata: Metadata = {
  title: "Routeur de modèles — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function RouteurPage({ searchParams }: PageProps<"/ia">) {
  const admin = await requireAdmin();
  const socle = await diagnostiquerSocleIa(admin.permissions);

  if (socle.etat !== "ok") {
    return (
      <EcranIaFerme
        etat={socle.etat}
        titre="Routeur de modèles"
        sousTitre="Quel modèle sert quel agent, et chez quelle entreprise."
      />
    );
  }

  const params = await searchParams;
  const verifier = params.verifier === "1";

  const etat = lireEtatRouteur();

  let surcharges: LigneSurcharge[];
  let entreprises: Awaited<ReturnType<typeof listerEntreprises>>;
  try {
    [surcharges, entreprises] = await Promise.all([lireSurcharges(), listerEntreprises()]);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="IA" title="Routeur de modèles" />
        <ReadFailure error={error} />
      </>
    );
  }

  const index = indexerEntreprises(entreprises.entreprises);
  const noms = await resoudreAuteurs(surcharges.map((ligne) => ligne.updated_by));

  // La carte SANS surcharge : c'est la table du produit, celle qui
  // s'applique à toute entreprise qui n'a rien de particulier.
  const carte = construireCarte(etat);

  const rapport = verifier ? await verifierDisponibilite(etat) : null;
  const orphelines = surchargesOrphelines(surcharges);

  const peutEcrire = admin.permissions.includes("ai.models.write");

  const colonnes: Column<LigneSurcharge>[] = [
    {
      key: "entreprise",
      header: "Entreprise",
      cell: (ligne) => index.get(ligne.organization_id)?.nom ?? "Entreprise inconnue",
    },
    {
      key: "agent",
      header: "Agent",
      cell: (ligne) => <span className="font-mono text-[12px]">{ligne.agent}</span>,
    },
    {
      key: "modele",
      header: "Modèle imposé",
      cell: (ligne) => {
        const niveau = niveauDeLIdentifiant(etat, ligne.model);
        return (
          <span className="flex flex-wrap items-center gap-2">
            <IdentifiantModele modele={ligne.model} />
            {niveau !== null ? (
              <NiveauBadge niveau={niveau} />
            ) : (
              <Badge tone="critical">Décrochée</Badge>
            )}
          </span>
        );
      },
    },
    {
      key: "motif",
      header: "Motif",
      secondary: true,
      cell: (ligne) => (
        <span className="text-[var(--text-secondary)] text-ink-soft">
          {ligne.reason ?? "—"}
        </span>
      ),
    },
    {
      key: "auteur",
      header: "Posée par",
      cell: (ligne) => (
        <Auteur identifiant={ligne.updated_by} quand={ligne.updated_at} noms={noms} />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="IA"
        title="Routeur de modèles"
        subtitle="Quel modèle sert quel agent, et chez quelle entreprise. Cette configuration appartient à l'éditeur : c'est lui qui paie les jetons, et la spec p.16 interdit de l'exposer aux clients."
        action={
          <ButtonLink href="/ia/plafonds" variant="secondary">
            Plafonds et quotas
          </ButtonLink>
        }
      />

      {carte.decrochees.length === 0 && orphelines.length === 0 ? null : (
        <Notice tone="critical" title="Des surcharges pointent un identifiant que plus personne ne sert">
          Une surcharge fige un identifiant LITTÉRAL — la migration 0076 l&apos;assume, parce que
          SQL ne doit connaître aucun nom de modèle. Le jour où l&apos;un des trois identifiants
          change, les entreprises surchargées restent accrochées à l&apos;ancien et leur IA tombe
          en 404 pendant que celle des autres tourne. Rien ne le signalerait ailleurs : la table
          est correcte, le routeur est correct.
        </Notice>
      )}

      {/* ---------------------------------------------------------- */}
      {/* 1. Les trois identifiants                                   */}
      {/* ---------------------------------------------------------- */}
      <Panel
        title="Les trois identifiants en vigueur"
        description="Lus dans l'environnement de CE serveur. Si le Control Center et Oasis Care Pro ne portent pas la même configuration, l'écart est invisible d'ici — c'est l'argument le plus fort pour que ces trois valeurs finissent en base."
        action={
          <form method="get" action="/ia">
            <SubmitButton variant="secondary">
              {rapport === null ? "Vérifier auprès de l'API" : "Revérifier"}
            </SubmitButton>
            <input type="hidden" name="verifier" value="1" />
          </form>
        }
      >
        <div className="divide-y divide-line">
          {NIVEAUX.map((niveau) => {
            const verification = rapport?.modeles.find((m) => m.niveau === niveau) ?? null;
            const surcharge = etat.identifiantsSurcharges.includes(niveau);
            return (
              <div key={niveau} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <NiveauBadge niveau={niveau} />
                    <IdentifiantModele modele={etat.modeles[niveau]} />
                    {surcharge && (
                      <Badge tone="info">Posé par {VARIABLES_MODELE[niveau]}</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
                    Cible d&apos;usage {CIBLE_RATIO[niveau]} % (spec p.17). Corrigible par la
                    variable{" "}
                    <code className="font-mono text-[11px]">{VARIABLES_MODELE[niveau]}</code>.
                  </p>
                  {verification !== null && (
                    <p className="mt-1.5 max-w-3xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                      {verification.detail}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {verification === null ? (
                    <StatusBadge tone="neutral" dot={false}>
                      Non interrogé
                    </StatusBadge>
                  ) : (
                    <EtatDisponibilite etat={verification.etat} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {rapport !== null && (
          <div className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] text-ink-faint">
            Vérifié le {formatDateTime(rapport.verifieLe)}.{" "}
            {rapport.cleConfiguree
              ? "« Introuvable » est un constat : le nom est faux, ou ce compte n'a pas accès au modèle. « Non vérifiable » n'est ni un oui ni un non."
              : "Aucune clé OpenAI dans l'environnement du Control Center : les trois réponses sont « non vérifiable », et surtout pas « introuvable » — un nom parfaitement correct le paraîtrait."}
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------------- */}
      {/* 2. Les anomalies de configuration                           */}
      {/* ---------------------------------------------------------- */}
      {etat.anomalies.length > 0 && (
        <div className="mt-5">
          <Panel
            title="Variables d'environnement refusées"
            description="Un réglage d'urgence qui n'a pas pris, et que personne ne voit, c'est la panne du lendemain matin avec en prime la conviction fausse d'avoir agi."
            count={etat.anomalies.length}
          >
            <ul className="divide-y divide-line">
              {etat.anomalies.map((anomalie) => (
                <li key={anomalie.variable} className="px-4 py-3">
                  <code className="font-mono text-[12px] text-ink">{anomalie.variable}</code>
                  <span className="ml-2 text-[var(--text-secondary)] text-ink-faint">
                    = « {anomalie.valeur} »
                  </span>
                  <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
                    {anomalie.raison}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* 3. La table agent → niveau                                  */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="La carte du produit : quel agent mérite quel niveau"
          description="Recopiée de web-pro/lib/ai/model/configuration.ts. Elle dit ce que le produit LIVRE ; elle ne prouve pas ce que le serveur Pro applique — deux déploiements, deux environnements."
          count={carte.surchargeables.length + carte.autres.length}
        >
          <ul className="divide-y divide-line">
            {[...carte.surchargeables, ...carte.autres].map((ligne) => (
              <li
                key={ligne.cle}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{ligne.libelle}</span>
                    {ligne.surchargeable ? (
                      <Badge tone="accent">Surchargeable par entreprise</Badge>
                    ) : (
                      <Badge tone="neutral">Pas encore écrit</Badge>
                    )}
                    {ligne.deplaceParEnvironnement && (
                      <Badge tone="info">Déplacé par {ligne.variableEnvironnement}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                    {ligne.mission}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <NiveauBadge niveau={ligne.niveauConfigure} />
                  <IdentifiantModele modele={ligne.modeleConfigure} />
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Quatre agents seulement acceptent une surcharge en base —{" "}
            {AGENTS_SURCHARGEABLES.map((agent) => agent).join(", ")} — parce que
            <code className="mx-1 font-mono text-[11px]">ai_is_supported_agent</code> (migration
            0072) refuse les dix autres. Ils sont calibrés d&apos;avance pour qu&apos;un nouvel
            agent n&apos;arrive jamais avec un modèle codé en dur dans son propre fichier.
            {" "}Les trois niveaux, dans l&apos;ordre du moins cher au plus cher :{" "}
            {NIVEAUX.map((n) => LIBELLES_NIVEAU[n]).join(" → ")}.
          </div>
        </Panel>
      </div>

      {/* ---------------------------------------------------------- */}
      {/* 4. Les surcharges par entreprise                            */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Surcharges en vigueur, par entreprise"
          description="La seule des trois sources qui fasse autorité : elle est en base, donc partagée par le Control Center et par le moteur des agents."
          count={surcharges.length}
        >
          <DataTable
            columns={colonnes}
            rows={surcharges}
            rowKey={(ligne) => `${ligne.organization_id}:${ligne.agent}`}
            rowHref={(ligne) => `/ia/organisations/${ligne.organization_id}`}
            empty={
              <div className="px-4 py-8 text-center">
                <p className="text-[length:var(--text-card)] font-medium text-ink">
                  Aucune surcharge en vigueur
                </p>
                <p className="mx-auto mt-2 max-w-2xl text-[var(--text-body)] leading-relaxed text-ink-soft">
                  Toutes les entreprises suivent la carte du produit. C&apos;est l&apos;état
                  souhaitable : une surcharge fige un identifiant, et on ne fige qu&apos;avec une
                  raison. Cette lecture passe par la politique « Platform reads
                  ai_model_overrides » de la migration 0080 — si vous lisez cette page, elle est
                  bien en place, sans quoi l&apos;écran serait fermé.
                </p>
              </div>
            }
          />
        </Panel>
      </div>

      {orphelines.length > 0 && (
        <div className="mt-5">
          <Panel
            title="Surcharges rattachées à un agent hors catalogue"
            description="Elles n'apparaissent dans aucune carte — il n'y a pas de ligne où les mettre — mais elles restent ACTIVES : ai_model_for_agent() les lit sans broncher."
            count={orphelines.length}
          >
            <ul className="divide-y divide-line">
              {orphelines.map((ligne) => (
                <li key={`${ligne.organization_id}:${ligne.agent}`} className="px-4 py-2.5">
                  <span className="font-mono text-[12px] text-ink">{ligne.agent}</span>
                  <span className="mx-2 text-ink-faint">chez</span>
                  <Link
                    href={`/ia/organisations/${ligne.organization_id}`}
                    className="font-medium hover:text-accent"
                  >
                    {index.get(ligne.organization_id)?.nom ?? ligne.organization_id}
                  </Link>
                  <span className="ml-2">
                    <IdentifiantModele modele={ligne.model} />
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* ---------------------------------------------------------- */}
      {/* 5. Choisir une entreprise                                   */}
      {/* ---------------------------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Poser une surcharge chez une entreprise"
          description={
            peutEcrire
              ? "Choisissez l'entreprise : son écran porte les quatre sélecteurs et le formulaire de plafonds."
              : "Votre rôle ne porte pas ai.models.write — vous voyez l'aiguillage, vous ne le changez pas. C'est la séparation des pouvoirs de 0080 : le produit choisit le modèle, la facturation fixe le plafond, aucun des deux ne tient les deux bouts."
          }
          count={entreprises.entreprises.length}
        >
          {entreprises.entreprises.length === 0 ? (
            <EmptyState
              title="Aucune entreprise Pro"
              description="admin_list_organizations ne rend aucune ligne. Il n'y a donc rien à régler — et rien à surveiller non plus."
            />
          ) : (
            <ul className="divide-y divide-line">
              {entreprises.entreprises.map((entreprise) => {
                const combien = surcharges.filter(
                  (ligne) => ligne.organization_id === entreprise.id,
                ).length;
                return (
                  <li key={entreprise.id}>
                    <Link
                      href={`/ia/organisations/${entreprise.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-surface-raised"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="font-medium">{entreprise.nom}</span>
                        {entreprise.archiveeLe !== null && (
                          <Badge tone="neutral">Archivée</Badge>
                        )}
                      </span>
                      <span className="shrink-0 text-[var(--text-secondary)] text-ink-soft">
                        {combien === 0
                          ? "Suit le produit"
                          : `${combien} agent${combien > 1 ? "s" : ""} surchargé${combien > 1 ? "s" : ""}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {entreprises.tronquee && (
            <div className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] text-ink-faint">
              Liste tronquée : plus de 1 000 entreprises. Les suivantes ne sont pas affichées, et
              une surcharge posée chez elles n&apos;apparaîtrait pas dans le tableau ci-dessus —
              c&apos;est dit ici plutôt que passé sous silence.
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Card className="px-4 py-3">
          <p className="text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            <strong className="text-ink">Ce que cet écran ne peut pas savoir.</strong> Les
            variables d&apos;environnement affichées ici sont celles du Control Center. Le moteur
            des agents tourne dans Oasis Care Pro, sur un autre serveur : s&apos;il porte un
            <code className="mx-1 font-mono text-[11px]">OASIS_MODEL_ADVANCED</code>
            différent, aucune requête d&apos;ici ne peut le détecter. Seules les surcharges par
            entreprise, qui vivent en base, sont vues à l&apos;identique par les deux
            applications.
          </p>
        </Card>
      </div>
    </>
  );
}
