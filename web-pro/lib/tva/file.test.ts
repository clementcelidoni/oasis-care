import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import { lireEtatValidationTva, lireProfilTva, programmerValidationTva } from "./file.ts";

/**
 * AUCUNE BASE N'EST JOIGNABLE DEPUIS UN TEST, ET C'EST TANT MIEUX : la
 * seule qui existe est la PRODUCTION. Le client Supabase est donc un
 * double, réduit aux deux formes d'appel que ce fichier utilise.
 *
 * CE QUI EST DÉFENDU ICI n'est pas le mappage des colonnes — il se
 * relit — mais la promesse que rien de tout cela ne peut faire échouer
 * une inscription. Chaque cas d'échec est donc éprouvé : la base qui
 * refuse, la base qui explose, la ligne absente, la colonne qui porte
 * une valeur imprévue.
 */

type AppelRpc = { nom: string; parametres: unknown };

type DoubleOptions = {
  rpcData?: unknown;
  rpcErreur?: { message: string };
  rpcExplose?: boolean;
  ligne?: Record<string, unknown> | null;
  erreurLecture?: { message: string };
  lectureExplose?: boolean;
};

type ChaineLecture = {
  select: () => ChaineLecture;
  eq: () => ChaineLecture;
  maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
};

function doubleSupabase(options: DoubleOptions = {}) {
  const rpcs: AppelRpc[] = [];
  const tablesLues: string[] = [];

  const client = {
    async rpc(nom: string, parametres: unknown) {
      rpcs.push({ nom, parametres });
      if (options.rpcExplose === true) throw new Error("fetch failed");
      return { data: options.rpcData ?? null, error: options.rpcErreur ?? null };
    },
    from(table: string) {
      tablesLues.push(table);
      const chaine: ChaineLecture = {
        select: () => chaine,
        eq: () => chaine,
        maybeSingle: async () => {
          if (options.lectureExplose === true) throw new Error("connexion perdue");
          return { data: options.ligne ?? null, error: options.erreurLecture ?? null };
        },
      };
      return chaine;
    },
  };

  return { client: client as unknown as SupabaseClient, rpcs, tablesLues };
}

/** Les `console.error` attendus ne doivent pas salir la sortie des tests. */
async function sansBruit<T>(travail: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await travail();
  } finally {
    console.error = original;
  }
}

const LIGNE_VALIDE = {
  vies_status: "valide",
  vat_number_validated_at: "2026-03-12T09:30:00Z",
  validation_source: "vies",
  vies_last_attempt_at: "2026-03-12T09:30:00Z",
  vies_next_attempt_at: null,
  vies_attempts: 0,
  vies_last_error: null,
  vies_consultation_number: "WAPIAAAAX123",
  vat_number_checked: "BE0123456789",
};

// ==================================================================
// 1. METTRE DANS LA FILE
// ==================================================================

test("programmer la vérification appelle la fonction de la base, et elle seule", async () => {
  const { client, rpcs } = doubleSupabase({ rpcData: "Consultation programmée." });
  const resultat = await programmerValidationTva(client, "org-1");

  assert.equal(resultat.transmise, true);
  assert.equal(resultat.message, "Consultation programmée.");
  assert.deepEqual(rpcs, [{ nom: "saas_vies_enqueue", parametres: { p_organization_id: "org-1" } }]);
});

test("UNE BASE QUI REFUSE NE FAIT PAS ÉCHOUER L'INSCRIPTION", async () => {
  // C'est la promesse centrale de ce fichier. Une panne côté base au
  // moment d'inscrire quelqu'un ne doit rien lui coûter : au pire, la
  // vérification partira au prochain enregistrement de sa fiche.
  const { client } = doubleSupabase({ rpcErreur: { message: "permission denied" } });
  const resultat = await sansBruit(() => programmerValidationTva(client, "org-1"));
  assert.equal(resultat.transmise, false);
  assert.equal(resultat.message, "permission denied");
});

test("une base qui explose ne remonte pas l'exception non plus", async () => {
  const { client } = doubleSupabase({ rpcExplose: true });
  const resultat = await sansBruit(() => programmerValidationTva(client, "org-1"));
  assert.equal(resultat.transmise, false);
});

// ==================================================================
// 2. LIRE OÙ ÇA EN EST
// ==================================================================

test("le profil se lit et se traduit colonne par colonne", async () => {
  const { client, tablesLues } = doubleSupabase({ ligne: LIGNE_VALIDE });
  const profil = await lireProfilTva(client, "org-1");

  assert.deepEqual(tablesLues, ["saas_customer_tax_profiles"]);
  assert.equal(profil?.viesStatus, "valide");
  assert.equal(profil?.validationSource, "vies");
  assert.equal(profil?.viesConsultationNumber, "WAPIAAAAX123");
  assert.equal(profil?.vatNumberChecked, "BE0123456789");
  assert.equal(profil?.viesAttempts, 0);
});

test("l'absence de ligne n'est pas une erreur : personne n'a encore rien demandé", async () => {
  const { client } = doubleSupabase({ ligne: null });
  assert.equal(await lireProfilTva(client, "org-1"), null);
});

test("une lecture qui échoue rend null au lieu de faire tomber la page", async () => {
  const { client } = doubleSupabase({ erreurLecture: { message: "timeout" } });
  assert.equal(await lireProfilTva(client, "org-1"), null);

  const explosif = doubleSupabase({ lectureExplose: true });
  assert.equal(await sansBruit(() => lireProfilTva(explosif.client, "org-1")), null);
});

test("une valeur imprévue en base est ramenée à « inconnu », pas propagée à l'écran", async () => {
  // La contrainte `check` de la table les interdit déjà. Si l'une passait
  // malgré tout, l'écran ne saurait quelle phrase choisir — et une page
  // qui ne choisit rien n'affiche rien.
  const { client } = doubleSupabase({
    ligne: { ...LIGNE_VALIDE, vies_status: "peut-être", validation_source: "télépathie" },
  });
  const profil = await lireProfilTva(client, "org-1");
  assert.equal(profil?.viesStatus, null);
  assert.equal(profil?.validationSource, null);
});

test("le compteur d'essais rendu en chaîne redevient un nombre", async () => {
  const { client } = doubleSupabase({ ligne: { ...LIGNE_VALIDE, vies_attempts: "3" } });
  assert.equal((await lireProfilTva(client, "org-1"))?.viesAttempts, 3);

  const absent = doubleSupabase({ ligne: { ...LIGNE_VALIDE, vies_attempts: null } });
  assert.equal((await lireProfilTva(absent.client, "org-1"))?.viesAttempts, 0);
});

// ==================================================================
// 3. L'ÉTAT COMPLET, EN UNE LECTURE
// ==================================================================

test("un client français ne déclenche aucune lecture : la question ne se pose pas", async () => {
  const { client, tablesLues } = doubleSupabase({ ligne: LIGNE_VALIDE });
  const etat = await lireEtatValidationTva(client, {
    organizationId: "org-1",
    zone: "france",
    numero: "FR44732829320",
  });
  assert.equal(etat.code, "france");
  assert.deepEqual(tablesLues, [], "aucune requête pour une entreprise qui ne passe pas par VIES");
});

test("un client de l'Union voit l'état réel de sa vérification", async () => {
  const { client } = doubleSupabase({ ligne: LIGNE_VALIDE });
  const etat = await lireEtatValidationTva(client, {
    organizationId: "org-1",
    zone: "unionEuropeenne",
    numero: "BE0123456789",
  });
  assert.equal(etat.code, "valide");
  assert.equal(etat.bloqueLaFacture, false);
});

test("une lecture impossible se raconte comme « en cours », jamais comme « validé »", async () => {
  // Le pire des défauts serait de faire croire à une validation parce
  // qu'une requête a échoué. « En cours » est la seule vérité
  // défendable quand on ne sait pas.
  const { client } = doubleSupabase({ erreurLecture: { message: "timeout" } });
  const etat = await lireEtatValidationTva(client, {
    organizationId: "org-1",
    zone: "unionEuropeenne",
    numero: "BE0123456789",
  });
  assert.equal(etat.code, "enCours");
  assert.equal(etat.bloqueLaFacture, true);
});
