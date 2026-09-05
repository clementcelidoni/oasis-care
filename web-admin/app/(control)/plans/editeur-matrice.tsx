"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/ui";
import { enregistrerCase } from "@/lib/billing/actions";
import { ETAT_VIERGE } from "@/lib/billing/formulaire";
import { LIBELLES_DISPONIBILITE, cleDeCase, indexerMatrice } from "@/lib/billing/grille";
import type { Disponibilite, LigneCase, LigneModule, LigneOffre } from "@/lib/billing/types";

/**
 * ==================================================================
 * DÉCIDER UNE CASE DE LA MATRICE
 * ==================================================================
 *
 * UN SEUL FORMULAIRE, PAS QUARANTE-CINQ. Cinq offres × neuf modules
 * feraient quarante-cinq formulaires sur une page, chacun avec son
 * motif : la page pèserait, et personne ne relirait quarante-cinq
 * champs. Le geste réel est ponctuel — « je décide Pro Solo × BioLab » —
 * et il mérite un formulaire qu'on remplit avec attention.
 *
 * ------------------------------------------------------------------
 * POURQUOI LES CHAMPS DE PRIX APPARAISSENT ET DISPARAISSENT
 * ------------------------------------------------------------------
 * Un prix n'a de sens que sur une case « en option ». La base le tient
 * par deux contraintes : « en option » sans prix est refusé
 * (invendable), et un prix sur une case « comprise » est refusé aussi
 * — ce serait un prix qu'on finirait par facturer. L'écran suit la
 * même règle plutôt que d'envoyer des champs que la base rejettera.
 *
 * ------------------------------------------------------------------
 * ET « NON DÉCIDÉ » RESTE PROPOSABLE
 * ------------------------------------------------------------------
 * On peut REMETTRE une case à « non décidé ». Ce n'est pas un état par
 * défaut qu'on quitterait une fois pour toutes : c'est une réponse, et
 * il faut pouvoir y revenir quand une décision est retirée. Le retrait
 * est journalisé comme le reste.
 */
export function EditeurMatrice({
  offres,
  modules,
  matrice,
  peutEcrire,
  role,
}: {
  offres: LigneOffre[];
  modules: LigneModule[];
  matrice: LigneCase[];
  peutEcrire: boolean;
  role: string;
}) {
  const [etat, action, enCours] = useActionState(enregistrerCase, ETAT_VIERGE);

  const [offreChoisie, setOffreChoisie] = useState(offres[0]?.key ?? "");
  const [moduleChoisi, setModuleChoisi] = useState(modules[0]?.key ?? "");
  const index = indexerMatrice(matrice);
  const courante = index.get(cleDeCase(offreChoisie, moduleChoisi));
  const [disponibilite, setDisponibilite] = useState<Disponibilite>(
    courante?.availability ?? "undecided",
  );

  const brique = modules.find((m) => m.key === moduleChoisi);

  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

  return (
    <div className="px-4 py-3">
      {!peutEcrire && (
        <p className="mb-3 text-[var(--text-secondary)] text-ink-soft">
          Le rôle « {role} » ne porte pas <code className="font-mono">billing.plans.write</code> :
          la matrice est en lecture seule.
        </p>
      )}

      <form action={action}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Offre</span>
            <select
              name="planKey"
              value={offreChoisie}
              onChange={(evenement) => {
                setOffreChoisie(evenement.target.value);
                setDisponibilite(
                  index.get(cleDeCase(evenement.target.value, moduleChoisi))?.availability ??
                    "undecided",
                );
              }}
              disabled={!peutEcrire}
              className={champ}
            >
              {offres.map((offre) => (
                <option key={offre.key} value={offre.key}>
                  {offre.name}
                  {offre.is_active ? "" : " (retirée de la grille)"}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Module</span>
            <select
              name="moduleKey"
              value={moduleChoisi}
              onChange={(evenement) => {
                setModuleChoisi(evenement.target.value);
                setDisponibilite(
                  index.get(cleDeCase(offreChoisie, evenement.target.value))?.availability ??
                    "undecided",
                );
              }}
              disabled={!peutEcrire}
              className={champ}
            >
              {modules.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                  {m.is_delivered ? "" : " (annoncé, non livré)"}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              État de la case
            </span>
            <select
              name="disponibilite"
              value={disponibilite}
              onChange={(evenement) => setDisponibilite(evenement.target.value as Disponibilite)}
              disabled={!peutEcrire}
              className={champ}
            >
              {(["included", "optional", "unavailable", "undecided"] as const).map((valeur) => (
                <option key={valeur} value={valeur}>
                  {LIBELLES_DISPONIBILITE[valeur]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {disponibilite === "optional" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Prix du module (€ / mois)
              </span>
              <input
                name="prixMensuel"
                defaultValue={euros(courante?.monthly_price_cents ?? null)}
                disabled={!peutEcrire}
                inputMode="decimal"
                className={champ}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Prix du module (€ / an)
              </span>
              <input
                name="prixAnnuel"
                defaultValue={euros(courante?.yearly_price_cents ?? null)}
                disabled={!peutEcrire}
                inputMode="decimal"
                className={champ}
              />
            </label>
          </div>
        )}

        {disponibilite === "optional" && brique?.pricing_model !== "flat" && (
          <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-warning">
            Ce module se facture{" "}
            {brique?.pricing_model === "metered"
              ? `au compteur (${brique.metered_unit ?? "unité"})`
              : "à la commission"}{" "}
            : un prix mensuel fixe ne le tarifera pas correctement, et aucune table
            n&apos;enregistre encore sa consommation. La facture rendra le montant INCONNU.
          </p>
        )}

        {brique !== undefined && !brique.is_delivered && (
          <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            <strong className="text-ink">« {brique.name} » est annoncé, pas livré.</strong> La case
            peut porter la promesse commerciale, mais aucune entreprise ne pourra y souscrire : la
            base refuse d&apos;activer un module non livré. On ne vend pas ce qu&apos;on n&apos;a
            pas construit.
          </p>
        )}

        <label className="mt-3 flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <input
            name="motif"
            disabled={!peutEcrire}
            required
            placeholder="Décider qu'un module est compris ou payant, c'est décider d'un revenu"
            className={champ}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton>{enCours ? "Enregistrement…" : "Enregistrer la case"}</SubmitButton>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            État actuel :{" "}
            {LIBELLES_DISPONIBILITE[courante?.availability ?? "undecided"].toLowerCase()}.
          </span>
        </div>
      </form>

      {etat.statut !== "vierge" && etat.message !== null && (
        <p
          role="status"
          className={`mt-3 rounded-[var(--radius-card)] border px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed ${
            etat.statut === "ok"
              ? "border-positive/35 bg-positive-wash text-positive"
              : "border-critical/40 bg-critical-wash text-critical"
          }`}
        >
          {etat.message}
        </p>
      )}
    </div>
  );
}

function euros(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
