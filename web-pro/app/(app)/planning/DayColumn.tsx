"use client";

import {
  WEEKDAY_LABELS, chargeDuJour, formatDayIso, formatDayIsoLong, formatDuree,
  type PlanningCard,
} from "@/lib/field/types";
import { DayDrawer } from "./DayDrawer";
import { DayNotes } from "./DayNotes";
import { InterventionCard } from "./InterventionCard";
import { NewIntervention } from "./NewIntervention";
import type { EquipeVue, NoteVue, OptionsCreation, SiteVue } from "./vue";

/**
 * Une case du planning.
 *
 * HAUTEURS : 240 px au minimum sur une grille à sept colonnes — un
 * en-tête, trois cartes et le bouton de création, soit très largement
 * la charge réelle d'une journée sans avoir à défiler. 512 px au
 * maximum, avec DÉFILEMENT INTERNE : sans plafond, dix cartes le lundi
 * rendent les sept colonnes hautes de dix cartes dont six vides, la
 * semaine passe sous la ligne de flottaison et le dimanche devient un
 * rectangle blanc de six cents pixels.
 *
 * SOUS 768 px, NI PLANCHER NI PLAFOND. La grille y repasse à une seule
 * colonne pleine largeur : un plancher de 240 px ferait sept écrans de
 * vide à faire défiler, et un plafond mettrait un ascenseur dans un
 * ascenseur. Une journée vide s'y réduit donc à son en-tête.
 *
 * PAS DE « +3 AUTRES » : un repli cache du travail derrière un clic sur
 * l'écran dont le métier est justement de dire combien il y en a — et
 * une carte repliée ne se glisse plus. Ce qu'on perd est rendu par le
 * compteur d'en-tête, qui ouvre le détail complet.
 */
export function DayColumn({
  dayIso, index, cartes, notes, equipes, equipesListe, clients, sites, options,
  jours, aujourdhui, maintenantIso, peutModifier, equipeParDefaut,
  edition, surEdition, enDeplacement, survole, unGlisserEnCours,
  surSurvol, surSortieDeSurvol, surDepot, surPrise, surFin, surDeplacement,
}: {
  dayIso: string;
  index: number;
  cartes: PlanningCard[];
  notes: NoteVue[];
  equipes: Map<string, EquipeVue>;
  equipesListe: EquipeVue[];
  clients: Map<string, string>;
  sites: Map<string, SiteVue>;
  options: OptionsCreation;
  jours: string[];
  aujourdhui: string;
  maintenantIso: string;
  peutModifier: boolean;
  equipeParDefaut: string;
  edition: string | null;
  surEdition: (quoi: string | null) => void;
  enDeplacement: string | null;
  survole: boolean;
  unGlisserEnCours: boolean;
  surSurvol: () => void;
  surSortieDeSurvol: () => void;
  surDepot: (event: React.DragEvent) => void;
  surPrise: (id: string) => void;
  surFin: () => void;
  surDeplacement: (id: string, jour: string) => void;
}) {
  const estAujourdhui = dayIso === aujourdhui;
  const weekend = index >= 5;
  const charge = chargeDuJour(cartes, dayIso);

  /*
    LE FOND DE LA CASE APPARTIENT AU DÉPÔT.
    Teinter le jour courant lui volerait le seul signal dont le
    glisser-déposer dispose, et le jour où il compte le plus est
    justement aujourd'hui. Le jour courant se marque donc par un trait
    haut et un libellé d'accent, jamais par un fond.
  */
  const fond = survole ? "bg-accent-wash" : weekend ? "bg-canvas" : "bg-surface";
  const bordure = survole
    ? "border-accent outline-2 outline-accent"
    : unGlisserEnCours
      // Le plateau annonce ses sept destinations dès la prise, pas
      // seulement celle qui est sous le curseur.
      ? "border-line outline-1 outline-dashed outline-line-strong"
      : "border-line";

  return (
    <section
      aria-label={formatDayIsoLong(dayIso)}
      onDragOver={(event) => { event.preventDefault(); surSurvol(); }}
      onDragLeave={surSortieDeSurvol}
      onDrop={surDepot}
      className={`@container flex flex-col rounded-[var(--radius-card)] border p-3 shadow-[var(--shadow-card)] outline-offset-[-6px] transition-colors md:max-h-[32rem] md:min-h-[15rem] [scroll-snap-align:start] ${fond} ${bordure} ${
        estAujourdhui ? "border-t-2 border-t-accent" : ""
      }`}
    >
      {/*
        L'EN-TÊTE NE DÉBORDE PLUS, ET NE TRONQUE PLUS LE NOM DU JOUR.

        Il empilait quatre choses dans 132 px utiles : le jour, la date,
        le bouton de note et le compteur de charge. Le libellé n'étant
        ni rétractable ni tronqué, « Dimanche » passait PAR-DESSUS le
        bouton de note — le geste demandé était masqué le dimanche — et
        la date tombait à zéro pixel. Le bouton de note est descendu
        d'un cran (voir `DayNotes`) ; il reste le jour, la date et le
        compteur, et c'est encore trop sur une colonne de week-end.

        LA DATE CÈDE, PAS LE NOM DU JOUR, et elle cède franchement
        plutôt qu'en pointillés : une requête de conteneur la retire
        sous 160 px de case. « Samedi » entier vaut mieux que
        « Sa… 6 sept. ». La date complète reste dans l'infobulle, dans
        le libellé accessible de la case, et dans le titre du tiroir.
      */}
      <header className="mb-2 flex items-baseline justify-between gap-2 overflow-hidden">
        <h2
          title={formatDayIsoLong(dayIso)}
          className="flex min-w-0 items-baseline gap-1.5 overflow-hidden"
        >
          <span
            className={`truncate text-[15px] font-semibold leading-none ${
              estAujourdhui ? "text-accent" : weekend ? "text-ink-faint" : "text-ink"
            }`}
          >
            {WEEKDAY_LABELS[index]}
          </span>
          <span className="hidden shrink-0 whitespace-nowrap text-[length:var(--text-secondary)] text-ink-faint @[10rem]:inline">
            {formatDayIso(dayIso)}
          </span>
        </h2>

        {charge.compte > 0 && (
          <DayDrawer
            dayIso={dayIso}
            cartes={cartes}
            notes={notes}
            equipes={equipes}
            clients={clients}
            sites={sites}
            declencheur={<span className="tabular">{libelleDeCharge(charge)}</span>}
            declencheurTitre={`${libelleDeCharge(charge)} — détail de la journée du ${formatDayIsoLong(dayIso).toLowerCase()}`}
            declencheurClassName="shrink-0 rounded-[var(--radius-control)] px-1 text-[length:var(--text-secondary)] text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
          />
        )}
      </header>

      <DayNotes
        dayIso={dayIso}
        notes={notes}
        equipes={equipes}
        peutModifier={peutModifier}
        edition={edition}
        surEdition={surEdition}
        equipeParDefaut={equipeParDefaut}
        debordement={(restantes) => (
          <DayDrawer
            dayIso={dayIso}
            cartes={cartes}
            notes={notes}
            equipes={equipes}
            clients={clients}
            sites={sites}
            declencheur={`+${restantes} note${restantes > 1 ? "s" : ""}`}
            declencheurTitre={`+${restantes} note${restantes > 1 ? "s" : ""} — toutes les notes du ${formatDayIsoLong(dayIso).toLowerCase()}`}
            declencheurClassName="self-start rounded-[var(--radius-control)] pl-2 text-[length:var(--text-secondary)] text-ink-faint transition-colors hover:text-accent"
          />
        )}
      />

      {/* Un jour vide n'affiche RIEN. « Aucune intervention » répété
          cinq fois est du bruit ; le vide se voit tout seul. */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {cartes.map((carte) => (
          <InterventionCard
            key={`${carte.intervention.id}-${carte.rang}`}
            carte={carte}
            dayIso={dayIso}
            aujourdhui={aujourdhui}
            equipe={carte.intervention.team_id
              ? equipes.get(carte.intervention.team_id) ?? null
              : null}
            client={carte.intervention.customer_id
              ? clients.get(carte.intervention.customer_id) ?? null
              : null}
            jours={jours}
            maintenantIso={maintenantIso}
            weekend={weekend}
            enDeplacement={enDeplacement === carte.intervention.id}
            peutModifier={peutModifier}
            surPrise={surPrise}
            surFin={surFin}
            surDeplacement={surDeplacement}
          />
        ))}
      </div>

      {peutModifier && (
        <NewIntervention
          dayIso={dayIso}
          equipes={equipesListe}
          options={options}
          declencheur="+ Planifier"
          declencheurTitre={`Planifier une intervention le ${formatDayIsoLong(dayIso).toLowerCase()}`}
          declencheurClassName="mt-2 w-full rounded-[var(--radius-control)] border border-dashed border-line-strong py-1.5 text-[length:var(--text-secondary)] text-ink-faint transition-colors hover:border-accent hover:text-accent"
        />
      )}
    </section>
  );
}

/**
 * « 3 · 22 h », « 3 · 22 h + », ou « 3 » tout court.
 *
 * Le « + » dit que le total est un minorant : au moins une intervention
 * n'a pas de durée connue pour cette journée-là — soit qu'elle n'ait
 * pas de fin, soit que ce soit un chantier de plusieurs jours, dont on
 * ne prétend plus savoir combien d'heures tombent ici (voir
 * `chargeDuJour`). Et quand AUCUNE n'a de durée, on n'écrit pas
 * « 0 h » : une journée pleine affichée à zéro heure est un mensonge,
 * et c'est très exactement ce qu'un `?? 0` aurait produit.
 */
function libelleDeCharge(charge: { compte: number; heures: number | null; incomplet: boolean }) {
  if (charge.heures === null) return String(charge.compte);
  return `${charge.compte} · ${formatDuree(charge.heures)}${charge.incomplet ? " +" : ""}`;
}
