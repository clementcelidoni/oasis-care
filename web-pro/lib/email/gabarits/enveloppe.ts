import type { IdentiteExpediteur, MentionsEntreprise } from "../types.ts";
import { echapperHtml, rendreBlocsHtml, rendreBlocsTexte, urlSure, type Bloc } from "./blocs.ts";

/**
 * §COURRIEL — L'HABILLAGE : L'EN-TÊTE, LE PIED, ET LE DÉSABONNEMENT.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE LE PIED DE PAGE PORTE, ET POURQUOI CE N'EST PAS DÉCORATIF
 * ══════════════════════════════════════════════════════════════════
 *
 * Sur un devis et sur une facture, la raison sociale, la forme
 * juridique, le SIRET, le numéro de TVA, l'adresse et le numéro
 * d'assurance décennale ont une VALEUR LÉGALE. La sélection reprend
 * celle de la vue `client_portal_companies` (migration 0056), qui sait
 * déjà quoi montrer d'une entreprise sans laisser fuiter `workspace_id`
 * ni `tax_configuration`.
 *
 * Tout est facultatif sauf la raison sociale, parce qu'en base tout est
 * `nullable` sauf `name` : le pied doit rester présentable avec des
 * trous. C'est l'état réel de la production, où le SIRET, le numéro de
 * TVA et la décennale manquent sur la seule entreprise existante.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA PHRASE QUI ÉVITE LES PLAINTES
 * ══════════════════════════════════════════════════════════════════
 *
 * Le client voit « Jardins Dupont » dans sa boîte, mais l'adresse
 * technique est celle d'Oasis Care : c'est le motif CRM, et c'est ce qui
 * fait que le message arrive. Un destinataire attentif qui regarde
 * l'adresse réelle et n'y comprend rien clique sur « indésirable » — et
 * cette plainte abîme la réputation du domaine pour TOUT le parc.
 *
 * Le pied le dit donc en une phrase, sur chaque message. Elle n'est pas
 * facultative et ne doit pas être retirée pour faire plus propre.
 */

/**
 * LE CONTEXTE DE RENDU, EN UNION DISCRIMINÉE — ET C'EST LE GARDE-FOU.
 *
 * Une publicité EXIGE un jeton de désabonnement, et le type l'impose :
 * appeler `habiller` sur une publicité sans jeton ne compile pas. Ce
 * n'est pas une vérification qu'on peut oublier d'écrire, c'est une
 * forme qu'on ne peut pas écrire autrement.
 *
 * Et la symétrique : un transactionnel n'a pas de champ où mettre un
 * jeton. Il ne peut donc pas porter de lien de désabonnement, même par
 * distraction. On ne se désabonne pas de ses propres factures.
 */
export type ContexteRendu =
  | {
      nature: "transactionnel";
      identite: IdentiteExpediteur;
      mentions: MentionsEntreprise;
      /** Racine des liens, sans barre oblique finale. */
      baseUrl: string;
    }
  | {
      nature: "publicite";
      identite: IdentiteExpediteur;
      mentions: MentionsEntreprise;
      baseUrl: string;
      /** Le jeton de `email_consents.unsubscribe_token`. Jamais fabriqué ici. */
      jetonDesabonnement: string;
    };

export type MessageHabille = {
  html: string;
  texte: string;
  /** `List-Unsubscribe` et son compagnon, pour la publicité seulement. */
  entetes: Record<string, string>;
};

/**
 * LE LIEN DE DÉSABONNEMENT.
 *
 * Il pointe une page publique qui appelle `email_unsubscribe(jeton)` —
 * la seule fonction de la migration 0084 ouverte à un visiteur non
 * connecté. Elle n'ouvre aucune session, ne rend l'adresse que masquée,
 * et ne donne accès à rien d'autre.
 *
 * LE JETON N'EXPIRE PAS, contrairement à celui d'une invitation au
 * portail. Un lien de désabonnement qui a cessé de fonctionner est un
 * désabonnement refusé, et la loi ne connaît pas de délai au-delà duquel
 * on aurait le droit de continuer.
 */
export function lienDesabonnement(baseUrl: string, jeton: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/desabonnement?jeton=${encodeURIComponent(jeton)}`;
}

/**
 * L'ADRESSE DU DÉSABONNEMENT EN UN CLIC — CELLE DE L'EN-TÊTE.
 *
 * ELLE N'EST PAS LA MÊME QUE CELLE DU BOUTON, ET C'EST NÉCESSAIRE.
 * Gmail et Yahoo, depuis 2024, exigent des envois de masse un en-tête
 * `List-Unsubscribe` qui accepte une requête POST sans interaction
 * supplémentaire (RFC 8058) : leur bouton natif POSTE, il ne clique pas.
 * Une page qui ne répond qu'au GET fait disparaître ce bouton, et le
 * destinataire n'a plus que « signaler comme indésirable ».
 *
 * Or une page Next et un point de terminaison POST ne peuvent pas
 * cohabiter sur la même route. L'en-tête pointe donc un chemin dédié —
 * qui accepte le POST du client de messagerie, et redirige un humain
 * vers la page quand il l'ouvre en GET.
 */
export function lienDesabonnementUnClic(baseUrl: string, jeton: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/desabonnement/un-clic?jeton=${encodeURIComponent(jeton)}`;
}

/**
 * Habiller un corps de blocs : en-tête, contenu, pied, désabonnement.
 *
 * C'est la SEULE fonction qui produit l'en-tête `List-Unsubscribe`, et
 * elle ne le produit que dans la branche « publicite ». Le transporteur
 * refuse ensuite toute publicité qui n'en porte pas et tout
 * transactionnel qui en porte (`verifierDesabonnement`) : les deux
 * verrous sont indépendants, et il en faut deux parce que celui-ci est
 * un choix de rendu tandis que l'autre est un point de passage.
 */
export function habiller(blocs: Bloc[], ctx: ContexteRendu): MessageHabille {
  const piedBlocs = piedIdentite(ctx);
  const entetes: Record<string, string> = {};

  let blocsDesabo: Bloc[] = [];
  if (ctx.nature === "publicite") {
    const jeton = ctx.jetonDesabonnement.trim();
    if (jeton === "") {
      // Le type garantit la PRÉSENCE du champ, pas qu'il soit rempli.
      // Une chaîne vide donnerait un lien qui ne désabonne personne :
      // pire qu'une absence, parce qu'elle a l'air de marcher.
      throw new Error(
        "Un message commercial sans jeton de désabonnement ne peut pas être rendu : le lien serait mort.",
      );
    }
    const url = lienDesabonnement(ctx.baseUrl, jeton);
    // L'EN-TÊTE POINTE LE CHEMIN QUI ACCEPTE LE POST, pas la page. Voir
    // `lienDesabonnementUnClic` : le bouton natif de Gmail et de Yahoo
    // poste, il ne clique pas, et un point de terminaison qui ne répond
    // qu'au GET fait disparaître ce bouton.
    entetes["List-Unsubscribe"] = `<${lienDesabonnementUnClic(ctx.baseUrl, jeton)}>`;
    // `One-Click` : Gmail et Yahoo l'exigent des envois de masse depuis
    // 2024. Sans lui, leur bouton « se désabonner » disparaît et le
    // destinataire n'a plus que « signaler comme indésirable » — la
    // plainte qui, chez le transporteur, finit par bloquer les FACTURES
    // de la même adresse.
    entetes["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    blocsDesabo = [
      { type: "note", texte: "Vous recevez ce message parce que vous êtes client d'Oasis Care et que vous avez accepté nos communications commerciales." },
      { type: "bouton", libelle: "Me désabonner des communications commerciales", url },
      { type: "note", texte: "Le désabonnement est immédiat et définitif. Vos documents — devis, factures, messages de votre compte — continueront de vous parvenir : ils ne sont pas concernés." },
    ];
  }

  return {
    html: coquilleHtml(blocs, piedBlocs, blocsDesabo, ctx),
    texte: coquilleTexte(blocs, piedBlocs, blocsDesabo),
    entetes,
  };
}

// ────────────────────────────────────────────────────────────────
// LE PIED D'IDENTITÉ
// ────────────────────────────────────────────────────────────────

function piedIdentite(ctx: ContexteRendu): Bloc[] {
  const m = ctx.mentions;
  const blocs: Bloc[] = [];

  blocs.push({ type: "note", texte: identiteEnUneLigne(m) });

  const adresse = [
    [m.adresse1, m.adresse2].filter(Boolean).join(", "),
    [m.codePostal, m.ville].filter(Boolean).join(" "),
  ]
    .filter((part) => part !== "")
    .join(" — ");
  if (adresse !== "") blocs.push({ type: "note", texte: adresse });

  const contact = [
    m.telephone ? `Tél. ${m.telephone}` : null,
    m.courriel ?? null,
    m.siteWeb ?? null,
  ].filter((part): part is string => part !== null && part.trim() !== "");
  if (contact.length > 0) blocs.push({ type: "note", texte: contact.join(" · ") });

  // LA DÉCENNALE. Mention obligatoire sur les documents pour des travaux
  // de paysage. Son absence n'arrête rien — un blocage ferait perdre un
  // devis pour une attestation à retrouver — mais elle est signalée à
  // l'entreprise dans son écran (0084, `email_sender_identity`).
  const assurance = [
    m.assureur ? `Assurance ${m.assureur}` : null,
    m.numeroDecennale ? `décennale n° ${m.numeroDecennale}` : null,
  ].filter((part): part is string => part !== null);
  if (assurance.length > 0) blocs.push({ type: "note", texte: assurance.join(" — ") });

  // LA PHRASE QUI ÉVITE LES PLAINTES. Voir l'en-tête du fichier.
  blocs.push({
    type: "note",
    texte:
      ctx.nature === "publicite"
        ? "Message envoyé par Oasis Care."
        : `Message envoyé par ${m.raisonSociale} avec Oasis Care. Pour répondre, utilisez simplement la fonction « Répondre » : votre réponse arrivera directement à ${ctx.identite.repondreA}.`,
  });

  return blocs;
}

/**
 * « Jardins Dupont, SARL au capital de 10 000 € — SIRET 123… — TVA FR… »
 *
 * Chaque mention n'apparaît que si elle existe. On n'écrit jamais
 * « SIRET : non renseigné » : une mention légale absente est une lacune
 * à corriger dans les paramètres, pas une information à publier au
 * client.
 */
export function identiteEnUneLigne(m: MentionsEntreprise): string {
  const parts: string[] = [m.raisonSociale];

  const capital =
    m.capitalCentimes !== null && m.capitalCentimes !== undefined && Number.isFinite(m.capitalCentimes)
      ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
          m.capitalCentimes / 100,
        )
      : null;

  if (m.formeJuridique && capital) parts.push(`${m.formeJuridique} au capital de ${capital}`);
  else if (m.formeJuridique) parts.push(m.formeJuridique);

  if (m.siret) parts.push(`SIRET ${m.siret}`);
  if (m.villeRcs) parts.push(`RCS ${m.villeRcs}`);
  if (m.numeroTva) parts.push(`TVA ${m.numeroTva}`);

  return parts.join(" — ");
}

// ────────────────────────────────────────────────────────────────
// LES DEUX COQUILLES
// ────────────────────────────────────────────────────────────────

function coquilleHtml(
  corps: Bloc[],
  pied: Bloc[],
  desabo: Bloc[],
  ctx: ContexteRendu,
): string {
  // LE LOGO. `logo_path` mène au bucket `organization-logos`, le seul
  // des cinq buckets qui soit public — et une image de message a besoin
  // d'une URL publique, sans quoi elle s'affiche comme une case vide.
  // L'appelant a déjà fabriqué l'URL ; ici on se contente de vérifier
  // qu'elle est en https, et de ne rien mettre sinon.
  const logo = ctx.identite.urlLogo ? urlSure(ctx.identite.urlLogo) : null;
  const entete = logo
    ? `<img src="${echapperHtml(logo)}" alt="${echapperHtml(ctx.identite.nomAffiche)}" ` +
      `width="140" style="display:block;max-width:140px;height:auto;margin:0 0 24px;">`
    : `<p style="margin:0 0 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
      `font-size:17px;font-weight:600;color:#1f2933;">${echapperHtml(ctx.identite.nomAffiche)}</p>`;

  const separateur = `<hr style="border:none;border-top:1px solid #e4e9ee;margin:28px 0 20px;">`;

  return [
    // `<div>` et non `<html>` : la coquille complète est ajoutée par le
    // transporteur, et deux `<html>` imbriqués font paniquer certains
    // clients de messagerie.
    `<div style="background:#f6f8f9;padding:24px 0;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8f9;">`,
    `<tbody><tr><td align="center">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;">`,
    `<tbody><tr><td style="padding:32px;">`,
    entete,
    rendreBlocsHtml(corps),
    separateur,
    rendreBlocsHtml(pied),
    desabo.length > 0 ? separateur + rendreBlocsHtml(desabo) : "",
    `</td></tr></tbody></table>`,
    `</td></tr></tbody></table>`,
    `</div>`,
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function coquilleTexte(corps: Bloc[], pied: Bloc[], desabo: Bloc[]): string {
  const parts = [rendreBlocsTexte(corps), "--", rendreBlocsTexte(pied)];
  if (desabo.length > 0) parts.push("--", rendreBlocsTexte(desabo));
  return parts.join("\n\n") + "\n";
}
