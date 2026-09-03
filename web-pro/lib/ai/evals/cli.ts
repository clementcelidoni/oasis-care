import { CAS_EVAL } from "./cas.ts";
import { executerSuite } from "./executeur.ts";
import { formaterRapport } from "./rapport.ts";
import type { ModeEval } from "./types.ts";

/**
 * §11V — LA SUITE D'ÉVALUATIONS, LANCÉE À LA MAIN.
 *
 * ══════════════════════════════════════════════════════════════════
 * COMMENT LA LANCER
 * ══════════════════════════════════════════════════════════════════
 *
 *   Mode simulé — gratuit, reproductible, sans réseau :
 *
 *     npm run evals
 *
 *   Mode réel — appels facturés, exige OPENAI_API_KEY côté serveur :
 *
 *     npm run evals -- --reel
 *
 *   Un seul cas, par son identifiant :
 *
 *     npm run evals -- --cas=devis-sous-tarife
 *
 *   Le script `evals` de `package.json` appelle
 *   `node --experimental-strip-types lib/ai/evals/cli.ts`. Il n'est
 *   PAS branché sur `npm test` — voir le paragraphe suivant.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER N'EST PAS UN TEST, ET POURQUOI ÇA COMPTE
 * ══════════════════════════════════════════════════════════════════
 *
 * `evals.test.ts` fait tourner les mêmes cas, en simulé, dans
 * `npm test` : c'est la garde permanente sur la plomberie. Ce
 * fichier-ci existe pour l'autre moitié — le JUGEMENT — et il ne doit
 * PAS être appelé par l'intégration continue.
 *
 * La raison n'est pas seulement la facture. Un test doit être
 * déterministe ; une évaluation de modèle ne l'est pas. Brancher le
 * mode réel sur `npm test` produirait une suite qui rougit au hasard,
 * ce qui apprend très vite à relancer sans lire — et le jour où
 * l'échec est réel, personne ne le voit. On sépare donc ce qui doit
 * casser le build de ce qui doit être LU.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE MODE RÉEL EXIGE UNE CLÉ, ET NE SE RABAT JAMAIS SUR LE SIMULÉ
 * ══════════════════════════════════════════════════════════════════
 *
 * Sans clé, ce programme s'arrête avec le nom de la variable à poser.
 * Basculer silencieusement en simulé produirait un rapport marqué
 * « RÉEL » qui n'aurait appelé personne : le pire résultat possible,
 * parce qu'on le croirait.
 */

type Arguments = { mode: ModeEval; cas: string | null };

function lireArguments(argv: readonly string[]): Arguments {
  let mode: ModeEval = "simule";
  let cas: string | null = null;

  for (const brut of argv) {
    if (brut === "--reel") mode = "reel";
    else if (brut.startsWith("--cas=")) cas = brut.slice("--cas=".length).trim();
    else if (brut === "--aide" || brut === "--help") {
      process.stdout.write(AIDE);
      process.exit(0);
    } else {
      process.stderr.write(`Argument inconnu : « ${brut} ».\n${AIDE}`);
      process.exit(2);
    }
  }

  return { mode, cas };
}

const AIDE = [
  "",
  "Suite d'évaluations des agents Oasis (spec p. 24).",
  "",
  "  npm run evals -- [--reel] [--cas=<id>]",
  "",
  "  --reel      appelle réellement le fournisseur. Exige OPENAI_API_KEY.",
  "  --cas=<id>  ne joue qu'un cas. Identifiants disponibles :",
  ...CAS_EVAL.map((c) => `                ${c.id.padEnd(28)} ${c.titre}`),
  "",
].join("\n");

async function principal(): Promise<void> {
  const { mode, cas } = lireArguments(process.argv.slice(2));

  const choisis = cas === null ? CAS_EVAL : CAS_EVAL.filter((c) => c.id === cas);
  if (choisis.length === 0) {
    process.stderr.write(`Aucun cas nommé « ${cas} ».\n${AIDE}`);
    process.exit(2);
  }

  let fournisseur;
  if (mode === "reel") {
    // Import DYNAMIQUE : en mode simulé, ce module n'est jamais chargé,
    // et le programme ne touche donc jamais à la lecture de la clé.
    const { OpenAIProvider } = await import("../model/provider.ts");
    const provider = new OpenAIProvider();
    if (!provider.estConfigure()) {
      process.stderr.write(
        "Mode réel demandé sans clé : posez OPENAI_API_KEY dans l'environnement du serveur " +
          "(jamais avec un préfixe NEXT_PUBLIC_, qui l'enverrait au navigateur).\n" +
          "L'évaluation s'arrête plutôt que de produire un rapport « RÉEL » qui n'aurait appelé personne.\n",
      );
      process.exit(3);
    }
    fournisseur = provider;
  }

  const rapport = await executerSuite({ mode, fournisseur }, choisis);
  process.stdout.write(`${formaterRapport(rapport)}\n`);

  // Le code de sortie ne compte QUE les échecs. Un cas non exécutable
  // n'est pas une régression : c'est une limite connue du produit, déjà
  // écrite dans le rapport. Le faire échouer forcerait à le retirer de
  // la suite pour retrouver le vert, et la limite disparaîtrait avec.
  process.exit(rapport.echoues > 0 ? 1 : 0);
}

await principal();
