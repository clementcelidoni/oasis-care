import { SubmitButton } from "@/components/ui";
import { donnerAvisRecommandation } from "@/lib/ai/admin/actions";
import type { MonAvis } from "@/lib/ai/admin/lecture";

/**
 * §11V — LE RETOUR UTILISATEUR SUR UNE RECOMMANDATION (spec p. 25).
 *
 *     👍 utile
 *     👎 inutile
 *     et éventuellement : Pourquoi ?
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE COMPOSANT NE CONTIENT PAS UNE LIGNE DE JAVASCRIPT
 * ══════════════════════════════════════════════════════════════════
 *
 * Des formulaires ordinaires et un `<details>`. Pas de `useState`, pas
 * de composant client : rien à charger, rien à hydrater, et un pouce
 * qui fonctionne même si le paquet du navigateur n'arrive jamais.
 *
 * Le « Pourquoi ? » est replié parce qu'il est FACULTATIF et que la
 * page 25 le dit ainsi. Déplié d'office, il transformerait un clic en
 * corvée de rédaction, et la mesure s'effondrerait : il ne resterait
 * que les avis des gens assez agacés pour écrire.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE COMMENTAIRE NE PEUT PAS VOTER À LA PLACE DU POUCE
 * ══════════════════════════════════════════════════════════════════
 *
 * `ai_recommendation_feedback.helpful` est `not null` : il n'existe pas
 * d'avis « sans opinion, mais avec un commentaire ». Il fallait donc
 * choisir ce que fait un commentaire écrit avant tout clic.
 *
 * Le compter comme « utile » par défaut aurait faussé la seule mesure
 * de qualité du produit, et dans le sens le plus flatteur — c'est
 * exactement la statistique qu'on ne veut pas. Le champ n'apparaît donc
 * qu'APRÈS un pouce, et la phrase le dit. Une fois le pouce donné, le
 * commentaire le conserve : écrire ne change pas d'avis.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LE POUCE MESURE
 * ══════════════════════════════════════════════════════════════════
 *
 * La RECOMMANDATION — le raisonnement, sa pertinence — pas l'exécution
 * qui a pu suivre. « Inutile » ne veut pas dire « ça a échoué », mais
 * « Oasis m'a fait perdre mon temps ». Aucun compteur ne saura jamais
 * le dire, et c'est la seule source du « user-rating » de la page 25.
 *
 * L'avis est PERSONNEL — un par personne et par décision, index unique
 * de 0076 — modifiable d'un clic, et retirable explicitement. Sans le
 * retrait, un pouce donné par erreur resterait pour toujours dans la
 * moyenne.
 */
export function Feedback({
  decisionId,
  avis,
}: {
  decisionId: string;
  /** Mon avis, s'il existe. Celui des autres n'apparaît pas ici. */
  avis: MonAvis | null;
}) {
  return (
    <div className="border-t border-line px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--text-secondary)] text-ink-faint">
          {avis === null
            ? "Cette recommandation vous a-t-elle aidé ?"
            : avis.utile
              ? "Vous l'avez trouvée utile."
              : "Vous l'avez trouvée inutile."}
        </span>

        <Pouce
          decisionId={decisionId}
          valeur="utile"
          libelle="👍 Utile"
          actif={avis?.utile === true}
          classeActive="border-positive/30 bg-positive-wash text-positive"
          pourquoi={avis?.pourquoi ?? null}
        />
        <Pouce
          decisionId={decisionId}
          valeur="inutile"
          libelle="👎 Inutile"
          actif={avis?.utile === false}
          classeActive="border-critical/30 bg-critical-wash text-critical"
          pourquoi={avis?.pourquoi ?? null}
        />

        {avis !== null && (
          /* Un retrait EXPLICITE, et non un second clic sur le même
             pouce qui l'annulerait : avec une bascule cachée, on ne sait
             jamais si l'on vient de donner un avis ou de le retirer. */
          <form action={donnerAvisRecommandation}>
            <input type="hidden" name="decisionId" value={decisionId} />
            <input type="hidden" name="avis" value="retirer" />
            <SubmitButton variant="ghost">Retirer mon avis</SubmitButton>
          </form>
        )}
      </div>

      {avis === null ? (
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Vous pourrez ajouter un « pourquoi » après avoir choisi. Il est facultatif — le pouce
          seul est déjà une réponse.
        </p>
      ) : (
        <details className="mt-2" open={avis.pourquoi !== null}>
          <summary className="cursor-pointer text-[var(--text-secondary)] text-ink-faint hover:text-ink-soft">
            {avis.pourquoi ? "Votre commentaire" : "Pourquoi ? (facultatif)"}
          </summary>
          <form action={donnerAvisRecommandation} className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="decisionId" value={decisionId} />
            {/* Le pouce déjà donné voyage avec le commentaire : écrire
                une phrase n'est pas changer d'avis. */}
            <input type="hidden" name="avis" value={avis.utile ? "utile" : "inutile"} />
            <input
              type="text"
              name="pourquoi"
              defaultValue={avis.pourquoi ?? ""}
              maxLength={1000}
              placeholder="Ce qui manquait, ce qui était faux, ce qui aurait aidé…"
              className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
              aria-label="Pourquoi cette recommandation a-t-elle aidé, ou pas ?"
            />
            <SubmitButton variant="secondary">Envoyer</SubmitButton>
          </form>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Votre commentaire est lu par les administrateurs de l&apos;entreprise, avec ceux de
            vos collègues. Il sert à décider si Oasis doit changer de façon de raisonner sur ce
            genre de sujet.
          </p>
        </details>
      )}
    </div>
  );
}

/**
 * Un pouce.
 *
 * Il réenvoie le commentaire déjà écrit : sans ce champ caché, changer
 * d'avis effacerait la phrase qui explique pourquoi — c'est-à-dire la
 * partie la plus utile de l'avis, et au pire moment.
 */
function Pouce({
  decisionId,
  valeur,
  libelle,
  actif,
  classeActive,
  pourquoi,
}: {
  decisionId: string;
  valeur: "utile" | "inutile";
  libelle: string;
  actif: boolean;
  classeActive: string;
  pourquoi: string | null;
}) {
  return (
    <form action={donnerAvisRecommandation}>
      <input type="hidden" name="decisionId" value={decisionId} />
      <input type="hidden" name="avis" value={valeur} />
      {pourquoi !== null && <input type="hidden" name="pourquoi" value={pourquoi} />}
      <button
        type="submit"
        aria-pressed={actif}
        className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[var(--text-secondary)] transition-colors ${
          actif ? classeActive : "border-line-strong text-ink-soft hover:bg-canvas"
        }`}
      >
        {libelle}
      </button>
    </form>
  );
}
