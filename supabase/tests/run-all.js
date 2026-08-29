/**
 * Joue toutes les suites de tests SQL contre la base Supabase.
 *
 *     node supabase/tests/run-all.js <chemin-du-jeton>
 *
 * Chaque fichier est une transaction terminée par ROLLBACK : rien n'est
 * écrit, y compris quand un test échoue. Le jeton n'est PAS lu depuis
 * le dépôt — on lui passe le chemin d'un fichier qui vit ailleurs, pour
 * qu'aucun commit ne puisse l'emporter par accident.
 *
 * Sort en code 1 si une suite échoue, de quoi brancher une CI le jour
 * venu.
 */
const fs = require("fs");
const path = require("path");

const PROJECT_REF = "bipicvyfhxvqpwwaogpl";
const tokenPath = process.argv[2];

if (!tokenPath || !fs.existsSync(tokenPath)) {
  console.error("Usage : node supabase/tests/run-all.js <chemin-du-jeton>");
  console.error("Le fichier doit contenir un jeton d'accès Supabase (sbp_…).");
  process.exit(2);
}

const token = fs.readFileSync(tokenPath, "utf8").trim();
const dir = __dirname;

const suites = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

async function run(file) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );

  const body = await response.text();
  if (response.status !== 201) {
    return { file, ok: false, note: `HTTP ${response.status} — ${body.slice(0, 160)}` };
  }

  const rows = JSON.parse(body);
  // Une suite rend un tableau de verdicts ; tout autre résultat n'est
  // pas un test et ne doit pas passer pour un succès.
  if (rows.length === 0 || rows[0].verdict === undefined) {
    return { file, ok: false, note: "aucun verdict rendu" };
  }

  const failed = rows.filter((r) => r.verdict !== "OK");
  for (const r of failed) {
    console.log(`    ÉCHEC  ${r.nom}  [attendu ${r.attendu}, obtenu ${r.obtenu}]`);
  }
  return {
    file,
    ok: failed.length === 0,
    note: `${rows.length - failed.length}/${rows.length}`,
  };
}

(async () => {
  const results = [];
  for (const file of suites) {
    const result = await run(file);
    results.push(result);
    console.log(`  ${result.ok ? "OK    " : "ÉCHEC "}${file.padEnd(38)} ${result.note}`);
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} suites vertes`);
  if (passed !== results.length) process.exitCode = 1;
})();
