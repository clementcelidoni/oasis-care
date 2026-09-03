import type { ConstatCas, RapportEval } from "./types.ts";

/**
 * §11V — LA MISE EN FORME DU RAPPORT D'ÉVALUATION.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE RAPPORT REFUSE D'ÉCRIRE
 * ══════════════════════════════════════════════════════════════════
 *
 *   • « 7/7 ». Trois cas de la page 24 n'ont ni agent ni fonction dans
 *     ce produit ; les compter comme réussis parce qu'ils n'ont rien
 *     cassé serait le mensonge le plus facile de tout ce travail. Ils
 *     sont comptés SÉPARÉMENT, avec leur raison.
 *
 *   • Un coût total à zéro quand un niveau n'est pas tarifé. `null`
 *     traverse la somme (`executerSuite`), et le rapport écrit
 *     « inconnu » plutôt qu'un chiffre rassurant.
 *
 *   • Un silence sur ce que le mode simulé ne prouve pas. La liste
 *     `avecUnVraiModele` de chaque cas est imprimée MÊME QUAND TOUT EST
 *     VERT, sous un titre qui ne laisse aucune ambiguïté. Une suite au
 *     vert dit que la plomberie tient, pas que les réponses sont bonnes.
 */

const LARGEUR = 78;

export function formaterRapport(rapport: RapportEval): string {
  const lignes: string[] = [];

  lignes.push("═".repeat(LARGEUR));
  lignes.push("OASIS CARE PRO — SUITE D'ÉVALUATIONS DES AGENTS (spec p. 24)");
  lignes.push("═".repeat(LARGEUR));
  lignes.push(
    rapport.mode === "simule"
      ? "Mode SIMULÉ — aucun appel au fournisseur, aucun jeton dépensé."
      : "Mode RÉEL — appels facturés au fournisseur.",
  );
  lignes.push(`Passage du ${rapport.quand}`);
  lignes.push("");

  for (const cas of rapport.cas) lignes.push(...formaterCas(cas));

  lignes.push("─".repeat(LARGEUR));
  lignes.push(
    `BILAN — ${rapport.reussis} réussi(s), ${rapport.echoues} échoué(s), ` +
      `${rapport.nonExecutables} non exécutable(s) sur ${rapport.cas.length} cas.`,
  );
  lignes.push(
    rapport.coutTotalCents === null
      ? "Coût estimé : INCONNU — au moins un niveau employé n'a pas de tarif renseigné."
      : `Coût estimé : ${euros(rapport.coutTotalCents)}.`,
  );

  if (rapport.nonExecutables > 0) {
    lignes.push("");
    lignes.push(
      "Les cas non exécutables ne sont NI réussis NI échoués : ce produit n'a rien à leur",
      "opposer. Leur raison est écrite ci-dessus, cas par cas.",
    );
  }

  return lignes.join("\n");
}

function formaterCas(cas: ConstatCas): string[] {
  const lignes: string[] = [];
  const marque =
    cas.statut === "reussi" ? "[ OK ]" : cas.statut === "echoue" ? "[ÉCHEC]" : "[ N/A ]";

  lignes.push("─".repeat(LARGEUR));
  lignes.push(`${marque} ${cas.titre}  (${cas.cas} · couverture : ${cas.couverture})`);

  if (cas.statut === "non_executable") {
    lignes.push("");
    for (const ligne of decouper(cas.raison ?? "Aucune raison renseignée.", LARGEUR - 8)) {
      lignes.push(`        ${ligne}`);
    }
    lignes.push("");
    return lignes;
  }

  for (const scenario of cas.scenarios) {
    lignes.push(`  · ${scenario.intitule}`);
    for (const controle of scenario.controles) {
      lignes.push(`      ${controle.ok ? "✓" : "✗"} ${controle.nom.padEnd(16)} ${controle.detail}`);
    }
    lignes.push(
      `        ${scenario.appelsModele} appel(s) de modèle · coût estimé : ` +
        (scenario.coutEstimeCents === null ? "inconnu" : euros(scenario.coutEstimeCents)),
    );
  }

  if (cas.nonVerifie.length > 0) {
    lignes.push("");
    lignes.push("      CE PASSAGE N'A PAS VÉRIFIÉ :");
    for (const item of cas.nonVerifie) {
      for (const [i, ligne] of decouper(item, LARGEUR - 12).entries()) {
        lignes.push(`        ${i === 0 ? "—" : " "} ${ligne}`);
      }
    }
  }

  lignes.push("");
  return lignes;
}

/** Des centimes entiers, dits en euros. Jamais de flottant intermédiaire. */
function euros(centimes: number): string {
  const signe = centimes < 0 ? "-" : "";
  const absolu = Math.abs(centimes);
  const partieEntiere = Math.trunc(absolu / 100);
  const reste = absolu % 100;
  return `${signe}${partieEntiere.toLocaleString("fr-FR")},${String(reste).padStart(2, "0")} €`;
}

function decouper(texte: string, largeur: number): string[] {
  const mots = texte.split(/\s+/).filter((m) => m.length > 0);
  const lignes: string[] = [];
  let courante = "";

  for (const mot of mots) {
    if (courante.length === 0) courante = mot;
    else if (courante.length + 1 + mot.length <= largeur) courante += ` ${mot}`;
    else {
      lignes.push(courante);
      courante = mot;
    }
  }
  if (courante.length > 0) lignes.push(courante);
  return lignes.length > 0 ? lignes : [""];
}
