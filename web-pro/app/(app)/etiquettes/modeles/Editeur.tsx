"use client";

import { useMemo, useState } from "react";

import { Panel } from "@/components/ui";
import {
  CHAMPS_ETIQUETTE,
  FORMATS_ETIQUETTE,
  coteQrMaximalMm,
  donneesExemple,
  mesurerDensiteQr,
  type ChampEtiquette,
  type ChampPlace,
  type DonneesEtiquette,
  type FamilleEtiquette,
  type ModeleEtiquette,
} from "@/lib/etiquettes";

import { urlExemple } from "../adresse.ts";
import { ApercuEtiquette } from "../ApercuEtiquette";
import { FAMILLES, LIBELLE_FAMILLE } from "../familles.ts";
import { LIBELLE_CHAMP } from "../modeles.ts";
import { enregistrerModele } from "../actions.ts";

/**
 * § 18 — L'ÉDITEUR DE MODÈLE.
 *
 * « Logo, nom, nom scientifique, cultivar, numéro de lot, date,
 *   quantité, emplacement, stade, QR, code-barres, texte libre. »
 *
 * ══════════════════════════════════════════════════════════════════
 * L'APERÇU EST À 1:1, ET C'EST LA DÉCISION LA PLUS IMPORTANTE DE CET
 * ÉCRAN
 * ══════════════════════════════════════════════════════════════════
 *
 * Un éditeur qui montre l'étiquette agrandie fait composer des
 * étiquettes illisibles : sur un aperçu de quinze centimètres,
 * « Trachycarpus fortunei var. wagnerianus » en corps 7 paraît
 * confortable ; sur les 34 mm réels, c'est un trait gris. Le zoom
 * existe — on ne compose pas au dixième de millimètre à l'œil nu —
 * mais il s'affiche en toutes lettres, et il revient à 1:1.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET ON COMPOSE CONTRE LE PIRE CAS, PAS CONTRE UN EXEMPLE FLATTEUR
 * ══════════════════════════════════════════════════════════════════
 *
 * Le bouton « texte long » remplace les valeurs d'exemple par les plus
 * longues qu'on rencontre vraiment : un nom d'espèce à rallonge, un
 * code de lot complet, un emplacement à trois niveaux. C'est le seul
 * moyen de savoir AVANT l'impression si le modèle tient debout — et
 * c'est exactement ce que le § 18 demande d'éviter de découvrir après
 * deux cents autocollants.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI DES COTES CHIFFRÉES ET PAS UN GLISSER-DÉPOSER
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce qu'une étiquette est un objet physique. « À peu près à deux
 * millimètres du bord » n'existe pas : soit le champ entre dans la
 * marge que la tête thermique mord, soit il n'y entre pas. Un champ
 * numérique dit 2, un glisser-déposer dit 1,87 et personne ne le
 * remarque. Le champ sélectionné est en revanche encadré dans
 * l'aperçu, ce qui donne le repère visuel sans donner l'imprécision.
 */

/** Les valeurs longues, pour éprouver un modèle avant de l'enregistrer. */
const EXEMPLE_LONG: Record<ChampEtiquette, string> = {
  logo: "OASIS RARE CARE — PÉPINIÈRE",
  nom: "Palmier chanvre de Chine",
  nomScientifique: "Trachycarpus fortunei var. wagnerianus",
  cultivar: "« Nainital Extra Compact »",
  numeroLot: "LOT-2026-000487-B",
  date: "05/09/2026",
  quantite: "1 250 u",
  emplacement: "Serre 2 — Travée B — Tablette 14",
  stade: "Multiplication (repiquage 3)",
  qr: "",
  codeBarres: "LOT-2026-000487-B",
  texteLibre:
    "Arrosage modéré, plein soleil, protéger du gel sous -12 °C la première année après plantation.",
};

const PAS = 0.5;

function nombreChamp(valeur: string, defaut: number): number {
  const n = Number(valeur.replace(",", "."));
  return Number.isFinite(n) ? n : defaut;
}

const CLASSE_MINI =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-2 py-1 " +
  "text-[var(--text-secondary)] tabular outline-none focus:border-accent";

export function Editeur({
  modeleId,
  initial,
  estDefaut,
  modifiable,
  baseAdresse,
}: {
  /** Vide pour une création. Sinon l'identifiant du modèle édité. */
  modeleId: string;
  initial: ModeleEtiquette;
  estDefaut: boolean;
  /** Faux pour un modèle fourni par Oasis : on regarde, on ne touche pas. */
  modifiable: boolean;
  /**
   * L'ORIGINE RÉELLEMENT CONFIGURÉE, ou null si aucune ne l'est.
   *
   * SANS ELLE, LE VERDICT DE LISIBILITÉ MENTAIT. L'éditeur mesurait sur
   * un gabarit d'étalonnage de vingt-sept caractères, quelle que soit
   * l'adresse du produit. Mesuré : avec l'étalon, un cadre de 14 mm
   * donne la version 4, 41 modules, 0,3415 mm — « à la limite » ; avec
   * « https://www.oasisrarecare.com », soixante-quatre caractères une
   * fois le jeton ajouté, il donne la version 5, 45 modules, 0,3111 mm
   * — « illisible ». L'écran disait « ça passe » et la planche sortait
   * un QR mort.
   *
   * Et le cas n'est pas théorique : sans OASIS_ETIQUETTES_BASE_URL, le
   * produit retombe sur NEXT_PUBLIC_SITE_URL, qui est souvent une
   * adresse d'hébergeur bien plus longue.
   */
  baseAdresse: string | null;
}) {
  const [nom, setNom] = useState(initial.nom);
  const [famille, setFamille] = useState<FamilleEtiquette>(initial.famille);
  const [largeurMm, setLargeurMm] = useState(initial.largeurMm);
  const [hauteurMm, setHauteurMm] = useState(initial.hauteurMm);
  const [margeMm, setMargeMm] = useState(initial.margeMm);
  const [champs, setChamps] = useState<ChampPlace[]>([...initial.champs]);
  const [defaut, setDefaut] = useState(estDefaut);
  const [selection, setSelection] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [texteLong, setTexteLong] = useState(false);

  const modele: ModeleEtiquette = useMemo(
    () => ({ famille, nom, largeurMm, hauteurMm, margeMm, champs }),
    [famille, nom, largeurMm, hauteurMm, margeMm, champs],
  );

  /** Le champ sélectionné est encadré : le repère visuel sans l'imprécision. */
  const modeleAffiche: ModeleEtiquette = useMemo(() => {
    if (selection === null) return modele;
    return {
      ...modele,
      champs: modele.champs.map((c, index) => (index === selection ? { ...c, cadre: true } : c)),
    };
  }, [modele, selection]);

  const donnees: DonneesEtiquette = useMemo(() => {
    const url = urlExemple(baseAdresse);
    if (!texteLong) return donneesExemple(url);
    return { url, valeurs: { ...EXEMPLE_LONG } };
  }, [texteLong, baseAdresse]);

  /**
   * LA DENSITÉ DU QR — le chiffre qui décide si l'étiquette sert à
   * quelque chose. On la mesure sur le cadre RÉEL du champ QR du
   * modèle, pas sur une estimation : `mesurerDensiteQr` encode
   * vraiment l'adresse et lit la version obtenue.
   */
  const densite = useMemo(() => {
    const champQr = champs.find((c) => c.champ === "qr");
    if (!champQr) return null;
    try {
      return mesurerDensiteQr(urlExemple(baseAdresse), Math.min(champQr.largeur, champQr.hauteur));
    } catch {
      return null;
    }
  }, [champs, baseAdresse]);

  const disponibles = CHAMPS_ETIQUETTE.filter((c) => !champs.some((place) => place.champ === c));

  const modifier = (index: number, patch: Partial<ChampPlace>) =>
    setChamps((precedent) =>
      precedent.map((champ, i) => (i === index ? { ...champ, ...patch } : champ)),
    );

  const supprimer = (index: number) => {
    setChamps((precedent) => precedent.filter((_, i) => i !== index));
    setSelection(null);
  };

  const ajouter = (cle: ChampEtiquette) => {
    // On pose le champ neuf SOUS le dernier, dans la zone imprimable.
    // S'il n'y a plus la place, il déborde — et l'avertissement le dira
    // aussitôt, ce qui vaut mieux qu'un placement « intelligent » qui
    // cacherait le fait que l'étiquette est pleine.
    const bas = champs.reduce((max, c) => Math.max(max, c.y + c.hauteur), margeMm);
    const carre = cle === "qr";
    const cote = carre ? Math.min(coteQrMaximalMm(largeurMm, hauteurMm, margeMm), 18) : 0;
    setChamps((precedent) => [
      ...precedent,
      {
        champ: cle,
        x: margeMm,
        y: Math.round((bas + 0.5) * 2) / 2,
        largeur: carre ? cote : Math.max(4, largeurMm - 2 * margeMm),
        hauteur: carre ? cote : cle === "texteLibre" ? 8 : 5,
        ...(carre ? {} : { taille: cle === "texteLibre" ? 5 : 7 }),
      },
    ]);
    setSelection(champs.length);
  };

  const appliquerFormat = (l: number, h: number) => {
    setLargeurMm(l);
    setHauteurMm(h);
  };

  return (
    <form action={enregistrerModele} className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <input type="hidden" name="modele_id" value={modeleId} />
      <input type="hidden" name="famille" value={famille} />
      <input type="hidden" name="nom" value={nom} />
      <input type="hidden" name="largeur_mm" value={String(largeurMm)} />
      <input type="hidden" name="hauteur_mm" value={String(hauteurMm)} />
      <input type="hidden" name="marge_mm" value={String(margeMm)} />
      {/* Les champs voyagent en un seul JSON. Voir `lireBrouillon` :
          une centaine d'entrées `champs[3].x` à recoller côté serveur
          serait une occasion de décaler tout un modèle sur une faute
          d'indice. */}
      <input type="hidden" name="champs" value={JSON.stringify(champs)} />
      {defaut && <input type="hidden" name="est_defaut" value="on" />}

      {/* ---------------- LA COMPOSITION ---------------- */}
      <div className="min-w-0 space-y-4">
        <Panel title="Identité du modèle">
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Nom</span>
              <input
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                disabled={!modifiable}
                maxLength={120}
                className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent disabled:opacity-60"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Famille
              </span>
              <select
                value={famille}
                onChange={(e) => setFamille(e.target.value as FamilleEtiquette)}
                disabled={!modifiable}
                className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent disabled:opacity-60"
              >
                {FAMILLES.map((f) => (
                  <option key={f} value={f}>
                    {LIBELLE_FAMILLE[f]}
                  </option>
                ))}
              </select>
              <span className="text-[var(--text-secondary)] text-ink-faint">
                Décide seulement du modèle proposé par défaut à l&apos;impression.
              </span>
            </label>

            <label className="flex items-start gap-2.5 pt-6">
              <input
                type="checkbox"
                checked={defaut}
                onChange={(e) => setDefaut(e.target.checked)}
                disabled={!modifiable}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-[var(--text-body)]">
                Modèle par défaut de cette famille
                <span className="block text-[var(--text-secondary)] text-ink-faint">
                  Un seul par famille : cocher ici démet l&apos;ancien.
                </span>
              </span>
            </label>
          </div>
        </Panel>

        <Panel
          title="Cotes de l'étiquette"
          description="En millimètres. Ce sont les cotes physiques de l'autocollant."
        >
          <div className="space-y-4 px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {FORMATS_ETIQUETTE.map((format) => {
                const actif =
                  format.largeurMm === largeurMm && format.hauteurMm === hauteurMm;
                return (
                  <button
                    key={format.cle}
                    type="button"
                    disabled={!modifiable}
                    onClick={() => appliquerFormat(format.largeurMm, format.hauteurMm)}
                    className={`rounded-[var(--radius-control)] border px-3 py-1.5 text-[var(--text-secondary)] transition-colors disabled:opacity-60 ${
                      actif
                        ? "border-accent bg-accent-wash font-medium text-accent"
                        : "border-line-strong text-ink-soft hover:bg-canvas"
                    }`}
                  >
                    {format.nom}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  ["Largeur", largeurMm, setLargeurMm],
                  ["Hauteur", hauteurMm, setHauteurMm],
                  ["Marge", margeMm, setMargeMm],
                ] as const
              ).map(([libelle, valeur, poser]) => (
                <label key={libelle} className="flex flex-col gap-1.5">
                  <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                    {libelle} (mm)
                  </span>
                  <input
                    type="number"
                    step={PAS}
                    min={0}
                    max={1000}
                    value={valeur}
                    disabled={!modifiable}
                    onChange={(e) => poser(nombreChamp(e.target.value, valeur))}
                    className={CLASSE_MINI}
                  />
                </label>
              ))}
            </div>
            <p className="text-[var(--text-secondary)] text-ink-faint">
              La marge est le blanc tournant SUR l&apos;étiquette, que la tête d&apos;impression
              ne doit pas mordre. Elle n&apos;a rien à voir avec les marges de la feuille.
            </p>
          </div>
        </Panel>

        <Panel
          title="Ce qu'on imprime dessus"
          count={champs.length}
          action={
            modifiable && disponibles.length > 0 ? (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) ajouter(e.target.value as ChampEtiquette);
                }}
                className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-2.5 py-1.5 text-[var(--text-secondary)] outline-none focus:border-accent"
              >
                <option value="">+ Ajouter un champ…</option>
                {disponibles.map((c) => (
                  <option key={c} value={c}>
                    {LIBELLE_CHAMP[c]}
                  </option>
                ))}
              </select>
            ) : null
          }
        >
          {champs.length === 0 ? (
            <p className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
              Cette étiquette est vide. Ajoutez au moins un champ — un nom et un QR suffisent à
              faire une étiquette utile.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {champs.map((champ, index) => {
                const choisi = selection === index;
                const texte = champ.champ !== "qr" && champ.champ !== "codeBarres";
                return (
                  <li
                    key={`${champ.champ}-${index}`}
                    className={`px-5 py-3 ${choisi ? "bg-accent-wash/40" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelection(choisi ? null : index)}
                        className="text-[var(--text-body)] font-medium hover:underline"
                      >
                        {LIBELLE_CHAMP[champ.champ]}
                      </button>
                      {modifiable && (
                        <button
                          type="button"
                          onClick={() => supprimer(index)}
                          className="text-[var(--text-secondary)] text-critical hover:underline"
                        >
                          Retirer
                        </button>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          ["x", champ.x],
                          ["y", champ.y],
                          ["largeur", champ.largeur],
                          ["hauteur", champ.hauteur],
                        ] as const
                      ).map(([cle, valeur]) => (
                        <label key={cle} className="flex flex-col gap-1">
                          <span className="text-[var(--text-secondary)] text-ink-faint">
                            {cle} (mm)
                          </span>
                          <input
                            type="number"
                            step={PAS}
                            value={valeur}
                            disabled={!modifiable}
                            onFocus={() => setSelection(index)}
                            onChange={(e) =>
                              modifier(index, { [cle]: nombreChamp(e.target.value, valeur) })
                            }
                            className={CLASSE_MINI}
                          />
                        </label>
                      ))}
                    </div>

                    {texte && (
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <label className="flex w-24 flex-col gap-1">
                          <span className="text-[var(--text-secondary)] text-ink-faint">
                            corps (pt)
                          </span>
                          <input
                            type="number"
                            step={0.25}
                            min={4}
                            value={champ.taille ?? ""}
                            placeholder="auto"
                            disabled={!modifiable}
                            onFocus={() => setSelection(index)}
                            onChange={(e) =>
                              modifier(index, {
                                taille:
                                  e.target.value === ""
                                    ? undefined
                                    : nombreChamp(e.target.value, 7),
                              })
                            }
                            className={CLASSE_MINI}
                          />
                        </label>
                        <label className="flex items-center gap-1.5 pb-1.5 text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={champ.gras ?? false}
                            disabled={!modifiable}
                            onChange={(e) => modifier(index, { gras: e.target.checked })}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                          Gras
                        </label>
                        <label className="flex items-center gap-1.5 pb-1.5 text-[var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={champ.italique ?? false}
                            disabled={!modifiable}
                            onChange={(e) => modifier(index, { italique: e.target.checked })}
                            className="h-4 w-4 accent-[var(--accent)]"
                          />
                          Italique
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-[var(--text-secondary)] text-ink-faint">
                            alignement
                          </span>
                          <select
                            value={champ.alignement ?? "gauche"}
                            disabled={!modifiable}
                            onChange={(e) =>
                              modifier(index, {
                                alignement: e.target.value as ChampPlace["alignement"],
                              })
                            }
                            className={CLASSE_MINI}
                          >
                            <option value="gauche">à gauche</option>
                            <option value="centre">centré</option>
                            <option value="droite">à droite</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* ---------------- L'APERÇU ---------------- */}
      <aside className="space-y-4">
        <Panel
          title="Aperçu"
          action={
            <div className="flex items-center gap-1">
              {[1, 2, 4].map((facteur) => (
                <button
                  key={facteur}
                  type="button"
                  onClick={() => setZoom(facteur)}
                  className={`rounded px-2 py-1 text-[var(--text-secondary)] ${
                    zoom === facteur
                      ? "bg-accent-wash font-medium text-accent"
                      : "text-ink-soft hover:bg-canvas"
                  }`}
                >
                  ×{facteur}
                </button>
              ))}
            </div>
          }
        >
          <div className="space-y-4 px-5 py-4">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={texteLong}
                onChange={(e) => setTexteLong(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="text-[var(--text-body)]">
                Éprouver avec des textes longs
                <span className="block text-[var(--text-secondary)] text-ink-faint">
                  Les valeurs les plus longues qu&apos;on rencontre vraiment. Si le modèle tient
                  avec elles, il tiendra avec tout le reste.
                </span>
              </span>
            </label>

            <ApercuEtiquette modele={modeleAffiche} donnees={donnees} zoom={zoom} />
          </div>
        </Panel>

        {/* LE VERDICT DE LISIBILITÉ DU QR — un chiffre, pas une
            impression. Sans lui, on compose un carré décoratif. */}
        {densite && (
          <Panel title="Le QR sera-t-il scannable ?">
            <div className="space-y-2 px-5 py-4 text-[var(--text-body)]">
              <p
                className={
                  densite.verdictAppareilPhoto === "confortable"
                    ? "font-medium text-positive"
                    : densite.verdictAppareilPhoto === "limite"
                      ? "font-medium text-warning"
                      : "font-medium text-critical"
                }
              >
                {densite.verdictAppareilPhoto === "confortable" && "Confortable"}
                {densite.verdictAppareilPhoto === "limite" && "À la limite"}
                {densite.verdictAppareilPhoto === "illisible" && "Illisible — à corriger"}
              </p>
              <p className="tabular text-[var(--text-secondary)] text-ink-soft">
                Version {densite.version}, {densite.modulesParCote} modules (
                {densite.modulesAvecSilence} avec la zone de silence), soit{" "}
                {densite.tailleModuleMm} mm par module.
              </p>
              {densite.remarques.map((remarque) => (
                <p key={remarque} className="text-[var(--text-secondary)] text-ink-soft">
                  {remarque}
                </p>
              ))}
              <p className="text-[var(--text-secondary)] text-ink-faint">
                {baseAdresse ? (
                  <>
                    Mesuré en encodant réellement <span className="tabular">{baseAdresse}</span>,
                    l&apos;adresse qui sera imprimée, zone de silence comprise — les quatre modules
                    clairs que la norme exige de chaque côté, et que la plupart des calculs
                    oublient.
                  </>
                ) : (
                  <>
                    Mesuré sur une adresse d&apos;ÉTALONNAGE, aucune adresse n&apos;étant configurée. Une
                    adresse plus longue que vingt-sept caractères donnerait un QR plus dense que
                    celui-ci : ce verdict est un ordre de grandeur tant que
                    OASIS_ETIQUETTES_BASE_URL n&apos;est pas posée.
                  </>
                )}
              </p>
            </div>
          </Panel>
        )}

        {modifiable ? (
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-secondary)] font-medium text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Enregistrer le modèle
          </button>
        ) : (
          <p className="rounded-[var(--radius-card)] border border-line bg-surface-sunken px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
            Ce modèle est fourni par Oasis : il se lit, il ne se modifie pas. Dupliquez-le pour
            en faire le vôtre — la copie appartiendra à votre entreprise et rien ne changera pour
            les autres.
          </p>
        )}
      </aside>
    </form>
  );
}
