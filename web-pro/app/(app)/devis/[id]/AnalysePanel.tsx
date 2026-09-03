"use client";

import { useActionState, useState } from "react";
import { Badge, type Tone } from "@/components/ui";
import { formatCents, formatQuantity } from "@/lib/quotes/types";
import { formatDate } from "@/lib/crm/types";
import { analyserDevis, type EtatAnalyseDevis } from "@/lib/travel/actions";
import { formatPourcentage, type Recommandation, type Risque } from "@/lib/travel/analyse";
import type { Confiance, PeutEtreInconnu } from "@/lib/travel/types";

/**
 * §11V — LE PANNEAU D'ANALYSE D'UN DEVIS.
 *
 * Critère de validation (spec p. 50) : ouvrir un devis et obtenir
 * « Analyse du prix · Marge · Déplacement · Historique comparable ·
 * Risques · Recommandation », avec un « Pourquoi ? » pour chaque
 * recommandation. Les six sections sont là, dans cet ordre.
 *
 * POURQUOI UN BOUTON, ET PAS UN CALCUL AUTOMATIQUE. L'analyse
 * interroge une fonction SQL lourde, un géocodeur externe et trois
 * agrégats. La déclencher au chargement de chaque fiche ferait payer ce
 * prix à quelqu'un qui vient juste corriger une faute de frappe dans un
 * libellé. Un clic, et tout arrive.
 *
 * CE QUE CET ÉCRAN NE FAIT JAMAIS.
 *
 *   — Il n'affiche aucun chiffre qu'il n'a pas. Une donnée absente
 *     s'écrit « — » suivi du motif, jamais « 0 € ». Un zéro dans une
 *     colonne d'argent se lit comme un fait.
 *   — Il ne propose aucune fourchette de prix sous le seuil de
 *     comparables : il dit combien il en a trouvé et pourquoi ce n'est
 *     pas assez.
 *   — Il ne dit pas « vous êtes trop cher » (interdit explicite de la
 *     page 14). Au-dessus des comparables, il demande de VÉRIFIER
 *     quatre choses.
 *   — Il n'écrit rien. Aucun bouton de ce panneau ne modifie le devis.
 */

const ETAT_INITIAL: EtatAnalyseDevis = { statut: "vide" };

const LIBELLE_CONFIANCE: Record<Confiance, string> = {
  high: "confiance élevée",
  medium: "confiance moyenne",
  low: "confiance faible",
  insufficient_data: "données insuffisantes",
};

const TON_CONFIANCE: Record<Confiance, Tone> = {
  high: "positive",
  medium: "info",
  low: "warning",
  insufficient_data: "neutral",
};

const TON_RISQUE: Record<Risque["niveau"], Tone> = {
  eleve: "critical",
  moyen: "warning",
  faible: "info",
  information: "neutral",
};

const LIBELLE_RISQUE: Record<Risque["niveau"], string> = {
  eleve: "Risque élevé",
  moyen: "À surveiller",
  faible: "Mineur",
  information: "Information",
};

const LIBELLE_VERDICT: Record<string, { texte: string; ton: Tone }> = {
  correct: { texte: "Prix correct", ton: "positive" },
  insuffisant: { texte: "Prix potentiellement insuffisant", ton: "critical" },
  auDessusDesComparables: { texte: "Au-dessus des comparables", ton: "warning" },
  cibleNonDefinie: { texte: "Aucune cible de marge", ton: "neutral" },
  insufficientData: { texte: "Données insuffisantes", ton: "neutral" },
};

export function AnalysePanel({ quoteId }: { quoteId: string }) {
  const [etat, action, enCours] = useActionState(analyserDevis, ETAT_INITIAL);
  const resultat = etat.statut === "ok" ? etat : null;
  const hypotheses = resultat?.hypothesesRetenues;

  return (
    <section className="mt-8 rounded-xl border border-line bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">Analyse Oasis</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            Prix, marge, déplacement, chantiers comparables. Chaque chiffre porte sa source ;
            ce qui manque est écrit comme manquant.
          </p>
        </div>
      </header>

      <form action={action} className="border-b border-line px-5 py-4">
        <input type="hidden" name="quote_id" value={quoteId} />

        <p className="mb-3 text-xs text-ink-soft">
          Le déplacement dépend de trois choses qu&apos;Oasis ne sait pas deviner : combien de
          personnes partent, combien de jours, et dans combien de véhicules.{" "}
          <strong>Sans elles, les heures de déplacement restent inconnues</strong> — elles ne
          valent pas zéro.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <ChampHypothese
            nom="effectif"
            libelle="Personnes"
            aide="sur le chantier"
            defaut={hypotheses?.effectif}
          />
          <ChampHypothese
            nom="jours"
            libelle="Jours"
            aide={hypotheses?.joursDeduitsDuChantier ? "repris du chantier" : "de chantier"}
            defaut={hypotheses?.jours}
          />
          <ChampHypothese
            nom="vehicules"
            libelle="Véhicules"
            aide="qui font le trajet"
            defaut={hypotheses?.vehicules ?? "1"}
          />
          <ChampHypothese
            nom="minutes"
            libelle="Trajet aller"
            aide="minutes, si connu"
            defaut={hypotheses?.minutes}
          />
          <ChampHypothese
            nom="cout_km"
            libelle="Coût / km"
            aide="€, si connu"
            defaut={hypotheses?.coutKmEuros}
          />
          <ChampHypothese
            nom="peages"
            libelle="Péages A/R"
            aide="€, si connu"
            defaut={hypotheses?.peagesEuros}
          />
        </div>

        <button
          type="submit"
          disabled={enCours}
          className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-60"
        >
          {enCours ? "Analyse en cours…" : resultat ? "Recalculer" : "Analyser ce devis"}
        </button>
      </form>

      {etat.statut === "erreur" && (
        <p className="px-5 py-4 text-sm text-critical">{etat.message}</p>
      )}

      {resultat && (
        <div className="divide-y divide-line">
          <SectionPrix etat={resultat} />
          <SectionMarge etat={resultat} />
          <SectionDeplacement etat={resultat} />
          <SectionComparables etat={resultat} />
          <SectionRisques risques={resultat.risques} />
          <SectionRecommandations recommandations={resultat.recommandations} />
        </div>
      )}
    </section>
  );
}

// ============================================================
// Les briques
// ============================================================

function ChampHypothese({
  nom,
  libelle,
  aide,
  defaut,
}: {
  nom: string;
  libelle: string;
  aide: string;
  defaut?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium text-ink-soft">{libelle}</span>
      <input
        name={nom}
        type="text"
        inputMode="decimal"
        defaultValue={defaut ?? ""}
        className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm tabular"
      />
      <span className="mt-0.5 block text-[10px] text-ink-faint">{aide}</span>
    </label>
  );
}

function Section({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}) {
  return (
    <section className="px-5 py-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {titre}
      </h3>
      {children}
    </section>
  );
}

/** Une affirmation ne vaut que par ce qui la fonde : on l'écrit sous elle. */
function Source({ source, confiance }: { source: string; confiance?: Confiance }) {
  return (
    <p className="mt-1 text-[11px] text-ink-faint">
      Source : {source}
      {confiance ? ` · ${LIBELLE_CONFIANCE[confiance]}` : ""}
    </p>
  );
}

function Ligne({
  libelle,
  valeur,
  fort = false,
}: {
  libelle: string;
  valeur: React.ReactNode;
  fort?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <span className="text-ink-soft">{libelle}</span>
      <span className={`tabular ${fort ? "font-semibold" : ""}`}>{valeur}</span>
    </div>
  );
}

/** « — » et rien d'autre quand la donnée manque : jamais un zéro d'office. */
function Manquant({ motif }: { motif: string }) {
  return (
    <span className="text-ink-faint" title={motif}>
      —
    </span>
  );
}

function valeurOuManquant<T>(
  valeur: PeutEtreInconnu<T>,
  rendu: (valeur: T) => React.ReactNode,
): React.ReactNode {
  return valeur.connu ? rendu(valeur.valeur) : <Manquant motif={valeur.explication} />;
}

// ============================================================
// 1. Analyse du prix
// ============================================================

function SectionPrix({ etat }: { etat: Extract<EtatAnalyseDevis, { statut: "ok" }> }) {
  const analyse = etat.analysePrix;

  if (!analyse) {
    return (
      <Section titre="Analyse du prix">
        <p className="text-sm text-ink-soft">
          {etat.motifAnalysePrixIndisponible ?? "L'analyse de prix n'est pas disponible."}
        </p>
      </Section>
    );
  }

  const verdict = LIBELLE_VERDICT[analyse.verdict ?? "insufficientData"] ??
    LIBELLE_VERDICT.insufficientData;

  return (
    <Section titre="Analyse du prix">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={verdict.ton}>{verdict.texte}</Badge>
        <Badge tone={TON_CONFIANCE[analyse.confiance]}>
          {LIBELLE_CONFIANCE[analyse.confiance]}
        </Badge>
      </div>

      <Ligne
        libelle="Prix proposé"
        fort
        valeur={
          analyse.prixProposeHtCents === null ? (
            <Manquant motif="Le devis n'a pas de total." />
          ) : (
            `${formatCents(analyse.prixProposeHtCents)} HT`
          )
        }
      />
      <Ligne
        libelle="Coût estimé"
        valeur={
          analyse.coutEstimeCents === null ? (
            <Manquant motif="Aucune ligne ne porte de coût unitaire : le coût est inconnu, pas nul." />
          ) : (
            formatCents(analyse.coutEstimeCents)
          )
        }
      />

      {analyse.explicationConclusion && (
        <p className="mt-2 text-sm text-ink-soft">{analyse.explicationConclusion}</p>
      )}
      <Source source="ai_quote_price_analysis (SQL, migration 0073)" confiance={analyse.confiance} />

      {analyse.explicationHypotheses.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-faint">
            Hypothèses de ce calcul
          </summary>
          <ul className="mt-1 list-disc pl-4 text-[11px] text-ink-faint">
            {analyse.explicationHypotheses.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

// ============================================================
// 2. Marge
// ============================================================

function SectionMarge({ etat }: { etat: Extract<EtatAnalyseDevis, { statut: "ok" }> }) {
  const analyse = etat.analysePrix;
  if (!analyse) return null;

  return (
    <Section titre="Marge">
      <Ligne
        libelle="Marge"
        fort
        valeur={
          analyse.margeCents === null ? (
            <Manquant motif="Sans coût saisi, il n'y a pas de marge à calculer." />
          ) : (
            `${formatCents(analyse.margeCents)} · ${formatPourcentage(analyse.tauxMarquePct)}`
          )
        }
      />
      <Ligne
        libelle="Marge cible de l'entreprise"
        valeur={
          analyse.margeCiblePct === null ? (
            <Manquant motif="Aucun objectif de marge n'est fixé." />
          ) : (
            formatPourcentage(analyse.margeCiblePct)
          )
        }
      />
      {analyse.ecartALaCiblePoints !== null && (
        <Ligne libelle="Écart à la cible" valeur={formatPourcentage(analyse.ecartALaCiblePoints)} />
      )}
      {analyse.manqueAGagnerCents !== null && (
        <Ligne libelle="Manque à gagner estimé" valeur={`${formatCents(analyse.manqueAGagnerCents)} HT`} />
      )}

      {analyse.coutPartiel && (
        <p className="mt-2 rounded-md bg-warning-wash px-3 py-2 text-xs text-warning">
          <strong>Ce taux ne décrit qu&apos;une partie du devis.</strong>{" "}
          {analyse.lignesSansCoutSaisi} ligne(s) sur {analyse.lignesTotal} ne portent aucun coût :
          la marge affichée est optimiste par construction.
        </p>
      )}

      <Source
        source="taux de marque (rapporté au prix de vente), calculé en SQL"
        confiance={analyse.confiance}
      />
    </Section>
  );
}

// ============================================================
// 3. Déplacement
// ============================================================

function SectionDeplacement({ etat }: { etat: Extract<EtatAnalyseDevis, { statut: "ok" }> }) {
  const d = etat.deplacement;

  return (
    <Section titre="Déplacement">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={TON_CONFIANCE[d.confiance]}>{LIBELLE_CONFIANCE[d.confiance]}</Badge>
        {d.comparaisonAuDevis.verdict === "sousChiffragePotentiel" && (
          <Badge tone="critical">Sous-chiffrage potentiel</Badge>
        )}
        {d.comparaisonAuDevis.verdict === "coherent" && <Badge tone="positive">Cohérent</Badge>}
      </div>

      <p className="mb-2 text-xs text-ink-faint">
        {d.siege.libelle} → {d.chantier.libelle}
      </p>

      <Ligne
        libelle="Distance estimée (aller)"
        valeur={valeurOuManquant(d.distance, (v) => `${formatQuantity(v.allerKm)} km`)}
      />
      <Ligne
        libelle="Aller-retour"
        valeur={valeurOuManquant(d.distance, (v) => `${formatQuantity(v.allerRetourKm)} km`)}
      />
      <Ligne
        libelle="Temps de trajet (aller)"
        valeur={valeurOuManquant(d.temps, (v) => `${v.allerMinutes} min`)}
      />
      <Ligne
        libelle="Trajets"
        valeur={valeurOuManquant(
          d.trajets,
          (v) =>
            `${v.trajetsParPersonne} par personne` +
            (v.trajetsVehicules === null ? "" : ` · ${v.trajetsVehicules} véhicule(s)`),
        )}
      />
      <Ligne
        libelle="Heures humaines de déplacement"
        fort
        valeur={valeurOuManquant(d.heuresHumaines, (v) => v.libelle)}
      />
      <Ligne
        libelle="Coût du temps de déplacement"
        valeur={valeurOuManquant(d.coutHumainCents, (v) => formatCents(v))}
      />
      <Ligne
        libelle="Coût véhicule"
        valeur={valeurOuManquant(d.coutVehiculeCents, (v) => formatCents(v))}
      />
      <Ligne
        libelle="Péages"
        valeur={valeurOuManquant(d.peagesCents, (v) => formatCents(v))}
      />
      <Ligne
        libelle={d.coutTotal.complet ? "Coût du déplacement" : "Coût du déplacement (partiel)"}
        fort
        valeur={
          d.coutTotal.totalCents === null ? (
            <Manquant motif="Aucun poste de coût n'est chiffrable." />
          ) : d.coutTotal.complet ? (
            formatCents(d.coutTotal.totalCents)
          ) : (
            `au moins ${formatCents(d.coutTotal.totalCents)}`
          )
        }
      />

      {d.distance.connu && (
        <Source
          source={`vol d'oiseau × facteur de détour ${d.distance.valeur.facteurSinuosite.toLocaleString("fr-FR")} — estimation, pas une mesure`}
        />
      )}
      {d.heuresHumaines.connu && <Source source={d.heuresHumaines.source} />}

      {/* La confrontation au devis : le cœur de l'exemple de la spec. */}
      <div className="mt-3 rounded-md border border-line bg-surface-sunken px-3 py-2">
        <p className="text-xs text-ink-soft">{d.comparaisonAuDevis.explication}</p>
        {etat.montantTransportDeviseCents > 0 && (
          <p className="mt-1 text-[11px] text-ink-faint">
            Lignes de transport du devis : {formatCents(etat.montantTransportDeviseCents)} HT.
          </p>
        )}
        {d.comparaisonAuDevis.heuresDevisees === 0 && (
          <p className="mt-1 text-[11px] text-ink-faint">
            Le devis ne porte aucune ligne de transport en heures. Le déplacement est peut-être
            inclus dans le prix de la main-d&apos;œuvre — Oasis ne peut pas le savoir.
          </p>
        )}
      </div>

      {d.avertissements.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-ink-faint">
          {d.avertissements.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ============================================================
// 4. Historique comparable
// ============================================================

function SectionComparables({ etat }: { etat: Extract<EtatAnalyseDevis, { statut: "ok" }> }) {
  const analyse = etat.analysePrix;
  if (!analyse) return null;
  const c = analyse.comparables;

  // PAS ASSEZ DE COMPARABLES = PAS DE FOURCHETTE. On dit combien il en
  // faut, combien on en a, et pourquoi on ne propose rien.
  if (c.motifInsuffisance !== null || c.fourchette === null) {
    return (
      <Section titre="Historique comparable">
        <p className="text-sm text-ink-soft">
          {c.explicationInsuffisance ??
            "Aucune fourchette n'est proposée : les chantiers comparables manquent."}
        </p>
        <p className="mt-1 text-xs text-ink-faint">
          {c.nombreComparables ?? 0} chantier(s) comparable(s) trouvé(s), seuil de{" "}
          {c.seuilComparables ?? "—"}.
        </p>
        <Source source="ai_quote_comparables (SQL)" confiance="insufficient_data" />
      </Section>
    );
  }

  return (
    <Section titre="Historique comparable">
      <Ligne
        libelle={`Vos ${c.nombreComparables} chantiers comparables`}
        fort
        valeur={`${formatCents(c.fourchette.minHtCents)} — ${formatCents(c.fourchette.maxHtCents)} HT`}
      />
      <Ligne libelle="Médiane" valeur={`${formatCents(c.fourchette.medianeHtCents)} HT`} />
      {c.fourchette.tauxMarqueReelMedianPct !== null && (
        <Ligne
          libelle="Marge réelle médiane de ces chantiers"
          valeur={formatPourcentage(c.fourchette.tauxMarqueReelMedianPct)}
        />
      )}
      <p className="mt-1 text-[11px] text-ink-faint">
        Comparés à périmètre égal :{" "}
        {c.heuresMainDoeuvreDevisees === null
          ? "périmètre horaire inconnu"
          : `${formatQuantity(c.heuresMainDoeuvreDevisees)} h de main-d'œuvre devisées`}
        , ± {c.bandeHeuresPct ?? "—"} %, famille « {c.familleDominante ?? "—"} », sur{" "}
        {c.ancienneteMaximaleMois ?? "—"} mois.
      </p>

      {c.echantillon.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-faint">
            Voir les chantiers retenus
          </summary>
          <ul className="mt-1 divide-y divide-line text-xs">
            {c.echantillon.map((e) => (
              <li key={e.projetId ?? e.numero} className="flex justify-between gap-3 py-1">
                <span className="text-ink-soft">
                  {e.numero} · {e.nom}
                  {e.termineLe ? ` · ${formatDate(e.termineLe)}` : ""}
                </span>
                <span className="tabular">{formatCents(e.venduHtCents)} HT</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Source source="ai_quote_comparables (SQL)" confiance={analyse.confiance} />
    </Section>
  );
}

// ============================================================
// 5. Risques
// ============================================================

function SectionRisques({ risques }: { risques: Risque[] }) {
  return (
    <Section titre="Risques">
      {risques.length === 0 ? (
        <p className="text-sm text-ink-soft">Aucun risque détecté par les contrôles disponibles.</p>
      ) : (
        <ul className="space-y-3">
          {risques.map((r) => (
            <li key={r.cle}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={TON_RISQUE[r.niveau]}>{LIBELLE_RISQUE[r.niveau]}</Badge>
                <span className="text-sm font-medium">{r.titre}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{r.explication}</p>
              <Source source={r.source} confiance={r.confiance} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ============================================================
// 6. Recommandation
// ============================================================

function SectionRecommandations({ recommandations }: { recommandations: Recommandation[] }) {
  return (
    <Section titre="Recommandation">
      <ul className="space-y-3">
        {recommandations.map((r) => (
          <li key={r.cle} className="rounded-lg border border-line px-3 py-2.5">
            <p className="text-sm font-medium">{r.titre}</p>
            <Pourquoi recommandation={r} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * « Je dois pouvoir voir : Pourquoi ? pour chaque recommandation. »
 * (spec p. 50)
 *
 * Le bouton est replié par défaut, mais la raison est TOUJOURS chargée
 * avec la recommandation : elle ne demande aucun aller-retour, et
 * surtout aucun modèle. Une justification qu'il faudrait aller
 * chercher est une justification qu'on n'irait jamais lire.
 */
function Pourquoi({ recommandation }: { recommandation: Recommandation }) {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="text-xs font-medium text-accent hover:underline"
      >
        {ouvert ? "Masquer le pourquoi" : "Pourquoi ?"}
      </button>
      {ouvert && (
        <div className="mt-1.5">
          <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-soft">
            {recommandation.pourquoi.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <Source source={recommandation.source} confiance={recommandation.confiance} />
        </div>
      )}
    </div>
  );
}
