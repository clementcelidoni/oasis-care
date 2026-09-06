import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PERMISSIONS,
  ROLES,
  permissionsForRole,
  type Permission,
  type Role,
} from "./permissions.ts";

/**
 * LE TEST QUE `permissions.ts` PROMETTAIT DEPUIS LE DÉBUT.
 *
 * Son commentaire annonçait un `lib/auth/__tests__/permissions.test.ts`
 * « qui échoue si les deux divergent ». Ce fichier n'existait pas.
 * Pendant ce temps, la seule chose qui décide de ce qu'un écran affiche
 * est la table `ROLE_PERMISSIONS` recopiée à la main dans le
 * TypeScript : `lib/auth/organization.ts` appelle `permissionsForRole`,
 * jamais `role_permissions` en base.
 *
 * LES DEUX DÉRIVES POSSIBLES SONT MUETTES, ET C'EST CE QUI LES REND
 * DANGEREUSES :
 *
 *   • une permission SEMÉE EN BASE mais absente d'ici : la base accorde
 *     le droit, aucun écran ne le cite, le menu n'apparaît pas, et rien
 *     ne l'explique. C'est exactement ce qui est arrivé aux trois clés
 *     BioLab entre la migration 0087 et son intégration.
 *
 *   • une permission LISTÉE ICI mais non semée : l'écran s'ouvre, la
 *     RLS rend zéro ligne, et l'état vide affirme « aucune donnée »
 *     alors que la vérité est « pas pour vous ».
 *
 * Le test relit donc les migrations elles-mêmes. C'est le même motif
 * que `lib/biolab/statistiques.test.ts`, qui relit `0087_biolab_pro.sql`
 * pour vérifier ses prédicats : le TypeScript ne peut pas interroger
 * Postgres, mais il peut lire le fichier qui le programme.
 */

const RACINE_MIGRATIONS = join(process.cwd(), "..", "supabase", "migrations");

/**
 * Les couples (rôle, permission) semés dans `public.role_permissions`
 * par l'ensemble des migrations.
 *
 * On vise la table EXACTE. `platform_admin_role_permissions` est un
 * autre monde — celui de web-admin — et la confondre avec celle-ci
 * ferait échouer ce test sur des permissions qui n'ont rien à voir avec
 * les rôles d'une entreprise cliente.
 */
function couplesSemesEnBase(): Set<string> {
  const couples = new Set<string>();
  const fichiers = readdirSync(RACINE_MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const fichier of fichiers) {
    const sql = readFileSync(join(RACINE_MIGRATIONS, fichier), "utf8");
    // Chaque bloc va du `insert into public.role_permissions … values`
    // jusqu'au point-virgule qui le termine.
    const blocs = sql.matchAll(
      /insert\s+into\s+public\.role_permissions\s*\(\s*role\s*,\s*permission\s*\)\s*values([\s\S]*?);/gi,
    );
    for (const bloc of blocs) {
      // Les commentaires SQL du corps ne doivent pas être lus comme des
      // couples : une ligne « -- ('manager','x') » n'est pas un seed.
      const corps = bloc[1].replace(/--[^\n]*/g, "");
      for (const couple of corps.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)) {
        couples.add(`${couple[1]}|${couple[2]}`);
      }
    }
  }
  return couples;
}

/** Les rôles dont `has_permission` décide sans consulter la table. */
const ROLES_SANS_TABLE: readonly Role[] = ["owner", "admin", "custom"];

test("les migrations sèment bien quelque chose — sinon ce test ne prouve rien", () => {
  const couples = couplesSemesEnBase();
  assert.ok(
    couples.size > 30,
    `Seulement ${couples.size} couples lus dans supabase/migrations : la lecture a échoué, pas la synchronisation.`,
  );
});

test("toute permission semée en base est déclarée dans PERMISSIONS", () => {
  const connues = new Set<string>(PERMISSIONS);
  const inconnues = [...couplesSemesEnBase()]
    .map((c) => c.split("|")[1])
    .filter((p) => !connues.has(p));
  assert.deepEqual(
    [...new Set(inconnues)].sort(),
    [],
    "Ces permissions existent en base et le web ne les connaît pas : la base accorde un droit qu'aucun écran ne peut citer.",
  );
});

test("tout rôle semé en base l'est aussi côté web, case par case", () => {
  const couples = couplesSemesEnBase();

  const roles = new Set<string>([...couples].map((c) => c.split("|")[0]));
  for (const role of roles) {
    assert.ok(
      (ROLES as readonly string[]).includes(role),
      `La migration sème le rôle « ${role} », que ROLES ne connaît pas.`,
    );

    const enBase = [...couples]
      .filter((c) => c.startsWith(`${role}|`))
      .map((c) => c.split("|")[1])
      .sort();
    const dansLeCode = [...permissionsForRole(role as Role)].sort();

    assert.deepEqual(
      dansLeCode,
      enBase,
      `Le rôle « ${role} » ne porte pas les mêmes droits des deux côtés. Base : ${enBase.join(", ")}. Code : ${dansLeCode.join(", ")}.`,
    );
  }
});

test("un rôle sans aucun seed n'en invente pas côté web", () => {
  const couples = couplesSemesEnBase();
  const semes = new Set<string>([...couples].map((c) => c.split("|")[0]));

  for (const role of ROLES) {
    if (ROLES_SANS_TABLE.includes(role)) continue;
    if (semes.has(role)) continue;
    assert.deepEqual(
      permissionsForRole(role),
      [],
      `« ${role} » n'est semé nulle part en base mais reçoit des droits dans ROLE_PERMISSIONS : l'écran s'ouvrirait sur des données que la RLS refuse.`,
    );
  }
});

test("owner et admin reçoivent tout, y compris ce que la table ne sème jamais", () => {
  // `organization.manageUsers` n'est semé pour aucun rôle : c'est
  // délibéré, `has_permission` l'accorde à owner et admin seuls. Le
  // test le fige plutôt que de laisser croire à un oubli de seed.
  for (const role of ["owner", "admin"] as const) {
    assert.deepEqual([...permissionsForRole(role)].sort(), [...PERMISSIONS].sort());
  }
});

test("le rôle personnalisé ne reçoit que des permissions existantes", () => {
  const accordees = permissionsForRole("custom", [
    "biolab.read",
    "clients.read",
    "permission.qui.nexiste.pas",
  ]);
  assert.deepEqual(accordees.sort(), ["biolab.read", "clients.read"]);
});

/**
 * LES TROIS CLÉS BIOLAB, NOMMÉMENT.
 *
 * Ce sont elles qui ont motivé l'écriture de ce fichier : les seize
 * écrans BioLab restaient fermés à TOUT LE MONDE, propriétaire compris,
 * parce que `permissionsForRole("owner")` rend `[...PERMISSIONS]` — une
 * liste qui ne les contenait pas. Un test générique aurait laissé
 * passer leur retrait ; celui-ci le nomme.
 */
test("les trois permissions BioLab sont portées par les rôles attendus", () => {
  const attendu: Partial<Record<Role, Permission[]>> = {
    manager: ["biolab.read", "biolab.write", "biolab.manage"],
    nurseryManager: ["biolab.read", "biolab.write", "biolab.manage"],
    nurseryWorker: ["biolab.read", "biolab.write"],
    readOnly: ["biolab.read"],
  };

  for (const [role, cles] of Object.entries(attendu)) {
    const detenues = permissionsForRole(role as Role);
    for (const cle of cles as Permission[]) {
      assert.ok(detenues.includes(cle), `« ${role} » devrait détenir ${cle}.`);
    }
  }

  // Et les rôles à qui la migration ne donne rien n'en reçoivent rien :
  // l'ouvrier de terrain est la case qui justifie tout le §2 de 0087.
  for (const role of ["fieldWorker", "teamLeader", "sales", "designer",
    "projectManager", "accounting", "orderPicker"] as const) {
    const detenues = permissionsForRole(role) as readonly string[];
    assert.deepEqual(
      detenues.filter((p) => p.startsWith("biolab.")),
      [],
      `« ${role} » ne doit détenir aucune permission BioLab.`,
    );
  }
});
