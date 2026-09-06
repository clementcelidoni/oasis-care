import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

/**
 * POURQUOI UN `register()` ET UN IMPORT DYNAMIQUE DEPUIS §11Y.
 *
 * `aiguillage.ts` n'importait qu'un TYPE de `@/lib/ai/runtime`, et un
 * type s'efface au dépouillement : Node n'avait rien à résoudre. Il en
 * importe maintenant une VALEUR — `DEFINITIONS`, d'où il tire les
 * mots-clés de chaque agent au lieu de les recopier —, et `@/` est un
 * alias de `tsconfig.json` que Node ignore.
 *
 * On emploie le crochet déjà écrit pour ce cas exact
 * (`lib/ai/runtime/_test/alias.mjs`, voir son en-tête) plutôt que
 * d'inventer un second mécanisme. L'import doit être DYNAMIQUE : un
 * import statique est hissé avant l'exécution de la première ligne,
 * donc avant que le crochet existe.
 */
register("../../../lib/ai/runtime/_test/alias.mjs", import.meta.url);

const { aiguiller, normaliser, reglesActives, ORDRE, EN_ATTENTE_INTEGRATION } = await import(
  "./aiguillage.ts"
);
const { DEFINITIONS } = await import("../../../lib/ai/runtime/agents/index.ts");
const { anomaliesDAiguillage } = await import("../../../lib/ai/runtime/agents/classification.ts");

/**
 * §11Z, INTÉGRATION — L'ÉCHAFAUDAGE A SERVI, PUIS IL A ÉTÉ RETIRÉ.
 *
 * Ce fichier complétait `DEFINITIONS` avec l'agent Ventes avant que
 * l'intégration ne le compose, pour pouvoir éprouver sa place dans
 * l'ORDRE sans toucher aux fichiers partagés. Les treize répondeurs
 * sont composés : `DEFINITIONS` les contient tous, et le complément
 * n'a plus d'objet.
 *
 * CE QUI COMPTE EST QUE LE COMPLÉMENT SOIT PARTI, PAS QU'IL AIT ÉTÉ
 * NEUTRALISÉ. Un échafaudage laissé en place « au cas où » masquerait
 * exactement la panne qu'il faut voir : un agent retiré de
 * `AGENTS_CONSTRUITS` par accident continuerait d'être aiguillé dans
 * ce test, qui resterait vert pendant que le produit, lui, ne le
 * trouverait plus.
 *
 * L'appel ci-dessous ne passe donc plus de troisième paramètre : c'est
 * le vrai aiguilleur, sur les vraies définitions, exactement comme
 * `lib/ai/conversations/actions.ts` l'appelle.
 */
function aiguillerApresIntegration(question: string) {
  return aiguiller(question, null);
}

/**
 * §11V — L'AIGUILLAGE, ÉPROUVÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON DÉFEND ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Deux propriétés, et la seconde compte plus que la première.
 *
 *   1. Les mots-clés envoient au bon agent. C'est agréable, et une
 *      erreur ici n'est jamais grave : le mauvais spécialiste répondra
 *      « je ne vois rien ».
 *
 *   2. L'AIGUILLAGE NE COÛTE RIEN. Aucun modèle n'est appelé pour
 *      décider à qui parler — c'est la règle « outils déterministes
 *      avant IA » (p. 11-12) appliquée à l'aiguillage lui-même. Un
 *      aiguilleur en langage naturel ajouterait un appel de modèle, une
 *      ligne au grand livre et une latence À CHAQUE QUESTION, avant
 *      même de commencer à répondre. Ce fichier est un test synchrone
 *      sans le moindre port : c'est la preuve que la fonction ne peut
 *      rien appeler du tout.
 *
 * ─── ET LE CAS QUI ÉCONOMISE LE PLUS D'ARGENT ───
 *
 * La question qu'aucun mot-clé ne tranche. Elle part à la Direction —
 * seul agent capable d'interroger les autres — mais AVEC
 * `complexity: "simple"`, ce qui la décale d'un cran sous son niveau
 * habituel. Sans ce décalage, toute question mal formulée partirait sur
 * le modèle le plus cher, et le ratio « ~5 % Sol » de la page 17 serait
 * faux dès la première semaine.
 */

// ==================================================================
// 1. L'agent imposé gagne toujours
// ==================================================================

test("quand l'écran sait de quoi il parle, il n'y a rien à deviner", () => {
  const resultat = aiguiller("n'importe quoi qui parle de facture", "quotePricing");
  assert.equal(resultat.agent, "quotePricing");
  assert.equal(resultat.complexite, undefined, "on laisse le routeur appliquer le niveau de l'agent");
  assert.match(resultat.raison, /imposé/);
});

// ==================================================================
// 2. Les mots-clés
// ==================================================================

test("les questions de facturation vont à la Facturation", () => {
  for (const question of [
    "Qu'est-ce que je dois facturer ?",
    "Quelles sont mes factures impayées ?",
    "Prépare un brouillon de facture pour les Dupont",
    "Où en sont mes encaissements ?",
  ]) {
    assert.equal(aiguiller(question).agent, "billing", question);
  }
});

test("les questions de prix vont au chiffrage", () => {
  for (const question of [
    "Ce devis est-il bien chiffré ?",
    "Quel taux de marque sur ce dossier ?",
    "Suis-je sous-tarifé sur les terrasses ?",
  ]) {
    assert.equal(aiguiller(question).agent, "quotePricing", question);
  }
});

test("les questions d'argent global vont à la Finance", () => {
  for (const question of [
    "Quel est mon chiffre d'affaires ce trimestre ?",
    "Comment va ma trésorerie ?",
    "Mes créances augmentent-elles ?",
    "Est-ce que je tiens mon objectif de marge ?",
  ]) {
    assert.equal(aiguiller(question).agent, "finance", question);
  }
});

test("les questions de pilotage vont à la Direction, à son niveau habituel", () => {
  for (const question of [
    "Que dois-je faire aujourd'hui ?",
    "Fais-moi un brief",
    "Quelles sont mes priorités ?",
    "Qu'est-ce qui est urgent ?",
  ]) {
    const resultat = aiguiller(question);
    assert.equal(resultat.agent, "executive", question);
    assert.equal(
      resultat.complexite,
      undefined,
      "un brief DEMANDÉ n'est pas une question qu'on n'a pas comprise",
    );
  }
});

test("l'ordre des règles tranche les questions qui portent deux mots", () => {
  // « facturer un devis signé » contient « factur » et « devis », et
  // c'est bien la Facturation qu'on interroge.
  assert.equal(aiguiller("Facturer les devis signés").agent, "billing");
});

// ==================================================================
// 2 bis. LES SIX AGENTS DE §11Y — CE QU'ILS PRENNENT, ET CE QU'ILS
//        NE DOIVENT PAS PRENDRE
// ==================================================================
//
// Cette section existe à cause d'une régression réelle, et elle est
// écrite pour qu'elle ne puisse pas revenir en silence.
//
// Quand six agents muets ont reçu leurs mots-clés d'un coup, l'ordre
// d'aiguillage s'est retourné sans que rien ne casse : des questions
// d'argent qui allaient à la Finance sont parties aux Chantiers et à la
// Pépinière — deux agents qui refusent l'argent par une limite
// explicite. Aucun test ne couvrait ces formulations, donc la suite est
// restée verte pendant que le produit répondait moins bien qu'avant.
//
// Une liste de mots-clés se relit très bien en paraissant complète.
// Seule la QUESTION RÉELLE, passée à `aiguiller()`, dit où elle tombe.

test("une question d'argent va à la Finance, même quand elle nomme un chantier", () => {
  // LE CRITÈRE EST « QUI A LA SOURCE ». Aucun autre agent n'agrège
  // d'argent ; la Finance possède `getCompanyMetrics`,
  // `getMarginBreakdown` et `analyzeProjectMargin` — dont le dernier
  // répond précisément à « la marge de CE chantier ».
  for (const question of [
    "Où en est ma trésorerie ?",
    "Où en est mon chiffre d'affaires ?",
    "Où en est ma marge globale",
    "Quelle rentabilité sur ce chantier ?",
    "Quelle est la marge du chantier Dupont ?",
    "Mes dépenses de pépinière",
  ]) {
    assert.equal(
      aiguiller(question).agent,
      "finance",
      `« ${question} » part à un agent qui refuse l'argent par une limite : on paie un appel ` +
        "de modèle pour recevoir un renvoi vers la Finance",
    );
  }
});

test("« où en est » n'aiguille rien toute seule : ce n'est pas un mot de métier", () => {
  // C'est une AMORCE DE PHRASE. Tant qu'elle était un mot-clé des
  // Chantiers, elle attrapait tout ce qui la suivait. Retirée, la
  // question tombe sur le mot qui la suit — ou sur la Direction.
  assert.equal(aiguiller("Où en est le chantier Mairie ?").agent, "operations");
  assert.equal(aiguiller("Où en est ma trésorerie ?").agent, "finance");
  assert.equal(aiguiller("Où en est mon stock de cycas ?").agent, "nursery");
  assert.equal(
    aiguiller("Où en est tout ça ?").agent,
    "executive",
    "sans mot de métier, la question doit aller à la Direction, qui ira demander",
  );
});

test("chacun des cinq agents outillés est atteint par sa question la plus ordinaire", () => {
  // La question qu'un paysagiste pose vraiment, agent par agent. Un
  // agent construit que personne n'atteint est un agent qui n'existe
  // pas : sa question part à la Direction, dont le plan ne contient
  // aucune de ses sources, et qui répond « je ne vois rien » avec
  // aplomb. C'est la panne la plus silencieuse de tout ce dispositif.
  const attendus: readonly [string, string][] = [
    ["Quels chantiers sont en retard ?", "operations"],
    ["Qu'est-ce qui est posé la semaine prochaine ?", "planning"],
    ["Combien de cycas j'ai en stock ?", "nursery"],
    ["Quel est le contrôle technique du camion ?", "fleet"],
    ["Combien ce client m'a rapporté ?", "customer"],
  ];
  for (const [question, agent] of attendus) {
    assert.equal(aiguiller(question).agent, agent, `« ${question} » n'atteint pas « ${agent} »`);
  }
});

test("les Achats restent inatteignables tant qu'ils n'ont rien à lire", () => {
  // L'agent Achats est un GABARIT : ses trois volets — fournisseurs,
  // commandes, besoins — comptent zéro ligne en production, et il n'a
  // aucun outil de lecture. Il n'a donc aucun mot-clé, et sa question
  // doit tomber à la Direction plutôt que sur lui.
  //
  // Ce n'est pas un manque à combler « pendant qu'on y est » : allumé,
  // il paierait un raisonnement complet pour rendre une phrase polie.
  assert.equal(aiguiller("Que dois-je commander ?").agent, "executive");
  assert.equal(aiguiller("Quels sont mes fournisseurs ?").agent, "executive");
});

// ==================================================================
// 3. LE CAS QUI COMPTE : personne ne sait
// ==================================================================

test("une question qu'aucun mot-clé ne tranche part à la Direction, UN CRAN PLUS BAS", () => {
  const resultat = aiguiller("Est-ce que ça se passe bien avec les Martin en ce moment ?");

  assert.equal(resultat.agent, "executive", "un spécialiste répondrait « je ne vois rien » avec aplomb");
  assert.equal(
    resultat.complexite,
    "simple",
    "on ne paie pas le modèle le plus cher pour découvrir ce qu'on nous demande",
  );
  assert.match(resultat.raison, /escaladera/, "et l'escalade montera si la Direction déclare l'ambiguïté");
});

test("une question vide ne fait pas planter l'aiguillage", () => {
  assert.equal(aiguiller("").agent, "executive");
  assert.equal(aiguiller("   ").complexite, "simple");
});

// ==================================================================
// 4. Les accents
// ==================================================================

test("« tresorerie » sans accent trouve la Finance, et « trésorerie » aussi", () => {
  assert.equal(aiguiller("comment va ma tresorerie").agent, "finance");
  assert.equal(aiguiller("comment va ma trésorerie").agent, "finance");
  assert.equal(aiguiller("COMMENT VA MA TRÉSORERIE").agent, "finance");
});

test("la normalisation retire les diacritiques et met en minuscules", () => {
  assert.equal(normaliser("Créance ÉCHUE"), "creance echue");
  assert.equal(normaliser("Où ça ?"), "ou ca ?");
  assert.equal(normaliser("déjà-vu"), "deja-vu");
});

test("la normalisation ne touche pas aux caractères ordinaires", () => {
  // §11Z — CETTE ATTENTE A CHANGÉ, ET LE CHANGEMENT EST LE SUJET.
  //
  // La normalisation replie désormais l'apostrophe sur une espace. Ce
  // test attendait « chiffre d'affaires 2026 » inchangé ; il attend
  // maintenant l'apostrophe repliée. Ce n'est pas un test qu'on
  // assouplit pour faire passer du code : c'est le comportement qu'on
  // voulait, écrit noir sur blanc. Le reste de la chaîne est intact —
  // ni les chiffres, ni les tirets, ni les espaces ne bougent.
  assert.equal(normaliser("chiffre d'affaires 2026"), "chiffre d affaires 2026");
  assert.equal(normaliser("sous-tarif 2026"), "sous-tarif 2026");
});

// ==================================================================
// 5. §11Z — L'APOSTROPHE NE DÉCIDE PLUS
// ==================================================================

test("l'apostrophe droite, la typographique et l'espace donnent le même agent", () => {
  // LE DÉFAUT ÉTAIT RÉEL ET MUET. Un iPhone substitue automatiquement
  // U+2019 à l'apostrophe droite : « aujourd’hui » ne correspondait à
  // AUCUNE des deux graphies déclarées par la Direction (« aujourd'hui »
  // et « aujourd hui »), et la question partait au repli — c'est-à-dire
  // à la Direction quand même, mais d'un cran plus bas et sans raison
  // affichée. Sur un mot-clé moins chanceux, elle serait partie chez le
  // mauvais agent.
  const droite = String.fromCharCode(0x27);
  const typographique = String.fromCharCode(0x2019);

  for (const apostrophe of [droite, typographique]) {
    const resultat = aiguiller(`Que dois-je faire aujourd${apostrophe}hui ?`);
    assert.equal(resultat.agent, "executive", `apostrophe U+${apostrophe.charCodeAt(0).toString(16)}`);
    assert.equal(
      resultat.complexite,
      undefined,
      "la question est comprise : elle ne doit pas passer par le repli à complexité simple",
    );
  }

  assert.equal(
    normaliser(`chiffre d${typographique}affaires`),
    normaliser("chiffre d'affaires"),
    "les deux apostrophes doivent se replier sur la même chaîne",
  );
});

test("une apostrophe dans la question ne rend plus obligatoire une seconde graphie", () => {
  // La Finance déclare « chiffre d'affaires » ET « chiffre d affaires ».
  // Les deux fonctionnent, et il n'en faudrait plus qu'une. On ne
  // retire pas la seconde ici — ce serait toucher au fichier d'un autre
  // agent pour un gain nul — mais on vérifie que la duplication n'est
  // plus la condition du bon fonctionnement.
  for (const question of [
    "Quel est mon chiffre d'affaires ?",
    `Quel est mon chiffre d${String.fromCharCode(0x2019)}affaires ?`,
    "Quel est mon chiffre d affaires ?",
  ]) {
    assert.equal(aiguiller(question).agent, "finance", question);
  }
});

// ==================================================================
// 6. §11Z — L'ORDRE EST UNE DÉCISION, ET ELLE SE RELIT
// ==================================================================

test("l'ORDRE ne nomme que des agents composés, ou des absences déclarées", () => {
  // UN SAUT SILENCIEUX SERAIT INDISTINGUABLE D'UNE FAUTE DE FRAPPE.
  // `reglesActives()` ignore un agent que `DEFINITIONS` ne connaît pas,
  // ce qui est la bonne tolérance tant que deux chantiers écrivent des
  // agents en parallèle — mais une tolérance sans borne laisse un agent
  // mal orthographié disparaître de l'aiguillage sans rien casser. Sa
  // question part alors à la Direction : la panne rassurante.
  for (const cle of ORDRE) {
    const compose = cle in DEFINITIONS;
    const attendu = EN_ATTENTE_INTEGRATION.includes(cle);
    assert.ok(
      compose || attendu,
      `« ${cle} » est dans l'ORDRE, absent de DEFINITIONS, et pas déclaré en attente : ` +
        "soit c'est une faute de frappe, soit l'intégration a oublié de l'inscrire",
    );
    assert.ok(
      !(compose && attendu),
      `« ${cle} » est composé ET déclaré en attente : retirez-le de EN_ATTENTE_INTEGRATION, ` +
        "sinon la tolérance ne se refermera jamais",
    );
  }
});

test("aucun agent composé n'est oublié de l'ORDRE, et aucun n'y figure deux fois", () => {
  // Un agent absent de l'ORDRE a des mots-clés que personne n'essaie :
  // il est achevé, joignable en théorie, et inatteignable en fait.
  for (const cle of Object.keys(DEFINITIONS)) {
    assert.ok(ORDRE.includes(cle as (typeof ORDRE)[number]), `« ${cle} » n'est pas dans l'ORDRE`);
  }
  assert.equal(new Set(ORDRE).size, ORDRE.length, "un agent figure deux fois dans l'ORDRE");
});

test("aucun mot-clé n'en vole un autre, une fois les Ventes en place", () => {
  // LA RÈGLE QUE LE TEST EXISTANT NE COUVRAIT PAS. Deux agents qui
  // revendiquent le même mot étaient déjà refusés (`agents/index.test.ts`).
  // Un mot COURT qui est une sous-chaîne du mot LONG d'un autre agent,
  // essayé plus tard, ne l'était pas — et c'est pourtant lui le vol :
  // toute question qui dit le mot long contient le mot court.
  //
  // Le cas qui a failli passer : « affaire » pour les Ventes est
  // contenu dans « chiffre d'affaires » pour la Finance, placée après.
  // Il aurait volé « quel est mon chiffre d'affaires ». D'où les trois
  // locutions du fichier `agents/sales.ts` au lieu du mot nu.
  const anomalies = anomaliesDAiguillage([...reglesActives(DEFINITIONS)], normaliser);
  assert.deepEqual(
    anomalies.map((a) => `${a.genre} : ${a.message}`),
    [],
    "l'aiguillage se vole lui-même",
  );
});

// ==================================================================
// 7. §11Z — LES VENTES : LA FENÊTRE REFERMÉE, ET RIEN D'AUTRE
// ==================================================================

test("les questions sur le devenir d'un devis DÉCIDÉ vont aux Ventes", () => {
  for (const question of [
    "Où en est mon pipeline ?",
    "Combien de prospects cette année ?",
    "Quelles opportunités sont en négociation ?",
    "Quel est mon taux de transformation ?",
    "Quel est mon taux de signature ?",
    "Quel est mon taux de conversion ?",
    "Combien de devis signés depuis janvier ?",
    "Combien de devis refusés cette année ?",
    "Quel motif de refus revient le plus ?",
    "Quels sont mes motifs de refus ?",
    "Mon cycle de vente s'allonge-t-il ?",
    "Cette affaire perdue, on sait pourquoi ?",
    "Combien d'affaires signées ce trimestre ?",
  ]) {
    assert.equal(aiguillerApresIntegration(question).agent, "sales", question);
  }
});

test("un devis PRÉCIS reste au Chiffrage, même quand on parle de son refus", () => {
  // LA FRONTIÈRE N'EST PAS LE MOT « REFUS », C'EST LA POPULATION.
  //
  // Les Ventes possèdent l'AGRÉGAT des motifs de refus — « quels motifs
  // reviennent », qui est un regroupement sur `quotes.rejection_reason`
  // que personne d'autre ne calcule. Un devis DÉSIGNÉ, lui, reste au
  // Chiffrage : c'est lui qui a `ai_quote_price_analysis`, qui rend le
  // prix, le coût, la marge et la cible de CE devis-là.
  //
  // Mesuré : « pourquoi ce devis a-t-il été refusé ? » n'appelle pas la
  // locution « devis refus » — les deux mots ne se touchent pas — et
  // tombe donc au Chiffrage sur « devis ». C'est le bon destinataire, et
  // ce n'est pas un hasard heureux : c'est la conséquence directe du
  // choix de n'écrire que des locutions contiguës pour les Ventes.
  assert.equal(
    aiguillerApresIntegration("Pourquoi ce devis a-t-il été refusé ?").agent,
    "quotePricing",
  );
});

test("LA RELANCE : une facture reste à la Facturation, un devis au Chiffrage, le CRM aux Ventes", () => {
  // ══════════════════════════════════════════════════════════════
  // LE CONFLIT QUE CE CHANTIER DEVAIT TRANCHER, ET IL EST À TROIS
  // ══════════════════════════════════════════════════════════════
  //
  // On aurait pu croire à deux camps — relance de facture d'un côté,
  // relance de devis de l'autre. Il y en a trois, et c'est la lecture
  // du catalogue d'actions qui le dit :
  //
  //   • RELANCE DE FACTURE → Facturation. C'est elle qui porte l'argent
  //     dû, et « factur » est le premier mot essayé de tout l'ORDRE.
  //   • RELANCE DE DEVIS → Chiffrage. L'action existe déjà au
  //     catalogue : `quoteFollowUp`, agent `quote_pricing`, droit
  //     `quotes.edit`. Et le devis à relancer est un devis ENCORE
  //     OUVERT, c'est-à-dire la population de `ai_executive_brief`
  //     sections 2 et 3 — pas celle des Ventes, qui commence à
  //     `decided_at`.
  //   • RELANCE COMMERCIALE → Ventes. Ce sont les `crm_activities`
  //     échues, que personne d'autre ne lit.
  //
  // ─── POURQUOI PAS « relance de devis → Ventes », QUI SEMBLAIT
  //     ÉVIDENT ───
  //
  // Parce que l'agent Ventes s'interdit explicitement de proposer
  // `quoteFollowUp` : il dirait « c'est au Chiffrage » APRÈS avoir fait
  // payer un appel de modèle. L'en-tête de `aiguillage.ts` nomme
  // précisément ce défaut — remplacer un agent qui répond par un agent
  // qui décline. Le mot-clé « relanc » nu l'aurait produit deux fois.
  const attendus: readonly [string, string][] = [
    ["Relancer cette facture", "billing"],
    ["Quelles relances de facture dois-je faire ?", "billing"],
    // Au SINGULIER, parce que la Facturation ne déclare que
    // « relance de paiement » : « relances de paiement » ne contient
    // pas cette chaîne et tombe aujourd'hui à la Direction. Le défaut
    // est réel, il est ANTÉRIEUR à ce chantier, et il vit dans
    // `agents/billing.ts` — hors du périmètre de ce constructeur. Il
    // est signalé au compte rendu plutôt que corrigé en douce dans le
    // fichier d'un autre : réparer le travail à moitié écrit d'un
    // voisin, c'est le détruire.
    ["Où en est ma relance de paiement ?", "billing"],
    ["Relancer ce devis", "quotePricing"],
    ["Quels devis faut-il relancer ?", "quotePricing"],
    ["Quelles relances commerciales sont en retard ?", "sales"],
    ["Ma relance commerciale de mardi", "sales"],
  ];
  for (const [question, agent] of attendus) {
    assert.equal(aiguillerApresIntegration(question).agent, agent, question);
  }
});

test("les Ventes ne prennent pas le mot « devis » nu : il reste au Chiffrage", () => {
  // Les Ventes sont essayées AVANT le Chiffrage, ce qui les rendrait
  // capables de tout rafler si elles portaient « devis ». Elles portent
  // deux locutions plus longues — « devis signe », « devis refus » — et
  // c'est le mécanisme normal de cet aiguilleur : le mot long gagne
  // quand son propriétaire est essayé le premier, le mot nu revient à
  // l'autre.
  for (const question of [
    "Ce devis est-il bien chiffré ?",
    "Quel taux de marque sur ce devis ?",
    "Ce devis est-il sous la marge cible ?",
    "Prépare-moi le chiffrage de ce devis",
  ]) {
    assert.equal(aiguillerApresIntegration(question).agent, "quotePricing", question);
  }
});

test("les Ventes ne volent aucune question d'argent : la Finance garde les siennes", () => {
  // « affaire » est contenu dans « chiffre d'affaires », et les Ventes
  // sont essayées AVANT la Finance. C'est la raison d'être des
  // locutions ; sans elles, cette liste tomberait entière chez les
  // Ventes, qui ne rendent aucun euro.
  for (const question of [
    "Quel est mon chiffre d'affaires ce trimestre ?",
    "Mon chiffre d'affaires signé est-il en hausse ?",
    "Comment va ma trésorerie ?",
    "Est-ce que je tiens mon objectif de marge ?",
  ]) {
    assert.equal(aiguillerApresIntegration(question).agent, "finance", question);
  }
});

test("l'ajout des Ventes ne déplace AUCUNE question déjà aiguillée", () => {
  // ══════════════════════════════════════════════════════════════
  // LE TEST QUI COMPTE LE PLUS DE CETTE SECTION
  // ══════════════════════════════════════════════════════════════
  //
  // Insérer un agent en deuxième position de l'ORDRE est le geste le
  // plus dangereux qu'on puisse faire ici : il passe devant onze autres
  // sans qu'aucun d'eux ne le sache. La régression de §11Y — six agents
  // muets à qui l'on donne leurs mots-clés d'un coup, et des questions
  // d'argent qui partent aux Chantiers — est arrivée exactement comme
  // cela, et la suite est restée verte.
  //
  // On rejoue donc TOUTES les questions des sections précédentes, avec
  // les Ventes actives, et on exige le même destinataire qu'avant.
  const inchanges: readonly [string, string][] = [
    ["Qu'est-ce que je dois facturer ?", "billing"],
    ["Quelles sont mes factures impayées ?", "billing"],
    ["Prépare un brouillon de facture pour les Dupont", "billing"],
    ["Où en sont mes encaissements ?", "billing"],
    ["Facturer les devis signés", "billing"],
    ["Ce devis est-il bien chiffré ?", "quotePricing"],
    ["Quel taux de marque sur ce dossier ?", "quotePricing"],
    ["Suis-je sous-tarifé sur les terrasses ?", "quotePricing"],
    ["Quel est mon chiffre d'affaires ce trimestre ?", "finance"],
    ["Comment va ma trésorerie ?", "finance"],
    ["Mes créances augmentent-elles ?", "finance"],
    ["Est-ce que je tiens mon objectif de marge ?", "finance"],
    ["Quelle rentabilité sur ce chantier ?", "finance"],
    ["Quelle est la marge du chantier Dupont ?", "finance"],
    ["Mes dépenses de pépinière", "finance"],
    ["Où en est le chantier Mairie ?", "operations"],
    ["Où en est mon stock de cycas ?", "nursery"],
    ["Quels chantiers sont en retard ?", "operations"],
    ["Qu'est-ce qui est posé la semaine prochaine ?", "planning"],
    ["Combien de cycas j'ai en stock ?", "nursery"],
    ["Quel est le contrôle technique du camion ?", "fleet"],
    ["Combien ce client m'a rapporté ?", "customer"],
    ["Que dois-je faire aujourd'hui ?", "executive"],
    ["Fais-moi un brief", "executive"],
    ["Quelles sont mes priorités ?", "executive"],
    ["Qu'est-ce qui est urgent ?", "executive"],
    ["Que dois-je commander ?", "executive"],
    ["Quels sont mes fournisseurs ?", "executive"],
    ["Où en est tout ça ?", "executive"],
    ["Est-ce que ça se passe bien avec les Martin en ce moment ?", "executive"],
  ];

  for (const [question, agent] of inchanges) {
    assert.equal(
      aiguillerApresIntegration(question).agent,
      agent,
      `« ${question} » n'allait pas aux Ventes avant, et ne doit pas y aller maintenant`,
    );
    // ET LE MÊME RÉSULTAT SANS LES VENTES : c'est ce qui prouve que le
    // destinataire n'a pas changé, plutôt que d'affirmer un attendu
    // recopié à la main.
    assert.equal(aiguiller(question).agent, agent, `« ${question} » a changé de destinataire`);
  }
});

// ==================================================================
// 8. §11Z — LE CLASSEMENT NE RÉPOND À RIEN
// ==================================================================

test("l'étape de Classement n'est atteinte par aucune question", () => {
  // Elle tourne AVANT la conversation, pas dedans. Lui donner des
  // mots-clés la rendrait joignable, donc capable de répondre, donc
  // concurrente des treize autres.
  assert.ok(!ORDRE.includes("classification" as (typeof ORDRE)[number]));
  for (const question of [
    "Classe ces activités",
    "À quelle catégorie appartient cette note ?",
    "Range mes éléments par type",
  ]) {
    const resultat = aiguillerApresIntegration(question);
    assert.notEqual(resultat.agent, "classification", question);
    assert.equal(resultat.agent, "executive", question);
  }
});
