"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { lireMontantEuros } from "@/lib/ia/montants";

import {
  lireEntier,
  lireMotif,
  lireTexte,
  lireUuid,
  messageDeLErreur,
  type EtatFormulaire,
} from "./formulaire.ts";
import { phraseDeRefus, type PermissionCommerciale } from "./permissions.ts";

/**
 * ==================================================================
 * LES ÉCRITURES COMMERCIALES DU CONTROL CENTER
 * ==================================================================
 *
 * AUCUNE N'ÉCRIT DANS UNE TABLE. Pas une. Après 0081,
 * `organization_plans`, `plan_modules`, `organization_subscriptions`,
 * `saas_invoices` et leurs voisines n'ont plus AUCUNE politique
 * d'écriture — pour personne, administrateur de plateforme compris — et
 * `authenticated` a perdu ses droits `insert/update/delete` dessus. Le
 * seul chemin est une fonction `security definer` qui, dans cet ordre :
 *
 *   1. refait le contrôle de permission en SQL ;
 *   2. exige une session vérifiée en second facteur si la politique
 *      l'impose (`platform_admin_require_mfa()`) ;
 *   3. refuse un motif vide ;
 *   4. relève l'ancienne valeur, écrit la nouvelle, et JOURNALISE dans
 *      la même transaction.
 *
 * La trace n'est donc pas un effet de bord : c'est la valeur de retour.
 * Si `record_admin_event()` refuse, l'écriture est annulée avec elle —
 * il n'existe pas d'état « changé mais non tracé ». Ce fichier n'a rien
 * à journaliser lui-même, et ne doit surtout pas essayer : une seconde
 * ligne écrite depuis TypeScript pourrait manquer là où la première ne
 * peut pas.
 *
 * ------------------------------------------------------------------
 * TROIS BARRIÈRES, ET AUCUNE NE SUPPOSE QUE LES AUTRES ONT TENU
 * ------------------------------------------------------------------
 *   1. `requireAdmin()` — une Server Action ne passe PAS par le layout.
 *      Sans cet appel, elle serait la seule porte du Control Center
 *      laissée ouverte : une Server Action est une URL.
 *   2. `refus()` ici, qui rend un MESSAGE plutôt qu'une redirection —
 *      dans un formulaire, une redirection perd la saisie et n'explique
 *      rien.
 *   3. `platform_admin_can(…)` dans la fonction SQL, la seule barrière
 *      qu'aucun remaniement de ce fichier ne peut déplacer.
 *
 * ------------------------------------------------------------------
 * ET CE QU'ON NE TROUVERA PAS ICI
 * ------------------------------------------------------------------
 * Aucun appel à un prestataire de paiement, aucune clé, aucun webhook,
 * aucun bouton « payer en ligne ». Le prestataire arrive au chantier
 * suivant ; `web-pro/lib/billing/` porte déjà l'abstraction dont
 * « unavailable » est l'état normal. Un bouton qui promet un paiement
 * impossible est pire qu'un bouton absent.
 *
 * Et rien pour Apple. Le canal mobile est encaissé, facturé et
 * remboursé par Apple : en construire une seconde facture serait
 * facturer deux fois.
 */

// ------------------------------------------------------------------
// Le socle commun
// ------------------------------------------------------------------

/**
 * Identité, second facteur, puis permission.
 *
 * Rend l'erreur au lieu de la lever : une action de formulaire doit
 * pouvoir répondre « voilà pourquoi » sans faire disparaître la page.
 */
async function autoriser(
  permission: PermissionCommerciale,
): Promise<{ ok: true } | { ok: false; etat: EtatFormulaire }> {
  const admin = await requireAdmin();
  if (!admin.permissions.includes(permission)) {
    return { ok: false, etat: { statut: "erreur", message: phraseDeRefus(admin.role, permission) } };
  }
  return { ok: true };
}

function erreur(message: string): EtatFormulaire {
  return { statut: "erreur", message };
}

function succes(message: string): EtatFormulaire {
  return { statut: "ok", message };
}

/**
 * Un prix saisi en euros, rendu en centimes — ou `null`, ou refusé.
 *
 * On réutilise `lireMontantEuros` de `lib/ia/montants.ts` plutôt que
 * d'en écrire une seconde : son nom parle de plafonds par accident
 * d'histoire, ce qu'elle fait est lire un montant en euros à la
 * française — virgule, espaces insécables des tableurs, symbole final —
 * et surtout REFUSER ce qu'elle ne comprend pas au lieu de rendre zéro.
 * Une deuxième lecture d'argent dans le même dépôt divergerait au
 * premier correctif, et l'une des deux ramènerait une frappe malheureuse
 * à zéro. Sur un prix d'abonnement, zéro est un cadeau permanent.
 */
function lirePrix(
  formData: FormData,
  champ: string,
  libelle: string,
): { ok: true; cents: number | null } | { ok: false; message: string } {
  const brut = formData.get(champ);
  const lecture = lireMontantEuros(typeof brut === "string" ? brut : null);
  if (lecture.etat === "illisible") return { ok: false, message: `${libelle} — ${lecture.raison}` };
  return { ok: true, cents: lecture.etat === "aucune" ? null : lecture.cents };
}

function lireEntierChamp(
  formData: FormData,
  champ: string,
  libelle: string,
  max?: number,
): { ok: true; valeur: number | null } | { ok: false; message: string } {
  const brut = formData.get(champ);
  const lecture = lireEntier(typeof brut === "string" ? brut : null, { max });
  if (lecture.etat === "illisible") return { ok: false, message: `${libelle} — ${lecture.raison}` };
  return { ok: true, valeur: lecture.etat === "aucun" ? null : lecture.valeur };
}

// ==================================================================
// 1. LA GRILLE
// ==================================================================

/**
 * Poser ou changer le prix d'une offre.
 *
 * CE GESTE EST LE PLUS CONSÉQUENT DU LOT, et pas seulement parce qu'il
 * touche à l'argent :
 *
 *   • `web-pro` lit `organization_plans` et l'affiche aux entreprises
 *     clientes (`lib/billing/provider.ts`, filtre `is_active`). Écrire
 *     un prix ici change, à la seconde, ce qu'une entreprise Pro voit
 *     sur son écran d'abonnement.
 *   • Le MRR et l'ARR du tableau de bord sont rendus INCONNUS par 0075
 *     tant qu'« au moins un forfait actif n'a pas de prix ». Poser les
 *     prix les rallume.
 *
 * CE QU'IL NE CHANGE PAS, ET IL FALLAIT LE VÉRIFIER : les factures déjà
 * émises. Une ligne de facture est une LIGNE — `saas_invoice_lines`
 * porte sa propre `description` et son propre `unit_price_cents`, et le
 * total se calcule sur ces lignes. Aucune jointure vers
 * `organization_plans` n'intervient après la génération. Un prix changé
 * aujourd'hui ne remonte donc dans aucune facture d'hier, pas même dans
 * un brouillon : le brouillon a déjà ses lignes.
 *
 * LES QUATRE PARAMÈTRES FACULTATIFS ont, en SQL, la sémantique « ne
 * touche pas » quand ils sont nuls (`coalesce(p_x, x)`). L'écran doit
 * l'épouser exactement : un champ laissé vide ne VIDE pas le quota IA,
 * il le laisse tel quel. C'est la sémantique inverse de celle des
 * plafonds IA, et c'est écrit sur le formulaire.
 */
export async function enregistrerTarif(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.plans.write");
  if (!droit.ok) return droit.etat;

  const cle = lireTexte(formData, "planKey");
  if (cle === null) return erreur("Offre absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur(
      "Motif obligatoire : un prix change ce que paient toutes les entreprises abonnées à cette offre, " +
        "et ce que voient celles qui hésitent.",
    );
  }

  const mensuel = lirePrix(formData, "prixMensuel", "Prix mensuel");
  if (!mensuel.ok) return erreur(mensuel.message);
  const annuel = lirePrix(formData, "prixAnnuel", "Prix annuel");
  if (!annuel.ok) return erreur(annuel.message);
  const siege = lirePrix(formData, "prixSiege", "Siège supplémentaire");
  if (!siege.ok) return erreur(siege.message);

  const sieges = lireEntierChamp(formData, "siegesInclus", "Sièges compris", 10_000);
  if (!sieges.ok) return erreur(sieges.message);
  const quota = lireEntierChamp(formData, "quotaIa", "Quota IA mensuel", 10_000_000);
  if (!quota.ok) return erreur(quota.message);
  const stockage = lireEntierChamp(formData, "stockageGo", "Stockage (Go)", 1_000_000);
  if (!stockage.ok) return erreur(stockage.message);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_plan_pricing", {
    p_plan_key: cle,
    p_monthly_price_cents: mensuel.cents,
    p_yearly_price_cents: annuel.cents,
    p_reason: motif,
    p_included_seats: sieges.valeur,
    p_extra_seat_monthly_price_cents: siege.cents,
    p_ai_monthly_quota: quota.valeur,
    p_storage_gb: stockage.valeur,
  });

  if (error) return erreur(messageDeLErreur("Enregistrer le tarif", error));

  revalidatePath("/plans");
  revalidatePath("/abonnements");

  return succes(
    "Tarif enregistré et journalisé. Ce prix est immédiatement celui que voient les entreprises Pro " +
      "sur leur écran d'abonnement ; les factures déjà produites gardent le leur.",
  );
}

/**
 * Décider une case de la matrice offre × module.
 *
 * LA CASE EST LA SEULE SOURCE DU PRIX D'UN MODULE. Un module compris
 * dans une offre coûte zéro ; le même module en option sur une autre
 * coûte ce que dit sa case. C'est ce qui fait qu'une entreprise Pro qui
 * paie BioLab 20 € et passe à Pro Business cesse d'être facturée pour
 * ce module SANS QU'AUCUN GESTE NE SOIT NÉCESSAIRE — la ligne
 * d'abonnement ne porte aucun prix, il n'y a donc rien à réévaluer.
 *
 * Et si la nouvelle offre ne sait pas accueillir un module déjà
 * souscrit, le changement d'offre est REFUSÉ par un déclencheur, plutôt
 * que de laisser une entreprise avec un module qu'on ne sait ni
 * facturer, ni retirer, ni expliquer.
 */
export async function enregistrerCase(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.plans.write");
  if (!droit.ok) return droit.etat;

  const offre = lireTexte(formData, "planKey");
  const brique = lireTexte(formData, "moduleKey");
  const disponibilite = lireTexte(formData, "disponibilite");
  if (offre === null || brique === null || disponibilite === null) {
    return erreur("Offre, module ou état absent du formulaire.");
  }

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur(
      "Motif obligatoire : décider qu'un module est compris ou payant, c'est décider d'un revenu.",
    );
  }

  const mensuel = lirePrix(formData, "prixMensuel", "Prix mensuel du module");
  if (!mensuel.ok) return erreur(mensuel.message);
  const annuel = lirePrix(formData, "prixAnnuel", "Prix annuel du module");
  if (!annuel.ok) return erreur(annuel.message);

  // La base refuse déjà « en option sans prix » par une contrainte de
  // table. On le dit ici pour que le message soit lisible : la
  // contrainte, elle, parlerait de `plan_modules_optional_has_a_price`.
  if (disponibilite === "optional" && mensuel.cents === null && annuel.cents === null) {
    return erreur(
      "« En option » sans prix serait invendable : indiquez au moins le prix mensuel, " +
        "ou choisissez un autre état pour cette case.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_plan_module", {
    p_plan_key: offre,
    p_module_key: brique,
    p_availability: disponibilite,
    p_monthly_price_cents: mensuel.cents,
    p_yearly_price_cents: annuel.cents,
    p_reason: motif,
    p_metered_unit_price_cents: null,
  });

  if (error) return erreur(messageDeLErreur("Enregistrer la case", error));

  revalidatePath("/plans");
  revalidatePath("/abonnements");
  return succes("Case enregistrée et journalisée.");
}

// ==================================================================
// 2. LES ABONNEMENTS
// ==================================================================

/**
 * CRÉER un abonnement — le geste que la spec ne nomme pas et sans lequel
 * les sept autres n'auraient rien à administrer.
 *
 * `provider` vaut 'manual' en base, et c'est la vérité : aucun
 * encaissement n'est branché, c'est un administrateur qui a saisi cette
 * ligne. Écrire 'web' laisserait croire à un paiement en ligne qui
 * n'existe pas.
 */
export async function creerAbonnement(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) return erreur("Entreprise absente ou mal formée dans le formulaire.");

  const plan = lireTexte(formData, "plan");
  const cycle = lireTexte(formData, "cycle");
  if (plan === null || cycle === null) return erreur("Offre ou cycle absent du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : un abonnement créé à la main engage une facturation.");
  }

  const statut = lireTexte(formData, "statut") ?? "trialing";
  const jours = lireEntierChamp(formData, "joursEssai", "Jours d'essai", 365);
  if (!jours.ok) return erreur(jours.message);

  const negocieMensuel = lirePrix(formData, "negocieMensuel", "Prix mensuel négocié");
  if (!negocieMensuel.ok) return erreur(negocieMensuel.message);
  const negocieAnnuel = lirePrix(formData, "negocieAnnuel", "Prix annuel négocié");
  if (!negocieAnnuel.ok) return erreur(negocieAnnuel.message);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_subscription", {
    p_organization_id: organizationId,
    p_plan: plan,
    p_billing_cycle: cycle,
    p_reason: motif,
    p_status: statut,
    p_trial_days: jours.valeur,
    p_negotiated_monthly_price_cents: negocieMensuel.cents,
    p_negotiated_yearly_price_cents: negocieAnnuel.cents,
  });

  if (error) return erreur(messageDeLErreur("Créer l'abonnement", error));

  revalidatePath("/abonnements");
  revalidatePath(`/abonnements/${organizationId}`);
  return succes("Abonnement créé et journalisé. Aucun encaissement n'y est associé : rien ne le facture tant qu'une facture n'est pas produite.");
}

export async function changerOffre(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  const plan = lireTexte(formData, "plan");
  if (organizationId === null || plan === null) return erreur("Entreprise ou offre absente.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : un changement d'offre change ce que l'entreprise paie.");
  }

  const cycle = lireTexte(formData, "cycle");
  const negocieMensuel = lirePrix(formData, "negocieMensuel", "Prix mensuel négocié");
  if (!negocieMensuel.ok) return erreur(negocieMensuel.message);
  const negocieAnnuel = lirePrix(formData, "negocieAnnuel", "Prix annuel négocié");
  if (!negocieAnnuel.ok) return erreur(negocieAnnuel.message);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_subscription_plan", {
    p_organization_id: organizationId,
    p_plan: plan,
    p_reason: motif,
    p_billing_cycle: cycle,
    p_negotiated_monthly_price_cents: negocieMensuel.cents,
    p_negotiated_yearly_price_cents: negocieAnnuel.cents,
  });

  if (error) return erreur(messageDeLErreur("Changer d'offre", error));

  revalidatePath("/abonnements");
  revalidatePath(`/abonnements/${organizationId}`);
  return succes(
    "Offre changée et journalisée. Les modules souscrits sont désormais tarifés par la case de la NOUVELLE offre : " +
      "un module qu'elle comprend cesse d'être facturé, sans autre geste.",
  );
}

export async function prolongerEssai(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) return erreur("Entreprise absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : offrir des jours d'essai, c'est offrir du chiffre d'affaires.");
  }

  const jours = lireEntierChamp(formData, "jours", "Jours", 365);
  if (!jours.ok) return erreur(jours.message);
  if (jours.valeur === null || jours.valeur < 1) return erreur("Indiquez un nombre de jours entre 1 et 365.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_extend_trial", {
    p_organization_id: organizationId,
    p_days: jours.valeur,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Prolonger l'essai", error));

  revalidatePath(`/abonnements/${organizationId}`);
  return succes(
    `Essai prolongé de ${jours.valeur} jour(s) et journalisé. La prolongation part de la fin d'essai existante ` +
      "quand elle est encore devant : deux prolongations le même jour ne s'écrasent pas.",
  );
}

/**
 * LES SIÈGES FACTURÉS EN PLUS, saisis à la main.
 *
 * Le prix du siège supplémentaire est semé sur les quatre offres et
 * publié sur la grille ; sans ce geste, rien ne permettait de
 * l'appliquer à personne. Le nombre saisi est l'EXCÉDENT au-delà des
 * sièges compris dans l'offre, et il n'est pas déduit du nombre de
 * membres : tant que `included_seats` n'est pas tranché, un comptage
 * automatique facturerait faux.
 */
export async function fixerSiegesFactures(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) return erreur("Entreprise absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : un siège facturé en plus est une ligne de facture.");
  }

  const sieges = lireEntierChamp(formData, "sieges", "Sièges supplémentaires", 10000);
  if (!sieges.ok) return erreur(sieges.message);
  if (sieges.valeur === null || sieges.valeur < 0) {
    return erreur("Indiquez un nombre de sièges supplémentaires entre 0 et 10000 — 0 pour n'en facturer aucun.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_billable_seats", {
    p_organization_id: organizationId,
    p_seats: sieges.valeur,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Fixer les sièges facturés", error));

  revalidatePath(`/abonnements/${organizationId}`);
  return succes(
    sieges.valeur === 0
      ? "Aucun siège supplémentaire ne sera facturé. Le geste est journalisé."
      : `${sieges.valeur} siège(s) supplémentaire(s) seront facturés à chaque période, au prix de l'offre. ` +
          "Le geste est journalisé, et le montant apparaîtra sur la prochaine facture générée.",
  );
}

export async function accorderCredit(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) return erreur("Entreprise absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : un crédit est de l'argent rendu, et il se justifie.");
  }

  const montant = lirePrix(formData, "montant", "Montant du crédit");
  if (!montant.ok) return erreur(montant.message);
  if (montant.cents === null || montant.cents <= 0) {
    return erreur("Un crédit se compte en euros strictement positifs.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_grant_credit", {
    p_organization_id: organizationId,
    p_amount_cents: montant.cents,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Accorder le crédit", error));

  revalidatePath(`/abonnements/${organizationId}`);
  return succes(
    "Crédit accordé et journalisé. Il sera consommé automatiquement, une seule fois, sur la prochaine facture générée.",
  );
}

/**
 * Activer ou retirer un module — les gestes 4 et 5 de la spec p.13.
 *
 * La spec dit « activer entitlement / désactiver entitlement ». Côté
 * Pro, un entitlement EST un module : c'est ce qui s'achète et ce qui
 * se facture, et la couche existante est `plan_modules` +
 * `organization_subscription_modules`. On n'en crée pas une troisième.
 *
 * Côté MOBILE, les entitlements viennent d'Apple
 * (`subscription_entitlements`, alimentée par le webhook) et ne
 * s'administrent pas ici : les toucher à la main désynchroniserait le
 * droit de ce qu'Apple a réellement encaissé.
 */
export async function basculerModule(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  const brique = lireTexte(formData, "moduleKey");
  if (organizationId === null || brique === null) return erreur("Entreprise ou module absent.");

  const motif = lireMotif(formData);
  if (motif === null) return erreur("Motif obligatoire.");

  const actif = formData.get("actif") === "1";

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_subscription_module", {
    p_organization_id: organizationId,
    p_module_key: brique,
    p_active: actif,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur(actif ? "Activer le module" : "Retirer le module", error));

  revalidatePath(`/abonnements/${organizationId}`);
  return succes(actif ? "Module activé et journalisé." : "Module retiré et journalisé.");
}

export async function annulerALEcheance(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) return erreur("Entreprise absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur(
      "Motif obligatoire : savoir POURQUOI un client part est la donnée la plus utile de cette table.",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_cancel_subscription_at_period_end", {
    p_organization_id: organizationId,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Annuler à l'échéance", error));

  revalidatePath("/abonnements");
  revalidatePath(`/abonnements/${organizationId}`);
  return succes(
    "Annulation enregistrée et journalisée. Le statut reste « actif » : le client a payé sa période et en garde l'usage " +
      "jusqu'à l'échéance. C'est le sens même de « à l'échéance ».",
  );
}

export async function reactiverAbonnement(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.subscriptions.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) return erreur("Entreprise absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) return erreur("Motif obligatoire.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reactivate_subscription", {
    p_organization_id: organizationId,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Réactiver l'abonnement", error));

  revalidatePath("/abonnements");
  revalidatePath(`/abonnements/${organizationId}`);
  return succes("Abonnement réactivé et journalisé.");
}

/**
 * Appliquer une remise DATÉE.
 *
 * La date de fin n'est pas saisie : elle est CALCULÉE à partir de la
 * durée de l'offre de remise. C'est la durée qui est promise — « 29,90 €
 * pendant douze mois » — et une date de fin saisie à la main serait la
 * première à dériver. `ends_on` est `not null` en base : l'à-vie est
 * littéralement inenregistrable, et c'est une décision du dirigeant
 * traduite en schéma plutôt qu'en politesse d'interface.
 */
export async function appliquerRemiseAuClient(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.plans.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  const code = lireTexte(formData, "code");
  if (organizationId === null || code === null) return erreur("Entreprise ou code de remise absent.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : une remise est un revenu auquel on renonce.");
  }

  const debut = lireTexte(formData, "debut");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_apply_discount", {
    p_organization_id: organizationId,
    p_code: code,
    p_reason: motif,
    p_starts_on: debut,
  });

  if (error) return erreur(messageDeLErreur("Appliquer la remise", error));

  revalidatePath(`/abonnements/${organizationId}`);
  return succes(
    "Remise appliquée et journalisée. Sa date de fin est calculée depuis la durée de l'offre, et elle est visible du client.",
  );
}

// ==================================================================
// 3. LES FACTURES SaaS
// ==================================================================

/**
 * Générer les factures d'une période.
 *
 * PAS DE DOUBLON, ET CE N'EST PAS LA FONCTION QUI LE PROMET : c'est un
 * index unique partiel, `saas_invoices_one_per_period_idx`, qui interdit
 * une seconde facture non annulée pour le même couple (entreprise,
 * période). L'écran le dit — sans quoi personne n'ose relancer, et un
 * mois manquant reste manquant.
 *
 * MAIS « SANS DANGER » ÉTAIT UNE DEMI-VÉRITÉ. C'était vrai des
 * DOUBLONS et faux du CONTENU : un brouillon gardait les prix du jour
 * où il avait été produit, et c'est lui qu'on émettait après un
 * changement d'offre. La base RECALCULE désormais les brouillons —
 * `outcome = 'refreshed'` — et ne touche jamais une facture émise. Le
 * compte rendu ci-dessous distingue les deux, sans quoi « déjà
 * facturé » laisserait croire que rien n'a bougé.
 *
 * PAR DÉFAUT DES BROUILLONS. Un document opposable ne part pas sans
 * qu'un humain l'ait regardé au moins la première fois. Émettre d'un
 * coup reste possible, et la fonction n'émet alors QUE ce que rien ne
 * bloque.
 */
export async function genererFactures(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.invoices.write");
  if (!droit.ok) return droit.etat;

  const cycle = lireTexte(formData, "cycle");
  const debut = lireTexte(formData, "debut");
  const fin = lireTexte(formData, "fin");
  if (cycle === null || debut === null || fin === null) {
    return erreur("Cycle ou période absent du formulaire.");
  }

  const motif = lireMotif(formData);
  if (motif === null) return erreur("Motif obligatoire.");

  const emettre = formData.get("emettre") === "1";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("saas_generate_invoices", {
    p_billing_cycle: cycle,
    p_period_start: debut,
    p_period_end: fin,
    p_reason: motif,
    p_issue: emettre,
  });

  if (error) return erreur(messageDeLErreur("Générer les factures", error));

  const resultats = Array.isArray(data)
    ? (data as { outcome: string; blocking_reason: string | null }[])
    : [];

  revalidatePath("/abonnements/factures");

  if (resultats.length === 0) {
    return succes(
      "Aucun abonnement à facturer sur cette période et ce cycle. " +
        "Seuls les abonnements « actif » et « impayé » sont facturés — un essai ne l'est pas, c'est le sens d'un essai.",
    );
  }

  const compte = (etat: string) => resultats.filter((r) => r.outcome === etat).length;
  const bloques = resultats.filter((r) => r.blocking_reason !== null).length;

  const morceaux = [
    `${resultats.length} abonnement(s) parcouru(s)`,
    `${compte("draft")} brouillon(s) créé(s)`,
    // « refreshed » : le brouillon existait et vient d'être REFAIT sur
    // l'abonnement d'aujourd'hui. Le confondre avec « déjà facturé »
    // ferait croire que rien n'a bougé, alors que les montants viennent
    // peut-être de changer.
    `${compte("refreshed")} brouillon(s) recalculé(s)`,
    `${compte("issued")} émise(s)`,
    `${compte("alreadyBilled")} déjà émise(s), intouchées`,
    `${compte("blocked")} bloqué(s) à l'émission`,
  ];

  return succes(
    `${morceaux.join(" · ")}.` +
      (bloques > 0
        ? ` ${bloques} facture(s) portent un motif de blocage : ouvrez-les, le motif est écrit en face de la ligne fautive.`
        : ""),
  );
}

export async function emettreFacture(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.invoices.write");
  if (!droit.ok) return droit.etat;

  const invoiceId = lireUuid(formData, "invoiceId");
  if (invoiceId === null) return erreur("Facture absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : émettre une facture, c'est produire un document opposable.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("saas_issue_invoice", {
    p_invoice_id: invoiceId,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Émettre la facture", error));

  revalidatePath("/abonnements/factures");
  revalidatePath(`/abonnements/factures/${invoiceId}`);

  return succes(
    `Facture émise sous le numéro ${typeof data === "string" ? data : "attribué"} et journalisée. ` +
      "Elle ne se modifie plus : une correction passe désormais par un avoir.",
  );
}

export async function enregistrerEncaissement(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.invoices.write");
  if (!droit.ok) return droit.etat;

  const invoiceId = lireUuid(formData, "invoiceId");
  if (invoiceId === null) return erreur("Facture absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) return erreur("Motif obligatoire : un encaissement saisi à la main se relit.");

  const montant = lirePrix(formData, "montant", "Montant encaissé");
  if (!montant.ok) return erreur(montant.message);
  if (montant.cents === null || montant.cents <= 0) {
    return erreur("Un encaissement se compte en euros strictement positifs.");
  }

  const moyen = lireTexte(formData, "moyen") ?? "transfer";
  const recuLe = lireTexte(formData, "recuLe");
  const reference = lireTexte(formData, "reference");
  const note = lireTexte(formData, "note");

  const supabase = await createClient();
  const { error } = await supabase.rpc("saas_record_invoice_payment", {
    p_invoice_id: invoiceId,
    p_amount_cents: montant.cents,
    p_received_on: recuLe,
    p_method: moyen,
    p_reason: motif,
    p_note: note,
    p_external_reference: reference,
  });

  if (error) return erreur(messageDeLErreur("Enregistrer l'encaissement", error));

  revalidatePath("/abonnements/factures");
  revalidatePath(`/abonnements/factures/${invoiceId}`);
  return succes(
    "Encaissement enregistré et journalisé. Le statut de la facture suit l'argent : il est recalculé depuis le solde, jamais saisi.",
  );
}

/**
 * Annuler un BROUILLON. Une facture émise ne s'annule pas.
 *
 * Elle garde son numéro — un trou dans la séquence est un défaut grave —
 * et se corrige par un avoir. Le bouton correspondant n'existe donc pas
 * sur une facture émise, et l'écran explique pourquoi plutôt que de
 * laisser chercher.
 */
export async function annulerBrouillon(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.invoices.write");
  if (!droit.ok) return droit.etat;

  const invoiceId = lireUuid(formData, "invoiceId");
  if (invoiceId === null) return erreur("Facture absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) return erreur("Motif obligatoire.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("saas_cancel_invoice", {
    p_invoice_id: invoiceId,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Annuler le brouillon", error));

  revalidatePath("/abonnements/factures");
  revalidatePath(`/abonnements/factures/${invoiceId}`);
  return succes(
    "Brouillon annulé et journalisé. Aucun numéro n'a été consommé : la séquence reste sans trou, et la période peut être régénérée.",
  );
}

export async function crediterFacture(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.invoices.write");
  if (!droit.ok) return droit.etat;

  const invoiceId = lireUuid(formData, "invoiceId");
  if (invoiceId === null) return erreur("Facture absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : un avoir dit ce qu'on corrige, et c'est ce que lira le comptable.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("saas_credit_invoice", {
    p_invoice_id: invoiceId,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Émettre l'avoir", error));

  revalidatePath("/abonnements/factures");
  revalidatePath(`/abonnements/factures/${invoiceId}`);
  return succes(
    `Avoir ${typeof data === "string" ? data : ""} émis et journalisé. La facture garde son numéro et reste au dossier : c'est l'avoir qui la neutralise.`,
  );
}

/**
 * L'identité légale de l'ÉMETTEUR — Oasis Care lui-même.
 *
 * ELLE N'EST NULLE PART AILLEURS DANS LA BASE : `business_organizations`
 * décrit les CLIENTS. Tant que ces champs manquent, AUCUNE facture ne
 * peut partir, et c'est la base qui le refuse, pas l'écran.
 *
 * `billing.issuer.write` n'appartient qu'au super-administrateur : un
 * SIRET ou un IBAN changé par erreur ne se rattrape pas sur une facture
 * déjà partie.
 *
 * LES CHAMPS SONT ENVOYÉS EN `jsonb`, et seuls ceux qui sont PRÉSENTS
 * dans l'objet sont écrits — un champ absent n'efface rien. On
 * n'envoie donc que ce que le formulaire porte réellement.
 */
export async function enregistrerEmetteur(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.issuer.write");
  if (!droit.ok) return droit.etat;

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur(
      "Motif obligatoire : ces mentions sont ce qui rend une facture opposable, et elles se relisent.",
    );
  }

  const champsTexte = [
    "legal_name",
    "legal_form",
    "siret",
    "siren",
    "vat_number",
    "rcs_city",
    "address_line1",
    "address_line2",
    "postal_code",
    "city",
    "country",
    "email",
    "phone",
    "website",
    "iban",
    "bic",
    "bank_name",
    "late_penalty_terms",
    "invoice_footer",
  ] as const;

  const fields: Record<string, unknown> = {};
  for (const champ of champsTexte) {
    const valeur = lireTexte(formData, champ);
    if (valeur !== null) fields[champ] = valeur;
  }

  const capital = lirePrix(formData, "share_capital", "Capital social");
  if (!capital.ok) return erreur(capital.message);
  if (capital.cents !== null) fields.share_capital_cents = capital.cents;

  const indemnite = lirePrix(formData, "recovery_indemnity", "Indemnité de recouvrement");
  if (!indemnite.ok) return erreur(indemnite.message);
  if (indemnite.cents !== null) fields.recovery_indemnity_cents = indemnite.cents;

  const delai = lireEntierChamp(formData, "payment_terms_days", "Délai de paiement", 120);
  if (!delai.ok) return erreur(delai.message);
  if (delai.valeur !== null) fields.payment_terms_days = delai.valeur;

  if (Object.keys(fields).length === 0) {
    return erreur("Aucun champ renseigné : il n'y a rien à enregistrer.");
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_billing_issuer", {
    p_fields: fields,
    p_reason: motif,
  });

  if (error) return erreur(messageDeLErreur("Enregistrer l'identité de l'émetteur", error));

  revalidatePath("/abonnements/factures");
  return succes("Identité de l'émetteur enregistrée et journalisée.");
}

/**
 * Déclarer le régime de TVA d'un client.
 *
 * C'EST LE GESTE QUI DÉBLOQUE UNE ÉMISSION, et il faut savoir ce qu'on
 * déclare : dire qu'un numéro de TVA intracommunautaire est VALIDÉ fait
 * passer la facture en autoliquidation, donc à 0 %. Si le numéro n'était
 * pas valide, Oasis Care reste redevable de la TVA. D'où la source de
 * validation obligatoire — VIES, contrôle manuel, ou document — et le
 * motif.
 */
export async function enregistrerRegimeClient(
  _precedent: EtatFormulaire,
  formData: FormData,
): Promise<EtatFormulaire> {
  const droit = await autoriser("billing.invoices.write");
  if (!droit.ok) return droit.etat;

  const organizationId = lireUuid(formData, "organizationId");
  if (organizationId === null) return erreur("Entreprise absente du formulaire.");

  const motif = lireMotif(formData);
  if (motif === null) {
    return erreur("Motif obligatoire : déclarer un numéro de TVA validé décide du taux facturé.");
  }

  const assujettie = formData.get("assujettie");
  const valide = formData.get("valide") === "1";
  const source = lireTexte(formData, "source");

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_customer_tax_profile", {
    p_organization_id: organizationId,
    // Trois états, et le nul en est un : « on ne sait pas ». Un booléen
    // à deux états forcerait à choisir entre deux mensonges.
    p_is_vat_registered: assujettie === "oui" ? true : assujettie === "non" ? false : null,
    p_validated: valide,
    p_validation_source: valide ? source : null,
    p_reason: motif,
    p_note: lireTexte(formData, "note"),
  });

  if (error) return erreur(messageDeLErreur("Enregistrer le régime de TVA", error));

  revalidatePath(`/abonnements/${organizationId}`);
  revalidatePath("/abonnements/factures");
  return succes("Régime de TVA enregistré et journalisé.");
}
