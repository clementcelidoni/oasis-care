/**
 * §TVA — LA FILE DE VÉRIFICATION, VUE DEPUIS L'APPLICATION.
 *
 * ══════════════════════════════════════════════════════════════════
 * L'INSCRIPTION N'ATTEND PAS VIES. JAMAIS.
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la règle qui gouverne tout ce fichier, et elle a une
 * conséquence que le code doit porter noir sur blanc : AUCUNE FONCTION
 * D'ICI NE LANCE D'EXCEPTION. Le registre national d'un État membre
 * tombe régulièrement ; si son indisponibilité pouvait faire échouer
 * l'enregistrement d'une fiche société, une panne à Bruxelles
 * fermerait l'inscription à tous les Belges — et personne, à l'écran,
 * ne pourrait comprendre pourquoi.
 *
 * Ce qui attend, c'est l'ÉMISSION DE LA FACTURE, et c'est déjà le
 * comportement de la base depuis 0081 : tant que le numéro n'est pas
 * validé, `saas_vat_regime()` rend « unknown » et
 * `saas_issue_invoice()` refuse. Ce refus-là est correct et il n'est
 * pas touché : facturer 0 % à un client qui n'est pas assujetti
 * laisserait Oasis Care redevable de la TVA.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER N'INTERROGE PAS VIES
 * ══════════════════════════════════════════════════════════════════
 *
 * Il DEMANDE À LA BASE de mettre l'entreprise dans la file, et il LIT
 * le résultat quand il arrive. La consultation elle-même est faite
 * ailleurs, par la machine, avec `vies.ts` — un serveur web qui
 * attendrait un service public européen pendant qu'un client remplit
 * un formulaire ferait attendre le client pour rien.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  etatValidationTva,
  type EtatValidationTva,
  type ProfilTvaLu,
  type ZoneFiscaleTva,
} from "./etats.ts";
import type { EtatVies } from "./vies.ts";

// ==================================================================
// METTRE DANS LA FILE
// ==================================================================

export type ResultatProgrammation = {
  /** La demande a-t-elle été prise en compte par la base ? */
  transmise: boolean;
  /**
   * Ce que la base a répondu, mot pour mot. Elle distingue sept cas
   * (client français, aucun numéro, déjà validé, déjà en file, numéro
   * modifié…) et c'est utile en journal — pas à l'écran, où l'état lu
   * ensuite est plus fiable qu'un accusé de réception.
   */
  message: string;
};

/**
 * Programme la vérification du numéro de TVA d'une entreprise.
 *
 * IDEMPOTENTE, et pas de notre fait : `saas_vies_enqueue()` (0089
 * § 7.c) ne reprogramme rien qui soit déjà programmé et ne remet pas le
 * compteur d'essais à zéro. On peut donc l'appeler à chaque
 * enregistrement de la fiche société sans crainte — et il FAUT
 * l'appeler à chaque fois, puisque c'est elle qui détecte qu'un numéro
 * a changé et qui efface alors la validation devenue caduque.
 *
 * ELLE NE LANCE PAS. Une panne ici ne doit pas coûter une inscription :
 * au pire, la vérification ne partira qu'au prochain enregistrement, et
 * l'écran dira honnêtement « en cours de vérification » — ce qui est
 * exactement vrai.
 */
export async function programmerValidationTva(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ResultatProgrammation> {
  try {
    const { data, error } = await supabase.rpc("saas_vies_enqueue", {
      p_organization_id: organizationId,
    });

    if (error) {
      // Journalisé et non montré : la personne qui s'inscrit n'a rien à
      // faire de cette information, et rien de ce qu'elle vient de
      // saisir n'est perdu.
      console.error("TVA : la vérification n'a pas pu être programmée —", error.message);
      return { transmise: false, message: error.message };
    }

    return { transmise: true, message: typeof data === "string" ? data : "" };
  } catch (erreur) {
    console.error(
      "TVA : la vérification n'a pas pu être programmée —",
      erreur instanceof Error ? erreur.message : String(erreur),
    );
    return { transmise: false, message: "" };
  }
}

// ==================================================================
// LIRE OÙ ÇA EN EST
// ==================================================================

/** Les colonnes lues, nommées une par une : `select *` ferait entrer la prochaine sans qu'on le décide. */
const COLONNES =
  "vies_status, vat_number_validated_at, validation_source, vies_last_attempt_at, " +
  "vies_next_attempt_at, vies_attempts, vies_last_error, vies_consultation_number, vat_number_checked";

type LigneProfil = {
  vies_status: string | null;
  vat_number_validated_at: string | null;
  validation_source: string | null;
  vies_last_attempt_at: string | null;
  vies_next_attempt_at: string | null;
  vies_attempts: number | string | null;
  vies_last_error: string | null;
  vies_consultation_number: string | null;
  vat_number_checked: string | null;
};

const ETATS_VIES: readonly EtatVies[] = ["valide", "refuse", "indisponible"];
const SOURCES = ["vies", "manual", "document"] as const;

/**
 * Le profil fiscal de l'entreprise, ou `null` s'il n'y en a pas encore.
 *
 * `null` N'EST PAS UNE ERREUR : la ligne n'existe qu'à partir de la
 * première mise en file. Une entreprise française n'en aura jamais, et
 * c'est normal — elle ne passe pas par VIES.
 *
 * La RLS de 0081 autorise déjà les membres de l'entreprise à lire leur
 * propre profil ; aucune clé de service n'est nécessaire ici, et il ne
 * faut surtout pas en introduire une pour lire ce que le client a le
 * droit de voir.
 */
export async function lireProfilTva(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ProfilTvaLu | null> {
  try {
    const { data, error } = await supabase
      .from("saas_customer_tax_profiles")
      .select(COLONNES)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error || !data) return null;
    const ligne = data as unknown as LigneProfil;

    // Une valeur inconnue est ramenée à `null` plutôt que propagée : la
    // contrainte `check` de la table les interdit déjà, et l'écran s'en
    // sert pour choisir une phrase — une valeur imprévue lui en ferait
    // choisir aucune.
    const statut = ETATS_VIES.find((etat) => etat === ligne.vies_status) ?? null;
    const source = SOURCES.find((valeur) => valeur === ligne.validation_source) ?? null;

    // Le compteur d'essais est un entier en base, mais PostgREST rend
    // parfois les nombres en chaîne. `Number.parseInt` sur une valeur
    // absente donnerait NaN : on retombe sur 0, qui est le défaut de la
    // colonne.
    const essais = Number.parseInt(String(ligne.vies_attempts ?? 0), 10);

    return {
      viesStatus: statut,
      vatNumberValidatedAt: ligne.vat_number_validated_at,
      validationSource: source,
      viesLastAttemptAt: ligne.vies_last_attempt_at,
      viesNextAttemptAt: ligne.vies_next_attempt_at,
      viesAttempts: Number.isFinite(essais) ? essais : 0,
      viesLastError: ligne.vies_last_error,
      viesConsultationNumber: ligne.vies_consultation_number,
      vatNumberChecked: ligne.vat_number_checked,
    };
  } catch (erreur) {
    console.error(
      "TVA : le profil fiscal n'a pas pu être lu —",
      erreur instanceof Error ? erreur.message : String(erreur),
    );
    return null;
  }
}

/**
 * Ce que l'écran doit dire, en une lecture.
 *
 * La zone vient de l'appelant (`zoneFiscale()` de `identite.ts`) : voir
 * `etats.ts` pour la raison — la liste des vingt-sept ne se recopie pas
 * une troisième fois.
 */
export async function lireEtatValidationTva(
  supabase: SupabaseClient,
  parametres: { organizationId: string; zone: ZoneFiscaleTva; numero: string | null },
): Promise<EtatValidationTva> {
  // Un client français ou hors Union n'a pas de profil à lire : la
  // question ne se pose pas, et une requête de plus par affichage
  // n'apprendrait rien.
  const profil =
    parametres.zone === "unionEuropeenne"
      ? await lireProfilTva(supabase, parametres.organizationId)
      : null;

  return etatValidationTva({
    zone: parametres.zone,
    numero: parametres.numero,
    profil,
  });
}
