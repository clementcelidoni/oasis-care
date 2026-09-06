import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, DataTable, PageHeader, Panel, type Column } from "@/components/ui";
import { perimetreBioLab, formatFacteur, formatNombre, formatPourcentage } from "@/lib/biolab/cultures";
import { EspaceVide, LectureImpossible, refusBioLab } from "@/lib/biolab/etats";
import {
  PONDERATION_PAR_DEFAUT,
  grouperProtocolesParRecette,
  performanceDesProtocoles,
  type Comparaison,
  type PerformanceProtocole,
} from "@/lib/biolab/protocoles";
import { lireRecettes, lireVersions } from "@/lib/biolab/recettes";
import { lireMatiere } from "@/lib/biolab/statistiques";
import { SEUIL_TAUX, direTaux } from "@/lib/biolab/referentiel";

/**
 * §7 « protocoles » — CE QUI MARCHE, ET SUR COMBIEN DE LOTS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CET ÉCRAN N'INVENTE PAS UNE TABLE « PROTOCOLES »
 * ══════════════════════════════════════════════════════════════════
 *
 * Il n'existe aucune table de protocoles ni de SOP en base — mesuré sur
 * les vingt et une tables BioLab. En créer une serait le second système
 * BioLab que le §6 interdit, et elle serait vide : personne, sur le
 * téléphone, n'a d'écran pour la remplir.
 *
 * Le protocole de ce produit, c'est la VERSION DE RECETTE. Le modèle
 * mobile se documente lui-même comme « the named recipe/protocol », et
 * tout le module raisonne ainsi. Cet écran est donc le comparateur des
 * protocoles réellement employés, adossé aux lots qui les ont reçus —
 * exactement ce que fait `ProtocolComparisonService` sur le téléphone.
 *
 * DEUX PRUDENCES SONT VISIBLES À L'ÉCRAN, PAS SEULEMENT DANS LE CODE :
 * le nombre de lots derrière chaque ligne, et le fait que le score est
 * RELATIF aux protocoles comparés. Sans elles, un protocole essayé une
 * fois trônerait en tête et déciderait d'une campagne entière.
 */

export default async function ProtocolesPage() {
  const contexte = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(contexte, "La comparaison des protocoles");

  const entete = (
    <PageHeader
      eyebrow="BioLab"
      title="Protocoles"
      subtitle="Les versions de recette réellement employées, comparées sur les lots qui les ont reçues."
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
  const [recettes, versions, matiere] = await Promise.all([
    lireRecettes(supabase, contexte.workspaceId),
    lireVersions(supabase, contexte.workspaceId),
    lireMatiere(supabase, contexte.workspaceId),
  ]);

  const erreur = recettes.erreur ?? versions.erreur ?? matiere.erreur;
  if (erreur) {
    return (
      <>
        {entete}
        <LectureImpossible sujet="Les protocoles" erreur={erreur} />
      </>
    );
  }

  const performances = performanceDesProtocoles(
    versions.donnees,
    recettes.donnees,
    matiere.donnees.lots,
    matiere.donnees.inspections,
    matiere.donnees.acclimatations,
  );

  if (performances.length === 0) {
    return (
      <>
        {entete}
        <EspaceVide
          quoi="Aucun protocole n'a encore servi"
          aQuoiCaSert="Un protocole apparaît ici dès qu'au moins un lot de culture a reçu l'une de ses versions ; il est alors comparé aux autres sur la multiplication, la contamination, l'hyperhydricité, l'enracinement et la survie en acclimatation."
        />
        <p className="mt-4 text-[var(--text-secondary)] text-ink-soft">
          {versions.donnees.length > 0
            ? `${versions.donnees.length} version${versions.donnees.length > 1 ? "s" : ""} de recette existe${
                versions.donnees.length > 1 ? "nt" : ""
              }, mais aucun lot n'y est rattaché. Une version jamais employée n'a pas une performance de zéro : elle n'a pas de performance.`
            : "Aucune version de recette n'est enregistrée."}
        </p>
      </>
    );
  }

  // ON GROUPE AVANT DE SCORER. Le score est une normalisation sur
  // l'ensemble comparé : le calculer sur tout le laboratoire revenait à
  // classer une recette d'Alocasia contre une recette de Monstera, ce
  // qui ne veut rien dire. Le téléphone regroupe par recette avant de
  // scorer ; on fait pareil, et pour la même raison.
  const groupes = grouperProtocolesParRecette(performances);
  const solides = performances.filter((p) => p.solide).length;

  return (
    <>
      {entete}

      <Card className="mb-6 p-5">
        <p className="text-[var(--text-body)]">
          {performances.length} protocole{performances.length > 1 ? "s" : ""} employé
          {performances.length > 1 ? "s" : ""}, dont {solides} appuyé{solides > 1 ? "s" : ""} sur au moins {SEUIL_TAUX}{" "}
          lots.
        </p>
        <p className="mt-2 text-[var(--text-secondary)] text-ink-soft">
          Le score est <strong>relatif</strong> : il compare ces protocoles entre eux et ne dit rien de leur valeur
          absolue. Il pèse la multiplication ({formatPourcentage(PONDERATION_PAR_DEFAUT.multiplication)}),
          l&apos;enracinement ({formatPourcentage(PONDERATION_PAR_DEFAUT.enracinement)}), la contamination et
          l&apos;hyperhydricité ({formatPourcentage(PONDERATION_PAR_DEFAUT.contamination)} chacune) et la survie en
          acclimatation ({formatPourcentage(PONDERATION_PAR_DEFAUT.survie)}) — la même pondération que
          l&apos;application mobile. Un indicateur inconnu ne compte pas comme un mauvais résultat : il sort du calcul.
        </p>
        <p className="mt-2 text-[var(--text-secondary)] text-ink-soft">
          <strong>Le score ne compare que les versions d&apos;une même recette</strong>, et le tableau est donc découpé
          par recette. C&apos;est la règle du moteur d&apos;analyse du téléphone, qui l&apos;écrit noir sur blanc :
          ce chiffre n&apos;est ni absolu, ni transposable d&apos;une espèce à l&apos;autre. Un milieu qui contamine peu
          sur une espèce facile n&apos;est pas meilleur qu&apos;un milieu qui contamine sur une espèce difficile ; les
          mettre dans le même classement produirait un gagnant sans signification.
        </p>
      </Card>

      {groupes.map((groupe) => (
        <section key={groupe.clef} className="mb-8">
          <Panel
            title={groupe.intitule}
            description={
              groupe.especes.length > 0
                ? `${groupe.performances.length} version${groupe.performances.length > 1 ? "s" : ""} employée${groupe.performances.length > 1 ? "s" : ""}, sur : ${groupe.especes.join(", ")}. Chaque ligne dit sur combien de lots elle repose ; sous ${SEUIL_TAUX} lots, les faits bruts remplacent le pourcentage.`
                : `${groupe.performances.length} version${groupe.performances.length > 1 ? "s" : ""} employée${groupe.performances.length > 1 ? "s" : ""}. Chaque ligne dit sur combien de lots elle repose.`
            }
            count={groupe.performances.length}
            className="mb-3"
          >
            <TableauProtocoles performances={groupe.performances} scores={groupe.scores} />
          </Panel>

          {/* « Rien à comparer » plutôt qu'un tableau à une colonne :
              une recette qui n'a qu'une version n'a pas de variante, et
              afficher une comparaison d'elle avec elle-même ferait
              croire à un travail d'analyse qui n'a pas eu lieu. */}
          {groupe.comparaison === null ? (
            <p className="text-[var(--text-secondary)] text-ink-soft">
              Une seule version employée : il n&apos;y a rien à comparer, et le score reste vide — un protocole
              seul serait « le meilleur » par le seul fait d&apos;être unique.
            </p>
          ) : (
            <Panel
              title="Ce qui distingue ces versions"
              description={
                groupe.comparaison.champsDifferents.length === 0
                  ? "Ces versions ne diffèrent sur aucun des champs comparés."
                  : `Elles diffèrent sur : ${groupe.comparaison.champsDifferents.join(", ")}. Une différence n'est pas une cause : rien ici n'établit qu'un écart de composition explique un écart de résultat.`
              }
            >
              <TableauComparaison comparaison={groupe.comparaison} />
            </Panel>
          )}
        </section>
      ))}
    </>
  );
}

function TableauComparaison({ comparaison }: { comparaison: Comparaison }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[var(--text-body)]">
        <thead>
          <tr className="border-b border-line bg-surface-sunken/60">
            <th scope="col" className="eyebrow px-4 py-2.5 text-left">
              Champ
            </th>
            {comparaison.intitules.map((intitule) => (
              <th key={intitule} scope="col" className="eyebrow px-4 py-2.5 text-left">
                {intitule}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparaison.lignes.map((ligne) => (
            <tr key={ligne.champ} className="border-b border-line last:border-0">
              <th scope="row" className="px-4 py-2.5 text-left font-medium">
                {ligne.champ}
                {/* La différence est signalée par un mot ET par la
                    teinte : §47 — une information portée par la seule
                    couleur disparaît pour un daltonien. */}
                {ligne.differe && (
                  <span className="ml-2 align-middle">
                    <Badge tone="warning">diffère</Badge>
                  </span>
                )}
              </th>
              {ligne.valeurs.map((valeur, index) => (
                <td
                  key={`${ligne.champ}-${index}`}
                  className={`px-4 py-2.5 ${ligne.differe ? "font-medium" : "text-ink-soft"}`}
                >
                  {valeur}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableauProtocoles({
  performances,
  scores,
}: {
  performances: PerformanceProtocole[];
  scores: Map<string, { score: number | null; solide: boolean }>;
}) {
  const colonnes: Column<PerformanceProtocole>[] = [
    {
      key: "protocole",
      header: "Protocole",
      cell: (p) => (
        <span>
          {p.intitule}
          {!p.solide && (
            <span className="ml-2 align-middle">
              <Badge tone="neutral">peu de lots</Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "especes",
      header: "Espèces",
      secondary: true,
      cell: (p) => (p.especes.length === 0 ? <span className="text-ink-faint">—</span> : p.especes.join(", ")),
    },
    { key: "lots", header: "Lots", numeric: true, cell: (p) => formatNombre(p.indicateurs.lots) },
    {
      key: "multiplication",
      header: "Multiplication",
      numeric: true,
      cell: (p) => formatFacteur(p.indicateurs.multiplication) ?? "Non disponible",
    },
    {
      key: "contamination",
      header: "Contamination",
      numeric: true,
      cell: (p) => direTaux(p.indicateurs.contamination),
    },
    {
      key: "hyperhydricite",
      header: "Hyperhydricité",
      numeric: true,
      secondary: true,
      cell: (p) => direTaux(p.indicateurs.hyperhydricite),
    },
    {
      key: "enracinement",
      header: "Enracinement",
      numeric: true,
      secondary: true,
      cell: (p) => direTaux(p.indicateurs.enracinement),
    },
    {
      key: "score",
      header: "Score relatif",
      numeric: true,
      cell: (p) => {
        const score = scores.get(p.version.id)?.score;
        // Un protocole seul n'a pas de score : il n'y a rien contre quoi
        // le comparer, et lui donner 100 le sacrerait meilleur du
        // laboratoire par le seul fait d'être unique.
        return score === null || score === undefined ? (
          <span className="text-ink-faint">Rien à comparer</span>
        ) : (
          formatNombre(Math.round(score))
        );
      },
    },
  ];

  return (
    <DataTable
      columns={colonnes}
      rows={performances}
      rowKey={(p) => p.version.id}
      empty={<span />}
      footer={
        <span className="text-[var(--text-secondary)] text-ink-soft">
          Le détail d&apos;une composition et sa filiation se lisent sur{" "}
          <Link href="/biolab/recettes" className="font-medium hover:text-accent">
            la fiche de sa recette
          </Link>
          .
        </span>
      }
    />
  );
}
