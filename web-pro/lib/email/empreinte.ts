/**
 * §COURRIEL — L'EMPREINTE DU CORPS HTML.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE EMPREINTE ET PAS LE HTML
 * ══════════════════════════════════════════════════════════════════
 *
 * `email_messages` garde la version du gabarit, les variables et
 * l'empreinte du HTML — jamais le HTML lui-même. Avec ces trois-là on
 * peut REFABRIQUER le message et PROUVER que la refabrication est
 * identique, sans stocker des mégaoctets d'habillage pour chaque devis
 * envoyé.
 *
 * La contrainte de la colonne est `~ '^[0-9a-f]{64}$'` : hexadécimal
 * minuscule, soixante-quatre caractères. Une empreinte en majuscules
 * ferait échouer l'insertion, et l'échec arriverait au moment d'envoyer
 * une facture.
 *
 * `crypto.subtle` plutôt que `node:crypto` : ce dossier doit tourner
 * aussi bien dans Next que dans la fonction Edge, qui est du Deno. Le
 * global `crypto` existe dans les deux depuis longtemps.
 */

const ENCODEUR = new TextEncoder();

export async function empreinteSha256(contenu: string): Promise<string> {
  const octets = await crypto.subtle.digest("SHA-256", ENCODEUR.encode(contenu));
  return Array.from(new Uint8Array(octets))
    .map((octet) => octet.toString(16).padStart(2, "0"))
    .join("");
}
