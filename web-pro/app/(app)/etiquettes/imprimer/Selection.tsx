"use client";

import { useMemo, useState } from "react";

import { ConfirmDialog, Panel, StatusBadge } from "@/components/ui";
import {
  grilleA4,
  rendreEtiquette,
  type ChampEtiquette,
  type ChampPlace,
  type FamilleEtiquette,
  type ModeleEtiquette,
} from "@/lib/etiquettes";

import { urlEtiquette, urlExemple } from "../adresse.ts";
import { ApercuEtiquette } from "../ApercuEtiquette";
import { LIBELLE_FAMILLE, type SourceEtiquette } from "../familles.ts";
import { LIBELLE_CHAMP } from "../modeles.ts";
import { poserEtiquettes, publierFiche, depublierFiche, revoquerEtiquette } from "../actions.ts";

/**
 * § 16 — LA SÉLECTION, LE COMPTE, ET CE QUI NE TIENDRA PAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS CHIFFRES AVANT LE CLIC, ET PAS UN DE MOINS
 * ══════════════════════════════════════════════════════════════════
 *
 *   • COMBIEN d'étiquettes vont sortir de l'imprimante ;
 *   • combien seront RÉIMPRIMÉES à l'identique — légitime, l'ancienne
 *     s'est décollée, et c'est le même QR qui ressort ;
 *   • combien seront CRÉÉES — un jeton neuf, qui n'existait pas.
 *
 * Le troisième est le seul irréversible : une étiquette créée pour un
 * objet qui en avait déjà une vivante, ce serait deux QR concurrents
 * sur le même pot. `etiquette_creer()` l'empêche côté base ; cet écran
 * le DIT côté écran, ce qui n'est pas la même chose — la base protège,
 * l'écran renseigne.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET CE QUI NE RENTRE PAS SE VOIT PENDANT LA COMPOSITION
 * ══════════════════════════════════════════════════════════════════
 *
 * Le contrôle porte sur TOUTE la sélection, pas sur un échantillon :
 * si sur quarante-deux lots trois portent un nom d'espèce qui doit
 * être coupé, on le dit avant, avec leurs noms. Découvrir la troncature
 * après avoir collé les quarante-deux autocollants, c'est quarante-deux
 * étiquettes à refaire.
 *
 * LE CALCUL EST DÉCOUPÉ EN DEUX POUR RESTER INSTANTANÉ. Le QR et le
 * code-barres sont encodés UNE SEULE FOIS : leur contenu — l'adresse —
 * a la même longueur pour tous les objets, donc le même verdict de
 * densité. Le reste, l'ajustement des textes, est de l'arithmétique de
 * chaînes : on peut le refaire pour cinq cents objets sans que la page
 * bronche. Encoder cinq cents QR à chaque frappe, en revanche, figerait
 * l'écran.
 */

type EtiquettePoseeVue = {
  id: string;
  jeton: string;
  type: string;
  publique: boolean;
  nombreScans: number;
  dernierScan: string | null;
};

type ObjetVue = {
  id: string;
  libelle: string;
  valeurs: Partial<Record<ChampEtiquette, string>>;
  etiquette: EtiquettePoseeVue | null;
};

type ModeleVue = {
  id: string;
  nom: string;
  famille: FamilleEtiquette;
  largeurMm: number;
  hauteurMm: number;
  margeMm: number;
  champs: readonly ChampPlace[];
  /** Vrai si le modèle appartient à l'entreprise (donc modifiable). */
  propre: boolean;
};

const CLASSE_CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 " +
  "text-[var(--text-body)] outline-none focus:border-accent";

function versModeleEtiquette(m: ModeleVue): ModeleEtiquette {
  return {
    famille: m.famille,
    nom: m.nom,
    largeurMm: m.largeurMm,
    hauteurMm: m.hauteurMm,
    margeMm: m.margeMm,
    champs: m.champs,
  };
}

export function Selection({
  source,
  singulier,
  familleParDefaut,
  peutGerer,
  baseAdresse,
  problemeAdresse,
  objets,
  modeles,
  modeleParDefaut,
  plafond,
  listeTronquee,
}: {
  source: SourceEtiquette;
  singulier: string;
  familleParDefaut: FamilleEtiquette;
  peutGerer: boolean;
  baseAdresse: string | null;
  problemeAdresse: string | null;
  objets: ObjetVue[];
  modeles: ModeleVue[];
  modeleParDefaut: string | null;
  plafond: number;
  listeTronquee: boolean;
}) {
  const [coches, setCoches] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [recherche, setRecherche] = useState("");
  const [modeleId, setModeleId] = useState(modeleParDefaut ?? modeles[0]?.id ?? "");
  const [support, setSupport] = useState<"rouleau" | "a4">("a4");
  const [copies, setCopies] = useState(1);
  const [casesSautees, setCasesSautees] = useState(0);
  const [traits, setTraits] = useState(true);
  const [texteLibre, setTexteLibre] = useState("");
  const [publique, setPublique] = useState(false);
  // LE FORMAT LIBRE ET LA GÉOMÉTRIE DE PLANCHE. Les deux existaient
  // dans le moteur et dans lireRequete ; aucun écran ne pouvait les
  // atteindre. « Sauter des cases » n'a de sens que sur une planche
  // prédécoupée, et une planche prédécoupée impose ses cotes, son
  // origine et ses gouttières : proposer l'un sans l'autre était une
  // promesse que le produit ne tenait pas.
  const [cotesLibres, setCotesLibres] = useState(false);
  const [largeurLibre, setLargeurLibre] = useState("");
  const [hauteurLibre, setHauteurLibre] = useState("");
  const [grilleLibre, setGrilleLibre] = useState(false);
  const [margeX, setMargeX] = useState("4.75");
  const [margeY, setMargeY] = useState("10.7");
  const [gouttiereX, setGouttiereX] = useState("2");
  const [gouttiereY, setGouttiereY] = useState("2");
  const [origineCoin, setOrigineCoin] = useState(false);

  const modele = useMemo(
    () => modeles.find((m) => m.id === modeleId) ?? modeles[0] ?? null,
    [modeles, modeleId],
  );

  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (q === "") return objets;
    return objets.filter((o) => o.libelle.toLowerCase().includes(q));
  }, [objets, recherche]);

  const selection = useMemo(() => objets.filter((o) => coches.has(o.id)), [objets, coches]);
  const nbDejaPosees = selection.filter((o) => o.etiquette !== null).length;
  const nbACreer = selection.length - nbDejaPosees;
  const total = selection.length * Math.max(1, copies);

  // ---- Ce qui ne tiendra pas ------------------------------------
  const controle = useMemo(() => {
    if (!modele || selection.length === 0) {
      return { avecFaute: [] as { libelle: string; messages: string[] }[], erreur: null as string | null };
    }
    // Le modèle privé de ses codes : il ne reste que du texte, donc du
    // calcul de chasse. Voir l'en-tête de ce fichier.
    const sansCodes: ModeleEtiquette = {
      ...versModeleEtiquette(modele),
      champs: modele.champs.filter((c) => c.champ !== "qr" && c.champ !== "codeBarres"),
    };
    const avecFaute: { libelle: string; messages: string[] }[] = [];
    try {
      for (const objet of selection) {
        const rendu = rendreEtiquette(sansCodes, {
          url: "",
          valeurs: { ...objet.valeurs, ...(texteLibre ? { texteLibre } : {}) },
        });
        if (rendu.avertissements.length > 0) {
          avecFaute.push({
            libelle: objet.libelle,
            messages: rendu.avertissements.map((a) =>
              a.champ ? `${LIBELLE_CHAMP[a.champ]} — ${a.message}` : a.message,
            ),
          });
        }
      }
    } catch (erreur) {
      return {
        avecFaute: [],
        erreur: erreur instanceof Error ? erreur.message : "Ce modèle ne peut pas être imprimé.",
      };
    }
    return { avecFaute, erreur: null };
  }, [modele, selection, texteLibre]);

  // ---- La planche : combien de feuilles ? ------------------------
  const pagination = useMemo(() => {
    if (!modele) return null;
    if (support === "rouleau") {
      return { parPage: 1, pages: total, phrase: `${total} étiquette${total > 1 ? "s" : ""} à la suite` };
    }
    try {
      const grille = grilleA4(modele.largeurMm, modele.hauteurMm, { regleDeControle: true });
      const utilisables = Math.max(0, grille.parPage - Math.max(0, casesSautees));
      const pages =
        total === 0 ? 0 : Math.ceil(Math.max(0, total - utilisables) / grille.parPage) + 1;
      return {
        parPage: grille.parPage,
        pages,
        phrase:
          `${grille.colonnes} × ${grille.lignes} = ${grille.parPage} par feuille A4, ` +
          `soit ${pages} feuille${pages > 1 ? "s" : ""}`,
      };
    } catch (erreur) {
      return {
        parPage: 0,
        pages: 0,
        phrase: erreur instanceof Error ? erreur.message : "Ce format ne tient pas sur une A4.",
      };
    }
  }, [modele, support, total, casesSautees]);

  const basculer = (id: string) =>
    setCoches((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });

  const toutCocher = () => setCoches(new Set(visibles.slice(0, plafond).map((o) => o.id)));
  const toutDecocher = () => setCoches(new Set<string>());

  const donneesApercu = useMemo(() => {
    const temoin = selection[0] ?? objets[0];
    // LE VRAI JETON QUAND ON L'A. Il a la même longueur que celui
    // d'exemple, donc la même densité de QR ; mais l'aperçu montre
    // alors le carré qui sortira réellement, pas un sosie. Si la
    // fabrication échoue — jeton biscornu, adresse refusée — on
    // retombe sur l'exemple plutôt que de faire tomber l'écran.
    let url: string;
    try {
      url =
        baseAdresse && temoin?.etiquette
          ? urlEtiquette(baseAdresse, temoin.etiquette.jeton)
          : urlExemple(baseAdresse);
    } catch {
      url = urlExemple(null);
    }
    return {
      url,
      valeurs: {
        ...(temoin?.valeurs ?? {}),
        ...(texteLibre ? { texteLibre } : {}),
      },
    };
  }, [selection, objets, texteLibre, baseAdresse]);

  const bloque = !baseAdresse || !peutGerer || selection.length === 0 || Boolean(controle.erreur);

  return (
    /**
     * LA LISTE EST HORS DU FORMULAIRE, ET CE N'EST PAS UN DÉTAIL DE
     * MISE EN PAGE.
     *
     * Elle y était d'abord, et cela produisait deux fautes :
     *
     *   1. UNE TOUCHE ENTRÉE POUVAIT RÉVOQUER UNE ÉTIQUETTE. Dans un
     *      formulaire, Entrée depuis un champ texte déclenche le
     *      PREMIER bouton de soumission du document — ici celui de la
     *      première ligne, c'est-à-dire « Publier » ou « Révoquer ».
     *      Filtrer la liste et appuyer sur Entrée aurait tué un
     *      autocollant collé sur un pot, à l'autre bout de la
     *      pépinière.
     *   2. AUCUNE CONFIRMATION N'ÉTAIT POSSIBLE. `ConfirmDialog` rend
     *      son propre `<form>` ; imbriqué dans un autre, HTML le jette
     *      purement et simplement.
     *
     * Les cases cochées vivent en mémoire React, pas dans le DOM du
     * formulaire — la sélection part en champs cachés depuis le
     * panneau de droite. La liste n'a donc AUCUN besoin d'être dans le
     * formulaire, et chaque ligne peut porter ses propres gestes.
     */
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* ---------------- LA LISTE ---------------- */}
      <div className="min-w-0 space-y-4">
        <Panel
          title={`Que faut-il étiqueter ?`}
          description={
            listeTronquee
              ? `Les ${plafond} premiers sont affichés — c'est le maximum d'une seule impression.`
              : undefined
          }
          count={objets.length}
          action={
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Filtrer…"
                aria-label={`Filtrer les ${singulier}s`}
                className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-2.5 py-1.5 text-[var(--text-secondary)] outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={toutCocher}
                className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
              >
                Tout
              </button>
              <button
                type="button"
                onClick={toutDecocher}
                className="text-[var(--text-secondary)] text-ink-soft hover:underline"
              >
                Rien
              </button>
            </div>
          }
        >
          {visibles.length === 0 ? (
            <p className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
              Aucun {singulier} ne correspond à « {recherche} ».
            </p>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
              {visibles.map((objet) => {
                const coche = coches.has(objet.id);
                return (
                  <li key={objet.id} className="flex items-start gap-3 px-5 py-2.5">
                    <input
                      type="checkbox"
                      checked={coche}
                      onChange={() => basculer(objet.id)}
                      id={`objet-${objet.id}`}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                    <label htmlFor={`objet-${objet.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-[var(--text-body)]">{objet.libelle}</span>
                      {objet.etiquette ? (
                        <span className="mt-0.5 flex flex-wrap items-center gap-2">
                          <StatusBadge tone="positive">Déjà étiqueté</StatusBadge>
                          <span className="tabular text-[var(--text-secondary)] text-ink-faint">
                            {objet.etiquette.type.toUpperCase()} …{objet.etiquette.jeton.slice(-6)}
                          </span>
                          {objet.etiquette.publique && (
                            <StatusBadge tone="warning">Fiche publique</StatusBadge>
                          )}
                          <span className="text-[var(--text-secondary)] text-ink-faint">
                            {objet.etiquette.nombreScans === 0
                              ? "jamais scanné"
                              : `${objet.etiquette.nombreScans} scan${objet.etiquette.nombreScans > 1 ? "s" : ""}`}
                          </span>
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[var(--text-secondary)] text-ink-faint">
                          Pas encore d&apos;étiquette
                        </span>
                      )}
                    </label>

                    {/* LES GESTES SUR UNE ÉTIQUETTE EXISTANTE, chacun
                        dans SON formulaire — c'est possible parce que
                        la liste est hors du grand formulaire (voir
                        l'en-tête du rendu). */}
                    {peutGerer && objet.etiquette && (
                      <div className="flex shrink-0 items-center gap-3">
                        {/* Publier va dans les deux sens et ne détruit
                            rien : un simple bouton suffit. */}
                        <form action={objet.etiquette.publique ? depublierFiche : publierFiche}>
                          <input type="hidden" name="source" value={source} />
                          <input type="hidden" name="etiquette" value={objet.etiquette.id} />
                          <button
                            type="submit"
                            className="text-[var(--text-secondary)] text-ink-soft hover:text-ink hover:underline"
                            title={
                              objet.etiquette.publique
                                ? "Retirer la fiche publique : un passant qui scanne n'apprendra plus rien."
                                : "Publier une fiche réduite : un passant qui scanne verra le nom et le nom scientifique."
                            }
                          >
                            {objet.etiquette.publique ? "Dépublier" : "Publier"}
                          </button>
                        </form>

                        {/* RÉVOQUER DEMANDE UNE CONFIRMATION. Le geste
                            est à distance de son effet : on clique ici,
                            et c'est un autocollant collé sur un pot à
                            l'autre bout de la pépinière qui cesse de
                            répondre. Personne ne le verra avant de
                            scanner. */}
                        <ConfirmDialog
                          triggerLabel="Révoquer"
                          triggerVariant="ghost"
                          triggerTitle={`Révoquer l'étiquette de ${objet.libelle}`}
                          title="Révoquer cette étiquette ?"
                          message={
                            `L'autocollant en circulation sur « ${objet.libelle} » cessera de mener à quoi que ce soit, ` +
                            `définitivement. À faire quand il est perdu, arraché, ou collé sur le mauvais pot. ` +
                            `Vous pourrez ensuite en imprimer un neuf, avec un jeton neuf — ` +
                            (objet.etiquette.nombreScans > 0
                              ? `celui-ci a été scanné ${objet.etiquette.nombreScans} fois.`
                              : `celui-ci n'a jamais été scanné.`)
                          }
                          confirmLabel="Révoquer"
                          confirmVariant="danger"
                          action={revoquerEtiquette}
                          hidden={{ source, etiquette: objet.etiquette.id }}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* ---------------- CE QUI NE RENTRE PAS ---------------- */}
        {controle.erreur && (
          <div className="rounded-[var(--radius-card)] border border-critical/30 bg-critical-wash px-5 py-4 text-[var(--text-body)] text-critical">
            {controle.erreur}
          </div>
        )}

        {!controle.erreur && controle.avecFaute.length > 0 && (
          <div className="rounded-[var(--radius-card)] border border-warning/30 bg-warning-wash px-5 py-4">
            <p className="text-[var(--text-body)] font-medium text-warning">
              {controle.avecFaute.length} étiquette
              {controle.avecFaute.length > 1 ? "s" : ""} sur {selection.length} ne tiendra
              {controle.avecFaute.length > 1 ? "nt" : ""} pas telle
              {controle.avecFaute.length > 1 ? "s" : ""} quelle
              {controle.avecFaute.length > 1 ? "s" : ""}
            </p>
            <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
              Elles s&apos;imprimeront quand même — le texte sera réduit, ou coupé avec des points
              de suspension. Pour l&apos;éviter : élargissez le champ dans le modèle, ou choisissez
              un format plus grand.
            </p>
            <ul className="mt-3 space-y-2">
              {controle.avecFaute.slice(0, 6).map((ligne) => (
                <li key={ligne.libelle} className="text-[var(--text-secondary)]">
                  <span className="font-medium">{ligne.libelle}</span>
                  <ul className="ml-4 list-disc text-ink-soft">
                    {ligne.messages.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {controle.avecFaute.length > 6 && (
              <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
                … et {controle.avecFaute.length - 6} autre
                {controle.avecFaute.length - 6 > 1 ? "s" : ""}.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ---------------- LES RÉGLAGES ET L'APERÇU ---------------- */}
      <form action={poserEtiquettes} className="space-y-4">
        <input type="hidden" name="source" value={source} />
        {/* Les cases cochées sont tenues en mémoire, pas par le DOM : un
            filtre de recherche qui masque une ligne ne doit pas
            désélectionner l'objet. On émet donc la sélection COMPLÈTE
            en champs cachés, indépendamment de ce qui est affiché. */}
        {selection.map((o) => (
          <input key={o.id} type="hidden" name="objet" value={o.id} />
        ))}
        <input type="hidden" name="modele" value={modeleId} />
        <input type="hidden" name="support" value={support} />
        <input type="hidden" name="copies" value={String(copies)} />
        <input type="hidden" name="cases_sautees" value={String(casesSautees)} />
        <input type="hidden" name="texte_libre" value={texteLibre} />
        {traits && <input type="hidden" name="traits_de_coupe" value="on" />}
        {publique && <input type="hidden" name="public_fiche" value="on" />}
        {cotesLibres && largeurLibre.trim() !== "" && (
          <input type="hidden" name="largeur_mm" value={largeurLibre} />
        )}
        {cotesLibres && hauteurLibre.trim() !== "" && (
          <input type="hidden" name="hauteur_mm" value={hauteurLibre} />
        )}
        {support === "a4" && grilleLibre && (
          <>
            <input type="hidden" name="mx_mm" value={margeX} />
            <input type="hidden" name="my_mm" value={margeY} />
            <input type="hidden" name="gx_mm" value={gouttiereX} />
            <input type="hidden" name="gy_mm" value={gouttiereY} />
            <input type="hidden" name="origine" value={origineCoin ? "coin" : "centre"} />
          </>
        )}
        <Panel title="Modèle et format">
          <div className="space-y-4 px-5 py-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Modèle</span>
              <select
                value={modeleId}
                onChange={(e) => setModeleId(e.target.value)}
                className={CLASSE_CHAMP}
              >
                {modeles.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nom} — {m.largeurMm} × {m.hauteurMm} mm
                    {m.propre ? "" : " (Oasis)"}
                  </option>
                ))}
              </select>
              <span className="text-[var(--text-secondary)] text-ink-faint">
                Proposé : la famille « {LIBELLE_FAMILLE[familleParDefaut]} ». Vous pouvez en
                choisir un autre.
              </span>
            </label>

            <fieldset>
              <legend className="mb-1.5 text-[var(--text-secondary)] font-medium text-ink-soft">
                Support
              </legend>
              <div className="flex gap-2">
                {(
                  [
                    ["a4", "Planche A4"],
                    ["rouleau", "Rouleau"],
                  ] as const
                ).map(([valeur, libelle]) => (
                  <label
                    key={valeur}
                    className={`flex-1 cursor-pointer rounded-[var(--radius-control)] border px-3 py-2 text-center text-[var(--text-body)] ${
                      support === valeur
                        ? "border-accent bg-accent-wash font-medium text-accent"
                        : "border-line-strong text-ink-soft"
                    }`}
                  >
                    <input
                      type="radio"
                      name="support_visuel"
                      className="sr-only"
                      checked={support === valeur}
                      onChange={() => setSupport(valeur)}
                    />
                    {libelle}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[var(--text-secondary)] text-ink-faint">
                {support === "a4"
                  ? "Une feuille A4 portant une grille d'étiquettes, avec la règle de contrôle en pied de page."
                  : "Une étiquette par page, la page à la taille exacte de l'étiquette. C'est ce qu'attend une thermique."}
              </p>
            </fieldset>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Exemplaires
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                  className={CLASSE_CHAMP}
                />
              </label>
              {support === "a4" && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                    Cases à sauter
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={200}
                    value={casesSautees}
                    onChange={(e) =>
                      setCasesSautees(Math.max(0, Math.min(200, Number(e.target.value) || 0)))
                    }
                    className={CLASSE_CHAMP}
                  />
                </label>
              )}
            </div>
            {support === "a4" && (
              <p className="-mt-2 text-[var(--text-secondary)] text-ink-faint">
                Pour reprendre une planche prédécoupée déjà entamée, au lieu de gâcher la demi-feuille
                qui reste.
              </p>
            )}

            {/* ---- LES COTES LIBRES DU § 17 ---- */}
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={cotesLibres}
                onChange={(e) => setCotesLibres(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-[var(--text-body)]">
                Format personnalisé
                <span className="block text-[var(--text-secondary)] text-ink-faint">
                  Remplace les cotes du modèle sans toucher à sa composition. Les champs du
                  modèle doivent tenir dans la nouvelle taille, sinon la planche est refusée.
                </span>
              </span>
            </label>

            {cotesLibres && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                    Largeur (mm)
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={1000}
                    step={0.1}
                    value={largeurLibre}
                    onChange={(e) => setLargeurLibre(e.target.value)}
                    placeholder={modele ? String(modele.largeurMm) : "38.1"}
                    className={CLASSE_CHAMP}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                    Hauteur (mm)
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={1000}
                    step={0.1}
                    value={hauteurLibre}
                    onChange={(e) => setHauteurLibre(e.target.value)}
                    placeholder={modele ? String(modele.hauteurMm) : "21.2"}
                    className={CLASSE_CHAMP}
                  />
                </label>
              </div>
            )}

            {/* ---- LA GEOMETRIE D UNE PLANCHE PREDECOUPEE ---- */}
            {support === "a4" && (
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={grilleLibre}
                  onChange={(e) => setGrilleLibre(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-[var(--text-body)]">
                  Caler sur une planche prédécoupée
                  <span className="block text-[var(--text-secondary)] text-ink-faint">
                    Sans cela, la grille est centrée avec 5 mm de marge et 2 mm entre les cases
                    — ce qui va très bien au papier ordinaire découpé aux ciseaux, mais ne tombe
                    sur AUCUNE planche du commerce. Les cotes se lisent sur la boîte.
                  </span>
                </span>
              </label>
            )}

            {support === "a4" && grilleLibre && (
              <div className="space-y-3 rounded-[var(--radius-control)] border border-line-strong px-4 py-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                      Marge gauche (mm)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={80}
                      step={0.1}
                      value={margeX}
                      onChange={(e) => setMargeX(e.target.value)}
                      className={CLASSE_CHAMP}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                      Marge haut (mm)
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={80}
                      step={0.1}
                      value={margeY}
                      onChange={(e) => setMargeY(e.target.value)}
                      className={CLASSE_CHAMP}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                      Entre colonnes
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step={0.1}
                      value={gouttiereX}
                      onChange={(e) => setGouttiereX(e.target.value)}
                      className={CLASSE_CHAMP}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                      Entre lignes
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step={0.1}
                      value={gouttiereY}
                      onChange={(e) => setGouttiereY(e.target.value)}
                      className={CLASSE_CHAMP}
                    />
                  </label>
                </div>
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={origineCoin}
                    onChange={(e) => setOrigineCoin(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="text-[var(--text-body)]">
                    Partir du coin haut-gauche
                    <span className="block text-[var(--text-secondary)] text-ink-faint">
                      Une prédécoupe impose son origine : le bloc ne peut pas être recentré sur
                      ce qui reste de feuille. Cocher retire aussi la règle de contrôle, qui
                      s&apos;imprimerait sur un autocollant. Sur du papier ordinaire, laissez
                      décoché.
                    </span>
                  </span>
                </label>
                <p className="text-[var(--text-secondary)] text-ink-faint">
                  Imprimez une feuille d&apos;essai sur du papier ordinaire et posez-la sur la
                  planche à contre-jour avant d&apos;engager les autocollants.
                </p>
              </div>
            )}
            {support === "a4" && (
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={traits}
                  onChange={(e) => setTraits(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-[var(--text-body)]">
                  Tracer les contours
                  <span className="block text-[var(--text-secondary)] text-ink-faint">
                    Pour découper aux ciseaux. À décocher sur des planches prédécoupées.
                  </span>
                </span>
              </label>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Texte libre (le même sur toutes)
              </span>
              <input
                type="text"
                value={texteLibre}
                onChange={(e) => setTexteLibre(e.target.value)}
                placeholder="Ex. : arrosage modéré, plein soleil"
                className={CLASSE_CHAMP}
              />
              <span className="text-[var(--text-secondary)] text-ink-faint">
                N&apos;apparaît que si le modèle comporte un champ « texte libre ».
              </span>
            </label>
          </div>
        </Panel>

        <Panel title="Aperçu à la taille réelle">
          <div className="px-5 py-4">
            {modele ? (
              <ApercuEtiquette
                modele={versModeleEtiquette(modele)}
                donnees={donneesApercu}
                titre={
                  selection.length > 0
                    ? `Première de la sélection : ${selection[0].libelle}`
                    : "Exemple — cochez un élément pour voir le sien"
                }
              />
            ) : (
              <p className="text-[var(--text-body)] text-ink-soft">Aucun modèle disponible.</p>
            )}
          </div>
        </Panel>

        <Panel title="Ce qui va sortir">
          <div className="space-y-3 px-5 py-4">
            <dl className="space-y-1.5 text-[var(--text-body)]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Éléments cochés</dt>
                <dd className="tabular font-semibold">{selection.length}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Étiquettes imprimées</dt>
                <dd className="tabular font-semibold">{total}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Jetons réutilisés</dt>
                <dd className="tabular">{nbDejaPosees}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-soft">Jetons créés</dt>
                <dd className="tabular font-semibold text-accent">{nbACreer}</dd>
              </div>
            </dl>

            {pagination && (
              <p className="border-t border-line pt-3 text-[var(--text-secondary)] text-ink-soft">
                {pagination.phrase}
              </p>
            )}

            {nbDejaPosees > 0 && (
              <p className="rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 text-[var(--text-secondary)] text-ink-soft">
                {nbDejaPosees} élément{nbDejaPosees > 1 ? "s" : ""} porte
                {nbDejaPosees > 1 ? "nt" : ""} déjà une étiquette : c&apos;est le{" "}
                <strong>même QR</strong> qui ressortira, pas un nouveau. Pour changer de jeton —
                autocollant arraché, pot recyclé — révoquez d&apos;abord l&apos;ancienne dans la
                liste.
              </p>
            )}

            <label className="flex items-start gap-2.5 border-t border-line pt-3">
              <input
                type="checkbox"
                checked={publique}
                onChange={(e) => setPublique(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-[var(--text-body)]">
                Fiche publique
                <span className="block text-[var(--text-secondary)] text-ink-faint">
                  Un passant qui scanne verra le nom et le nom scientifique — rien d&apos;autre,
                  jamais un prix ni un client. Décoché, il n&apos;apprend même pas que
                  l&apos;élément existe. Ne concerne que les étiquettes créées maintenant.
                </span>
              </span>
            </label>

            {!peutGerer && (
              <p className="rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 text-[var(--text-secondary)] text-ink-soft">
                Votre rôle permet de consulter les étiquettes, pas d&apos;en poser. Demandez le
                droit « gérer les étiquettes » à un responsable.
              </p>
            )}

            {!baseAdresse && (
              <p className="rounded-[var(--radius-control)] bg-critical-wash px-3 py-2 text-[var(--text-secondary)] text-critical">
                {problemeAdresse}
              </p>
            )}

            {/* Un vrai `disabled`, pas une opacité : un bouton qui a
                l'air éteint mais que la touche Entrée déclenche quand
                même est pire qu'un bouton actif. Le refus reste doublé
                côté serveur — l'action revérifie tout. */}
            <button
              type="submit"
              disabled={bloque}
              className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {selection.length === 0
                ? "Cochez au moins un élément"
                : `Préparer la planche de ${total} étiquette${total > 1 ? "s" : ""}`}
            </button>
          </div>
        </Panel>
      </form>
    </div>
  );
}
