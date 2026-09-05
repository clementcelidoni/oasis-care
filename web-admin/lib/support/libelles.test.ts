import assert from "node:assert/strict";
import { test } from "node:test";

import {
  etatSession,
  libelle,
  LIBELLES_STATUT,
  niveauProposable,
  phraseTempsRestant,
  RANG_PRIORITE,
  resumeRessources,
  secondesRestantes,
  tonDe,
  TONS_ETAT_SESSION,
} from "./libelles.ts";
import type { NiveauAcces } from "./types.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * Une seule chose, et elle vaut la peine : qu'une session d'assistance
 * TERMINÉE ne soit jamais présentée comme ouverte, et réciproquement.
 * Le reste — libellés, tons, rangs — est vérifié parce que c'est
 * gratuit une fois le fichier importé.
 *
 * Rappel écrit à côté du code qu'il teste : `etatSession()` n'est pas
 * la sécurité. La sécurité est `support_session_record_access()`, en
 * SQL, qui revérifie l'expiration à chaque accès. Ces tests protègent
 * l'HONNÊTETÉ DE L'AFFICHAGE, pas l'accès.
 */

const MAINTENANT = new Date("2026-09-05T12:00:00.000Z");

function session(patch: Partial<{
  revoked_at: string | null;
  expires_at: string;
  consent_required: boolean;
  consent_given_at: string | null;
}>) {
  return {
    revoked_at: null,
    expires_at: "2026-09-05T12:30:00.000Z",
    consent_required: false,
    consent_given_at: null,
    ...patch,
  };
}

test("une session révoquée l'est, même si son échéance est dans le futur", () => {
  const etat = etatSession(
    session({ revoked_at: "2026-09-05T11:50:00.000Z" }),
    MAINTENANT,
  );
  assert.equal(etat, "revoquee");
});

test("une session dont l'échéance est passée est terminée", () => {
  assert.equal(
    etatSession(session({ expires_at: "2026-09-05T11:59:59.000Z" }), MAINTENANT),
    "expiree",
  );
});

test("l'instant exact de l'échéance ferme la session, il ne la laisse pas ouverte", () => {
  // La base écrit `expires_at <= now()` : l'égalité FERME. Une
  // interface qui garderait la session ouverte à la seconde pile
  // afficherait « ouverte » sur un accès que le SQL refuse déjà.
  assert.equal(
    etatSession(session({ expires_at: "2026-09-05T12:00:00.000Z" }), MAINTENANT),
    "expiree",
  );
});

test("une date d'échéance illisible ferme la session au lieu de l'ouvrir", () => {
  assert.equal(etatSession(session({ expires_at: "pas une date" }), MAINTENANT), "expiree");
});

test("le consentement requis et non donné n'est pas « ouverte »", () => {
  assert.equal(
    etatSession(session({ consent_required: true }), MAINTENANT),
    "consentement-attendu",
  );
});

test("le consentement donné rend la session ouverte", () => {
  assert.equal(
    etatSession(
      session({ consent_required: true, consent_given_at: "2026-09-05T11:58:00.000Z" }),
      MAINTENANT,
    ),
    "active",
  );
});

test("« ouverte » n'est pas peinte en vert : c'est un accès qui court", () => {
  assert.equal(TONS_ETAT_SESSION.active, "warning");
  assert.notEqual(TONS_ETAT_SESSION.active, "positive");
});

test("les secondes restantes ne descendent jamais sous zéro", () => {
  assert.equal(secondesRestantes("2026-09-05T11:00:00.000Z", MAINTENANT), 0);
  assert.equal(secondesRestantes("2026-09-05T12:18:00.000Z", MAINTENANT), 1080);
  assert.equal(secondesRestantes("pas une date", MAINTENANT), 0);
});

test("la dernière minute se compte en secondes, pas en « 0 min »", () => {
  assert.equal(phraseTempsRestant(0), "expirée");
  assert.equal(phraseTempsRestant(42), "expire dans 42 s");
  assert.equal(phraseTempsRestant(1080), "expire dans 18 min");
  assert.equal(phraseTempsRestant(3600), "expire dans 1 h");
  assert.equal(phraseTempsRestant(3900), "expire dans 1 h 5 min");
});

test("le rang des priorités met l'urgent devant, contrairement à l'alphabet", () => {
  const ordre = (["low", "normal", "high", "urgent"] as const)
    .slice()
    .sort((a, b) => RANG_PRIORITE[b] - RANG_PRIORITE[a]);
  assert.deepEqual(ordre, ["urgent", "high", "normal", "low"]);
});

test("un statut que l'interface ne connaît pas s'affiche brut plutôt que « inconnu »", () => {
  assert.equal(libelle(LIBELLES_STATUT, "open"), "Ouverte");
  assert.equal(libelle(LIBELLES_STATUT, "escalated"), "escalated");
  assert.equal(tonDe(TONS_ETAT_SESSION, "quelque-chose"), "neutral");
});

function niveau(patch: Partial<NiveauAcces>): NiveauAcces {
  return {
    key: "diagnostics",
    label: "Diagnostic technique",
    opens_business_data: false,
    is_grantable: true,
    max_minutes: 30,
    requires_consent: false,
    note: null,
    ...patch,
  };
}

test("un niveau non accordable n'est pas proposable, et le motif vient de la base", () => {
  const resultat = niveauProposable(
    niveau({ key: "businessReadOnly", is_grantable: false, note: "Aucune table nommée." }),
    0,
  );
  assert.equal(resultat.proposable, false);
  assert.equal(resultat.proposable === false ? resultat.motif : null, "Aucune table nommée.");
});

test("un niveau qui ouvrirait des données métier sans ressource est refusé, même accordable", () => {
  // C'est la seconde moitié du refus de 0081 § 8.c, et celle qu'on
  // oublie : `is_grantable = true` ne suffit pas si la liste est vide.
  const resultat = niveauProposable(
    niveau({ key: "businessReadOnly", opens_business_data: true, is_grantable: true }),
    0,
  );
  assert.equal(resultat.proposable, false);
});

test("le niveau « aucun accès » reste proposable : ne rien ouvrir est un choix", () => {
  assert.equal(niveauProposable(niveau({ key: "none" }), 0).proposable, true);
  assert.equal(resumeRessources([]), "N'ouvre aucune donnée.");
  assert.equal(
    resumeRessources(["ai_usage_events", "usage_counters"]),
    "Ouvre en lecture seule : ai_usage_events, usage_counters.",
  );
});
