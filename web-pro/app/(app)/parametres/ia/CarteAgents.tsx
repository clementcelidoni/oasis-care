import { Card, Panel, Badge, StatusBadge, SubmitButton } from "@/components/ui";
import {
  CHOIX_PRODUIT,
  LIBELLES_NIVEAU,
  MOTIF_MINIMUM,
  TEINTES_NIVEAU,
  USAGES_NIVEAU,
  choixCourant,
  type CarteAgents as Carte,
  type LigneCarte,
} from "@/lib/ai/admin";
import { enregistrerSurchargeModele } from "@/lib/ai/admin/actions";
import { NIVEAUX_MODELE } from "@/lib/ai/model/types";

/**
 * §11V — LA CARTE AGENT → MODÈLE (spec p. 26).
 *
 *     Executive Sol · Finance Terra · Billing Terra · Quote Pricing Sol
 *     Sales Terra · Nursery Terra · Classification Luna
 *     « Permettre modification sécurisée. »
 *
 * ══════════════════════════════════════════════════════════════════
 * CHAQUE LIGNE DIT PAR QUEL MOYEN ELLE SE CHANGE
 * ══════════════════════════════════════════════════════════════════
 *
 * Trois des sept agents de la page 26 — Sales, Nursery, Classification —
 * ne peuvent PAS recevoir de surcharge en base : la contrainte
 * `ai_is_supported_agent` (0072) n'admet que les quatre agents de
 * l'itération, et elle a raison de le faire. Leur montrer un sélecteur
 * aurait produit un formulaire refusé par un `check` au moment
 * d'enregistrer, c'est-à-dire la pire des trois solutions possibles.
 *
 * Ils portent donc, à la place, le nom EXACT de la variable
 * d'environnement qui les déplace. Ce n'est pas un pis-aller : c'est le
 * `modelOverride` de la page 5-6, réversible en une minute et sans
 * redéploiement.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET LES SEPT AUTRES AGENTS ?
 * ══════════════════════════════════════════════════════════════════
 *
 * La configuration en calibre quatorze (p. 5) ; la page 26 en affiche
 * sept. Cacher les sept autres ferait mentir cet écran sur ce que le
 * routeur fait réellement, et le jour où l'agent Marché arrivera,
 * personne ne saurait qu'il avait déjà un niveau — le sien est
 * « avancé », et c'est une décision de coût qui mérite d'être vue avant
 * d'être subie. Ils sont donc là, repliés, en lecture seule.
 */
export function CarteAgents({ carte, peutModifier }: { carte: Carte; peutModifier: boolean }) {
  return (
    <>
      {/* ---- La correspondance niveau → identifiant ---- */}
      <Panel
        title="Les trois niveaux"
        description="Le produit ne raisonne qu'en niveaux ; l'identifiant du fournisseur est une conséquence, pas une décision."
        className="mb-6"
      >
        <ul className="divide-y divide-line">
          {NIVEAUX_MODELE.map((niveau) => (
            <li key={niveau} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
              <Badge tone={TEINTES_NIVEAU[niveau]}>{LIBELLES_NIVEAU[niveau]}</Badge>
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-[12px] text-ink-soft">
                {carte.modeles[niveau]}
              </code>
              <span className="min-w-0 flex-1 basis-full text-[var(--text-secondary)] text-ink-soft sm:basis-auto">
                {USAGES_NIVEAU[niveau]}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ---- Les surcharges refusées ----
          Une variable posée avec une valeur illisible n'est pas ignorée
          en silence : quelqu'un a tapé quelque chose à sept heures du
          matin, et il doit apprendre que son réglage n'a pas pris. */}
      {carte.anomalies.length > 0 && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-5 py-4">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {carte.anomalies.length} réglage
            {carte.anomalies.length > 1 ? "s" : ""} d&apos;environnement n&apos;
            {carte.anomalies.length > 1 ? "ont" : "a"} pas été retenu
            {carte.anomalies.length > 1 ? "s" : ""}.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {carte.anomalies.map((anomalie) => (
              <li key={anomalie.variable} className="text-[var(--text-secondary)] text-warning">
                <code className="rounded bg-warning/10 px-1 py-0.5 text-[11px]">
                  {anomalie.variable}
                </code>{" "}
                = « {anomalie.valeur} » — {anomalie.raison}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- Les surcharges qui ont décroché ---- */}
      {carte.surchargesDesalignees.length > 0 && (
        <Card className="mb-6 border-critical/30 bg-critical-wash px-5 py-4">
          <p className="text-[var(--text-body)] font-medium text-critical">
            {carte.surchargesDesalignees.length} dérogation
            {carte.surchargesDesalignees.length > 1 ? "s pointent" : " pointe"} un identifiant
            qui n&apos;est plus configuré.
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-critical">
            Une dérogation enregistre un identifiant littéral. Quand celui du niveau change —
            correction d&apos;un nom faux, nouvelle génération de modèles — la dérogation garde
            l&apos;ancien, et les appels concernés échoueront pendant que le reste du produit
            tournera. Revenez au réglage du produit, puis reposez la dérogation si elle est
            toujours utile.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {carte.surchargesDesalignees.map((ligne) => (
              <li key={ligne.cle} className="text-[var(--text-secondary)] text-critical">
                {ligne.libelle} →{" "}
                <code className="rounded bg-critical/10 px-1 py-0.5 text-[11px]">
                  {ligne.modeleEffectif}
                </code>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ---- Les sept lignes de la page 26 ---- */}
      <Panel
        title="Aiguillage des agents"
        description="Quel niveau de modèle chaque agent demande. Les analyses déjà rendues gardent le modèle avec lequel elles ont été produites : changer ici ne relance rien."
        count={carte.page26.length}
        className="mb-6"
        action={
          carte.nombreSurcharges > 0 ? (
            <Badge tone="info">
              {carte.nombreSurcharges} dérogation{carte.nombreSurcharges > 1 ? "s" : ""}
            </Badge>
          ) : undefined
        }
      >
        <ul className="divide-y divide-line">
          {carte.page26.map((ligne) => (
            <LigneAgent key={ligne.cle} ligne={ligne} peutModifier={peutModifier} />
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
          Une dérogation ne concerne que cette entreprise, et elle fige un identifiant : sans
          elle, vous suivez automatiquement l&apos;aiguillage du produit, correctifs compris.
        </p>
        {/* LA PHRASE A CHANGÉ LE JOUR OÙ LA LIGNE A ÉTÉ BRANCHÉE.
            `runtimeAgents()` (lib/ai/runtime/supabase.ts) lit désormais
            `ai_model_overrides` à chaque requête et décore le routeur
            avec `appliquerSurcharges`. Le panneau portait jusqu'ici un
            avertissement disant l'inverse ; le garder serait devenu le
            même bouton menteur, dans l'autre sens. */}
        <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
          <span className="font-medium">Une dérogation prend effet au prochain appel.</span> Le
          moteur relit cette table à chaque question posée à Oasis. Le repli en cas de panne du
          fournisseur, lui, redescend sur le modèle du produit et non sur votre dérogation :
          c&apos;est un mécanisme de secours, pas un choix d&apos;aiguillage.
        </p>
      </Panel>

      {/* ---- Le reste du catalogue ---- */}
      <details className="mb-6">
        <summary className="cursor-pointer text-[var(--text-secondary)] text-ink-soft hover:text-ink">
          Les {carte.reste.length} agents calibrés mais pas encore écrits
        </summary>
        <Panel
          title="Le reste du catalogue"
          description="Leur niveau est décidé avant qu'ils existent — sinon chaque nouvel agent arriverait avec un modèle codé en dur dans son propre fichier, ce que la page 4 interdit."
          className="mt-3"
        >
          <ul className="divide-y divide-line">
            {carte.reste.map((ligne) => (
              <LigneAgent key={ligne.cle} ligne={ligne} peutModifier={false} lectureSeule />
            ))}
          </ul>
        </Panel>
      </details>
    </>
  );
}

function LigneAgent({
  ligne,
  peutModifier,
  lectureSeule = false,
}: {
  ligne: LigneCarte;
  peutModifier: boolean;
  lectureSeule?: boolean;
}) {
  const courant = choixCourant(ligne);
  const modifiable = ligne.surchargeable && peutModifier && !lectureSeule;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[var(--text-body)] font-medium">
            {ligne.libelle}
            {ligne.niveauEffectif === null ? (
              <StatusBadge tone="critical">Identifiant hors configuration</StatusBadge>
            ) : (
              <Badge tone={TEINTES_NIVEAU[ligne.niveauEffectif]}>
                {LIBELLES_NIVEAU[ligne.niveauEffectif]}
              </Badge>
            )}
            {ligne.source === "entreprise" && <Badge tone="info">Dérogation</Badge>}
            {ligne.source === "environnement" && <Badge tone="warning">Variable serveur</Badge>}
          </p>
          <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">{ligne.mission}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-secondary)] text-ink-faint">
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-[11px]">
              {ligne.modeleEffectif}
            </code>
            {ligne.source !== "produit" && (
              <span>
                Le produit livre « {LIBELLES_NIVEAU[ligne.niveauLivre].toLowerCase()} ».
              </span>
            )}
          </p>

          {ligne.surcharge && (
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              Motif : {ligne.surcharge.motif ?? "aucun motif enregistré"}
              {ligne.surcharge.posLe &&
                ` — modifié le ${new Date(ligne.surcharge.posLe).toLocaleDateString("fr-FR")}`}
              .
            </p>
          )}

          {!ligne.surchargeable && (
            /* Pas un message d'erreur : le cas ordinaire de dix agents
               sur quatorze, avec le geste exact qui les déplace. */
            <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
              Se déplace par la variable d&apos;environnement{" "}
              <code className="rounded bg-surface-sunken px-1 py-0.5 text-[11px]">
                {ligne.variableEnvironnement}
              </code>{" "}
              (valeurs : economy, standard, advanced), pour tout le serveur.
            </p>
          )}
        </div>

        {modifiable && (
          <form
            action={enregistrerSurchargeModele}
            className="flex w-full shrink-0 flex-col gap-2 sm:w-64"
          >
            <input type="hidden" name="agent" value={ligne.cleSql ?? ""} />
            <select
              name="niveau"
              defaultValue={courant ?? CHOIX_PRODUIT}
              className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
              aria-label={`Niveau de modèle pour ${ligne.libelle}`}
            >
              <option value={CHOIX_PRODUIT}>
                Réglage du produit ({LIBELLES_NIVEAU[ligne.niveauConfigure].toLowerCase()})
              </option>
              {NIVEAUX_MODELE.map((niveau) => (
                <option key={niveau} value={niveau}>
                  {LIBELLES_NIVEAU[niveau]}
                </option>
              ))}
            </select>
            <input
              type="text"
              name="motif"
              defaultValue={ligne.surcharge?.motif ?? ""}
              minLength={MOTIF_MINIMUM}
              maxLength={200}
              placeholder="Pourquoi cette dérogation ?"
              className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent"
              aria-label={`Motif de la dérogation pour ${ligne.libelle}`}
            />
            <SubmitButton variant="secondary">Enregistrer</SubmitButton>
          </form>
        )}
      </div>
    </li>
  );
}
