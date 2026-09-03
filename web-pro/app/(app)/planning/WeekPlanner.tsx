"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { moveIntervention } from "@/lib/field/actions";
import {
  addDaysIso, groupByDay, weekDaysIso, type Intervention,
} from "@/lib/field/types";
import { DayColumn } from "./DayColumn";
import { NewIntervention } from "./NewIntervention";
import type { EquipeVue, NoteVue, OptionsCreation, SiteVue } from "./vue";

/** À quelle distance du bord le glisser fait défiler la semaine. */
const MARGE_DE_DEFILEMENT = 64;

/**
 * §11G — la semaine.
 *
 * GLISSER-DÉPOSER NATIF, SANS BIBLIOTHÈQUE : une carte est `draggable`,
 * une colonne écoute `onDrop`. Plusieurs centaines de kilo-octets pour
 * déplacer sept cartes seraient un mauvais marché, et le natif rend
 * exactement le service attendu. Ce qu'il ne rend pas — le tactile, le
 * clavier — est rendu par le menu « ⋯ » de chaque carte, qui appelle la
 * même Server Action.
 *
 * LE DÉPLACEMENT CONSERVE L'HEURE ET LA DURÉE, et c'est protégé côté
 * serveur (`moveIntervention` → `moveToDayParis`). C'est la première
 * chose qui casse, et la moins visible.
 *
 * LA GRILLE DÉFILE HORIZONTALEMENT plutôt que de rétrécir, À PARTIR DE
 * 768 px. C'est la seule forme qui garantisse une largeur de case sur
 * un écran de bureau : sur 1920 px la semaine entière tient à ~250 px
 * par jour ; sur un portable de 1366 px ce sont le samedi et le
 * dimanche qui sortent du cadre les premiers, ce qui est le bon ordre
 * pour ce métier. Le sacrifice est assumé : sur un portable, la semaine
 * entière n'est plus visible d'un seul coup d'œil.
 *
 * EN DESSOUS DE 768 px, LA GRILLE REVIENT À UNE COLONNE. Sept pistes
 * d'au moins 196/156 px font 1 364 px de large ; la barre latérale
 * n'ayant aucun repli responsive, il reste environ 78 px de fenêtre sur
 * un téléphone. Un défilement horizontal y serait inutilisable, là où
 * l'ancien écran, tout serré qu'il était, restait au moins lisible en
 * pile. On garde donc le repli en pile — mais sans plancher de hauteur
 * (voir `DayColumn`), pour que les journées vides ne coûtent rien.
 */
export function WeekPlanner({
  mondayIso, aujourdhui, maintenantIso, interventions, equipes, notes, clients, sites,
  options, equipeFiltre, peutModifier, premiereFois,
}: {
  mondayIso: string;
  aujourdhui: string;
  maintenantIso: string;
  interventions: Intervention[];
  equipes: EquipeVue[];
  notes: NoteVue[];
  clients: { id: string; display_name: string }[];
  sites: SiteVue[];
  options: OptionsCreation;
  /** `""` toutes, `"sans"` celles sans équipe, sinon un identifiant. */
  equipeFiltre: string;
  peutModifier: boolean;
  /** L'entreprise n'a jamais planifié quoi que ce soit. */
  premiereFois: boolean;
}) {
  const router = useRouter();
  const grille = useRef<HTMLDivElement>(null);

  const [enDeplacement, setEnDeplacement] = useState<string | null>(null);
  const [survole, setSurvole] = useState<string | null>(null);
  const [edition, setEdition] = useState<{ jour: string; quoi: string } | null>(null);

  const jours = weekDaysIso(mondayIso);
  const equipesParId = new Map(equipes.map((e) => [e.id, e]));
  const clientsParId = new Map(clients.map((c) => [c.id, c.display_name]));
  const sitesParId = new Map(sites.map((s) => [s.id, s]));

  const retenues = equipeFiltre === ""
    ? interventions
    : interventions.filter((iv) =>
      equipeFiltre === "sans" ? iv.team_id === null : iv.team_id === equipeFiltre);

  const cartesParJour = groupByDay(
    retenues, jours,
    (id) => (id ? equipesParId.get(id)?.name ?? "" : ""),
  );

  // Une note d'entreprise (sans équipe) reste visible quel que soit le
  // filtre : « dépôt fermé » concerne aussi celui qui ne regarde qu'une
  // équipe. Une note d'équipe suit le filtre, comme les interventions.
  const notesRetenues = equipeFiltre === ""
    ? notes
    : notes.filter((n) => n.team_id === null
      || (equipeFiltre !== "sans" && n.team_id === equipeFiltre));

  const notesParJour = new Map<string, NoteVue[]>(jours.map((j) => [j, []]));
  for (const note of notesRetenues) notesParJour.get(note.day)?.push(note);

  /*
    « VIDE » SE JUGE SANS LE FILTRE.

    Le calcul se faisait sur la sélection : choisir une équipe qui n'a
    rien cette semaine effaçait les sept colonnes et affichait « Aucune
    intervention cette semaine » juste sous une barre de filtres qui
    annonçait « Toutes : 7 » — deux affirmations contradictoires l'une
    au-dessus de l'autre. Et l'on y perdait la création sur un jour
    précis. Un écran vide PAR FILTRE garde sa grille et le dit d'un mot.
  */
  const cartesToutes = groupByDay(interventions, jours);
  const semaineVide = jours.every(
    (j) => (cartesToutes.get(j)?.length ?? 0) === 0,
  ) && notes.length === 0;
  const selectionVide = !semaineVide && jours.every(
    (j) => (cartesParJour.get(j)?.length ?? 0) === 0 && (notesParJour.get(j)?.length ?? 0) === 0,
  );

  // Le filtre suit la navigation : on suit UNE équipe d'une semaine à
  // l'autre, et le lien de secours de l'état vide le perdait.
  const suffixeEquipe = equipeFiltre === "" ? "" : `&equipe=${equipeFiltre}`;
  const jourDAccueil = jours.includes(aujourdhui) ? aujourdhui : mondayIso;

  async function deplacer(id: string, jour: string) {
    const data = new FormData();
    data.set("intervention_id", id);
    data.set("day", jour);
    await moveIntervention(data);
    router.refresh();
  }

  function surDepot(event: React.DragEvent, jour: string) {
    event.preventDefault();
    setSurvole(null);
    // L'état React d'abord, `dataTransfer` en secours : le premier est
    // fiable dans l'onglet, le second survit à un glisser qui aurait
    // commencé ailleurs.
    const id = enDeplacement ?? event.dataTransfer.getData("text/plain");
    setEnDeplacement(null);
    if (id) void deplacer(id, jour);
  }

  /**
   * Le glisser doit faire défiler la grille.
   *
   * Sans cela, une semaine qui déborde rend le dimanche INATTEIGNABLE au
   * glisser — ce qui annulerait tout le bénéfice des grandes cases.
   */
  function surSurvolDeLaGrille(event: React.DragEvent) {
    const element = grille.current;
    if (!element) return;
    const cadre = element.getBoundingClientRect();
    if (event.clientX - cadre.left < MARGE_DE_DEFILEMENT) element.scrollLeft -= 24;
    else if (cadre.right - event.clientX < MARGE_DE_DEFILEMENT) element.scrollLeft += 24;
  }

  /*
    L'ÉTAT VIDE CÈDE LA PLACE À LA GRILLE DÈS QU'ON ÉCRIT.

    Il remplaçait la grille entière, donc les colonnes, donc le seul
    point d'entrée des notes : sur une semaine sans intervention — et
    en production, c'est la semaine courante et toutes les suivantes —
    la moitié de ce qui a été demandé de cet écran était littéralement
    inaccessible. Plutôt que de dupliquer un formulaire de note ici, le
    bouton ouvre la saisie sur un jour : `edition` cesse d'être nul, la
    grille reprend la main, et le champ est déjà là, focalisé.
  */
  if (semaineVide && edition === null) {
    return (
      <EmptyState
        icon={<Icon name="planning" className="h-6 w-6" />}
        title={
          premiereFois
            ? "Le planning est encore vide"
            : "Aucune intervention cette semaine"
        }
        description={
          premiereFois
            ? "Planifiez votre première intervention : donnez-lui un intitulé, "
              + "une équipe et un jour. Vous pourrez ensuite la faire glisser "
              + "d'un jour à l'autre, son heure et sa durée suivront."
            : "Planifiez les chantiers de la semaine, affectez une équipe, et faites "
              + "glisser une carte d'un jour à l'autre pour la replanifier. Une note "
              + "de journée retient ce qui ne tient sur aucune intervention."
        }
        action={
          <>
            {peutModifier && (
              <NewIntervention
                dayIso={jourDAccueil}
                equipes={equipes}
                options={options}
                declencheur="Planifier une intervention"
              />
            )}
            {peutModifier && (
              <button
                type="button"
                onClick={() => setEdition({ jour: jourDAccueil, quoi: "nouvelle" })}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[length:var(--text-secondary)] font-medium text-ink transition-colors hover:bg-canvas"
              >
                Ajouter une note
              </button>
            )}
            {/* Non négociable : devant un écran vide, le premier
                réflexe est de croire à une panne. La semaine
                précédente est la preuve du contraire — sauf s'il n'y a
                jamais rien eu, où elle ne mènerait nulle part. */}
            {!premiereFois && (
              <Link
                href={`/planning?semaine=${addDaysIso(mondayIso, -7)}${suffixeEquipe}`}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[length:var(--text-secondary)] font-medium text-ink transition-colors hover:bg-canvas"
              >
                ← Semaine précédente
              </Link>
            )}
          </>
        }
      />
    );
  }

  return (
    <>
      {selectionVide && (
        <p className="mb-3 text-[length:var(--text-secondary)] text-ink-soft">
          {equipeFiltre === "sans"
            ? "Tout est affecté à une équipe cette semaine."
            : "Rien pour cette équipe cette semaine."}{" "}
          <Link
            href={`/planning?semaine=${mondayIso}`}
            className="font-medium text-accent hover:underline"
          >
            Voir toutes les équipes
          </Link>
        </p>
      )}

      {/* `items-start` : sans lui la grille étire les sept cases à la
          hauteur de la plus chargée. Huit interventions le lundi
          donnaient sept colonnes de 512 px — trois cartes visibles
          derrière un ascenseur d'un côté, quatre cents pixels de blanc
          de l'autre. C'est l'inversion exacte de la priorité. */}
      <div
        ref={grille}
        onDragOver={surSurvolDeLaGrille}
        className="grid grid-cols-1 items-start gap-3 pb-2 md:grid-cols-[repeat(5,minmax(196px,1fr))_repeat(2,minmax(156px,0.72fr))] md:overflow-x-auto md:[overscroll-behavior-x:contain] md:[scroll-padding-left:12px] md:[scroll-snap-type:x_proximity]"
      >
        {jours.map((jour, index) => (
          <DayColumn
            key={jour}
            dayIso={jour}
            index={index}
            cartes={cartesParJour.get(jour) ?? []}
            notes={notesParJour.get(jour) ?? []}
            equipes={equipesParId}
            equipesListe={equipes}
            clients={clientsParId}
            sites={sitesParId}
            options={options}
            jours={jours}
            aujourdhui={aujourdhui}
            maintenantIso={maintenantIso}
            peutModifier={peutModifier}
            equipeParDefaut={equipeFiltre === "sans" ? "" : equipeFiltre}
            edition={edition?.jour === jour ? edition.quoi : null}
            surEdition={(quoi) => setEdition(quoi === null ? null : { jour, quoi })}
            enDeplacement={enDeplacement}
            survole={survole === jour}
            unGlisserEnCours={enDeplacement !== null}
            surSurvol={() => setSurvole(jour)}
            surSortieDeSurvol={() => setSurvole((c) => (c === jour ? null : c))}
            surDepot={(event) => surDepot(event, jour)}
            surPrise={setEnDeplacement}
            surFin={() => { setEnDeplacement(null); setSurvole(null); }}
            surDeplacement={(id, cible) => void deplacer(id, cible)}
          />
        ))}
      </div>
    </>
  );
}
