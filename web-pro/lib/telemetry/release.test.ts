import { test } from "node:test";
import assert from "node:assert/strict";
import { webRelease } from "./release.ts";
import { VERSION_MAX_LENGTH, isDeclarable, WEB_PLATFORM } from "./presence.ts";

/**
 * « QUELLE VERSION » — ET LE PIÈGE DÉJÀ RENCONTRÉ CÔTÉ iPHONE.
 *
 * 0077 a dû ajouter `app_build` parce que `MARKETING_VERSION` est figée
 * à « 0.1.0 » : 31 versions envoyées à TestFlight, toutes annoncées
 * 0.1.0. Le web pro est dans le même cas — `package.json` porte 0.1.0
 * depuis le premier jour et aucune chaîne d'intégration ne le remonte.
 *
 * Ces tests fixent donc les deux moitiés : la version vient du paquet
 * (jamais d'une constante recopiée qui dériverait), et la révision de
 * build vaut `null` tant que le déploiement n'en injecte aucune —
 * `null`, pas « inconnu », pas une valeur fabriquée qui serait
 * indiscernable d'une vraie dans la distribution des versions.
 */

const CLEFS = [
  "NEXT_PUBLIC_APP_VERSION",
  "NEXT_PUBLIC_APP_BUILD",
  "VERCEL_GIT_COMMIT_SHA",
  "CF_PAGES_COMMIT_SHA",
  "GIT_COMMIT_SHA",
] as const;

/** Rend l'environnement propre : ces tests ne doivent pas se contaminer. */
function sansVariables<T>(corps: () => T): T {
  const memoire = CLEFS.map((clef) => [clef, process.env[clef]] as const);
  for (const clef of CLEFS) delete process.env[clef];
  try {
    return corps();
  } finally {
    for (const [clef, valeur] of memoire) {
      if (valeur === undefined) delete process.env[clef];
      else process.env[clef] = valeur;
    }
  }
}

test("la version vient du paquet, et la révision manque honnêtement", () => {
  sansVariables(() => {
    const release = webRelease();

    // Pas d'égalité avec « 0.1.0 » écrite en dur ici : ce test doit
    // survivre au jour où quelqu'un montera la version du paquet.
    assert.match(release.appVersion, /^\d+\.\d+\.\d+/);
    assert.ok(release.appVersion.length <= VERSION_MAX_LENGTH);

    // LE POINT IMPORTANT. Rien n'injecte de révision aujourd'hui : le
    // champ vaut `null`. Une chaîne fabriquée (« local », « dev », la
    // date du jour) entrerait dans la distribution des versions comme
    // une livraison réelle.
    assert.equal(release.appBuild, null);
  });
});

test("la révision de build est prise à la première source disponible", () => {
  sansVariables(() => {
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    assert.equal(webRelease().appBuild, "0123456789ab", "un SHA complet doit être raccourci, pas rejeté");

    // Celle qu'on pose exprès gagne sur celle de l'hébergeur.
    process.env.NEXT_PUBLIC_APP_BUILD = "livraison-42";
    assert.equal(webRelease().appBuild, "livraison-42");
  });
});

test("une variable posée mais vide vaut absente", () => {
  sansVariables(() => {
    // `VERCEL_GIT_COMMIT_SHA=` arrive vraiment : une variable déclarée
    // et non renseignée. Elle ne doit pas devenir une révision « ».
    process.env.VERCEL_GIT_COMMIT_SHA = "   ";
    process.env.NEXT_PUBLIC_APP_VERSION = "";
    const release = webRelease();

    assert.equal(release.appBuild, null);
    assert.match(release.appVersion, /^\d+\.\d+\.\d+/);
  });
});

test("une version imposée trop longue est ignorée, pas tronquée", () => {
  sansVariables(() => {
    // Tronquer fabriquerait un numéro de version qui n'existe pas.
    process.env.NEXT_PUBLIC_APP_VERSION = "v".repeat(VERSION_MAX_LENGTH + 1);
    assert.match(webRelease().appVersion, /^\d+\.\d+\.\d+/);
  });
});

test("ce que rend webRelease() est toujours déclarable", () => {
  // Le contrôle de bout en bout : si `release.ts` produisait une valeur
  // que `isDeclarable` refuse, la présence web ne serait jamais
  // enregistrée — et rien, nulle part, ne le signalerait.
  sansVariables(() => {
    for (const build of [undefined, "0123456789abcdef0123456789abcdef01234567", "  "]) {
      if (build === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = build;

      assert.equal(
        isDeclarable({
          installId: "3f6a1b2c-8d4e-4f10-9a7b-5c2e1d0f8a93",
          platform: WEB_PLATFORM,
          ...webRelease(),
        }),
        true,
      );
    }
  });
});
