// Oasis Care — Chantier Stripe. LA VÉRIFICATION DE SIGNATURE.
//
// C'EST LA SEULE DÉFENSE DE CE POINT DE TERMINAISON. La fonction est
// déployée sans vérification de jeton (Stripe ne porte aucun jeton
// Supabase), donc n'importe qui sur Internet peut lui envoyer un corps
// qui dit « paiement reçu ». Si cette vérification est ratée, un
// abonnement payant s'ouvre gratuitement. Tout le reste du fichier
// suppose que ce module a dit oui.
//
// ------------------------------------------------------------------
// POURQUOI CE MODULE N'IMPORTE RIEN, ET SURTOUT PAS LA BIBLIOTHÈQUE
// OFFICIELLE
// ------------------------------------------------------------------
// La bibliothèque `stripe` sait faire cette vérification
// (`constructEventAsync`). On ne l'emploie pas ICI, et c'est un
// arbitrage assumé, pas une facilité :
//
//   • CE FICHIER DOIT ÊTRE TESTABLE HORS RÉSEAU. Deno n'est pas installé
//     sur le poste de développement de ce dépôt, et un module importé
//     d'un CDN ne se charge pas sans réseau. Un test qui exige le réseau
//     est un test qui ne tournera jamais en intégration — et une
//     vérification cryptographique jamais exécutée est exactement le
//     défaut que le webhook Apple de ce dépôt porte encore en tête de
//     fichier, en majuscules.
//   • Sans import, ce module tourne à l'identique sous Deno (production)
//     et sous Node (les tests), parce qu'il n'emploie que `crypto.subtle`,
//     présent dans les deux. La chose testée est donc littéralement la
//     chose déployée.
//   • Le schéma est petit, publié, et stable depuis des années. Le
//     réécrire est un risque mesuré ; ne jamais l'exécuter en est un
//     autre, et le second est pire.
//
// Le prix à payer est réel : ce code doit être JUSTE. Il est donc
// éprouvé dans `signature.test.ts` contre une seconde implémentation
// indépendante (`node:crypto`), et contre un vecteur figé.
//
// ------------------------------------------------------------------
// LE SCHÉMA, TEL QUE STRIPE LE PUBLIE
// ------------------------------------------------------------------
//   En-tête : Stripe-Signature: t=1492774577,v1=5257a869…,v1=…
//   Charge signée : `${t}.${corps brut}`  — un point littéral entre les
//                   deux, et le corps EXACTEMENT tel qu'il est arrivé.
//   Signature : HMAC-SHA256, clé = le secret de point de terminaison
//               en entier, préfixe `whsec_` COMPRIS, sortie en
//               hexadécimal minuscule.
//   Tolérance : 300 secondes par défaut.
//
// Plusieurs `v1` peuvent coexister : c'est ainsi qu'on fait tourner un
// secret sans coupure. On accepte donc dès qu'UN d'entre eux concorde.
//
// `v0` existe aussi dans certains en-têtes (signature des « thin
// events » de Radar) et ne suit PAS ce schéma. Un en-tête qui ne porte
// que du `v0` est rejeté : accepter un schéma qu'on ne sait pas
// vérifier reviendrait à ne rien vérifier.

/** La tolérance par défaut, en secondes. Celle de Stripe. */
export const TOLERANCE_PAR_DEFAUT_SECONDES = 300;

export type MotifRejetSignature =
  | "secretAbsent"
  | "enteteAbsente"
  | "horodatageAbsent"
  | "signatureAbsente"
  | "horodatageHorsTolerance"
  | "signatureNonConcordante";

export type VerdictSignature =
  | { readonly valide: true; readonly horodatage: number }
  | { readonly valide: false; readonly motif: MotifRejetSignature; readonly detail: string };

export interface DemandeVerification {
  /**
   * LE CORPS BRUT, EN OCTETS. Pas une chaîne, pas un objet analysé.
   *
   * C'est l'erreur classique de toute intégration de webhook : analyser
   * le JSON puis le ré-encoder pour vérifier la signature. Le
   * ré-encodage réordonne les clés, change les espaces, normalise les
   * nombres — et la signature ne concorde plus jamais. Le pire cas
   * n'est pas l'échec systématique (qu'on remarque tout de suite) mais
   * la « correction » qui suit : contourner la vérification parce
   * qu'« elle ne marche pas ». On exige donc les octets, et le type
   * l'impose.
   */
  readonly corpsBrut: Uint8Array;
  readonly enteteSignature: string | null | undefined;
  readonly secret: string | null | undefined;
  /**
   * L'instant courant, en secondes, INJECTÉ. Un test qui dépend de
   * l'horloge réelle est un test qui échouera un jour tout seul.
   */
  readonly maintenantSecondes: number;
  readonly toleranceSecondes?: number;
}

/**
 * Calcule la signature attendue, en hexadécimal minuscule.
 *
 * Exportée parce que le test s'en sert, et parce que la comparer à une
 * implémentation indépendante est la seule preuve qui vaille.
 */
export async function calculerSignatureHex(
  corpsBrut: Uint8Array,
  horodatage: number,
  secret: string,
): Promise<string> {
  // LA CHARGE SIGNÉE SE CONSTRUIT EN OCTETS, pas en chaîne. Concaténer
  // `${t}.${texte}` puis ré-encoder donnerait le même résultat pour un
  // corps UTF-8 valide, mais pas pour un corps qui ne l'est pas
  // tout à fait — et on ne veut pas que la validité d'une signature
  // dépende de la propreté de l'encodage d'en face.
  const prefixe = new TextEncoder().encode(`${horodatage}.`);
  const charge = new Uint8Array(prefixe.length + corpsBrut.length);
  charge.set(prefixe, 0);
  charge.set(corpsBrut, prefixe.length);

  const cle = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const empreinte = new Uint8Array(await crypto.subtle.sign("HMAC", cle, charge));

  let hex = "";
  for (const octet of empreinte) hex += octet.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Vérifie l'en-tête `Stripe-Signature` contre le corps brut.
 *
 * NE LÈVE JAMAIS. Elle rend un verdict motivé : un gestionnaire de
 * webhook qui doit envelopper sa vérification dans un `try` finit
 * toujours par avoir un `catch` qui laisse passer.
 */
export async function verifierSignatureStripe(
  demande: DemandeVerification,
): Promise<VerdictSignature> {
  const tolerance = demande.toleranceSecondes ?? TOLERANCE_PAR_DEFAUT_SECONDES;

  if (!demande.secret || demande.secret.trim() === "") {
    // ON ÉCHOUE FERMÉ. Un secret absent ne veut pas dire « pas de
    // vérification à faire », il veut dire « on ne peut rien vérifier ».
    return { valide: false, motif: "secretAbsent", detail: "Aucun secret de signature configuré." };
  }
  if (!demande.enteteSignature || demande.enteteSignature.trim() === "") {
    return { valide: false, motif: "enteteAbsente", detail: "En-tête Stripe-Signature absente." };
  }

  let horodatage: number | null = null;
  const signaturesV1: string[] = [];

  for (const morceau of demande.enteteSignature.split(",")) {
    const separateur = morceau.indexOf("=");
    if (separateur < 0) continue;
    const cle = morceau.slice(0, separateur).trim();
    const valeur = morceau.slice(separateur + 1).trim();
    if (cle === "t") {
      // `Number.parseInt` accepterait « 12abc » ; on exige des chiffres
      // et rien d'autre, sans quoi un horodatage bricolé passerait le
      // contrôle de tolérance par troncature.
      if (/^\d+$/.test(valeur)) horodatage = Number(valeur);
    } else if (cle === "v1") {
      if (valeur !== "") signaturesV1.push(valeur.toLowerCase());
    }
  }

  if (horodatage === null) {
    return { valide: false, motif: "horodatageAbsent", detail: "Aucun horodatage `t` lisible dans l'en-tête." };
  }
  if (signaturesV1.length === 0) {
    // Un en-tête qui ne porte que du `v0` tombe ici, et c'est voulu.
    return { valide: false, motif: "signatureAbsente", detail: "Aucune signature `v1` dans l'en-tête." };
  }

  // LA TOLÉRANCE, DANS LES DEUX SENS.
  //
  // Le passé : c'est la protection contre le rejeu d'un corps
  // authentique capté hier. (Elle double l'idempotence par la base, qui
  // reste la vraie garantie ; ceci écarte simplement le corps ancien
  // avant même de toucher à la base.)
  //
  // L'avenir : un horodatage très en avance ne peut pas venir d'un
  // attaquant — la signature couvre `t`, donc seul Stripe peut le
  // produire. Ce qu'il signale, c'est une HORLOGE FAUSSE, ici ou en
  // face. Et une horloge fausse rend le contrôle du passé inopérant :
  // avec une machine en retard d'une heure, tout rejeu de la dernière
  // heure serait accepté. On préfère donc échouer bruyamment.
  const age = demande.maintenantSecondes - horodatage;
  if (age > tolerance) {
    return {
      valide: false,
      motif: "horodatageHorsTolerance",
      detail: `Événement daté de ${age} s dans le passé, tolérance ${tolerance} s.`,
    };
  }
  if (-age > tolerance) {
    return {
      valide: false,
      motif: "horodatageHorsTolerance",
      detail: `Événement daté de ${-age} s dans l'avenir, tolérance ${tolerance} s : horloge à vérifier.`,
    };
  }

  const attendue = await calculerSignatureHex(demande.corpsBrut, horodatage, demande.secret);

  // COMPARAISON À TEMPS CONSTANT, sur TOUTES les signatures présentes.
  //
  // On ne sort pas de la boucle au premier succès : un `break` rendrait
  // la durée de la réponse dépendante de la position de la bonne
  // signature. C'est une fuite minuscule, mais elle ne coûte rien à
  // fermer, et une comparaison de signature écrite avec `===` est le
  // genre de détail qu'un audit relève à juste titre.
  let concorde = false;
  for (const candidate of signaturesV1) {
    concorde = comparerATempsConstant(attendue, candidate) || concorde;
  }

  if (!concorde) {
    return {
      valide: false,
      motif: "signatureNonConcordante",
      detail: "Aucune signature `v1` ne correspond au corps reçu.",
    };
  }

  return { valide: true, horodatage };
}

/**
 * Compare deux chaînes hexadécimales sans laisser la durée dépendre de
 * l'endroit où elles divergent.
 *
 * La différence de LONGUEUR, elle, se voit : c'est admis et c'est ce que
 * font les bibliothèques de référence — la longueur d'une empreinte
 * SHA-256 n'est pas un secret.
 */
function comparerATempsConstant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i++) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}
