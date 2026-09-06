/**
 * §EMAILS — LE TEXTE DU CONSENTEMENT, DANS SON PROPRE FICHIER.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI IL N'EST PAS DANS `actions.ts`
 * ══════════════════════════════════════════════════════════════════
 *
 * Un fichier « use server » ne peut exporter que des fonctions
 * asynchrones : Next refuse d'y trouver une chaîne, parce que tout ce
 * qu'un tel fichier exporte devient un point d'entrée appelable depuis
 * le navigateur. La règle est bonne, et elle nous oblige ici à faire la
 * bonne chose — sortir la donnée du module d'actions.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE SEULE CHAÎNE, LUE DES DEUX CÔTÉS
 * ══════════════════════════════════════════════════════════════════
 *
 * L'écran l'AFFICHE, et l'action l'ENREGISTRE dans
 * `email_consents.consent_evidence`. Ce doit être la même, mot pour
 * mot : l'article 7-1 du RGPD demande de pouvoir DÉMONTRER que la
 * personne a consenti, ce qui suppose de savoir à QUOI. Recopier le
 * texte dans la preuve plutôt que d'y mettre une référence est la
 * différence entre une preuve et une promesse — une référence vers un
 * texte modifiable devient fausse le jour où le texte change.
 *
 * Si vous modifiez cette phrase, sachez que les consentements déjà
 * enregistrés gardent l'ANCIENNE, et c'est exactement ce qu'on veut.
 */
export const TEXTE_CONSENTEMENT =
  "J'accepte de recevoir par courriel les nouveautés et les offres d'Oasis Care. " +
  "Je peux me désabonner à tout moment, par le lien présent dans chaque message. " +
  "Ce choix ne concerne pas mes documents ni les messages de mon compte, qui continueront de me parvenir.";
