"use client";

import { useMemo } from "react";

import {
  documentSvg,
  elementsVersSvg,
  rendreEtiquette,
  verifierModele,
  type AvertissementRendu,
  type DonneesEtiquette,
  type ModeleEtiquette,
} from "@/lib/etiquettes";

import { LIBELLE_CHAMP } from "./modeles.ts";

/**
 * L'APERÇU — AUX COTES RÉELLES, ET AVEC CE QUI NE RENTRE PAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI L'APERÇU EST À 1:1 PAR DÉFAUT
 * ══════════════════════════════════════════════════════════════════
 *
 * Un éditeur qui montre l'étiquette plus grande qu'elle ne sera fait
 * composer des textes illisibles : on écrit « Trachycarpus fortunei
 * var. wagnerianus » parce que ça tient joliment sur l'écran, et on
 * découvre à l'impression un trait de 4 points sur 34 mm. L'aperçu
 * s'ouvre donc à la taille du vrai autocollant, et l'agrandissement
 * est un geste EXPLICITE, annoncé comme tel.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET POURQUOI IL PORTE SA PROPRE RÈGLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le millimètre CSS est une unité absolue — 1 mm = 96/25,4 px — mais
 * le navigateur le calcule sur une définition d'écran SUPPOSÉE, pas
 * mesurée. Sur un écran dont la densité réelle diffère, l'aperçu dérive
 * de quelques pour cent. On ne peut pas corriger cela depuis une page
 * web ; on peut le RENDRE MESURABLE. D'où la barre de 20 mm sous
 * l'aperçu, à vérifier une fois avec une vraie règle. C'est la même
 * logique que la règle de contrôle imprimée en pied de planche : une
 * mesure vaut mieux qu'une promesse.
 *
 * Ce qui, lui, ne dérive PAS, c'est le fichier envoyé à l'imprimante :
 * les cotes sont dans le MediaBox du PDF, et rien à l'écran n'y touche.
 *
 * ══════════════════════════════════════════════════════════════════
 * RIEN N'EST SILENCIEUX
 * ══════════════════════════════════════════════════════════════════
 *
 * `rendreEtiquette` remonte chaque compromis : un texte réduit, un
 * texte coupé, un QR trop dense pour être scanné, un code-barres trop
 * serré pour une douchette. On les affiche TOUS, pendant la
 * composition. Découvrir après deux cents autocollants qu'aucun ne se
 * scanne est le seul échec que ce module doit rendre impossible.
 */

const TONS: Record<string, string> = {
  faute: "border-critical/30 bg-critical-wash text-critical",
  avertissement: "border-warning/30 bg-warning-wash text-warning",
};

export function ApercuEtiquette({
  modele,
  donnees,
  zoom = 1,
  regle = true,
  titre,
}: {
  modele: ModeleEtiquette;
  donnees: DonneesEtiquette;
  /** 1 = taille réelle. Tout le reste est annoncé à l'écran. */
  zoom?: number;
  regle?: boolean;
  titre?: string;
}) {
  const { svg, avertissements, fautes } = useMemo(() => {
    const fautes = verifierModele(modele);
    if (fautes.length > 0) return { svg: null, avertissements: [], fautes };
    try {
      const rendu = rendreEtiquette(modele, donnees);
      return {
        svg: documentSvg(
          rendu.largeurMm,
          rendu.hauteurMm,
          elementsVersSvg(rendu.elements, "apercu"),
        ),
        avertissements: rendu.avertissements as AvertissementRendu[],
        fautes: [] as string[],
      };
    } catch (erreur) {
      // Le moteur lève quand le modèle est inimprimable. On l'affiche
      // au lieu de laisser React remplacer l'écran par une page
      // d'erreur de développeur devant un pépiniériste.
      return {
        svg: null,
        avertissements: [],
        fautes: [erreur instanceof Error ? erreur.message : "Ce modèle ne peut pas être rendu."],
      };
    }
  }, [modele, donnees]);

  const defauts = avertissements.filter((a) => (a.niveau ?? "defaut") === "defaut");
  const remarques = avertissements.filter((a) => a.niveau === "remarque");

  return (
    <div>
      {titre && <p className="eyebrow mb-2">{titre}</p>}

      <div className="flex flex-col items-start gap-3">
        <div
          className="rounded-[var(--radius-card)] border border-line bg-[#fff] p-2 shadow-[var(--shadow-card)]"
          // L'ombre imite une étiquette posée sur un bureau : sans un
          // repère de ce genre, on n'a aucune idée de ce que 25 mm
          // représente à l'écran.
        >
          {svg ? (
            <div
              // Le SVG déclare ses cotes en millimètres ; le zoom
              // n'agit que sur la boîte, jamais sur les cotes du
              // fichier. Un aperçu agrandi et un PDF sortent donc du
              // MÊME rendu, ce qui est tout l'intérêt d'un moteur de
              // mise en page unique.
              style={{
                width: `${modele.largeurMm * zoom}mm`,
                height: `${modele.hauteurMm * zoom}mm`,
              }}
              className="[&>svg]:h-full [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <div className="px-4 py-6 text-[var(--text-secondary)] text-ink-faint">
              Rien à montrer tant que le modèle n&apos;est pas imprimable.
            </div>
          )}
        </div>

        <p className="tabular text-[var(--text-secondary)] text-ink-faint">
          {modele.largeurMm} × {modele.hauteurMm} mm
          {zoom !== 1 && (
            <span className="ml-2 rounded bg-warning-wash px-1.5 py-0.5 font-medium text-warning">
              agrandi × {zoom} — l&apos;étiquette réelle est {zoom} fois plus petite
            </span>
          )}
        </p>

        {regle && (
          <div>
            {/* LA RÈGLE D'ÉCRAN. Vingt millimètres suffisent à révéler
                une dérive : sur une barre de 20 mm, 5 % font 1 mm, ce
                qui se voit à la règle d'écolier. */}
            <div
              className="h-1.5 rounded-sm bg-ink"
              style={{ width: "20mm" }}
              aria-hidden
            />
            <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
              Cette barre devrait mesurer 20 mm sur votre écran. Si elle en fait plus ou moins,
              c&apos;est l&apos;APERÇU qui dérive, pas le fichier imprimé : les cotes du PDF sont
              écrites dedans et ne dépendent d&apos;aucun écran.
            </p>
          </div>
        )}
      </div>

      {fautes.length > 0 && (
        <ul className={`mt-4 space-y-1.5 rounded-[var(--radius-card)] border px-4 py-3 ${TONS.faute}`}>
          {fautes.map((faute) => (
            <li key={faute} className="text-[var(--text-body)]">
              {faute}
            </li>
          ))}
        </ul>
      )}

      {/*
        DEUX BLOCS, PAS UN. Un texte tranché et « ce QR se lit de près »
        n'appellent pas le même geste : le premier se corrige avant
        d'engager le rouleau, le second se sait. Les mélanger, c'était
        soit faire crier l'écran pour rien, soit taire ce qui compte.
      */}
      {defauts.length > 0 && (
        <div
          className={`mt-4 rounded-[var(--radius-card)] border px-4 py-3 ${TONS.avertissement}`}
          role="status"
        >
          <p className="text-[var(--text-body)] font-medium">
            {defauts.length} chose{defauts.length > 1 ? "s" : ""} ne tient pas comme prévu
          </p>
          <ul className="mt-2 space-y-1.5">
            {defauts.map((a, index) => (
              <li key={`${a.champ ?? "general"}-${index}`} className="text-[var(--text-body)]">
                {a.champ && (
                  <span className="font-medium">{LIBELLE_CHAMP[a.champ]} : </span>
                )}
                {a.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {remarques.length > 0 && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--border-subtle)] px-4 py-3">
          <p className="text-[var(--text-body)] font-medium">
            Ça s&apos;imprimera — voici ce qu&apos;il faut savoir
          </p>
          <ul className="mt-2 space-y-1.5">
            {remarques.map((a, index) => (
              <li
                key={`${a.champ ?? "general"}-${index}`}
                className="text-[var(--text-secondary)] text-ink-soft"
              >
                {a.champ && (
                  <span className="font-medium">{LIBELLE_CHAMP[a.champ]} : </span>
                )}
                {a.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
