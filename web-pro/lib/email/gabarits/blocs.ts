/**
 * §COURRIEL — LE CORPS D'UN MESSAGE, ÉCRIT UNE FOIS, RENDU DEUX FOIS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN MODÈLE DE BLOCS PLUTÔT QUE DES CHAÎNES HTML
 * ══════════════════════════════════════════════════════════════════
 *
 * La consigne est qu'un message parte TOUJOURS avec sa version texte :
 * un message sans partie texte est classé indésirable plus souvent, et
 * certains clients de messagerie n'affichent que celle-là.
 *
 * La façon naïve de s'y prendre — écrire le HTML, puis écrire le texte à
 * côté — produit deux textes qui divergent au premier changement. On
 * corrige une faute dans l'un, jamais dans l'autre, et personne ne s'en
 * aperçoit puisque personne ne lit jamais les deux. Un jour la version
 * texte annonce encore l'ancien montant.
 *
 * ICI, UN GABARIT NE PRODUIT NI HTML NI TEXTE : il produit des BLOCS.
 * Deux fonctions de ce fichier — et elles seules — savent les rendre.
 * Il devient impossible qu'une phrase existe dans une version et pas
 * dans l'autre, parce qu'elle n'est écrite qu'une fois.
 */

/**
 * Les blocs disponibles. Volontairement peu nombreux.
 *
 * Un message professionnel n'a pas besoin de mise en page ; il a besoin
 * d'être lu. Chaque bloc ajouté est un bloc à rendre dans les deux
 * versions, donc une occasion de divergence : on n'en ajoute que quand
 * un message ne peut pas se dire autrement.
 */
export type Bloc =
  | { type: "paragraphe"; texte: string }
  | { type: "titre"; texte: string }
  /** Le tableau chiffres-clés : « Montant · 1 240,00 € ». */
  | { type: "encadre"; lignes: LigneEncadre[] }
  | { type: "bouton"; libelle: string; url: string }
  | { type: "liste"; elements: string[] }
  /** Une mention discrète : pourquoi ce message arrive, comment répondre. */
  | { type: "note"; texte: string };

export type LigneEncadre = { libelle: string; valeur: string; fort?: boolean };

/**
 * L'ÉCHAPPEMENT, ET IL N'EST PAS FACULTATIF.
 *
 * Un client peut s'appeler « Dupont & Fils <Jardins> ». Sans
 * échappement, ce nom casse la mise en page — au mieux. Au pire, une
 * valeur venue d'une fiche client injecte du balisage dans un message
 * qui part sous le nom d'une entreprise, depuis un domaine authentifié :
 * c'est-à-dire le support d'hameçonnage le plus crédible qui soit.
 *
 * Les apostrophes sont échappées aussi. Elles ne sont dangereuses que
 * dans un attribut, et l'on ne place jamais de valeur dans un attribut
 * ici — mais la règle « on échappe tout, partout » est la seule qui
 * survive à une relecture distraite.
 */
export function echapperHtml(valeur: string): string {
  return valeur
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * UNE URL DE BOUTON N'EST PAS UNE CHAÎNE QUELCONQUE.
 *
 * `javascript:` ne s'exécute pas dans un client de messagerie, mais
 * `http://` en clair, si : un lien non chiffré dans un message qui parle
 * d'un devis expose ce que la personne consulte, et les filtres le
 * pénalisent. On n'accepte donc que `https:` et `mailto:`, et on rend
 * `null` sinon — le rendu omet alors le bouton plutôt que d'écrire un
 * lien mort.
 */
export function urlSure(valeur: string): string | null {
  const propre = valeur.trim();
  if (/[\s<>"']/.test(propre)) return null;
  if (!/^(https:\/\/|mailto:)/i.test(propre)) return null;
  return propre;
}

// ────────────────────────────────────────────────────────────────
// LE RENDU HTML
// ────────────────────────────────────────────────────────────────
//
// DES STYLES EN LIGNE, ET AUCUNE FEUILLE DE STYLE. Ce n'est pas de la
// négligence : les clients de messagerie — celui de Gmail au premier
// rang — suppriment les blocs `<style>` et ignorent les classes. Un
// message mis en page proprement selon les usages du web arrive nu.
//
// DES TABLEAUX POUR LA STRUCTURE, pour la même raison : `flex` et `grid`
// ne sont pas rendus par plusieurs clients encore très employés en
// entreprise.

const POLICE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const ENCRE = "#1f2933";
const ENCRE_DOUCE = "#5c6b7a";
const TRAIT = "#e4e9ee";
const ACCENT = "#2f6f4e";

export function rendreBlocsHtml(blocs: Bloc[]): string {
  return blocs.map(rendreBlocHtml).filter((part) => part !== "").join("\n");
}

function rendreBlocHtml(bloc: Bloc): string {
  switch (bloc.type) {
    case "titre":
      return `<h1 style="margin:0 0 16px;font-family:${POLICE};font-size:20px;line-height:1.35;font-weight:600;color:${ENCRE};">${echapperHtml(bloc.texte)}</h1>`;

    case "paragraphe":
      return `<p style="margin:0 0 16px;font-family:${POLICE};font-size:15px;line-height:1.6;color:${ENCRE};">${echapperHtml(bloc.texte)}</p>`;

    case "liste": {
      const items = bloc.elements
        .map(
          (element) =>
            `<li style="margin:0 0 6px;">${echapperHtml(element)}</li>`,
        )
        .join("");
      return `<ul style="margin:0 0 16px;padding-left:20px;font-family:${POLICE};font-size:15px;line-height:1.6;color:${ENCRE};">${items}</ul>`;
    }

    case "encadre": {
      const lignes = bloc.lignes
        .map((ligne) => {
          const poids = ligne.fort ? "600" : "400";
          return (
            `<tr>` +
            `<td style="padding:6px 0;font-family:${POLICE};font-size:14px;color:${ENCRE_DOUCE};">${echapperHtml(ligne.libelle)}</td>` +
            `<td align="right" style="padding:6px 0;font-family:${POLICE};font-size:15px;font-weight:${poids};color:${ENCRE};">${echapperHtml(ligne.valeur)}</td>` +
            `</tr>`
          );
        })
        .join("");
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" ` +
        `style="margin:0 0 20px;border:1px solid ${TRAIT};border-radius:8px;padding:8px 16px;">` +
        `<tbody>${lignes}</tbody></table>`
      );
    }

    case "bouton": {
      const url = urlSure(bloc.url);
      if (!url) return "";
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">` +
        `<tbody><tr><td style="border-radius:6px;background:${ACCENT};">` +
        `<a href="${echapperHtml(url)}" style="display:inline-block;padding:11px 22px;font-family:${POLICE};` +
        `font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${echapperHtml(bloc.libelle)}</a>` +
        `</td></tr></tbody></table>`
      );
    }

    case "note":
      return `<p style="margin:0 0 12px;font-family:${POLICE};font-size:13px;line-height:1.55;color:${ENCRE_DOUCE};">${echapperHtml(bloc.texte)}</p>`;
  }
}

// ────────────────────────────────────────────────────────────────
// LE RENDU TEXTE
// ────────────────────────────────────────────────────────────────
//
// PAS UN HTML DÉPOUILLÉ DE SES BALISES — un vrai texte, lisible.
// Retirer les balises d'un HTML produit des lignes de trois cents
// caractères et des URL collées aux mots. Ici chaque bloc sait se dire
// en texte, et l'URL d'un bouton est écrite EN TOUTES LETTRES sur sa
// propre ligne : dans une version texte, un lien qu'on ne peut pas
// recopier n'est pas un lien.

export function rendreBlocsTexte(blocs: Bloc[]): string {
  return blocs
    .map(rendreBlocTexte)
    .filter((part) => part !== "")
    .join("\n\n")
    .trim();
}

function rendreBlocTexte(bloc: Bloc): string {
  switch (bloc.type) {
    case "titre":
      return `${bloc.texte}\n${"-".repeat(Math.min(bloc.texte.length, 60))}`;

    case "paragraphe":
      return bloc.texte;

    case "liste":
      return bloc.elements.map((element) => `- ${element}`).join("\n");

    case "encadre":
      return bloc.lignes.map((ligne) => `${ligne.libelle} : ${ligne.valeur}`).join("\n");

    case "bouton": {
      const url = urlSure(bloc.url);
      if (!url) return "";
      return `${bloc.libelle} :\n${url}`;
    }

    case "note":
      return bloc.texte;
  }
}

// ────────────────────────────────────────────────────────────────
// LES FORMATS — ET POURQUOI ILS NE VIENNENT PAS DE `lib/quotes/types`
// ────────────────────────────────────────────────────────────────
//
// `formatCents` du reste du produit rend « — » quand le montant manque,
// ce qui est le bon choix DANS UN TABLEAU : une cellule vide se voit et
// ne trompe personne. DANS UN MESSAGE, c'est le mauvais choix : « Votre
// facture s'élève à — » part chez le client et il appelle son
// paysagiste.
//
// Ces deux fonctions REFUSENT donc un montant ou une date absente en
// rendant `null`, et c'est au gabarit de décider quoi faire — le plus
// souvent : ne pas afficher la ligne. Le second bénéfice est que ce
// dossier reste sans dépendance, donc portable dans la fonction Edge.

const EUROS = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** Des centimes entiers vers « 1 240,00 € ». `null` si le montant manque. */
export function formaterMontant(centimes: number | null | undefined): string | null {
  if (centimes === null || centimes === undefined) return null;
  if (!Number.isFinite(centimes)) return null;
  return EUROS.format(centimes / 100);
}

/**
 * Une date ISO vers « 5 septembre 2026 ».
 *
 * EN TOUTES LETTRES, et pas « 05/09/2026 ». Un message part parfois à un
 * client qui n'est pas en France, et 05/09 s'y lit « 9 mai ». Sur une
 * date de validité de devis ou une échéance de facture, l'ambiguïté
 * coûte cher.
 */
const DATE_LONGUE = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Paris",
});

export function formaterDate(valeur: string | null | undefined): string | null {
  if (!valeur) return null;
  const lu = new Date(valeur);
  if (Number.isNaN(lu.getTime())) return null;
  return DATE_LONGUE.format(lu);
}
