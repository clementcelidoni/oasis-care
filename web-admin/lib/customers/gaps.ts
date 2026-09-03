/**
 * ==================================================================
 * CE QUE LA SPEC DEMANDE ET QUE CET ÉCRAN NE PEUT PAS MONTRER
 * ==================================================================
 *
 * Spec p.4 : « Les KPI doivent être calculés depuis les vraies données.
 * Aucune valeur fictive en production. » Ce fichier est l'application
 * de cette phrase aux fiches : plutôt que d'omettre discrètement les
 * champs qu'on ne sait pas remplir, on les NOMME, et on dit pourquoi.
 *
 * Un champ omis se lit « l'écran est incomplet, sans doute un oubli ».
 * Un champ nommé et expliqué se lit « la plateforme ne mesure pas
 * cela » — et c'est une information exploitable : elle se transforme en
 * décision produit.
 *
 * ------------------------------------------------------------------
 * TROIS CAUSES, QU'IL SERAIT COÛTEUX DE CONFONDRE
 * ------------------------------------------------------------------
 * Elles n'appellent pas le même travail, et une liste qui les
 * mélangerait ferait chiffrer de travers tout ce chapitre.
 *
 *   « absente »      La plateforme n'enregistre RIEN de cela, nulle
 *                    part. Y remédier demande de modifier le produit
 *                    lui-même — une colonne de plus, remplie par
 *                    l'application iPhone ou par l'inscription — puis
 *                    d'attendre que des données s'accumulent. Des
 *                    semaines, et rien de rétroactif : ce qui n'a pas
 *                    été enregistré hier ne le sera jamais.
 *
 *   « non exposée »  La donnée EXISTE en base, et se lit en SQL. Ce qui
 *                    manque est une fonction d'administration qui la
 *                    rende — la migration 0075 n'en a pas écrit pour
 *                    ce champ. Y remédier est une migration, et la
 *                    donnée est disponible immédiatement, y compris
 *                    pour le passé.
 *
 *   « hors jalon »   Ni l'un ni l'autre : le sujet appartient à une
 *                    section que ce jalon ne construit pas (support,
 *                    sécurité). Rien ne manque, rien n'est à écrire.
 *
 * ------------------------------------------------------------------
 * POURQUOI CETTE SECTION N'A PAS ÉCRIT LES FONCTIONS MANQUANTES
 * ------------------------------------------------------------------
 * Trois agents travaillent en parallèle sur ce dépôt et la migration
 * 0075 appartient à l'un d'eux. Ajouter un 0076 depuis ici entrerait en
 * collision avec un fichier qui n'est pas le mien et avec une
 * numérotation que je ne contrôle pas. Les manques « non exposée »
 * sont donc SIGNALÉS, précisément, plutôt que comblés à la hâte : la
 * liste ci-dessous est la commande exacte à passer à la prochaine
 * migration.
 */

export type GapCause = "absente" | "non exposée" | "hors jalon";

export type Gap = {
  /** Le champ, tel que la spec le nomme. */
  label: string;
  cause: GapCause;
  /** Ce qui manque, et où. Une phrase, vérifiable. */
  reason: string;
};

/**
 * La fiche utilisateur (spec p.8), moins ce que
 * `admin_list_users()` rend déjà.
 */
export const USER_GAPS: Gap[] = [
  /*
    TROIS MANQUES ONT DISPARU DE CETTE LISTE, et il faut savoir
    lesquels : « nombre d'appareils », « version de l'application » et
    « plateforme » étaient les trois champs « absente » de la fiche
    p.8. La migration 0077 les a comblés, et ils sont désormais
    AFFICHÉS sur la fiche — dans le panneau « Présence mobile », avec
    leur date de dernière annonce.
  */
  {
    label: "Stockage utilisé",
    cause: "non exposée",
    reason:
      "Les tailles vivent dans storage.objects, mais aucune fonction d'administration ne les agrège par compte. Une migration suffirait — la donnée est là, y compris pour le passé.",
  },
  {
    label: "Consommation IA",
    cause: "non exposée",
    reason:
      "public.usage_counters compte bien les appels par utilisateur, par fonction et par mois. Aucune fonction d'administration ne les rend. Le COÛT, lui, reste absent : aucune table n'enregistre de jetons ni d'euros.",
  },
  {
    label: "Entitlements — le détail",
    cause: "non exposée",
    reason:
      "admin_list_users() ne rend que le forfait mobile le plus élevé. Le détail des droits (subscription_entitlements) existe en base ; il faudrait une fonction pour le lire ligne à ligne.",
  },
  {
    label: "Support ouvert",
    cause: "hors jalon",
    reason:
      "Le support et les tickets ne font pas partie de ce jalon. Aucune table de tickets n'existe encore, et aucun écran ne doit en esquisser une.",
  },
  {
    label: "Événements de sécurité",
    cause: "hors jalon",
    reason:
      "La section Sécurité n'est pas construite par ce jalon. Le journal d'audit de GoTrue (auth.audit_log_entries) est par ailleurs vide sur ce projet.",
  },
];

/**
 * La fiche d'un utilisateur MOBILE (spec p.9), moins ce que la
 * migration 0077 a rendu affichable.
 *
 * Le premier manque de cette liste était longtemps le plus grave : on
 * ne savait même pas dire QUI est un utilisateur mobile. Ce n'est plus
 * le cas. Restent des questions sur le CONTENU d'un compte — combien de
 * jardins, combien de plantes, combien de photos — auxquelles aucune
 * fonction d'administration ne répond, et qui sont d'un tout autre
 * genre : la donnée existe, il faut une migration pour la compter sans
 * jamais la lister (spec p.9).
 */
export const MOBILE_GAPS: Gap[] = [
  {
    label: "Nombre de jardins",
    cause: "non exposée",
    reason:
      "public.gardens se rattache au compte par son espace de travail. Le comptage est immédiat en SQL ; aucune fonction d'administration ne le rend pour un utilisateur.",
  },
  {
    label: "Nombre de plantes",
    cause: "non exposée",
    reason:
      "Même chemin que les jardins, par public.plants. Un NOMBRE, jamais la liste : la spec p.9 l'interdit explicitement.",
  },
  {
    label: "Stockage photos",
    cause: "non exposée",
    reason: "Les tailles sont dans storage.objects ; rien ne les agrège par compte.",
  },
  {
    label: "Dernière activité métier",
    cause: "absente",
    reason:
      "Rien ne date un GESTE — arroser une plante, ouvrir un jardin — par utilisateur. La « dernière annonce » affichée sur la fiche date l'ouverture de l'application, pas ce qu'on y a fait, et la dernière connexion date encore autre chose. Les trois sont affichées sous leur vrai nom, jamais l'une à la place de l'autre.",
  },
  {
    label: "Utilisateurs en mode invité",
    cause: "absente",
    reason:
      "L'application entière s'utilise sans compte, et la synchronisation ne part qu'une fois authentifié : un utilisateur mobile en mode invité n'écrit rien et ne sera jamais compté. Le chiffre « N utilisateurs Mobile » compte donc des COMPTES, pas des personnes — c'est l'une des raisons pour lesquelles il reste une borne inférieure.",
  },
  {
    label: "Version d'iOS complète",
    cause: "absente",
    reason:
      "Seule la version MAJEURE est collectée (26, pas 26.3.1) : la mineure ne change aucune décision de cible de déploiement, et la collecter rendrait l'empreinte plus fine pour rien. C'est un choix de minimisation, pas un oubli.",
  },
];

/**
 * La fiche entreprise (spec p.10-11), moins ce que
 * `admin_list_organizations()` rend déjà.
 *
 * Le premier de ces manques est le plus visible à l'écran : la spec
 * demande la liste des membres avec leur rôle, et c'est la seule chose
 * de cette page qui ne soit pas un nombre.
 */
export const ORGANIZATION_GAPS: Gap[] = [
  {
    label: "Membres — nom, e-mail, rôle, dernière connexion",
    cause: "non exposée",
    reason:
      "admin_list_organizations() rend le NOMBRE de membres et le nombre d'actifs, jamais la liste. Les données existent (organization_members joint à auth.users) ; il manque une fonction d'administration qui les rende, avec sa propre clause de garde.",
  },
  {
    label: "Logo de la société",
    cause: "non exposée",
    reason:
      "La colonne business_organizations.logo_path existe et pointe vers le fichier. La fonction ne la rend pas, et il faudrait en plus signer une URL de lecture côté serveur.",
  },
  {
    label: "Digital twins",
    cause: "non exposée",
    reason:
      "La table digital_twin_revisions existe. La fonction rend les jardins et les plantes de l'espace de travail, qui n'en sont pas le décompte : un comptage dédié reste à écrire.",
  },
  {
    label: "Stockage",
    cause: "non exposée",
    reason: "Comme pour les comptes : storage.objects porte les tailles, rien ne les agrège par entreprise.",
  },
  {
    label: "Modules utilisés — le détail",
    cause: "non exposée",
    reason:
      "La fonction rend le NOMBRE de modules désactivés (business_organizations.disabled_modules), pas lesquels. Le tableau est en base ; il suffirait de le rendre.",
  },
  {
    label: "Abonnement — début, échéance, résiliation",
    cause: "non exposée",
    reason:
      "organization_subscriptions porte started_at, current_period_end et cancelled_at ; la fonction ne rend que le forfait et le statut. La table est de toute façon vide : aucune ligne du dépôt ne l'écrit jamais.",
  },
];

/** Le ton d'affichage d'une cause. Voir `components/ui` pour les valeurs. */
export function gapTone(cause: GapCause): "warning" | "info" | "neutral" {
  switch (cause) {
    // Une donnée absente est le manque coûteux : il faut modifier le
    // produit, et rien ne sera rétroactif.
    case "absente":
      return "warning";
    // Une donnée non exposée est une migration à écrire. C'est une
    // tâche, pas un problème.
    case "non exposée":
      return "info";
    default:
      return "neutral";
  }
}
