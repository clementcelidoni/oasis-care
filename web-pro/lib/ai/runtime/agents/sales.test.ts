import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { AGENT_VENTES } from "./sales.ts";
import { AGENTS_SANS_DONNEES } from "./sansDonnees.ts";
import { DEFINITIONS } from "./index.ts";
import { OUTIL_SALES_FLOW } from "../outils/sales.ts";

/**
 * §11Z — L'AGENT VENTES, ÉPROUVÉ AVANT D'ÊTRE COMPOSÉ.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QU'ON DÉFEND ICI, ET CE N'EST PAS « LE TEXTE EST JOLI »
 * ══════════════════════════════════════════════════════════════════
 *
 * Un fichier de définition n'exécute rien : il n'est que du texte
 * envoyé à un modèle. On ne peut donc pas éprouver son comportement, et
 * il serait facile de conclure qu'il n'y a rien à tester. C'est faux, et
 * pour une raison précise : LES LIMITES SONT LA SEULE BARRIÈRE entre un
 * agent et une phrase inventée. Elles sont recopiées dans l'instruction
 * par `instructionsPour()`, et si l'une d'elles disparaît — dans une
 * reformulation, une fusion, un « nettoyage » — rien ne casse. L'agent
 * se met simplement à répondre à des questions auxquelles il ne sait pas
 * répondre, avec aplomb.
 *
 * Ce fichier noue donc chaque limite à un FAIT VÉRIFIABLE : une
 * constante de la migration 0088, un nom de fonction SQL, une entrée du
 * catalogue d'actions. Une limite retirée casse un test qui nomme la
 * raison.
 */

const ici = dirname(fileURLToPath(import.meta.url));
const racineDepot = join(ici, "..", "..", "..", "..", "..");

function migration0088(): string {
  return readFileSync(
    join(racineDepot, "supabase", "migrations", "0088_agents_derniers.sql"),
    "utf8",
  );
}

/** Toutes les limites en une seule chaîne, pour chercher dedans. */
const LIMITES = AGENT_VENTES.limites.join("\n");

// ==================================================================
// 1. L'IDENTITÉ
// ==================================================================

test("il s'appelle « sales » des deux côtés, contrairement au Chiffrage", () => {
  // LE PIÈGE DE GRAPHIE A DÉJÀ COÛTÉ : la spec écrit `quotePricing`, la
  // base écrit `quote_pricing`, et une action enregistrée sous la
  // mauvaise graphie est refusée par la contrainte APRÈS que l'appel de
  // modèle a été payé. Les quatre clés de 0088 n'ont, elles, qu'une
  // seule graphie — c'est une chance, pas une règle, et c'est vérifié
  // ici plutôt que supposé.
  assert.equal(AGENT_VENTES.cle, "sales");
  assert.match(migration0088(), /'sales'/, "0088 doit accepter le nom `sales` tel quel");
});

test("il a un libellé, une mission, des responsabilités et des limites", () => {
  assert.ok(AGENT_VENTES.libelle.length > 0);
  assert.ok(AGENT_VENTES.mission.length > 20);
  assert.ok(AGENT_VENTES.responsabilites.length > 20);
  assert.ok(AGENT_VENTES.limites.length >= 5, "un agent qui refuse peu refuse mal");
  for (const limite of AGENT_VENTES.limites) assert.ok(limite.length > 20);
});

test("il n'est PAS un gabarit, et il a donc des mots-clés ET une source", () => {
  // LES TROIS FAITS VONT ENSEMBLE, et `definitions.test.ts` les noue
  // déjà dans les deux sens pour les agents composés. On les vérifie ici
  // AVANT la composition, parce que c'est ici qu'on peut encore corriger
  // sans toucher à un fichier partagé.
  assert.notEqual(AGENT_VENTES.aCompleter, true);
  assert.ok((AGENT_VENTES.motsCles ?? []).length > 0, "achevé et inatteignable");
  assert.equal(OUTIL_SALES_FLOW.agent, "sales", "achevé et sans rien à lire");
});

test("« sales » est composé OU déclaré sans données, jamais les deux, jamais aucun", () => {
  // ─── POURQUOI CE TEST N'EXIGE PAS DÉJÀ LE RETRAIT ───
  //
  // `agents/sansDonnees.ts` et `agents/index.ts` sont des fichiers
  // PARTAGÉS que ce constructeur ne touche pas : deux chantiers écrivent
  // des agents en même temps, et deux mains dans la même liste, c'est un
  // des deux travaux perdu à la fusion. L'entrée « sales » y est donc
  // encore, et l'agent n'est pas encore composé — un état transitoire
  // cohérent.
  //
  // CE QU'ON REFUSE, C'EST L'INTÉGRATION À MOITIÉ FAITE : composer
  // l'agent sans retirer sa façade le donnerait pour construit ET pour
  // inexistant, ce que `agents/index.test.ts` refuse ailleurs — mais
  // seulement une fois le mal fait. Ici, le message nomme le geste
  // manquant.
  const compose = "sales" in DEFINITIONS;
  const declareSansDonnees = AGENTS_SANS_DONNEES.some((e) => e.cle === "sales");

  assert.ok(
    !(compose && declareSansDonnees),
    "« sales » est composé dans DEFINITIONS et toujours listé dans `agents/sansDonnees.ts` : " +
      "retirez-en l'entrée, le dirigeant a tranché et 0088 accepte son nom",
  );
  assert.ok(
    compose || declareSansDonnees,
    "« sales » a disparu des deux listes : il n'est ni construit ni déclaré, donc invisible",
  );
});

// ==================================================================
// 2. LES DROITS — CEUX QUE LA FONCTION EXIGE, PAS CEUX QU'ON CROIT
// ==================================================================

test("les droits annoncés sont EXACTEMENT les gardes de ai_sales_flow", () => {
  // `droitsAttendus` n'est pas décoratif : `context.ts` n'appelle PAS
  // une source dont la permission manque, et l'instruction ordonne à
  // l'agent de nommer le droit absent. Un droit oublié ici produit un
  // appel qui lève ; un droit de trop retire l'agent à quelqu'un qui
  // avait le droit de l'utiliser.
  const sql = migration0088();
  const corps = sql.slice(sql.indexOf("function public.ai_sales_flow"));
  const gardes = [...corps.slice(0, 6000).matchAll(/ai_guard\(p_organization_id, '([a-z.]+)'\)/g)]
    .map((m) => m[1]);

  assert.deepEqual(
    new Set(AGENT_VENTES.droitsAttendus),
    new Set(gardes),
    "les droits annoncés ne sont pas ceux que la fonction exige",
  );
  assert.ok(gardes.includes("projects.read") && gardes.includes("quotes.read"));
});

test("le droit déclaré par l'outil est la garde la PLUS ÉTROITE, pas la première", () => {
  // ══════════════════════════════════════════════════════════════════
  // §11Z, INTÉGRATION — CE TEST DÉFENDAIT LE MAUVAIS CRITÈRE
  // ══════════════════════════════════════════════════════════════════
  //
  // Il exigeait que `permission` soit la PREMIÈRE garde rencontrée dans
  // la fonction SQL. C'est un critère d'écriture, pas un critère
  // d'effet, et il donnait ici la mauvaise réponse.
  //
  // Ce que le champ sert à faire, c'est empêcher le modèle de se voir
  // offrir un outil qui échouera. Le bon critère est donc « quelle
  // garde décide SEULE », c'est-à-dire la plus étroite — celle qui
  // manque à quelqu'un qui a l'autre.
  //
  // MESURÉ DANS `role_permissions` : `projects.read` est porté par neuf
  // rôles, `quotes.read` par six, et les six sont inclus dans les neuf.
  // Trois rôles ont donc le premier sans le second. Pour eux, déclarer
  // `projects.read` laissait passer l'appel, la fonction levait, et le
  // runner rendait « Oasis n'a obtenu aucune des données nécessaires » —
  // sans jamais nommer `quotes.read`. Un droit manquant présenté comme
  // une panne, ce que ce produit s'interdit.
  //
  // `outils/market.ts` et `outils/risk.ts` ont appliqué ce critère chez
  // eux dès l'écriture ; les Ventes s'y alignent.
  assert.equal(OUTIL_SALES_FLOW.permission, "quotes.read");
  assert.ok(
    AGENT_VENTES.droitsAttendus.includes("quotes.read"),
    "le droit déclaré par l'outil doit être l'un de ceux que l'agent annonce",
  );
  assert.equal(OUTIL_SALES_FLOW.permissionSource, "aiGuard");
});

// ==================================================================
// 3. LES TROIS FRONTIÈRES — C'EST TOUT LE SUJET DE CET AGENT
// ==================================================================

test("il dit explicitement ce qui appartient au CHIFFRAGE", () => {
  // Sans cette phrase, un agent Ventes recalculerait les devis dormants
  // et le produit aurait DEUX réponses à la même question. C'est
  // exactement le motif pour lequel 0082 l'avait écarté.
  assert.match(LIMITES, /ai_executive_brief/, "le briefing doit être nommé, pas évoqué");
  assert.match(LIMITES, /sections 2 et 3/);
  assert.match(LIMITES, /Chiffrage/);
  assert.match(LIMITES, /ai_quote_price_analysis/);
  assert.match(LIMITES, /quote_totals/);
});

test("il dit explicitement ce qui appartient à la FACTURATION", () => {
  assert.match(LIMITES, /Facturation/);
  assert.match(LIMITES, /ai_billing_candidates/);
  assert.match(
    LIMITES,
    /status = accepted/,
    "la frontière est vérifiable dans 0073, et elle doit être citée telle quelle",
  );
});

test("la frontière citée est celle que le SQL applique vraiment", () => {
  // ON NE CROIT PAS LE COMMENTAIRE SUR PAROLE. Les deux populations
  // doivent être disjointes par construction, sans quoi tout l'agent
  // s'effondre — et « disjointes » se lit dans le filtre, pas dans la
  // prose.
  const sql = migration0088();
  const corps = sql.slice(sql.indexOf("function public.ai_sales_flow"));
  assert.match(
    corps.slice(0, 8000),
    /decided_at is not null/,
    "ai_sales_flow doit se borner aux devis DÉCIDÉS",
  );
  assert.match(
    corps.slice(0, 12000),
    /ai_executive_brief\(p_organization_id\)/,
    "les devis ouverts doivent être LUS dans le briefing, jamais recalculés",
  );
});

test("il ne propose pas « relancer un devis » et dit qui la porte", () => {
  // L'action est au catalogue sous `quoteFollowUp`, agent
  // `quote_pricing`. Deux endroits d'où l'on relance, c'est un jour deux
  // relances envoyées au même client.
  assert.match(LIMITES, /quoteFollowUp/);
  assert.match(LIMITES, /quote_pricing/);
  assert.match(LIMITES, /quotes\.edit/);
});

// ==================================================================
// 4. CE QU'IL REFUSE, ET POURQUOI CHAQUE REFUS EST NÉCESSAIRE
// ==================================================================

test("il refuse tout montant de devis, dans TOUTES les fenêtres", () => {
  assert.match(LIMITES, /AUCUN MONTANT DE DEVIS/);
  assert.match(LIMITES, /dans aucune fenêtre/);
  // Et l'outil ne prétend fournir aucune grandeur monétaire : c'est la
  // barrière réelle, la limite n'en est que l'annonce.
  assert.deepEqual([...OUTIL_SALES_FLOW.fournit], [], "un outil qui fournit un euro le déclare");
});

test("il refuse toute prévision, comme la Direction", () => {
  assert.match(LIMITES, /NE PRÉVOIT NI CHIFFRE D'AFFAIRES NI SIGNATURE À VENIR/);
  assert.match(
    LIMITES,
    /probabilité/,
    "la tentation précise est de multiplier une valeur estimée par une probabilité saisie au jugé",
  );
});

test("il refuse tout taux sous le seuil, et le seuil est celui du SQL", () => {
  // LE SEUIL EST DANS LA BASE, PAS DANS UN PROMPT. Une règle qu'on
  // demande à un modèle est une règle qu'il peut assouplir pour rendre
  // service. On vérifie que le texte de l'agent annonce le MÊME nombre
  // que la constante appliquée.
  const sql = migration0088();
  assert.match(sql, /c_seuil_taux\s+constant int := 20;/);
  assert.match(sql, /c_seuil_delai\s+constant int := 8;/);
  assert.match(LIMITES, /VINGT DÉCISIONS/);
  assert.match(LIMITES, /sous huit/);
  assert.match(LIMITES, /tauxMotif/, "le motif du refus doit être rendu, pas juste le null");
});

test("il refuse de lire viewed_at comme une preuve d'ouverture", () => {
  // MESURÉ DANS LE CODE : `lib/quotes/actions.ts` n'écrit `viewed_at`
  // que lorsqu'un humain passe le devis au statut « vu ». Il n'existe
  // aucun accusé de lecture dans ce produit.
  assert.match(LIMITES, /viewed_at/);
  assert.match(LIMITES, /SAISIE HUMAINE/);
  assert.match(LIMITES, /personne n'a marqué ce devis comme vu/);

  const source = readFileSync(join(racineDepot, "web-pro", "lib", "quotes", "actions.ts"), "utf8");
  assert.match(
    source,
    /viewed_at/,
    "si cette colonne cessait d'être écrite à la main, la limite serait à réécrire",
  );
  assert.ok(
    /status === "viewed"[\s\S]{0,80}viewed_at/.test(source),
    "`viewed_at` doit toujours être écrit depuis un changement de statut manuel : le jour où " +
      "un vrai traceur existera, cette limite devra changer, et ce test est là pour le dire",
  );
});

test("il refuse de rendre « zéro » pour « rien n'a jamais été saisi »", () => {
  // La confusion que ce produit a déjà corrigée QUATRE FOIS. Un pipeline
  // à zéro se lit « je n'ai rien en cours » ; la vérité mesurée est
  // « personne n'a jamais rempli l'écran Opportunités ».
  assert.match(LIMITES, /NE COMPTE PAS À ZÉRO CE QUI N'A JAMAIS ÉTÉ SAISI/);
  assert.match(LIMITES, /vous ne perdez jamais/);
  assert.match(LIMITES, /TotalTouteHistoire/, "le champ qui fait la différence doit être nommé");
});

test("il n'écrit rien", () => {
  assert.match(LIMITES, /N'ÉCRIT RIEN/);
  assert.equal(OUTIL_SALES_FLOW.famille, "lecture");
  assert.equal(OUTIL_SALES_FLOW.confirmationRequise, false);
});

// ==================================================================
// 5. LA MISSION EST UN `handoffDescription` : ELLE PORTE SES REFUS
// ==================================================================

test("la mission annonce ce qu'il ne sait pas faire, pour ne pas être déléguée pour rien", () => {
  // `mission` sert de `handoffDescription` : c'est sur elle que la
  // Direction décide à qui déléguer. Une mission qui promet des montants
  // fait payer une délégation complète pour recevoir un renvoi — l'appel
  // est facturé avant que le spécialiste ait la parole.
  assert.match(AGENT_VENTES.mission, /DÉCIDÉS/);
  assert.match(AGENT_VENTES.mission, /Aucun montant/);
  assert.match(AGENT_VENTES.mission, /aucune[\s\S]{0,20}prévision/);
  assert.match(AGENT_VENTES.mission, /rien sur les devis encore ouverts/);
});
