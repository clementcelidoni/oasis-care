import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * §11V — CE QUI PERMET À `node --test` DE RÉSOUDRE « @/ ».
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE FICHIER EXISTE
 * ══════════════════════════════════════════════════════════════════
 *
 * `@/` est un alias de `tsconfig.json`, que Next et `tsc` comprennent
 * et que Node ignore : il ne lit aucun tsconfig, et son mécanisme
 * d'alias natif (`imports` de `package.json`) impose des clés
 * commençant par `#`. Un module qui écrit `@/lib/ai/proposals` est donc
 * inexécutable sous `node --test`.
 *
 * C'est la raison pour laquelle tout `lib/ai/runtime/` s'importe en
 * relatif — et la règle tient, sauf sur UN chemin : `agents.ts` a
 * besoin de `describeProposal`, qui vit dans `lib/ai/proposals.ts`,
 * lequel importe à son tour `@/lib/quotes/types`. Ces deux fichiers
 * sont hors du périmètre de la Phase 11V ; les réécrire en relatif pour
 * arranger un test reviendrait à modifier du code qui marche au nom de
 * l'outillage.
 *
 * ─── CE QUE CE CROCHET NE FAIT PAS ───
 *
 * Il ne s'installe pas tout seul. Aucun test ne le charge par défaut :
 * les fichiers qui en ont besoin appellent `register()` eux-mêmes, puis
 * importent en DYNAMIQUE ce qui dépend de l'alias — un `import` statique
 * est hissé avant l'exécution de la première ligne, donc avant que le
 * crochet existe.
 *
 * Il ne devine rien non plus : la liste des extensions essayées est
 * fermée, dans l'ordre où Next les résout, et un chemin qui ne
 * correspond à aucun fichier redescend à la résolution normale de Node
 * plutôt que d'être inventé.
 */

const racineWeb = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** Les formes essayées pour un chemin sans extension, dans l'ordre de Next. */
const FORMES = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

/**
 * Vrai seulement pour un FICHIER.
 *
 * La forme vide (`""`) existe pour les chemins déjà complets, mais elle
 * correspondrait aussi à un DOSSIER — `@/lib/ai/runtime` en est un — et
 * rendre l'URL d'un dossier produirait une erreur d'import obscure là
 * où `/index.ts` était la bonne réponse.
 */
function estFichier(chemin) {
  try {
    return statSync(chemin).isFile();
  } catch {
    return false;
  }
}

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = join(racineWeb, specifier.slice(2));
    for (const forme of FORMES) {
      const candidat = `${base}${forme}`;
      if (estFichier(candidat)) {
        return { url: pathToFileURL(candidat).href, shortCircuit: true };
      }
    }
  }
  return next(specifier, context);
}
