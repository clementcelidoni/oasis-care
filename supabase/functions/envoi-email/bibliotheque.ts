// Oasis Care — Chantier courriel. LE SEUL PONT VERS LA BIBLIOTHÈQUE.
//
// ==================================================================
// UNE LIGNE, ET C'EST TOUT L'INTÉRÊT
// ==================================================================
//
// Les gabarits et le transporteur vivent dans `web-pro/lib/email/`. Ils
// sont écrits SANS aucune dépendance — ni `node:*`, ni React, ni client
// Supabase — précisément pour pouvoir être rendus des deux côtés :
//
//   • côté application, quand le paysagiste envoie un devis ;
//   • côté machine, ici, quand la file d'une campagne se vide.
//
// POURQUOI PAS UNE COPIE. Deux jeux de gabarits, c'est un jour où l'un
// dit encore l'ancien montant, où l'on corrige une faute dans un seul
// des deux, et où personne ne s'en aperçoit puisque personne ne lit
// jamais les deux. Le rendu d'un message doit avoir une seule source,
// comme un document comptable doit avoir un seul gabarit.
//
// SI CE CHEMIN RELATIF POSAIT UN JOUR PROBLÈME AU DÉPLOIEMENT — la CLI
// bundle bien les imports relatifs sortant du dossier de la fonction,
// mais c'est un usage à surveiller — LE CORRECTIF TIENT EN UN GESTE :
// déplacer `web-pro/lib/email/` sous `supabase/functions/_shared/email/`
// et changer cette seule ligne. Aucun autre fichier de la fonction ne
// nomme la bibliothèque, et c'est pour cela que ce fichier existe.

export * from "../../../web-pro/lib/email/index.ts";
