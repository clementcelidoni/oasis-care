import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * §EMAILS — LA FRONTIÈRE ENTRE « UN ÉTAT A CHANGÉ » ET « UN MODÈLE A
 * DÉCIDÉ », ÉPROUVÉE SUR LES FICHIERS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE ÉPREUVE QUI LIT DES FICHIERS
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce que c'est la seule qui survit à un copier-coller distrait.
 *
 * La règle du produit est ancienne et elle tient : l'IA prépare des
 * BROUILLONS, un humain valide. Un envoi déclenché par un CHANGEMENT
 * D'ÉTAT — « la facture vient d'être émise, on l'expédie » — est
 * légitime, et c'est précisément ce que ce dossier fait. Un envoi
 * décidé par un MODÈLE ne l'est pas : personne n'a voulu ce courrier,
 * et le destinataire, lui, ne fait pas la différence.
 *
 * On peut écrire cette règle dans un commentaire. Elle sera vraie le
 * jour où on l'écrit, et fausse le jour où quelqu'un ajoutera un outil
 * d'agent « envoyer la relance au client » en toute bonne foi, parce
 * que ça semblera rendre service. Une épreuve qui LIT les imports des
 * fichiers d'IA rattrape ce jour-là.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS BARRIÈRES, DONT DEUX AILLEURS
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. EN BASE — `email_templates.trigger_kind` n'a pas de valeur
 *      `'ia'` (migration 0084). Un envoi décidé par un modèle ne peut
 *      pas être déclaré, donc pas inséré.
 *   2. DANS LE CODE — aucun fichier de `lib/ai/` n'atteint ce dossier.
 *      C'est ce que vérifie l'épreuve ci-dessous.
 *   3. DANS LES SIGNATURES — les déclencheurs ne prennent aucun texte.
 *      Un agent qui les atteindrait ne pourrait toujours pas choisir ce
 *      qui est écrit. Vérifié dans `declencheurs.test.ts`.
 */

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE_WEB_PRO = path.resolve(ICI, "..", "..", "..");
const DOSSIER_IA = path.join(RACINE_WEB_PRO, "lib", "ai");

async function fichiersSous(racine: string): Promise<string[]> {
  const entrees = await readdir(racine, { withFileTypes: true, recursive: true });
  return entrees
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => path.join(e.parentPath ?? racine, e.name));
}

test("AUCUN FICHIER D'IA N'IMPORTE LE CHEMIN D'ENVOI", async () => {
  const fichiers = await fichiersSous(DOSSIER_IA);
  assert.ok(fichiers.length > 0, "le dossier des agents doit exister pour que l'épreuve ait un sens");

  // On cherche l'import, pas la mention : un commentaire qui parle du
  // courrier est utile, un `import` qui y mène ne l'est pas. Les trois
  // écritures possibles de la même chose sont couvertes.
  const interdits = [
    "app/api/email",
    "@/app/api/email",
    "../../app/api/email",
  ];

  const coupables: string[] = [];
  for (const fichier of fichiers) {
    const contenu = await readFile(fichier, "utf8");
    // On ne regarde que les lignes d'import : un chemin cité dans un
    // commentaire d'explication est légitime, et l'interdire pousserait
    // à ne plus expliquer.
    const lignesDImport = contenu
      .split("\n")
      .filter((ligne) => /^\s*(import|export)\s|require\(|import\(/.test(ligne));
    if (lignesDImport.some((ligne) => interdits.some((motif) => ligne.includes(motif)))) {
      coupables.push(path.relative(RACINE_WEB_PRO, fichier));
    }
  }

  assert.deepEqual(
    coupables, [],
    "Un fichier d'IA atteint le chemin d'envoi. L'IA prépare des brouillons ; "
    + "un humain valide. Retirez l'import plutôt que d'assouplir cette épreuve.",
  );
});

/**
 * Le code, sans les commentaires.
 *
 * LA DISTINCTION EST LE SUJET DE L'ÉPREUVE SUIVANTE. Un commentaire qui
 * EXPLIQUE pourquoi le transporteur n'a pas sa place ici est
 * exactement ce qu'on veut lire ; un `fetch("https://api.…")` ne l'est
 * pas. Une épreuve qui interdirait les deux pousserait à ne plus
 * expliquer — et c'est l'explication qui empêche la prochaine personne
 * de coder le transporteur en dur.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((ligne) => ligne.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

test("aucun transporteur n'est nommé DANS LE CODE de la couche métier", async () => {
  // §"Aucun appel au transporteur ne doit exister ailleurs que dans son
  // implémentation ; si un gabarit, un écran ou une fonction métier le
  // nomme, c'est un défaut." Ce dossier est du métier : il dit « envoie
  // ce message », jamais « appelle untel ».
  const fichiers = (await fichiersSous(ICI)).filter((f) => !f.endsWith("frontiere-ia.test.ts"));
  const transporteurs = /\b(brevo|sendinblue|sendgrid|mailgun|postmark|resend|nodemailer)\b/i;

  const coupables: string[] = [];
  for (const fichier of fichiers) {
    if (transporteurs.test(sansCommentaires(await readFile(fichier, "utf8")))) {
      coupables.push(path.relative(RACINE_WEB_PRO, fichier));
    }
  }

  assert.deepEqual(
    coupables, [],
    "Le nom d'un transporteur est apparu dans le code de la couche métier. "
    + "Il n'a sa place que dans l'implémentation du port.",
  );
});

test("aucune adresse de service n'est appelée depuis la couche métier", async () => {
  // La contrepartie de l'épreuve précédente : on peut coder un
  // transporteur en dur sans jamais écrire son nom, en écrivant son
  // URL. Deux règles à la fois — pas d'appel sortant, et pas de nom.
  //
  // `port.ts` EST EXCLU, ET C'EST LE SEUL. Il est l'IMPLÉMENTATION du
  // port, exactement comme `lib/email/brevo-api.ts` l'est du
  // transporteur : c'est son métier de parler à la machine d'envoi, qui
  // seule détient la clé de service. L'épreuve suivante vérifie que ce
  // qu'il appelle est bien la machine et rien d'autre.
  const fichiers = (await fichiersSous(ICI)).filter(
    (f) => !f.endsWith("frontiere-ia.test.ts") && !f.endsWith(`${path.sep}port.ts`),
  );
  const appels = /\b(fetch|XMLHttpRequest)\s*\(|https?:\/\/api\./i;

  const coupables: string[] = [];
  for (const fichier of fichiers) {
    if (appels.test(sansCommentaires(await readFile(fichier, "utf8")))) {
      coupables.push(path.relative(RACINE_WEB_PRO, fichier));
    }
  }

  assert.deepEqual(coupables, [], "Un appel sortant est apparu dans la couche métier.");
});

test("le port n'appelle QUE la machine, et son adresse vient de l'environnement", async () => {
  // Ce que cette épreuve empêche : qu'on écrive un jour l'URL d'un
  // transporteur en dur dans le port. L'adresse se déduit du projet
  // Supabase ou d'une variable ; aucune autre n'est écrite.
  const source = sansCommentaires(
    await readFile(path.join(ICI, "port.ts"), "utf8"),
  );

  const urlsEcrites = source.match(/https?:\/\/[^\s"'`]+/g) ?? [];
  assert.deepEqual(urlsEcrites, [], "Aucune URL ne doit être écrite en dur dans le port.");

  const transporteurs = /\b(brevo|sendinblue|sendgrid|mailgun|postmark|resend|nodemailer)\b/i;
  assert.ok(!transporteurs.test(source), "Le port ne nomme aucun transporteur.");

  // Et le seul appel sortant vise le chemin de la machine.
  assert.ok(source.includes("/envoyer"), "le port appelle bien le chemin d'envoi de la machine");
});

test("les actions de devis et de facture n'appellent que la porte prévue", async () => {
  // L'accroche doit rester d'une ligne, et passer par `dependances.ts`.
  // Si une action se mettait à importer `port.ts` ou `lecteur-supabase.ts`
  // directement, elle recommencerait à câbler — et c'est en câblant
  // qu'on finit par laisser remonter une exception jusqu'à la facture.
  for (const chemin of [
    path.join(RACINE_WEB_PRO, "lib", "quotes", "actions.ts"),
    path.join(RACINE_WEB_PRO, "lib", "finance", "actions.ts"),
  ]) {
    const contenu = await readFile(chemin, "utf8");
    const imports = contenu.split("\n").filter((l) => /^\s*import\s/.test(l));
    const versEmail = imports.filter((l) => l.includes("app/api/email"));
    for (const ligne of versEmail) {
      assert.ok(
        ligne.includes("app/api/email/dependances"),
        `${path.basename(path.dirname(chemin))}/actions.ts importe le courrier par un autre chemin : ${ligne.trim()}`,
      );
    }
  }
});
