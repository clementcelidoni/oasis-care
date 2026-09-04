/**
 * ==================================================================
 * CE QUE L'ÉCRAN DES COÛTS IA NE SAIT PAS, ET POURQUOI
 * ==================================================================
 *
 * La spec p.15 demande neuf chiffres pour l'AI CONTROL CENTER :
 * requêtes du jour, jetons, coût estimé, coût par organisation, par
 * utilisateur, par agent, par modèle, latence, erreurs. Sur les neuf,
 * UN SEUL se calcule aujourd'hui — le nombre de requêtes d'assistant du
 * mois, par organisation.
 *
 * ------------------------------------------------------------------
 * LE MOTIF HISTORIQUE EST PÉRIMÉ, ET LE RECOPIER SERAIT UNE FAUTE
 * ------------------------------------------------------------------
 * `admin_platform_kpis()` rend encore, pour `ai_cost_cents` :
 *
 *     « Aucune table du projet n'enregistre de tokens, de modèle, de
 *       latence ni de coût. » (0075, recopié en 0077)
 *
 * C'EST FAUX DEPUIS LA MIGRATION 0076. `ai_usage_events` porte
 * `input_tokens`, `output_tokens`, `model`, `duration_ms`,
 * `estimated_cost_cents`, `cost_basis`, `success`, `failure_reason`,
 * `user_id` et `agent`. La donnée existe. Le tableau de bord du Control
 * Center continue d'afficher l'ancien motif parce que le corriger
 * demande de toucher `admin_platform_kpis()`, ce qu'aucune migration
 * n'a encore fait.
 *
 * Cet écran-ci écrit donc le motif EXACT, et il est différent : ce n'est
 * pas la donnée qui manque, c'est le CHEMIN DE LECTURE.
 *
 * ------------------------------------------------------------------
 * LE CHEMIN QUI MANQUE, NOMMÉ PRÉCISÉMENT
 * ------------------------------------------------------------------
 * `ai_usage_events` porte une seule politique (0076) :
 *
 *     create policy "Members read ai_usage_events" on public.ai_usage_events
 *       for select using (public.is_organization_member(organization_id));
 *
 * Un administrateur de plateforme n'est membre d'aucune organisation
 * cliente — c'est même toute la séparation de la spec p.32. Il lit donc
 * ZÉRO LIGNE, et une somme sur zéro ligne vaut zéro : c'est exactement
 * le mensonge que cette application refuse partout ailleurs. « 0 € de
 * coût IA » se lirait « l'IA ne coûte rien ».
 *
 * La migration 0080 a ouvert `ai_model_overrides` et `ai_cost_limits` à
 * l'éditeur ; elle n'a pas touché au grand livre, et le dit elle-même
 * en toutes lettres (§ 6).
 *
 * CE QU'IL FAUDRAIT ÉCRIRE, et ce n'est pas une politique de lecture en
 * lignes : la règle R5 de 0075 — « des nombres, pas des lignes » —
 * s'applique ici pour de bon, parce qu'une ligne d'`ai_usage_events`
 * porte un `decision_id` et un `user_id` d'un client. Il faut une
 * fonction `security definer` d'agrégation, sur le modèle exact
 * d'`admin_platform_kpis()` : garde `platform_admin_can('ai.config.read')`
 * en première instruction, `group by` en SQL, et des NOMBRES en retour.
 *
 * ------------------------------------------------------------------
 * ET LES TARIFS ? DEUX INCONNUS DISTINCTS, PAS UN SEUL
 * ------------------------------------------------------------------
 * Même le jour où ce chemin existera, les MONTANTS resteront inconnus
 * tant que les six variables de tarif ne sont pas posées sur le serveur
 * d'Oasis Care Pro : `estimated_cost_cents` est alors écrit à NULL, et
 * `cost_basis` dit pourquoi. Un tableau qui compterait ces appels pour
 * zéro ferait croire que l'IA est gratuite — et il le ferait d'autant
 * plus facilement que le nombre d'appels, lui, serait juste.
 *
 * Les deux inconnus sont donc nommés séparément ci-dessous. Ils ne se
 * corrigent pas au même endroit ni par les mêmes personnes.
 */

/** Les six variables de tarif, sur le serveur d'Oasis Care Pro. */
export const VARIABLES_TARIF = [
  "OASIS_AI_TARIF_ECONOMY_ENTREE_CENTS_PAR_MILLION",
  "OASIS_AI_TARIF_ECONOMY_SORTIE_CENTS_PAR_MILLION",
  "OASIS_AI_TARIF_STANDARD_ENTREE_CENTS_PAR_MILLION",
  "OASIS_AI_TARIF_STANDARD_SORTIE_CENTS_PAR_MILLION",
  "OASIS_AI_TARIF_ADVANCED_ENTREE_CENTS_PAR_MILLION",
  "OASIS_AI_TARIF_ADVANCED_SORTIE_CENTS_PAR_MILLION",
] as const;

/**
 * La phrase commune aux sept chiffres qui attendent le même chemin de
 * lecture. Écrite une fois : sept variantes rédigées à la main
 * divergeraient au premier correctif.
 */
const CHEMIN_MANQUANT =
  "La donnée EXISTE : ai_usage_events l'enregistre depuis la migration 0076. " +
  "Ce qui manque est le chemin de lecture — la table ne porte que « Members read » " +
  "(is_organization_member), et un administrateur de plateforme n'est membre d'aucune " +
  "entreprise cliente : il lit zéro ligne, et une somme sur zéro ligne vaut zéro. " +
  "Il faut une fonction security definer d'agrégation, gardée par " +
  "platform_admin_can('ai.config.read'), qui rende des NOMBRES et non des lignes " +
  "(règle R5 de 0075).";

/**
 * Les motifs, par clé d'indicateur.
 *
 * Même forme que `unknown_reasons` des fonctions de 0075 : la clé est
 * le nom du chiffre, la valeur la phrase affichée. Le jour où un
 * chiffre devient calculable, sa clé disparaît d'ici — et le panneau
 * « ce que cet écran ne sait pas » rétrécit tout seul.
 */
export const MOTIFS_INCONNUS_COUTS: Readonly<Record<string, string>> = Object.freeze({
  cout_total:
    CHEMIN_MANQUANT +
    " ET, une fois ce chemin ouvert, les montants resteront inconnus tant que les six " +
    "variables OASIS_AI_TARIF_… ne sont pas posées sur le serveur d'Oasis Care Pro : " +
    "estimated_cost_cents est alors écrit à NULL, et compter ces appels pour zéro ferait " +
    "croire que l'IA est gratuite.",
  jetons: CHEMIN_MANQUANT,
  cout_par_organisation: CHEMIN_MANQUANT,
  cout_par_agent: CHEMIN_MANQUANT,
  cout_par_modele: CHEMIN_MANQUANT,
  cout_par_utilisateur: CHEMIN_MANQUANT,
  latence: CHEMIN_MANQUANT,
  erreurs: CHEMIN_MANQUANT,
  ratio_niveaux:
    "Le ratio réel 15 / 80 / 5 (spec p.17) se calcule en groupant ai_usage_events par " +
    "modèle, puis en ramenant chaque identifiant à son niveau. " +
    CHEMIN_MANQUANT,
  requetes_du_jour:
    "ai_pro_usage et usage_counters sont indexés par période MENSUELLE (AAAA-MM). Il " +
    "n'existe aucun seau journalier, et le compteur étant cumulatif sans instantané " +
    "quotidien, on ne peut même pas soustraire. Le chiffre du mois, lui, est exact.",
  revenu_abonnement:
    "Aucun abonnement n'est enregistré : organization_subscriptions est vide et aucune " +
    "ligne de code du dépôt ne l'écrit, et les forfaits Pro ont monthly_price_cents à " +
    "NULL. Le revenu d'une entreprise est donc inconnu — pas nul.",
});

/**
 * L'alerte de rentabilité de la spec p.17 : « Coût IA ce mois 168 € /
 * revenu abonnement 149 € → ratio non rentable. »
 *
 * ------------------------------------------------------------------
 * ELLE NE PEUT PAS ÊTRE CALCULÉE, ET LES DEUX TERMES MANQUENT
 * ------------------------------------------------------------------
 * C'est la fonction qui justifie tout cet écran, et c'est la seule
 * qu'on ne puisse pas approcher : ni le numérateur (le coût, faute de
 * chemin de lecture) ni le dénominateur (le revenu, faute d'abonnement
 * enregistré) n'existent.
 *
 * Un ratio calculé avec un seul terme connu, ou avec un zéro à la place
 * d'un inconnu, désignerait des entreprises « non rentables » au hasard
 * — et l'écran servirait alors exactement à l'inverse de ce pour quoi
 * il est demandé. On l'affiche donc en INCONNU, avec les deux motifs.
 */
export const MOTIF_ALERTE_RENTABILITE =
  "Les DEUX termes du ratio manquent, et pour des raisons différentes. " +
  "Le coût IA du mois : " +
  MOTIFS_INCONNUS_COUTS.cout_total +
  " Le revenu d'abonnement : " +
  MOTIFS_INCONNUS_COUTS.revenu_abonnement +
  " Tant qu'il en manque un seul, aucune entreprise ne peut être déclarée non rentable : " +
  "un ratio calculé avec un zéro à la place d'un inconnu accuserait au hasard.";

/** Les libellés lisibles, pour le panneau récapitulatif des inconnus. */
export const LIBELLES_INCONNUS_COUTS: Readonly<Record<string, string>> = Object.freeze({
  cout_total: "Coût IA du mois, toutes organisations",
  jetons: "Jetons consommés (entrée / sortie)",
  requetes_du_jour: "Requêtes IA du jour",
  cout_par_organisation: "Coût par organisation",
  cout_par_agent: "Coût, exécutions et taux de succès par agent",
  cout_par_modele: "Coût par modèle",
  cout_par_utilisateur: "Coût par utilisateur",
  latence: "Latence moyenne",
  erreurs: "Appels en échec, et leur motif",
  ratio_niveaux: "Ratio réel des trois niveaux, comparé à la cible 15 / 80 / 5",
  revenu_abonnement: "Revenu d'abonnement d'une organisation",
});
