import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import { Card, PageHeader, Panel, Badge, StatusBadge, MetricCard, EmptyState } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { formatCents } from "@/lib/quotes/types";
import { routeurModeles } from "@/lib/ai/model/router";
import { NIVEAUX_MODELE } from "@/lib/ai/model/types";
import {
  RATIO_CIBLE,
  lireGrilleTarifaire,
  repartirParNiveau,
} from "@/lib/ai/runtime/cost";
import { LIBELLES_PANNE, type MotifPanne } from "@/lib/ai/runtime/types";
import {
  LIBELLES_NIVEAU,
  TEINTES_NIVEAU,
  estMinorant,
  nomAgentDuJournal,
  type Depense,
  type LigneVentilation,
} from "@/lib/ai/admin";
import {
  lireNomsUtilisateurs,
  lirePlafonds,
  lireStatistiquesAvis,
  lireTableauCouts,
  lireTitresDecisions,
} from "@/lib/ai/admin/lecture";
import { IaTabs } from "../IaTabs";
import { Plafonds } from "./Plafonds";

/**
 * §11V — « DASHBOARD COÛT IA » (spec p. 18-19).
 *
 *     Coût IA aujourd'hui · Coût IA mois · Coût moyen / organisation
 *     Coût / agent · Coût / décision · Coût / utilisateur
 *
 * ══════════════════════════════════════════════════════════════════
 * TOUT CE QUI EST AFFICHÉ ICI EST UNE ESTIMATION, ET L'ÉCRAN LE DIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Un montant de cette page est le produit de deux nombres : des jetons
 * comptés par le fournisseur, et un tarif que NOUS avons saisi dans une
 * variable d'environnement. Le second peut être périmé sans que
 * personne le sache — c'est même pour cela que la migration 0076 refuse
 * de tenir une grille tarifaire en base et range `cost_basis` à côté de
 * chaque montant.
 *
 * Présenter ces chiffres comme une facture serait donc faux, et
 * dangereusement : on rapproche une facture, on ne rapproche pas une
 * estimation. Le bandeau le dit une fois, en haut, et chaque total qui
 * omet des appels non tarifés le redit à sa place.
 *
 * ══════════════════════════════════════════════════════════════════
 * « COÛT MOYEN / ORGANISATION » N'EST PAS CALCULABLE ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * La page 18 s'adresse à l'« Administrateur Oasis Care », c'est-à-dire à
 * l'éditeur, qui voit tout le parc. Sur Oasis Care Pro, la RLS ne montre
 * qu'une entreprise : celle de la session. Une moyenne « par
 * organisation » calculée sur une seule organisation serait un chiffre
 * juste sous une étiquette fausse. Cette page affiche donc le total de
 * VOTRE entreprise, et renvoie la moyenne du parc là où elle a un sens.
 */
export default async function CoutsIAPage() {
  const organization = await requireOrganization();
  const peutModifier = organization.permissions.includes("organization.manageUsers");

  // Même verrou que l'onglet Configuration, et pour la même raison :
  // cette page nomme les trois modèles dans son ratio (p. 27).
  if (!peutModifier) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader
          eyebrow="Administration technique"
          title="Coûts IA"
          subtitle="Ce que le moteur d'Oasis AI consomme."
        />
        <Card className="border-info/30 bg-info-wash px-5 py-4">
          <p className="text-[var(--text-body)] font-medium text-info">
            Cet écran est réservé aux administrateurs de l&apos;entreprise.
          </p>
          <p className="mt-1 text-[var(--text-body)] text-info">
            Il détaille le moteur d&apos;Oasis AI, ses modèles et ce qu&apos;ils coûtent — un
            détail technique qui n&apos;a pas à circuler.{" "}
            <Link href="/oasis-ai" className="underline">
              Retourner à Oasis AI
            </Link>
            .
          </p>
        </Card>
      </div>
    );
  }

  const organizationId = organization.organizationId;
  const maintenant = new Date();

  const [couts, plafonds, avis] = await Promise.all([
    lireTableauCouts(organizationId, maintenant),
    lirePlafonds(organizationId),
    lireStatistiquesAvis(organizationId),
  ]);

  const tableau = couts.donnees;

  // Les noms se lisent APRÈS l'agrégation, et seulement pour les lignes
  // qu'on affiche : une jointure sur tout le grand livre coûterait cher
  // pour des lignes qui ne tiendront pas à l'écran.
  const [titres, noms] = await Promise.all([
    lireTitresDecisions(organizationId, tableau.parDecision.slice(0, 8).map((l) => l.cle)),
    lireNomsUtilisateurs(organizationId, tableau.parUtilisateur.slice(0, 8).map((l) => l.cle)),
  ]);

  const modeles = routeurModeles().modelesConfigures();
  const ratio = repartirParNiveau(tableau.parModele, modeles, tableau.complet);

  const grille = lireGrilleTarifaire();
  const tarifsManquants = NIVEAUX_MODELE.filter((n) => grille.tarifs[n] === null).map((n) =>
    LIBELLES_NIVEAU[n].toLowerCase(),
  );

  const grandLivreVide = couts.etat === "lue" && tableau.mois.appels === 0;

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Administration technique"
        title="Coûts IA"
        subtitle="Ce que le moteur consomme, comment il se répartit entre les trois niveaux, et jusqu'où il a le droit d'aller."
        action={<Badge tone="accent">Administrateur</Badge>}
      />

      <IaTabs current="/parametres/ia/couts" />

      {/* ---- La lecture n'a pas abouti ---- */}
      {couts.etat !== "lue" && (
        <Card
          className={`mb-6 px-5 py-4 ${
            couts.etat === "absente" ? "border-info/30 bg-info-wash" : "border-warning/30 bg-warning-wash"
          }`}
        >
          <p
            className={`text-[var(--text-body)] font-medium ${
              couts.etat === "absente" ? "text-info" : "text-warning"
            }`}
          >
            {couts.message}
          </p>
          <p
            className={`mt-1 text-[var(--text-secondary)] ${
              couts.etat === "absente" ? "text-info" : "text-warning"
            }`}
          >
            Les chiffres ci-dessous ne sont donc pas « zéro » : ils sont INCONNUS. Tant que le
            grand livre n&apos;est pas lisible, cette page ne peut rien affirmer de votre
            dépense.
          </p>
        </Card>
      )}

      {/* ---- Le grand livre existe et il est vide ----
          Un fait tiré des données, pas une promesse sur l'état du code :
          il restera vrai tant qu'aucun appel n'aura eu lieu, et faux dès
          le premier. */}
      {grandLivreVide && (
        <Card className="mb-6 border-info/30 bg-info-wash px-5 py-4">
          <p className="text-[var(--text-body)] text-info">
            <span className="font-medium">Aucun appel de modèle enregistré ce mois-ci.</span> Le
            grand livre est lisible et vide : ce zéro-ci est un vrai zéro. Chaque appel — réussi,
            en échec, replié, ou refusé par un plafond — y laissera une ligne.
          </p>
        </Card>
      )}

      {/* ---- Le bandeau d'estimation ---- */}
      <Card className="mb-6 px-5 py-4">
        <p className="text-[var(--text-body)] text-ink-soft">
          <span className="font-medium text-ink">Ces montants sont des estimations.</span> Ils
          multiplient des jetons comptés par le fournisseur par un tarif que nous saisissons
          nous-mêmes, côté serveur. Un tarif qui change chez le fournisseur ne se voit pas ici :
          rapprochez toujours de la facture réelle avant d&apos;en tirer une conclusion
          comptable.{" "}
          {grille.base === null
            ? "Aucun tarif n'est renseigné aujourd'hui : tous les appels sont comptés sans montant."
            : `Grille utilisée : « ${grille.base} ».`}
        </p>
        {/* CE QUE LE GRAND LIVRE COUVRE, ET COMMENT.
            Le produit a deux surfaces IA, et elles ne se comptent pas de
            la même façon. Le taire aurait été le pire des deux : un
            administrateur lirait un total en croyant qu'il couvre tout,
            ou qu'il ne couvre rien. */}
        <p className="mt-2 text-[var(--text-secondary)] text-ink-soft">
          <span className="font-medium">Les deux surfaces d&apos;Oasis AI y sont.</span> Les
          agents (briefing, décisions) inscrivent leurs jetons ET un montant estimé.
          L&apos;assistant de conversation, lui, inscrit ses jetons SANS montant : il tourne
          hors du routeur, on ne connaît donc pas son niveau de modèle, donc pas son tarif. Ses
          appels apparaissent sous « Assistant (conversation) » et comptent dans les appels non
          tarifés — la dépense affichée est un minorant, jamais un total.
        </p>
        {grille.anomalies.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {grille.anomalies.map((anomalie, index) => (
              <li key={`${anomalie.variable}-${index}`} className="text-[var(--text-secondary)] text-warning">
                <code className="rounded bg-warning-wash px-1 py-0.5 text-[11px]">
                  {anomalie.variable}
                </code>{" "}
                — {anomalie.raison}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {tableau.complet === false && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-5 py-3.5">
          <p className="text-[var(--text-body)] text-warning">
            La lecture du mois a été tronquée : les chiffres ci-dessous portent sur un
            échantillon des appels les plus récents, pas sur le mois entier.
          </p>
        </Card>
      )}

      {/* ---- Les quatre chiffres ---- */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Coût IA aujourd'hui"
          value={valeurDepense(tableau.jour, couts.etat === "lue")}
          hint={indice(tableau.jour, "depuis minuit, heure de Paris")}
        />
        <MetricCard
          label="Coût IA ce mois"
          value={valeurDepense(tableau.mois, couts.etat === "lue")}
          hint={indice(tableau.mois, `${tableau.mois.appels} appel${tableau.mois.appels > 1 ? "s" : ""}`)}
          tone="accent"
        />
        <MetricCard
          label="Coût moyen par décision"
          value={
            tableau.moyenneParDecisionCents === null
              ? null
              : formatCents(tableau.moyenneParDecisionCents)
          }
          hint={
            tableau.decisionsDistinctes === 0
              ? "aucune décision analysée ce mois-ci"
              : `sur ${tableau.decisionsDistinctes} décision${tableau.decisionsDistinctes > 1 ? "s" : ""}`
          }
        />
        <MetricCard
          label="Coût moyen par utilisateur"
          value={
            tableau.moyenneParUtilisateurCents === null
              ? null
              : formatCents(tableau.moyenneParUtilisateurCents)
          }
          hint={
            tableau.utilisateursDistincts === 0
              ? "personne n'a encore sollicité Oasis"
              : `sur ${tableau.utilisateursDistincts} compte${tableau.utilisateursDistincts > 1 ? "s" : ""}`
          }
        />
      </div>

      {/* ---- Le ratio de la page 17 ---- */}
      <Panel
        title="Répartition entre les trois niveaux"
        description="La page 17 vise une approche indicative de 15 % économique, 80 % standard, 5 % avancé. Rien ne force cette répartition — ce serait refuser le bon modèle à une demande légitime pour tenir une statistique. Ce qui est codé, c'est la mesure."
        className="mb-6"
      >
        {ratio.total === 0 ? (
          <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
            Aucun appel à répartir ce mois-ci.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {NIVEAUX_MODELE.map((niveau) => {
              const part = ratio.parNiveau[niveau];
              const ecart = ratio.ecartCible[niveau];
              return (
                <li key={niveau} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Badge tone={TEINTES_NIVEAU[niveau]}>{LIBELLES_NIVEAU[niveau]}</Badge>
                    <span className="tabular text-[length:var(--text-card)] font-semibold">
                      {part.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
                    </span>
                    <span className="text-[var(--text-secondary)] text-ink-faint">
                      cible {RATIO_CIBLE[niveau]} % ·{" "}
                      {ratio.appelsParNiveau[niveau]} appel
                      {ratio.appelsParNiveau[niveau] > 1 ? "s" : ""}
                    </span>
                    <span
                      className={`tabular ml-auto text-[var(--text-secondary)] font-medium ${
                        Math.abs(ecart) < 5 ? "text-ink-faint" : ecart > 0 ? "text-warning" : "text-info"
                      }`}
                    >
                      {ecart > 0 ? "+" : ""}
                      {ecart.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} pt
                    </span>
                  </div>
                  {/* La barre double le chiffre, elle ne le remplace pas
                      (§47 : une information portée par la seule couleur
                      disparaît pour un daltonien). */}
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-surface-sunken">
                    <div
                      className={`h-full ${
                        niveau === "advanced"
                          ? "bg-warning"
                          : niveau === "standard"
                            ? "bg-info"
                            : "bg-positive"
                      }`}
                      style={{ width: `${Math.min(100, part)}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {ratio.appelsNiveauInconnu > 0 && (
          <p className="border-t border-line bg-warning-wash px-5 py-3.5 text-[var(--text-body)] text-warning">
            {ratio.appelsNiveauInconnu} appel{ratio.appelsNiveauInconnu > 1 ? "s ont" : " a"} été
            passé{ratio.appelsNiveauInconnu > 1 ? "s" : ""} sur un modèle qui ne figure plus dans
            la configuration ({ratio.modelesInconnus.join(", ")}). Ils sont exclus du
            dénominateur plutôt que rangés d&apos;office sur un niveau : c&apos;est le plus
            souvent un identifiant qui vient de changer, et le ranger fausserait justement la
            mesure qu&apos;on regarde pour arbitrer ce changement.
          </p>
        )}
      </Panel>

      {/* ---- Les trois ventilations ---- */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Ventilation
          titre="Par agent"
          description="Qui consomme, et pour quoi."
          lignes={tableau.parAgent}
          nommer={nomAgentDuJournal}
        />
        <Ventilation
          titre="Par utilisateur"
          description="Un compte sans fiche salarié n'a pas de nom : le comptable, un accès temporaire."
          lignes={tableau.parUtilisateur}
          nommer={(cle) =>
            cle === "" ? "Compte supprimé depuis" : (noms.get(cle) ?? "Compte sans fiche salarié")
          }
        />
      </div>

      <Panel
        title="Par décision"
        description="Ce que coûte l'analyse d'une décision, du premier appel jusqu'à la recommandation. Les appels de conversation libre n'y figurent pas : ils ne sont rattachés à aucune décision."
        className="mb-6"
        count={tableau.decisionsDistinctes}
      >
        {tableau.parDecision.length === 0 ? (
          <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
            Aucun appel rattaché à une décision ce mois-ci.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {tableau.parDecision.slice(0, 8).map((ligne) => (
              <li key={ligne.cle} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-[var(--text-body)]">
                  {titres.get(ligne.cle) ?? "Décision supprimée depuis"}
                </span>
                <MontantLigne depense={ligne.depense} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ---- Les échecs ---- */}
      {tableau.appelsEnEchec > 0 && (
        <Panel
          title="Appels en échec"
          description="Un refus pour plafond en fait partie : sans lui, un budget qui coupe tout un après-midi ressemblerait à une absence d'activité."
          className="mb-6"
          count={tableau.appelsEnEchec}
        >
          <ul className="divide-y divide-line">
            {tableau.pannes.map((panne) => (
              <li key={panne.motif} className="flex items-baseline gap-3 px-5 py-3">
                <StatusBadge tone={panne.motif === "budget_exceeded" ? "info" : "warning"}>
                  {panne.motif === "inconnu"
                    ? "Motif non enregistré"
                    : LIBELLES_PANNE[panne.motif as MotifPanne]}
                </StatusBadge>
                <span className="tabular ml-auto text-[var(--text-body)]">
                  {panne.appels} appel{panne.appels > 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ---- Les plafonds ---- */}
      {plafonds.etat !== "lue" ? (
        <Card className="mb-6 border-info/30 bg-info-wash px-5 py-4">
          <p className="text-[var(--text-body)] text-info">{plafonds.message}</p>
          <p className="mt-1 text-[var(--text-secondary)] text-info">
            Aucun plafond n&apos;est donc lisible — ce qui n&apos;est pas la même chose
            qu&apos;« aucun plafond ».
          </p>
        </Card>
      ) : (
        <Plafonds
          plafonds={plafonds.donnees}
          tarifsManquants={tarifsManquants}
          peutModifier={peutModifier}
        />
      )}

      {/* ---- Les retours (p. 25) ---- */}
      <Panel
        title="Retours de vos équipes"
        description="La seule des cinq mesures du benchmark de modèles (justesse, coût, latence, usage des outils, avis) qu'aucun compteur ne remplace."
        className="mb-6"
        action={
          avis.donnees.satisfactionPct !== null ? (
            <Badge tone={avis.donnees.satisfactionPct >= 60 ? "positive" : "warning"}>
              {avis.donnees.satisfactionPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
              utiles
            </Badge>
          ) : undefined
        }
      >
        {avis.etat !== "lue" ? (
          <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">{avis.message}</p>
        ) : avis.donnees.utiles + avis.donnees.inutiles === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="Personne ne s'est encore prononcé"
              description="Chaque recommandation du centre de décision porte un 👍 et un 👎. Sans eux, on sait ce qu'une analyse a coûté, jamais si elle a servi."
              icon={<Icon name="ai" className="h-5 w-5" />}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-6 px-5 py-4">
              <p className="text-[var(--text-body)]">
                <span className="tabular text-[length:var(--text-card)] font-semibold text-positive">
                  {avis.donnees.utiles}
                </span>{" "}
                <span className="text-ink-soft">utiles</span>
              </p>
              <p className="text-[var(--text-body)]">
                <span className="tabular text-[length:var(--text-card)] font-semibold text-critical">
                  {avis.donnees.inutiles}
                </span>{" "}
                <span className="text-ink-soft">inutiles</span>
              </p>
            </div>
            {avis.donnees.motifs.length > 0 && (
              <ul className="divide-y divide-line border-t border-line">
                {avis.donnees.motifs.map((motif, index) => (
                  <li key={`${motif.quand}-${index}`} className="flex gap-3 px-5 py-3">
                    <span aria-hidden className="shrink-0">
                      {motif.utile ? "👍" : "👎"}
                    </span>
                    <span className="min-w-0 flex-1 text-[var(--text-body)] text-ink-soft">
                      {motif.pourquoi}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>

      <p className="text-[11px] text-ink-faint">
        La dépense « aujourd&apos;hui » et « ce mois-ci » se compte en heure de Paris, comme le
        fait la base pour déclencher les plafonds : compter à partir de minuit UTC donnerait deux
        chiffres proches et différents, plus coûteux à démêler qu&apos;un seul franchement faux.
        La moyenne par organisation sur l&apos;ensemble du parc, elle, n&apos;a de sens que pour
        l&apos;éditeur : elle vit dans le Control Center, pas ici.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------
// Écrire une dépense qui n'est peut-être qu'un minorant
// ------------------------------------------------------------------

/**
 * La valeur d'une grande carte.
 *
 * `null` — donc un tiret — quand la lecture a échoué : « 0,00 € » sur un
 * grand livre illisible serait un chiffre rassurant et faux. Le préfixe
 * « ≥ » apparaît dès qu'un appel du groupe n'a pas de tarif connu.
 */
function valeurDepense(depense: Depense, lue: boolean): string | null {
  if (!lue) return null;
  const montant = formatCents(depense.centsConnus);
  return estMinorant(depense) ? `≥ ${montant}` : montant;
}

function indice(depense: Depense, suffixe: string): string {
  if (!estMinorant(depense)) return suffixe;
  return `${suffixe} · ${depense.appelsSansTarif} sans tarif connu`;
}

function MontantLigne({ depense }: { depense: Depense }) {
  return (
    <span className="tabular shrink-0 text-[var(--text-body)]">
      {estMinorant(depense) && <span className="text-ink-faint">≥ </span>}
      {formatCents(depense.centsConnus)}
      <span className="ml-2 text-[var(--text-secondary)] text-ink-faint">
        {depense.appels} appel{depense.appels > 1 ? "s" : ""}
      </span>
    </span>
  );
}

function Ventilation({
  titre,
  description,
  lignes,
  nommer,
}: {
  titre: string;
  description: string;
  lignes: LigneVentilation[];
  nommer: (cle: string) => string;
}) {
  return (
    <Panel title={titre} description={description}>
      {lignes.length === 0 ? (
        <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">Rien à ventiler.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lignes.slice(0, 8).map((ligne) => (
            <li key={ligne.cle || "sans"} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3">
              <span className="min-w-0 flex-1 truncate text-[var(--text-body)]">
                {nommer(ligne.cle)}
              </span>
              <MontantLigne depense={ligne.depense} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
