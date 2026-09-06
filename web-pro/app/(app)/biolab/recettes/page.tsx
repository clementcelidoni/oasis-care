import { createClient } from "@/lib/supabase/server";
import { DataTable, PageHeader, Tabs, type Column } from "@/components/ui";
import { perimetreBioLab, formatNombre } from "@/lib/biolab/cultures";
import { EspaceVide, LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  direVolume,
  lirePreparations,
  lireRecettes,
  lireVersions,
  lireComposants,
  resumerComposition,
  type LignePreparation,
  type LigneRecette,
  type LigneVersion,
} from "@/lib/biolab/recettes";
import { formaterDate } from "@/lib/biolab/referentiel";

/**
 * §7 « recettes » et « milieux » — LA LISTE.
 *
 * Deux vues sur la même matière, et il fallait choisir laquelle est la
 * page :
 *
 *   • LA RECETTE est le référentiel — ce qu'on écrit une fois et qu'on
 *     fait évoluer par versions.
 *   • LA PRÉPARATION est l'acte — les cinq litres qu'on a réellement
 *     faits mardi, à partir d'une version précise.
 *
 * Les mélanger dans un seul tableau donnerait une liste où « MS
 * Alocasia » et « MB-2026-0042 » se suivent sans qu'on sache lequel est
 * un modèle et lequel est un objet. Deux onglets, donc, et deux URL
 * distinctes : un lien vers « les préparations » doit pouvoir se coller
 * dans un message.
 *
 * LE WEB NE CRÉE RIEN ICI. Une recette se saisit à la paillasse, sur le
 * téléphone, au moment où on la pèse — c'est le partage du §7 (le web
 * supervise) et du §8 (la saisie reste mobile).
 */

type Vue = "recettes" | "preparations";

function lire(valeur: string | string[] | undefined): string {
  if (Array.isArray(valeur)) return valeur[0] ?? "";
  return valeur ?? "";
}

export default async function RecettesPage({ searchParams }: PageProps<"/biolab/recettes">) {
  const contexte = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(contexte, "Le référentiel des milieux");
  const params = await searchParams;
  const vue: Vue = lire(params.vue) === "preparations" ? "preparations" : "recettes";

  const entete = (
    <PageHeader
      eyebrow="BioLab"
      title="Recettes de milieu"
      subtitle="Le référentiel des milieux de culture et les préparations qui en sont issues. La saisie se fait depuis l'application mobile."
    />
  );

  if (refus) {
    return (
      <>
        {entete}
        {refus}
      </>
    );
  }

  const supabase = await createClient();
  const [recettes, versions] = await Promise.all([
    lireRecettes(supabase, contexte.workspaceId),
    lireVersions(supabase, contexte.workspaceId),
  ]);

  const erreur = recettes.erreur ?? versions.erreur;
  if (erreur) {
    return (
      <>
        {entete}
        <LectureImpossible sujet="Les recettes de milieu" erreur={erreur} />
      </>
    );
  }

  const preparations = await lirePreparations(supabase, contexte.workspaceId);

  const onglets = [
    { label: "Recettes", href: "/biolab/recettes", count: recettes.donnees.length },
    {
      label: "Préparations",
      href: "/biolab/recettes?vue=preparations",
      count: preparations.donnees.length,
    },
  ];

  return (
    <>
      {entete}
      <Tabs items={onglets} current={vue === "recettes" ? "/biolab/recettes" : "/biolab/recettes?vue=preparations"} />
      {vue === "recettes" ? (
        <TableauRecettes recettes={recettes.donnees} versions={versions.donnees} preparations={preparations.donnees} />
      ) : preparations.erreur ? (
        <LectureImpossible sujet="Les préparations de milieu" erreur={preparations.erreur} />
      ) : (
        <TableauPreparations preparations={preparations.donnees} versions={versions.donnees} recettes={recettes.donnees} />
      )}
    </>
  );
}

function TableauRecettes({
  recettes,
  versions,
  preparations,
}: {
  recettes: LigneRecette[];
  versions: LigneVersion[];
  preparations: LignePreparation[];
}) {
  const versionsParRecette = new Map<string, LigneVersion[]>();
  for (const version of versions) {
    const liste = versionsParRecette.get(version.recipe_id) ?? [];
    liste.push(version);
    versionsParRecette.set(version.recipe_id, liste);
  }

  const versionIds = new Map(versions.map((v) => [v.id, v.recipe_id]));
  const preparationsParRecette = new Map<string, number>();
  for (const preparation of preparations) {
    const recetteId = preparation.recipe_version_id ? versionIds.get(preparation.recipe_version_id) : undefined;
    if (!recetteId) continue;
    preparationsParRecette.set(recetteId, (preparationsParRecette.get(recetteId) ?? 0) + 1);
  }

  type Ligne = LigneRecette & { versions: LigneVersion[]; preparations: number };
  const lignes: Ligne[] = recettes.map((recette) => ({
    ...recette,
    versions: (versionsParRecette.get(recette.id) ?? []).sort((a, b) => a.version_number - b.version_number),
    preparations: preparationsParRecette.get(recette.id) ?? 0,
  }));

  const colonnes: Column<Ligne>[] = [
    { key: "nom", header: "Recette", cell: (l) => l.name },
    {
      key: "espece",
      header: "Espèce",
      cell: (l) => l.species_name || <span className="text-ink-faint">Toutes espèces</span>,
    },
    {
      key: "derniere",
      header: "Dernière version",
      cell: (l) => {
        const derniere = l.versions[l.versions.length - 1];
        if (!derniere) return <span className="text-ink-faint">Aucune version</span>;
        const resume = resumerComposition(lireComposants(derniere.components).composants);
        return (
          <span>
            V{derniere.version_number}
            <span className="ml-2 text-ink-soft">
              {resume.milieuxDeBase.length > 0 ? resume.milieuxDeBase.join(", ") : `${resume.nombreComposants} composants`}
            </span>
          </span>
        );
      },
    },
    { key: "versions", header: "Versions", numeric: true, cell: (l) => formatNombre(l.versions.length) },
    {
      key: "preparations",
      header: "Préparations",
      numeric: true,
      secondary: true,
      cell: (l) => formatNombre(l.preparations),
    },
    { key: "creee", header: "Créée le", secondary: true, cell: (l) => formaterDate(l.created_at) },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={lignes}
      rowKey={(l) => l.id}
      rowHref={(l) => `/biolab/recettes/${l.id}`}
      empty={
        <EspaceVide
          quoi="Aucune recette de milieu"
          aQuoiCaSert="Une recette décrit la composition d'un milieu de culture, et chacune de ses versions reste figée pour qu'un lot puisse toujours dire ce qu'il a réellement reçu."
        />
      }
    />
  );
}

function TableauPreparations({
  preparations,
  versions,
  recettes,
}: {
  preparations: LignePreparation[];
  versions: LigneVersion[];
  recettes: LigneRecette[];
}) {
  const nomsRecette = new Map(recettes.map((r) => [r.id, r.name]));
  const nomVersion = new Map(
    versions.map((v) => [v.id, `${nomsRecette.get(v.recipe_id) ?? "Recette inconnue"} · V${v.version_number}`]),
  );

  const colonnes: Column<LignePreparation>[] = [
    { key: "code", header: "Préparation", cell: (p) => p.code },
    {
      key: "milieu",
      header: "Version employée",
      cell: (p) =>
        p.recipe_version_id ? (
          nomVersion.get(p.recipe_version_id) ?? "Version supprimée"
        ) : (
          // `recipe_version_id` est `on delete set null` (0029) : une
          // préparation survit à la version qui l'a produite, et le dire
          // vaut mieux que d'afficher une case vide.
          <span className="text-ink-faint">Version non renseignée</span>
        ),
    },
    { key: "volume", header: "Volume", numeric: true, cell: (p) => direVolume(p) },
    {
      key: "ph",
      header: "pH mesuré",
      numeric: true,
      secondary: true,
      // Le pH MESURÉ, pas le pH visé de la recette : le module distingue
      // les deux depuis l'origine, et les confondre effacerait
      // précisément l'écart qu'on cherche à surveiller.
      cell: (p) => (p.measured_ph === null ? <span className="text-ink-faint">Non relevé</span> : formatNombre(p.measured_ph)),
    },
    { key: "date", header: "Préparée le", cell: (p) => formaterDate(p.prepared_at) },
    {
      key: "par",
      header: "Par",
      secondary: true,
      cell: (p) => p.prepared_by || <span className="text-ink-faint">—</span>,
    },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={preparations}
      rowKey={(p) => p.id}
      empty={
        <EspaceVide
          quoi="Aucune préparation de milieu"
          aQuoiCaSert="Une préparation est un milieu réellement fabriqué à partir d'une version de recette : le volume obtenu, le pH mesuré et les pesées effectuées."
        />
      }
    />
  );
}
