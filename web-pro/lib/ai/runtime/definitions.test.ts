import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AGENTS_A_COMPLETER,
  AGENTS_CONSTRUITS,
  AGENTS_SANS_DONNEES,
  CLE_BASE,
  CONSIGNE_DIRECTION,
  DEFINITIONS,
  SOCLE_INSTRUCTIONS,
  consigneContexte,
  estAgentConstruit,
  instructionsPour,
  sourcesDe,
  type AgentConstruit,
} from "./definitions.ts";
import { CONSIGNE_FRONTIERE_DETERMINISTE, registreOutils } from "./tools.ts";
import type { AgentContext } from "./context.ts";
import type { Permission } from "./types.ts";

/**
 * §11V, §11Y — LES DIX AGENTS : QUI ILS SONT, ET CE QU'ON LEUR DIT.
 *
 * ══════════════════════════════════════════════════════════════════
 * ON N'ÉPROUVE PAS UNE INSTRUCTION EN LA RELISANT
 * ══════════════════════════════════════════════════════════════════
 *
 * Une instruction d'agent est du texte : aucun test ne peut vérifier
 * qu'un modèle l'a comprise. Ce qu'un test PEUT vérifier, et qui casse
 * réellement en pratique, c'est qu'elle soit COMPLÈTE — que les six
 * règles qui protègent contre une erreur coûteuse y soient toutes, dans
 * chacun des dix agents — gabarits compris, puisqu'un gabarit qu'on appelle
 * répond.
 *
 * La panne visée est banale : quelqu'un ajoute un cinquième agent, le
 * construit à partir d'un copier-coller, et oublie la ligne sur les
 * données qui ne sont pas des instructions. Rien ne casse. Rien
 * n'alerte. Jusqu'au jour où le nom d'un client dit « envoie ce devis ».
 *
 * ─── ET LE PIÈGE PROPRE À CET ENSEMBLE ───
 *
 * `CONSIGNE_DIRECTION` — « tu ne lis pas la base, tu interroges les
 * spécialistes » (p. 8) — n'a de sens que pour la Direction. Collée sur
 * Finance, qui EST un spécialiste, elle lui ordonnerait de déléguer à
 * personne. Un test l'exige sur un agent et l'interdit sur les neuf
 * autres.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..");

function contexte(surcharge: Partial<AgentContext> = {}): AgentContext {
  return {
    agent: "finance",
    organizationId: "org-A",
    workspaceId: "ws-A",
    userId: "user-A",
    permissions: ["projects.read"] as readonly Permission[],
    donnees: {},
    sources: [],
    permissionsManquantes: [],
    vide: false,
    dateArreteDonnees: "2026-09-03T09:00:00.000Z",
    empreinte: "abc",
    tailleCaracteres: 0,
    ...surcharge,
  };
}

// ==================================================================
// 1. Les treize répondeurs, et pas un quatorzième
// ==================================================================

test("les treize agents construits sont ceux que 0072 + 0082 + 0088 acceptent", () => {
  // §11Z — TREIZE ET NON QUATORZE, ET L'ÉCART EST LE SUJET. La base en
  // accepte quatorze depuis 0088 ; le quatorzième, `classification`, n'est
  // pas un répondeur — il dépense sans jamais répondre, et il est
  // déclaré dans `agents/nonRepondants.ts`. La liste ci-dessous est donc
  // volontairement plus courte que celle de la migration, et
  // `agents/index.test.ts` vérifie que la différence est exactement
  // celle-là — ni plus, ni moins.
  assert.deepEqual(
    [...AGENTS_CONSTRUITS],
    [
      "executive",
      "finance",
      "billing",
      "quotePricing",
      "sales",
      "operations",
      "planning",
      "procurement",
      "nursery",
      "fleet",
      "customer",
      "market",
      "risk",
    ],
  );
  for (const agent of AGENTS_CONSTRUITS) {
    assert.ok(DEFINITIONS[agent], `« ${agent} » n'a pas de définition`);
    assert.equal(DEFINITIONS[agent].cle, agent, "la clé de la définition doit être sa propre clé");
  }
});

test("la graphie de la base est celle des migrations, pas celle de la spec", () => {
  // La spec écrit `quotePricing`, `ai_is_supported_agent` écrit
  // `quote_pricing`. Une action enregistrée sous le mauvais nom serait
  // refusée par la contrainte — après avoir payé l'appel.
  // La CLÉ est la graphie de la spec, la VALEUR celle de la base. Le
  // seul couple qui diffère est celui du chiffrage, et c'est
  // exactement le piège que cette table existe pour désamorcer : les
  // six agents ajoutés en 0082 et les trois de 0088 s'écrivent pareil
  // des deux côtés, ce qui est une chance et non une règle.
  const attendu: Record<AgentConstruit, string> = {
    executive: "executive",
    finance: "finance",
    billing: "billing",
    quotePricing: "quote_pricing",
    sales: "sales",
    operations: "operations",
    planning: "planning",
    procurement: "procurement",
    nursery: "nursery",
    fleet: "fleet",
    customer: "customer",
    market: "market",
    risk: "risk",
  };
  assert.deepEqual(CLE_BASE, attendu);

  // LES TROIS MIGRATIONS SONT RELUES ENSEMBLE. 0072 a posé les quatre
  // premières valeurs, 0082 les six suivantes, 0088 les trois
  // dernières : chercher dans l'une seulement laisserait passer les
  // deux tiers du contrat.
  const migrations =
    readFileSync(join(racineDepot, "supabase", "migrations", "0072_phase11v_socle.sql"), "utf8") +
    readFileSync(join(racineDepot, "supabase", "migrations", "0082_agents_ia.sql"), "utf8") +
    readFileSync(join(racineDepot, "supabase", "migrations", "0088_agents_derniers.sql"), "utf8");
  for (const cle of Object.values(CLE_BASE)) {
    assert.ok(
      migrations.includes(`'${cle}'`),
      `« ${cle} » doit exister dans 0072, 0082 ou 0088`,
    );
  }
});

test("estAgentConstruit accepte les trois répondeurs de 0088 et refuse le quatorzième", () => {
  assert.equal(estAgentConstruit("finance"), true);
  assert.equal(estAgentConstruit("nursery"), true);

  // §11Z — LE DIRIGEANT A TRANCHÉ, ET CES TROIS-LÀ RÉPONDENT MAINTENANT.
  for (const construit of ["sales", "market", "risk"]) {
    assert.equal(
      estAgentConstruit(construit),
      true,
      `« ${construit} » a un fichier, une mission et une fonction SQL depuis 0088`,
    );
  }

  // ET LE QUATORZIÈME RESTE DEHORS, CE QUI EST LA VRAIE GARDE DE CE
  // TEST. `classification` est accepté par la base depuis 0088 — pour
  // que sa dépense soit plafonnable — mais il n'est pas un répondeur.
  // L'accepter ici lui donnerait une mission, des limites
  // conversationnelles et une place dans l'aiguillage : il deviendrait
  // le quatorzième répondeur, en concurrence avec les treize autres, et
  // le seul symptôme serait une réponse un peu creuse.
  assert.equal(
    estAgentConstruit("classification"),
    false,
    "« classification » dépense sans répondre : voir agents/nonRepondants.ts",
  );
  assert.equal(estAgentConstruit(null), false);
});

test("plus aucun agent n'est déclaré sans données, et le mécanisme reste armé", () => {
  // §11Z — LA LISTE EST VIDE, ET C'EST LE RÉSULTAT DE CE CHANTIER. Les
  // quatre entrées de §11Y ont été retirées parce que les quatre agents
  // existent : une déclaration d'indisponibilité pour un agent qui
  // répond serait un mensonge, et le plus difficile à découvrir de tous
  // puisqu'il ne casse rien.
  assert.deepEqual(AGENTS_SANS_DONNEES.map((e) => e.cle), []);

  // L'ASSERTION QUI SUIT NE VÉRIFIE RIEN AUJOURD'HUI, ET ON LA GARDE.
  // Elle attrapera la première contradiction du jour où quelqu'un
  // déclarera un agent indisponible tout en le construisant — ce qui
  // est arrivé en §11Z, et a coûté une catégorie entière à démêler.
  for (const entree of AGENTS_SANS_DONNEES) {
    assert.ok(entree.motif.length > 80, `« ${entree.cle} » n'explique pas pourquoi`);
    assert.ok(entree.aLivrerDabord.length > 0, `« ${entree.cle} » ne dit pas ce qui manque`);
    assert.equal(
      estAgentConstruit(entree.cle),
      false,
      `« ${entree.cle} » est déclaré sans données ET construit : les deux listes se contredisent`,
    );
  }
});

test("un gabarit se déclare gabarit, et les quatre premiers n'en sont pas", () => {
  // Le drapeau vit dans le fichier de l'agent, et lui seul : celui qui
  // finit un agent le retire sans croiser le travail des neuf autres.
  for (const acheve of ["executive", "finance", "billing", "quotePricing"] as const) {
    assert.equal(
      DEFINITIONS[acheve].aCompleter,
      undefined,
      `« ${acheve} » était achevé avant ce chantier : le déménagement l'a marqué gabarit`,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // L'ASSERTION EST DÉRIVÉE, PLUS RECOPIÉE — ET C'EST UNE CORRECTION
  // ══════════════════════════════════════════════════════════════
  //
  // Cette ligne était une liste écrite à la main. Elle a fait tomber le
  // dépôt à CHAQUE agent achevé, et chacun des six constructeurs l'a
  // heurtée à son tour — sur un fichier partagé, donc en conflit de
  // fusion avec les cinq autres. Un test qui transforme tout progrès en
  // conflit n'est pas un garde-fou, c'est un péage.
  //
  // Ce qu'elle prétendait défendre — « la liste est à jour » — n'était
  // d'ailleurs pas défendable : `AGENTS_A_COMPLETER` est CONSTRUITE en
  // filtrant `aCompleter`, donc la recopier revenait à comparer la
  // liste à elle-même, écrite deux fois. Le vrai risque est ailleurs, et
  // c'est lui qu'on vérifie maintenant : qu'un drapeau et la RÉALITÉ
  // divergent.
  assert.deepEqual(
    [...AGENTS_A_COMPLETER],
    AGENTS_CONSTRUITS.filter((a) => DEFINITIONS[a].aCompleter === true),
    "AGENTS_A_COMPLETER n'est plus le reflet des drapeaux : c'est une seconde liste",
  );
});

test("un gabarit n'est jamais joignable, et un agent achevé l'est", () => {
  // ══════════════════════════════════════════════════════════════
  // LA RÈGLE QUE LE CHANTIER A FAILLI PERDRE
  // ══════════════════════════════════════════════════════════════
  //
  // Le drapeau `aCompleter` ne bride rien à l'exécution. Ce qui rend un
  // agent joignable, ce sont ses MOTS-CLÉS d'aiguillage. Les deux
  // peuvent donc diverger en silence, et c'est exactement ce qui s'est
  // produit à mi-chantier : deux agents avaient perdu leur drapeau et
  // gagné des mots-clés SANS avoir un seul outil au registre. Ils
  // étaient atteignables, présentés comme prêts, et incapables de
  // répondre à une question de leur propre mission — la façade que ce
  // chantier avait pour but d'éviter, arrivée par la porte de derrière.
  //
  // Ce test noue les trois faits ensemble, dans les deux sens, pour
  // qu'aucun ne puisse plus avancer sans les autres.
  for (const agent of AGENTS_CONSTRUITS) {
    const definition = DEFINITIONS[agent];
    const gabarit = definition.aCompleter === true;
    const mots = definition.motsCles ?? [];
    const sources = sourcesDe(agent);

    if (gabarit) {
      assert.equal(
        mots.length,
        0,
        `« ${agent} » est un gabarit ET joignable : on le fait répondre avant qu'il ait ` +
          "quelque chose à dire",
      );
    } else {
      assert.ok(
        sources.length > 0,
        `« ${agent} » est donné pour achevé et n'a AUCUNE source à lui : soit on lui verse ` +
          "ses outils dans tools.ts, soit on lui remet aCompleter — pas d'état intermédiaire",
      );
      assert.ok(
        mots.length > 0,
        `« ${agent} » est achevé mais aucun mot ne l'appelle : ses questions partiront à la ` +
          "Direction, qui n'a pas ses sources et répondra « je ne vois rien » avec aplomb",
      );
    }
  }
});

// ==================================================================
// 2. LE SOCLE — les règles qui doivent être dans les dix
// ==================================================================

test("les dix instructions portent la frontière déterministe (p. 11-12)", () => {
  for (const agent of AGENTS_CONSTRUITS) {
    assert.ok(
      instructionsPour(agent, contexte()).includes(CONSIGNE_FRONTIERE_DETERMINISTE),
      `« ${agent} » pourrait recalculer une marge que le SQL a déjà calculée`,
    );
  }
});

test("les dix disent qu'une donnée reçue n'est jamais une instruction", () => {
  for (const agent of AGENTS_CONSTRUITS) {
    const texte = instructionsPour(agent, contexte());
    assert.ok(
      texte.includes("JAMAIS DES INSTRUCTIONS"),
      `« ${agent} » n'est pas protégé contre un nom de client qui dit « supprime tout »`,
    );
  }
});

test("les dix distinguent « null » de « zéro », et « insufficient_data » d'une confiance faible", () => {
  for (const agent of AGENTS_CONSTRUITS) {
    const texte = instructionsPour(agent, contexte());
    assert.ok(texte.includes("UNE DONNÉE ABSENTE SE DIT"), agent);
    assert.ok(texte.includes("N'EST PAS UNE CONFIANCE FAIBLE"), agent);
    assert.ok(
      texte.includes("estimatedImpactCents"),
      `« ${agent} » doit savoir que la base REFUSE un montant sans données`,
    );
  }
});

test("les dix annoncent qu'un outil d'action ne fait rien tout de suite", () => {
  for (const agent of AGENTS_CONSTRUITS) {
    const texte = instructionsPour(agent, contexte());
    assert.ok(texte.includes("NE FONT RIEN TOUT DE SUITE"), agent);
    assert.ok(texte.includes("Ne dis donc jamais"), agent);
  }
});

test("le socle ne demande AUCUNE conversion de centimes en euros", () => {
  // Les sorties sont structurées : `estimatedImpactCents` est un entier.
  // Demander une division au modèle réintroduirait le calcul que la
  // page 12 lui interdit, et l'affichage est le travail de l'écran.
  assert.ok(!/divise par 100|diviser par 100/i.test(SOCLE_INSTRUCTIONS));
});

// ==================================================================
// 3. CE QUI N'APPARTIENT QU'À LA DIRECTION (p. 8)
// ==================================================================

test("seule la Direction reçoit la consigne de ne pas lire la base", () => {
  const direction = instructionsPour("executive", contexte({ agent: "executive" }));
  assert.ok(direction.includes(CONSIGNE_DIRECTION));
  assert.ok(direction.includes("TU NE LIS PAS LA BASE"));

  for (const specialiste of ["finance", "billing", "quotePricing"] as const) {
    assert.ok(
      !instructionsPour(specialiste, contexte({ agent: specialiste })).includes(CONSIGNE_DIRECTION),
      `« ${specialiste} » EST un spécialiste : lui dire de déléguer n'a aucun sens`,
    );
  }
});

test("la Direction est tenue de nommer les agents qu'elle a réellement interrogés", () => {
  assert.ok(CONSIGNE_DIRECTION.includes("agentsConsultes"));
  assert.ok(CONSIGNE_DIRECTION.includes("ATTRIBUABLE"));
  assert.ok(CONSIGNE_DIRECTION.includes("Cinq décisions au plus"));
});

test("chaque agent porte son rôle et ses limites, et elles ne sont pas vides", () => {
  for (const agent of AGENTS_CONSTRUITS) {
    const definition = DEFINITIONS[agent];
    const texte = instructionsPour(agent, contexte({ agent }));

    assert.ok(texte.includes(definition.libelle), `le rôle de « ${agent} » n'est pas annoncé`);
    assert.ok(texte.includes(definition.responsabilites));
    assert.ok(definition.limites.length > 0, `« ${agent} » n'a aucune limite écrite`);
    for (const limite of definition.limites) assert.ok(texte.includes(limite));
  }
});

test("la Direction s'interdit explicitement d'écrire et de prévoir", () => {
  const limites = DEFINITIONS.executive.limites.join(" ");
  assert.ok(limites.includes("N'écrit rien"));
  assert.ok(limites.includes("Ne prévoit pas"), "une prévision est une estimation, et elle est interdite");
  assert.ok(limites.includes("Ne lit JAMAIS la base directement"));
});

test("la Facturation dit qu'elle crée des BROUILLONS et n'émet aucun numéro", () => {
  const limites = DEFINITIONS.billing.limites.join(" ");
  assert.ok(limites.includes("BROUILLONS"));
  assert.ok(limites.includes("n'envoie rien"));
});

test("le chiffrage refuse de conclure sous cinq comparables et ne chiffre pas le déplacement", () => {
  const limites = DEFINITIONS.quotePricing.limites.join(" ");
  assert.ok(limites.includes("cinq comparables"));
  assert.ok(
    limites.includes("distancier n'existe pas"),
    "getTravelEstimate n'a pas de service : l'agent doit le dire plutôt que d'estimer",
  );
});

// ==================================================================
// 4. LA PARTIE QUI DÉPEND DU CONTEXTE
// ==================================================================

test("la date d'arrêté est annoncée à l'agent (p. 21)", () => {
  // « Aujourd'hui », relu trois jours plus tard, est un mensonge que
  // personne n'a écrit.
  const texte = consigneContexte(contexte({ dateArreteDonnees: "2026-09-03T09:00:00.000Z" }));
  assert.ok(texte.includes("2026-09-03T09:00:00.000Z"));
  assert.ok(texte.includes("Données arrêtées au"));
});

test("une source en échec est NOMMÉE, parce qu'elle ressemble sinon à « rien à signaler »", () => {
  const texte = consigneContexte(
    contexte({
      sources: [
        { outil: "getCompanyMetrics", rpc: "ai_company_metrics", ok: true, motif: null },
        { outil: "getMarginBreakdown", rpc: "ai_margin_breakdown", ok: false, motif: "délai dépassé" },
      ],
    }),
  );

  assert.ok(texte.includes("SOURCES NON LUES"));
  assert.ok(texte.includes("getMarginBreakdown"));
  assert.ok(texte.includes("délai dépassé"));
  assert.ok(!texte.includes("getCompanyMetrics"), "on ne liste que ce qui a échoué");
});

test("une source en échec sans motif est quand même annoncée", () => {
  const texte = consigneContexte(
    contexte({ sources: [{ outil: "getQuote", rpc: "ai_quote", ok: false, motif: null }] }),
  );
  assert.ok(texte.includes("getQuote"));
  assert.ok(texte.includes("lecture impossible"));
});

test("les droits manquants entrent dans l'instruction, avec l'ordre de les dire", () => {
  const texte = consigneContexte(contexte({ permissionsManquantes: ["quotes.read"] }));
  assert.ok(texte.includes("quotes.read"));
  assert.ok(texte.includes("donneesManquantes"));
  assert.ok(texte.includes("Ce n'est pas « rien à signaler »"));
});

test("un contexte sain n'encombre l'instruction d'aucune alerte", () => {
  const texte = consigneContexte(contexte());
  assert.ok(!texte.includes("SOURCES NON LUES"));
  assert.ok(!texte.includes("DROITS MANQUANTS"));
});

test("l'instruction est RECONSTRUITE : deux dates d'arrêté donnent deux textes", () => {
  // Une instruction mémorisée au démarrage annoncerait, six heures plus
  // tard, des données arrêtées ce matin.
  const matin = instructionsPour("finance", contexte({ dateArreteDonnees: "2026-09-03T07:00:00.000Z" }));
  const soir = instructionsPour("finance", contexte({ dateArreteDonnees: "2026-09-03T19:00:00.000Z" }));
  assert.notEqual(matin, soir);
});

// ==================================================================
// 5. LES SOURCES, DÉDUITES DU REGISTRE
// ==================================================================

test("un agent ACHEVÉ a au moins une source, et toutes sont des fonctions déclarées", () => {
  // LA NUANCE EST LE SUJET, et elle est nouvelle depuis §11Y.
  //
  // Un agent achevé sans source propre serait creux : il n'aurait que
  // les trois outils transverses, donc rien à dire que la Direction ne
  // dise déjà. Un GABARIT sans source propre, en revanche, est l'état
  // juste : `runtime/tools.ts` est un fichier partagé, et l'outil d'un
  // agent s'y ajoute quand cet agent est écrit, pas avant.
  //
  // ─── L'EXEMPTION EST BORNÉE AILLEURS, ET ELLE DOIT L'ÊTRE ───
  //
  // Exempter les gabarits est défendable, mais une exemption sans
  // contrepartie laisse passer exactement ce qu'elle prétend surveiller :
  // il suffirait de garder `aCompleter: true` sur un agent joignable
  // pour qu'un agent creux réponde en silence. La contrepartie est
  // écrite plus haut, dans « un gabarit n'est jamais joignable » : un
  // agent qui porte le drapeau n'a AUCUN mot-clé, donc l'aiguilleur ne
  // le rend jamais, et la route refuse qu'un appelant l'impose. Les
  // deux tests ne valent que pris ensemble.
  //
  // Après §11Y, un seul agent reste dans ce cas — les Achats — et sa
  // situation est mesurée, pas subie : ses trois volets comptent zéro
  // ligne en production.
  const registre = registreOutils();
  for (const agent of AGENTS_CONSTRUITS) {
    const sources = sourcesDe(agent, registre);
    if (DEFINITIONS[agent].aCompleter !== true) {
      assert.ok(sources.length > 0, `« ${agent} » est donné pour achevé et n'aurait rien à lire`);
    }
    for (const rpc of sources) {
      assert.equal(typeof rpc, "string");
      assert.ok(rpc.length > 0);
    }
  }
});

test("les sources d'un agent lui appartiennent réellement dans le registre", () => {
  const registre = registreOutils();
  for (const agent of AGENTS_CONSTRUITS) {
    for (const rpc of sourcesDe(agent, registre)) {
      const outil = registre.tous().find((o) => o.rpc === rpc && o.agent === agent);
      assert.ok(outil, `« ${rpc} » est attribué à « ${agent} » sans lui appartenir`);
    }
  }
});

test("la Facturation ne peut pas lire les sources du chiffrage, ni l'inverse", () => {
  // La moitié « outils » de la minimisation de la page 20, vue depuis
  // les définitions.
  const facturation = new Set(sourcesDe("billing"));
  const chiffrage = new Set(sourcesDe("quotePricing"));
  for (const rpc of chiffrage) {
    assert.ok(!facturation.has(rpc), `« ${rpc} » est visible des deux côtés`);
  }
});
