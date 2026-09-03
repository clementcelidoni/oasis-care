import { Badge } from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import {
  CONFIDENCE_EXPLANATIONS,
  CONFIDENCE_LABELS,
  CONFIDENCE_TONES,
  isInsufficient,
  tableLabel,
  type Confidence,
} from "@/lib/ai/types";

/**
 * §11V — LES CINQ BLOCS QU'UNE RECOMMANDATION DOIT PORTER (spec p. 6) :
 *
 *     Pourquoi ? · Impact estimé · Données utilisées · Confiance ·
 *     Que se passe-t-il si je ne fais rien ?
 *
 * « Le "Pourquoi ?" n'est pas décoratif : c'est un critère de
 * validation à lui seul. » D'où un composant partagé plutôt que cinq
 * copies : le briefing du matin et le centre de décision doivent
 * afficher exactement la même chose, sinon l'un des deux finira par
 * perdre un bloc en route.
 *
 * TROIS RÈGLES TIENNENT CE FICHIER.
 *
 *   1. UN BLOC VIDE SE DIT VIDE. « Non renseigné » occupe la place et
 *      apprend quelque chose ; un bloc escamoté laisse croire qu'il n'a
 *      jamais été prévu, et personne ne réclame ce qu'il ignore.
 *
 *   2. UN MONTANT ABSENT N'EST PAS ZÉRO. `formatCents(null)` rend un
 *      tiret, et la phrase à côté dit pourquoi il n'y a pas de chiffre.
 *
 *   3. « DONNÉES INSUFFISANTES » N'EST PAS « CONFIANCE FAIBLE ». Les
 *      deux ont leur libellé, leur teinte et leur explication : « je
 *      n'ai pas assez de données » appelle une action (saisir des
 *      coûts, accorder un droit), « j'ai des données qui disent peu »
 *      non.
 */

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <Badge tone={CONFIDENCE_TONES[confidence]}>{CONFIDENCE_LABELS[confidence]}</Badge>
  );
}

export function Explanation({
  pourquoi,
  impactCents,
  impactTexte,
  donneesUtilisees,
  confiance,
  siRienNestFait,
  actionRecommandee,
}: {
  pourquoi: string | null;
  impactCents: number | null;
  impactTexte: string | null;
  donneesUtilisees: string[];
  confiance: Confidence;
  siRienNestFait: string | null;
  actionRecommandee?: string | null;
}) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      <Block label="Pourquoi ?" value={pourquoi} />

      <Block
        label="Impact estimé"
        value={
          impactCents === null ? null : (
            <>
              <span className="tabular font-medium">{formatCents(impactCents)}</span>
              {impactTexte && (
                <span className="mt-0.5 block text-[var(--text-secondary)] text-ink-soft">
                  {impactTexte}
                </span>
              )}
            </>
          )
        }
        /* Un impact sans chiffre garde son explication : « impact non
           chiffrable » est une information, « — » tout seul n'en est
           pas une. */
        fallback={
          impactTexte ??
          "Impact non chiffré. Oasis ne remplace pas un montant inconnu par zéro."
        }
      />

      <Block
        label="Données utilisées"
        value={
          donneesUtilisees.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {donneesUtilisees.map((source) => (
                <Badge key={source} tone="neutral">
                  {tableLabel(source)}
                </Badge>
              ))}
            </span>
          ) : null
        }
        fallback="Non renseignées pour cette recommandation."
      />

      <Block
        label="Confiance"
        value={
          <>
            <ConfidenceBadge confidence={confiance} />
            <span className="mt-1 block text-[var(--text-secondary)] text-ink-soft">
              {CONFIDENCE_EXPLANATIONS[confiance]}
            </span>
            {isInsufficient(confiance) && (
              <span className="mt-1 block text-[var(--text-secondary)] text-ink-faint">
                Aucun montant n&apos;accompagne cette ligne : un chiffre posé sur des
                données manquantes serait une estimation déguisée.
              </span>
            )}
          </>
        }
      />

      <Block
        label="Que se passe-t-il si je ne fais rien ?"
        value={siRienNestFait}
        fallback="Non renseigné pour cette recommandation."
        wide
      />

      {actionRecommandee && (
        <Block label="Ce qu'Oasis recommande" value={actionRecommandee} wide />
      )}
    </dl>
  );
}

function Block({
  label,
  value,
  fallback = "Non renseigné.",
  wide = false,
}: {
  label: string;
  value: React.ReactNode;
  fallback?: string;
  wide?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`mt-1 text-[var(--text-body)] ${empty ? "text-ink-faint" : "text-ink-soft"}`}
      >
        {empty ? fallback : value}
      </dd>
    </div>
  );
}
