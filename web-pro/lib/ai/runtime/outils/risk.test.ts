import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OUTIL_RISK_SNAPSHOT } from "./risk.ts";
import { registreOutils } from "../tools.ts";

/**
 * §11Z — L'OUTIL DE L'AGENT RISQUES, ÉPROUVÉ AVANT D'ÊTRE BRANCHÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CES TESTS VÉRIFIENT, ET CE QU'ILS NE PEUVENT PAS VÉRIFIER
 * ══════════════════════════════════════════════════════════════════
 *
 * Ils ne lancent aucune requête : la fonction `ai_risk_snapshot` a été
 * éprouvée en base par `supabase/tests/agents_derniers.sql`, dans une
 * transaction annulée contre la production. La refaire ici serait une
 * seconde vérité sur le même comportement.
 *
 * Ce qui reste, et qui n'est vérifié nulle part ailleurs, c'est le
 * CONTRAT entre la fonction et le modèle : que chaque bloc qui porte
 * une affirmation soit étiqueté, que les seuils soient appliqués par le
 * SQL et non laissés au modèle, et que la description dise au modèle
 * ce que la fonction ne peut pas lui faire dire.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

/**
 * Les migrations, lues COMME POSTGRES LES LIT.
 *
 * DEUX NORMALISATIONS, ET AUCUNE N'EST UN CONFORT DE TEST.
 *
 *   1. L'APOSTROPHE DOUBLÉE. Dans un littéral SQL elle s'écrit `''` :
 *      le fichier porte « je n''ai rien à lire », et la phrase que le
 *      lecteur voit est « je n'ai rien à lire ».
 *
 *   2. LA CONCATÉNATION DE LITTÉRAUX. Une phrase longue est coupée par
 *      `' || '` pour tenir dans la largeur du fichier — « une facture
 *      payée hors ' || 'logiciel ». Postgres rend UNE phrase ; le
 *      fichier en montre deux morceaux.
 *
 * Sans la seconde, un test qui cherche la phrase telle qu'elle sera
 * LUE échoue sur un retour à la ligne. Et la mauvaise correction est
 * évidente : raccourcir l'expression cherchée jusqu'à ce qu'elle tienne
 * dans un morceau — c'est-à-dire tester moins pour ne plus échouer.
 * Pire, une phrase interdite écrite à cheval sur une coupure
 * échapperait au balayage. On recolle donc, comme Postgres.
 */
function migrations(): string {
  const dossier = join(racineDepot, "supabase", "migrations");
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dossier, f), "utf8"))
    .join("\n")
    .replaceAll("''", "'")
    // Quote, `||`, quote — donc littéral collé à littéral. Une
    // concaténation avec une VARIABLE (`' || v_x || '`) n'a pas de
    // guillemet des deux côtés du `||` et n'est pas touchée.
    .replace(/'\s*\|\|\s*'/g, "");
}

/** Le corps de `ai_risk_snapshot`, isolé de tout le reste. */
function corpsFonction(): string {
  const sql = migrations();
  const debut = sql.indexOf("create or replace function public.ai_risk_snapshot(");
  assert.notEqual(debut, -1, "`ai_risk_snapshot` n'est définie dans aucune migration");
  const fin = sql.indexOf("comment on function public.ai_risk_snapshot", debut);
  assert.notEqual(fin, -1, "`ai_risk_snapshot` n'est pas commentée : le découpage est faux");
  return sql.slice(debut, fin);
}

/** Le `jsonb_build_object` de premier niveau — ce que le modèle reçoit. */
function clesDePremierNiveau(): readonly string[] {
  const corps = corpsFonction();
  const retour = corps.slice(corps.indexOf("return jsonb_build_object("));
  // Quatre espaces d'indentation = premier niveau. Les clés imbriquées
  // sont à six, les morceaux de `format()` plus loin encore.
  return [...retour.matchAll(/^ {4}'(\w+)',/gm)].map((m) => m[1]);
}

// ==================================================================
// 1. LA RÈGLE QUI TIENT TOUT LE REGISTRE
// ==================================================================

test("l'outil nomme une fonction réellement écrite", () => {
  assert.equal(OUTIL_RISK_SNAPSHOT.rpc, "ai_risk_snapshot");
  assert.ok(
    migrations().includes("create or replace function public.ai_risk_snapshot("),
    "`ai_risk_snapshot` n'est définie dans aucune migration : l'outil pointe dans le vide",
  );
});

test("l'organisation vient de la SESSION, et le modèle n'a aucun paramètre à remplir", () => {
  assert.equal(OUTIL_RISK_SNAPSHOT.injecteOrganisation, true);

  const champs = Object.keys(
    (OUTIL_RISK_SNAPSHOT.parametres as unknown as { shape: Record<string, unknown> }).shape,
  );
  assert.deepEqual(
    champs,
    [],
    "un paramètre exposé au modèle est un paramètre que la question peut choisir",
  );

  // Et l'absence de fenêtre de dates est DÉLIBÉRÉE : une période
  // choisie par le modèle permettrait de passer sous ou au-dessus d'un
  // seuil, donc de faire dire à la fonction ce qu'on veut y lire.
  assert.match(
    corpsFonction(),
    /create or replace function public\.ai_risk_snapshot\(\s*p_organization_id uuid\s*\)/,
    "la signature a gagné un paramètre : vérifier qu'il ne déplace aucun dénominateur",
  );
});

test("une lecture ne réclame aucune confirmation, et n'écrit rien", () => {
  assert.equal(OUTIL_RISK_SNAPSHOT.famille, "lecture");
  assert.equal(OUTIL_RISK_SNAPSHOT.confirmationRequise, false);
  assert.equal(OUTIL_RISK_SNAPSHOT.risque, "low");
  assert.equal(OUTIL_RISK_SNAPSHOT.agent, "risk");
});

// ==================================================================
// 2. MESURÉ CONTRE DÉDUIT — LA RAISON D'ÊTRE DE CET AGENT
// ==================================================================

/**
 * LES CINQ BLOCS QUI PORTENT UNE AFFIRMATION.
 *
 * Ce sont les seuls endroits de la réponse d'où le modèle a le droit de
 * tirer un fait. Chacun doit se déclarer comme une mesure.
 */
const BLOCS_DE_MESURE = [
  "concentrationClient",
  "encoursEchu",
  "comportementDePaiement",
  "tenueDesDelais",
  "cascadeDeRetards",
] as const;

test("chaque bloc qui affirme quelque chose se déclare comme une MESURE", () => {
  // C'EST LE TEST DEMANDÉ, ET VOICI POURQUOI IL PREND CETTE FORME.
  //
  // On ne peut pas vérifier ici qu'un modèle annonce ses déductions :
  // cela demanderait un appel de modèle, donc un test qui coûte de
  // l'argent et qui échoue au hasard. Ce qu'on PEUT vérifier, et qui
  // est la seule protection réelle, c'est que la distinction soit
  // portée par la DONNÉE — pas seulement par une consigne. Un bloc
  // ajouté demain sans étiquette est un fait que le modèle recevra sans
  // savoir si c'est une mesure, et il tranchera tout seul.
  const corps = corpsFonction();
  for (const bloc of BLOCS_DE_MESURE) {
    const ancre = corps.indexOf(`'${bloc}', jsonb_build_object(`);
    assert.notEqual(ancre, -1, `le bloc « ${bloc} » a disparu de ai_risk_snapshot`);
    const entete = corps.slice(ancre, ancre + 200);
    assert.match(
      entete,
      /'nature', 'mesure'/,
      `« ${bloc} » affirme quelque chose sans se déclarer comme une mesure : ` +
        "le modèle ne saura pas s'il a le droit de le présenter comme un relevé",
    );
  }
});

test("aucun bloc n'échappe à l'étiquetage : la liste des clés est close", () => {
  // Un bloc ajouté sans étiquette passerait le test précédent, qui ne
  // regarde que les cinq connus. Celui-ci ferme la porte : toute clé de
  // premier niveau est soit une mesure étiquetée, soit une clé de
  // service NOMMÉE ici. Il échoue à l'ajout, ce qui oblige à décider.
  const CLES_DE_SERVICE = [
    "agent",
    "organisationId",
    "aujourdhuiParis",
    "regleDEtiquetage",
    "phraseInterdite",
    "pourquoiCettePhraseEstInterdite",
    "seuils",
    "nonMesurable",
    "confiance",
  ];

  const attendues = [...CLES_DE_SERVICE, ...BLOCS_DE_MESURE].sort();
  const trouvees = [...clesDePremierNiveau()].sort();

  assert.deepEqual(
    trouvees,
    attendues,
    "ai_risk_snapshot rend une clé de premier niveau que ce test ne connaît pas. " +
      "Si elle porte un fait, elle doit porter « nature: mesure » et entrer dans " +
      "BLOCS_DE_MESURE ; sinon elle entre dans CLES_DE_SERVICE, en connaissance de cause.",
  );
});

test("la règle d'étiquetage voyage DANS la réponse, pas seulement dans le prompt", () => {
  // Un réglage qui cesserait un jour d'injecter les limites de l'agent
  // n'emporterait pas la règle avec lui : elle est aussi dans la donnée.
  const corps = corpsFonction();
  assert.match(corps, /'regleDEtiquetage'/);
  assert.match(
    corps,
    /est une DÉDUCTION/,
    "la règle rendue par la fonction ne nomme pas la déduction",
  );
  assert.match(
    corps,
    /avec le fait mesuré qui la porte/,
    "la règle exige-t-elle encore qu'une déduction cite le fait qui la porte ?",
  );
});

test("la description dit au modèle d'étiqueter AVANT qu'il ait vu la réponse", () => {
  // La description est ce que le modèle lit avant d'appeler. Un modèle
  // qui décide de répondre sans outil n'aura jamais vu
  // `regleDEtiquetage`.
  const d = OUTIL_RISK_SNAPSHOT.description;
  assert.match(d, /MESURE/);
  assert.match(d, /DÉDUCTION/);
  assert.match(d, /j'en déduis/, "la formulation attendue d'une déduction n'est pas donnée");
});

test("aucun champ de mesure ne ressemble à une prédiction", () => {
  // `nonMesurable` a le droit de prononcer « probabilité » et « score » :
  // c'est là qu'ils sont REFUSÉS. Partout ailleurs dans la réponse, un
  // champ qui porterait ces mots serait une déduction déguisée en
  // relevé — exactement ce que cet agent existe pour empêcher.
  const corps = corpsFonction();
  const retour = corps.slice(corps.indexOf("return jsonb_build_object("));
  const avantRefus = retour.slice(0, retour.indexOf("'nonMesurable'"));

  for (const interdit of ["probabilit", "'score", "prevision", "prédiction", "risqueEstime"]) {
    assert.ok(
      !avantRefus.toLowerCase().includes(interdit.toLowerCase()),
      `« ${interdit} » apparaît dans un bloc de mesure : une prédiction s'y lirait comme un relevé`,
    );
  }
});

// ==================================================================
// 3. LES SEUILS SONT APPLIQUÉS PAR LE SQL, PAS PAR LE MODÈLE
// ==================================================================

test("sous le seuil, la fonction rend null et un motif — elle ne rend pas un pourcentage", () => {
  // Un seuil laissé à l'appréciation du modèle est un seuil qui cède la
  // première fois qu'on insiste. Celui-ci est une constante SQL.
  const corps = corpsFonction();
  assert.match(corps, /c_seuil_obs\s+constant int := 12;/);
  assert.match(corps, /c_seuil_clients\s+constant int := 5;/);

  // Et le refus est écrit : la part passe à null quand il y a trop peu
  // de clients, avec le ratio qu'elle vaudrait et pourquoi il ne dit
  // rien. Un chiffre qualifié, pas un chiffre caché.
  assert.match(corps, /elsif v_clients_fact < c_seuil_clients then\s+v_part := null;/);
  assert.match(corps, /Concentration refusée/);
  assert.match(corps, /arithmétiquement exact/);
});

test("les seuils sont ANNONCÉS au modèle, pas seulement appliqués", () => {
  const corps = corpsFonction();
  assert.match(corps, /'seuils', jsonb_build_object\(/);
  assert.match(
    corps,
    /elle ne rend jamais un pourcentage calculé sur trois lignes/,
    "le bloc « seuils » n'explique plus ce que le null veut dire",
  );
  assert.match(OUTIL_RISK_SNAPSHOT.description, /trop peu d'observations pour conclure/);
});

// ==================================================================
// 4. LES TABLES VIDES — L'ÉTAT ACTUEL, DONC LE PREMIER CAS RENCONTRÉ
// ==================================================================

test("sur zéro ligne, la fonction dit ce qu'elle ne sait pas plutôt que zéro", () => {
  // C'est l'état mesuré de cette base : aucun règlement, aucune date de
  // fin prévue, une facture émise. Un agent qui rend « zéro » sur ces
  // tables affirme le contraire de la vérité — la confusion zéro /
  // je-ne-sais-pas a déjà été corrigée quatre fois dans ce produit.
  const corps = corpsFonction();

  // Aucun règlement enregistré.
  assert.match(corps, /Aucun règlement n'a jamais été enregistré dans ce produit/);
  assert.match(
    corps,
    /je ne peux pas distinguer une facture impayée d'une facture payée hors logiciel/,
  );
  assert.match(corps, /Ce n'est pas « zéro retard de paiement »/);

  // Aucune date de fin prévue.
  assert.match(corps, /Aucune date de fin prévue n'est saisie/);
  assert.match(corps, /ce n'est pas « aucun retard », c'est « aucune référence »/);

  // Aucune facture émise.
  assert.match(corps, /il n'y a pas de concentration à mesurer/);
  assert.match(corps, /ce n'est pas une concentration nulle/);
});

test("zéro facture en retard n'est jamais présenté comme « les clients paient »", () => {
  // Le piège est réel et il est mesuré : au jour de l'écriture, les
  // deux factures de cette base échoient fin septembre. Zéro échu ne
  // dit rien du comportement des clients, il dit que rien n'est encore
  // exigible — et sans le dénominateur, ce zéro se lit comme un
  // satisfecit.
  const corps = corpsFonction();
  assert.match(corps, /'facturesNonEncoreEchues', v_a_echoir_nb/);
  assert.match(corps, /'echeancesDejaArrivees', v_echues_nb/);
  assert.match(corps, /Zéro facture en retard ne veut pas dire que tout le monde paie/);
  assert.match(OUTIL_RISK_SNAPSHOT.description, /Zéro facture en retard ne veut pas dire/);
});

test("la phrase « aucun risque détecté » est interdite dans la donnée elle-même", () => {
  const corps = corpsFonction();
  assert.match(corps, /'phraseInterdite', 'Aucun risque détecté'/);
  assert.match(corps, /'pourquoiCettePhraseEstInterdite'/);
  assert.match(OUTIL_RISK_SNAPSHOT.description, /« AUCUN RISQUE DÉTECTÉ » EST INTERDITE/);
});

test("le refus de la cascade est VÉRIFIÉ sur le schéma, pas affirmé par commentaire", () => {
  // Un refus adossé à un commentaire se périme en silence. Celui-ci
  // interroge `information_schema` à chaque appel : le jour où
  // quelqu'un ajoute une colonne de prédécesseur, la réponse change
  // toute seule et le refus se déclare périmé.
  const corps = corpsFonction();
  assert.match(corps, /from information_schema\.columns/);
  assert.match(corps, /'predecessor_id', 'predecessor_task_id', 'depends_on'/);
  assert.match(corps, /'calculable', \(v_col_dep > 0\)/);
  assert.match(corps, /ce refus est périmé/, "le cas « les colonnes existent » a disparu");
});

// ==================================================================
// 5. LE DOUBLON QU'IL NE FAUT PAS CRÉER
// ==================================================================

test("les factures échues sont LUES chez la Facturation, jamais recomptées", () => {
  // Deux comptes du même encours dans le même produit finiraient un
  // jour par différer, et personne ne saurait lequel croire.
  const corps = corpsFonction();
  assert.match(corps, /v_bill := public\.ai_billing_candidates\(p_organization_id\);/);
  assert.match(corps, /'facturesEnRetard' -> 'resume' ->> 'nombre'/);
  assert.match(corps, /'source', 'ai_billing_candidates, section 4 \(agent billing\)'/);
  assert.match(OUTIL_RISK_SNAPSHOT.description, /LU chez la Facturation/);
});

test("les trois droits exigés sont ceux de la fonction qu'elle appelle", () => {
  // En exiger moins ferait échouer l'appel plus bas, avec un message
  // qui parlerait de la Facturation et pas du Risque.
  const corps = corpsFonction();
  for (const droit of ["projects.read", "invoice.create", "quotes.read"]) {
    assert.ok(
      corps.includes(`perform public.ai_guard(p_organization_id, '${droit}');`),
      `la fonction ne garde plus « ${droit} » : un droit manquant rendrait une vue partielle`,
    );
  }
  // Le champ `permission` n'en accepte qu'un, et le bon est le plus
  // étroit — mesuré dans `role_permissions` : deux rôles portent
  // `invoice.create`, et ils portent aussi les deux autres.
  assert.equal(OUTIL_RISK_SNAPSHOT.permission, "invoice.create");
  assert.equal(OUTIL_RISK_SNAPSHOT.permissionSource, "aiGuard");
});

test("ce qui appartient à d'autres agents est NOMMÉ, pas silencieusement omis", () => {
  const corps = corpsFonction();
  for (const renvoi of [
    "'margeEtSaDerive'",
    "'resteDuDUnClientNomme'",
    "'echeancesDuMateriel'",
    "'devisQuiExpirent'",
    "'facturesEnRetardRecalculees'",
    "'scoreDeRisque'",
    "'probabilites'",
  ]) {
    assert.ok(corps.includes(renvoi), `le renvoi ${renvoi} a disparu de « nonMesurable »`);
  }
});

// ==================================================================
// 6. LE COUPLAGE OUTIL / CATALOGUE
// ==================================================================

test("branché ou non, l'outil reste cohérent — et le test change de camp tout seul", () => {
  // TEST FAIT POUR CHANGER DE CAMP, comme celui des Clients et du
  // Matériel : il réclame le geste manquant dans un sens comme dans
  // l'autre, et personne n'a besoin de s'en souvenir.
  const registre = registreOutils();
  const inscrit = registre.chercher(OUTIL_RISK_SNAPSHOT.nom);

  if (inscrit === null) {
    // État attendu tant que `runtime/tools.ts` — fichier PARTAGÉ — n'a
    // pas reçu l'import. `tools.test.ts` §8 le dit déjà, plus fort.
    assert.ok(true);
    return;
  }

  assert.equal(inscrit.rpc, "ai_risk_snapshot");
  assert.equal(inscrit.agent, "risk");
  assert.equal(
    inscrit,
    OUTIL_RISK_SNAPSHOT,
    "le catalogue porte une COPIE de la déclaration et non l'import : " +
      "le jour où l'une des deux est corrigée, c'est l'autre qui part au modèle",
  );
});
