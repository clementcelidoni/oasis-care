import assert from "node:assert/strict";
import { test } from "node:test";

import {
  composerAudience,
  empreinteAudience,
  repartirParForfait,
  type LectureEntreprise,
} from "./audience.ts";
import type { EntrepriseDuParc, IdentiteExpediteur, VerdictPorte } from "./types.ts";

/**
 * ==================================================================
 * CE QUE CES TESTS PROTÈGENT
 * ==================================================================
 *
 * DEUX RÈGLES, ET LES DEUX SONT DES RÈGLES DE DROIT AVANT D'ÊTRE DES
 * RÈGLES DE CODE.
 *
 *   1. LE CLIENT FINAL D'UN PAYSAGISTE NE REÇOIT JAMAIS DE PUBLICITÉ
 *      D'OASIS CARE. Il n'a rien signé avec nous. Le test qui
 *      l'interdit est plus bas, et il porte sur la FORME du type
 *      d'entrée autant que sur les valeurs : une audience se compose
 *      d'entreprises et d'adresses rendues par
 *      `email_sender_identity()`, et il n'existe aucun paramètre par
 *      lequel une adresse de `crm_customers` ou `crm_contacts`
 *      pourrait entrer.
 *
 *   2. LE DÉFAUT EST « N'ENVOIE PAS ». Toute lecture incomplète — pas
 *      d'identité, pas de verdict, pas d'adresse — écarte l'entreprise.
 *      Une composition qui retiendrait par défaut ferait partir un
 *      message à cause d'un aller-retour raté.
 *
 * Ces tests ne remplacent pas ceux de la base. `email_gate()` est la
 * seule autorité sur le consentement, et les contraintes
 * `email_messages_publicite_jamais_au_client_final` et
 * `email_messages_entreprise_sans_client_crm` sont ce qui rend la
 * première règle impossible à enfreindre, pas ce fichier. Ici, on
 * vérifie que l'ÉCRAN ne promet rien que la base refuserait, et surtout
 * qu'il ne retient rien qu'elle écarterait.
 */

function entreprise(over: Partial<EntrepriseDuParc> = {}): EntrepriseDuParc {
  return {
    organization_id: "11111111-1111-1111-1111-111111111111",
    name: "Jardins Dupont",
    plan: "pro",
    subscription_status: "active",
    archived_at: null,
    ...over,
  };
}

function identite(over: Partial<IdentiteExpediteur> = {}): IdentiteExpediteur {
  return {
    from_name: "Jardins Dupont SARL",
    reply_to_email: "contact@jardins-dupont.fr",
    logo_path: null,
    blocking_reason: null,
    warnings: [],
    ...over,
  };
}

function porte(over: Partial<VerdictPorte> = {}): VerdictPorte {
  return { allowed: true, blocking_reason: null, warnings: [], ...over };
}

test("une entreprise consentante et joignable est retenue, avec son adresse réelle", () => {
  const audience = composerAudience([
    { entreprise: entreprise(), identite: identite(), porte: porte() },
  ]);

  assert.equal(audience.retenues.length, 1);
  assert.equal(audience.retenues[0].destinataire, "contact@jardins-dupont.fr");
  assert.equal(audience.ecartees.length, 0);
});

test("LE TEST QUI COMPTE : l'adresse retenue vient toujours de l'entreprise, jamais d'un client", () => {
  // Il n'existe aucun champ « client » dans `LectureEntreprise` : une
  // adresse de `crm_customers` n'a pas de chemin pour entrer. Ce test
  // fige cette absence, parce qu'un champ ajouté « pour la souplesse »
  // six mois plus tard ne serait refusé par rien d'autre.
  const lecture: LectureEntreprise = {
    entreprise: entreprise(),
    identite: identite(),
    porte: porte(),
  };

  assert.deepEqual(Object.keys(lecture).sort(), ["entreprise", "identite", "porte"]);

  const audience = composerAudience([lecture]);
  assert.equal(audience.retenues[0].destinataire, lecture.identite?.reply_to_email);
});

test("sans adresse e-mail, l'entreprise est écartée avec la phrase de la base", () => {
  const phrase =
    "Renseignez l'adresse e-mail de votre entreprise dans ses paramètres : sans elle, les réponses de vos clients se perdraient.";
  const audience = composerAudience([
    {
      entreprise: entreprise(),
      identite: identite({ reply_to_email: null, blocking_reason: phrase }),
      porte: null,
    },
  ]);

  assert.equal(audience.retenues.length, 0);
  assert.equal(audience.ecartees[0].motif, "sansAdresse");
  assert.equal(audience.ecartees[0].phrase, phrase);
});

test("sans consentement, la porte refuse et l'entreprise est écartée", () => {
  const audience = composerAudience([
    {
      entreprise: entreprise(),
      identite: identite(),
      porte: porte({
        allowed: false,
        blocking_reason:
          "Aucun consentement préalable enregistré pour cette adresse : la publicité ne part pas.",
      }),
    },
  ]);

  assert.equal(audience.retenues.length, 0);
  assert.equal(audience.ecartees[0].motif, "sansConsentement");
});

test("une désabonnée, une suppression et une suspension sont écartées et comptées séparément", () => {
  const audience = composerAudience([
    {
      entreprise: entreprise({ organization_id: "aaaaaaaa-0000-0000-0000-000000000001" }),
      identite: identite(),
      porte: porte({ allowed: false, blocking_reason: "Cette adresse s'est désabonnée le 03/03/2026." }),
    },
    {
      entreprise: entreprise({ organization_id: "aaaaaaaa-0000-0000-0000-000000000002" }),
      identite: identite(),
      porte: porte({
        allowed: false,
        blocking_reason:
          "Cette adresse est sur la liste de suppression (plainte). Continuer à la solliciter détruirait la réputation du domaine pour tout le parc.",
      }),
    },
    {
      entreprise: entreprise({ organization_id: "aaaaaaaa-0000-0000-0000-000000000003" }),
      identite: identite(),
      porte: porte({
        allowed: false,
        blocking_reason:
          "L'expédition de courrier est suspendue pour cette entreprise depuis le 01/03/2026. Motif : plaintes répétées",
      }),
    },
  ]);

  assert.equal(audience.retenues.length, 0);
  const motifs = Object.fromEntries(audience.parMotif.map((c) => [c.motif, c.nombre]));
  assert.deepEqual(motifs, { desabonnee: 1, suppression: 1, suspendue: 1 });
});

test("une entreprise archivée est écartée sans coûter un aller-retour", () => {
  // Elle n'apparaîtra ni dans `queued_count` ni dans `skipped_count` :
  // la boucle d'envoi ne la visite pas. La compter ici est ce qui
  // permet à l'écran de réconcilier ses totaux après coup.
  const audience = composerAudience([
    {
      entreprise: entreprise({ archived_at: "2026-01-01T00:00:00Z" }),
      identite: null,
      porte: null,
    },
  ]);

  assert.equal(audience.ecartees[0].motif, "archivee");
});

test("LE DÉFAUT EST « N'ENVOIE PAS » : une lecture ratée écarte, elle ne retient pas", () => {
  const audience = composerAudience([
    { entreprise: entreprise(), identite: null, porte: null },
    { entreprise: entreprise({ organization_id: "bbbbbbbb-0000-0000-0000-000000000001" }), identite: identite(), porte: null },
  ]);

  assert.equal(audience.retenues.length, 0);
  assert.equal(audience.ecartees.length, 2);
  assert.ok(audience.ecartees.every((e) => e.motif === "autre"));
});

test("les avertissements accompagnent une retenue, ils ne l'arrêtent pas", () => {
  const audience = composerAudience([
    {
      entreprise: entreprise(),
      identite: identite({ warnings: ["Aucun logo : vos messages partiront sans votre image."] }),
      porte: porte({ warnings: ["Cette adresse a échoué le 03/03/2026 (rebondDur)."] }),
    },
  ]);

  assert.equal(audience.retenues.length, 1);
  assert.equal(audience.retenues[0].avertissements.length, 2);
});

test("l'empreinte change quand la LISTE change à nombre constant", () => {
  // Le cas que le seul nombre laisserait passer : l'une se désabonne,
  // l'autre consent, le total ne bouge pas, et un message partirait
  // vers quelqu'un que personne n'a vu à l'écran.
  const avant = composerAudience([
    { entreprise: entreprise({ organization_id: "cccccccc-0000-0000-0000-000000000001" }), identite: identite(), porte: porte() },
  ]);
  const apres = composerAudience([
    { entreprise: entreprise({ organization_id: "cccccccc-0000-0000-0000-000000000002" }), identite: identite(), porte: porte() },
  ]);

  assert.equal(avant.retenues.length, apres.retenues.length);
  assert.notEqual(empreinteAudience(avant), empreinteAudience(apres));
});

test("la composition par forfait COMPTE, elle ne retire personne", () => {
  // Le ciblage par forfait a été demandé et n'est pas livrable : la
  // fonction d'envoi n'a aucun paramètre d'audience. Ce test fige le
  // fait que la répartition est une VUE : la somme des groupes est
  // toujours le nombre de destinataires, jamais moins.
  const audience = composerAudience([
    {
      entreprise: entreprise({ organization_id: "eeeeeeee-0000-0000-0000-000000000001", plan: "pro" }),
      identite: identite(),
      porte: porte(),
    },
    {
      entreprise: entreprise({
        organization_id: "eeeeeeee-0000-0000-0000-000000000002",
        plan: "pro",
        subscription_status: "trialing",
      }),
      identite: identite(),
      porte: porte(),
    },
    {
      entreprise: entreprise({
        organization_id: "eeeeeeee-0000-0000-0000-000000000003",
        plan: null,
        subscription_status: null,
      }),
      identite: identite(),
      porte: porte(),
    },
  ]);

  const groupes = repartirParForfait(audience.retenues);
  assert.equal(
    groupes.reduce((total, groupe) => total + groupe.nombre, 0),
    audience.retenues.length,
  );
  // « Aucun abonnement suivi » n'est pas « pas client » :
  // organization_subscriptions n'est écrite par personne aujourd'hui.
  assert.ok(groupes.some((groupe) => groupe.libelle === "Aucun abonnement suivi"));
  assert.ok(groupes.some((groupe) => groupe.libelle.includes("en essai")));
});

test("l'empreinte ne dépend pas de l'ordre de lecture", () => {
  const a = composerAudience([
    { entreprise: entreprise({ organization_id: "dddddddd-0000-0000-0000-000000000001" }), identite: identite(), porte: porte() },
    { entreprise: entreprise({ organization_id: "dddddddd-0000-0000-0000-000000000002" }), identite: identite(), porte: porte() },
  ]);
  const b = composerAudience([
    { entreprise: entreprise({ organization_id: "dddddddd-0000-0000-0000-000000000002" }), identite: identite(), porte: porte() },
    { entreprise: entreprise({ organization_id: "dddddddd-0000-0000-0000-000000000001" }), identite: identite(), porte: porte() },
  ]);

  assert.equal(empreinteAudience(a), empreinteAudience(b));
});
