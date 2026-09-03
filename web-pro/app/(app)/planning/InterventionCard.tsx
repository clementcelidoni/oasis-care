"use client";

import Link from "next/link";
import { useRef } from "react";
import { Badge, Modal } from "@/components/ui";
import {
  INTERVENTION_STATUS_LABELS, INTERVENTION_STATUS_TONE,
  formatDayIsoLong, formatDuree, formatTime, overlapHours,
  type PlanningCard,
} from "@/lib/field/types";
import { KindGlyph } from "./KindGlyph";
import type { EquipeVue } from "./vue";

/**
 * Une intervention, un jour.
 *
 * ORDRE DE LECTURE, et il est décidé : ce qu'on fait, puis quand et
 * pour qui, puis avec qui. Plus aucun texte sous 13 px — et sous
 * `text-[length:…]`, faute de quoi Tailwind compile `text-[var(--x)]`
 * en `color:` : la déclaration est invalide, le navigateur la jette, et
 * tout l'étage « secondaire » se rendait à la taille du titre. Vérifié
 * en compilant la feuille : `.text-[var(--text-secondary)]` produit
 * `color: var(--text-secondary)`, c'est-à-dire `color: 0.8125rem`.
 *
 * TROIS LIGNES, TOUJOURS LES MÊMES. Une variante « compacte » à une
 * ligne existait pour les interventions de moins de deux heures ; elle
 * escamotait le statut, le nom du client et le rappel « à clôturer »,
 * c'est-à-dire tout ce qui répond à « est-ce fait ? », et sur la carte
 * la plus courante d'un paysagiste : la visite d'une heure. La rendre
 * complète en une seule ligne était impossible — un badge de statut et
 * le menu de déplacement ne laissent rien d'une piste de 156 px. On a
 * préféré la régularité : une visite courte coûte une vingtaine de
 * pixels de plus, et elle dit enfin chez qui elle est.
 *
 * PAS DE POIGNÉE DE GLISSER. Six points au survol étaient prévus ;
 * partout où on les posait, ils apparaissaient à l'entrée du curseur et
 * repoussaient soit le titre, soit le nom de l'équipe — un
 * tremblement, sur l'élément qu'on est justement en train de viser.
 * `cursor-grab` / `active:cursor-grabbing` annonce déjà le geste, et le
 * menu « ⋯ » le rend faisable au doigt et au clavier. Une décoration
 * qui bouge la mise en page ne vaut pas son prix.
 */
export function InterventionCard({
  carte, dayIso, aujourdhui, equipe, client, jours, maintenantIso, weekend,
  enDeplacement, peutModifier, surPrise, surFin, surDeplacement,
}: {
  carte: PlanningCard;
  dayIso: string;
  /** Le jour vécu à Paris : « à clôturer » n'a de sens qu'au passé. */
  aujourdhui: string;
  equipe: EquipeVue | null;
  /** Le CLIENT — jamais le numéro de chantier. C'est le nom qu'on prononce le matin. */
  client: string | null;
  /** Les sept jours, pour le menu « Déplacer à… ». */
  jours: string[];
  /** L'instant du rendu, calculé UNE fois sur le serveur. */
  maintenantIso: string;
  /** Le fond de la case : la carte doit rester visible dessus. */
  weekend: boolean;
  enDeplacement: boolean;
  peutModifier: boolean;
  surPrise: (id: string) => void;
  surFin: () => void;
  surDeplacement: (id: string, jour: string) => void;
}) {
  const iv = carte.intervention;
  const suite = !carte.premier;
  const plusieursJours = carte.jours > 1;

  /*
    LA CARTE D'UN JOUR DE CONTINUATION NE SE DÉPLACE PAS.
    Glisser le troisième jour d'un chantier de quatre n'a pas de sens
    défini — le raccourcir ? le décaler tout entier ? Le laisser faire
    produirait un déplacement silencieusement faux. Seule la carte du
    premier jour bouge, et elle emporte le chantier entier.
  */
  const deplacable = peutModifier && carte.premier;

  /*
    « À CLÔTURER » SE JUGE SUR LA FIN, ET NE S'ÉCRIT QU'UNE FOIS.

    La version précédente testait le DÉBUT, sans regarder le jour de la
    carte : un chantier commencé hier et toujours « Planifiée » portait
    le rappel sur chacun de ses jours À VENIR. Un chantier qui court
    n'est pas en retard — il l'est quand sa fin est passée. Et le
    rappel ne se pose que sur sa dernière carte, la seule où il veuille
    dire quelque chose.
  */
  const finPrevue = iv.scheduled_end ?? iv.scheduled_start;
  const enRetard = iv.status === "scheduled"
    && carte.dernier
    && dayIso <= aujourdhui
    && Boolean(finPrevue)
    && finPrevue! < maintenantIso;

  const couleur = equipe?.color ?? "var(--line-strong)";
  const nomEquipe = equipe?.name ?? "Sans équipe";

  /*
    LA LIGNE MÉTA, ET LE RANG QUI N'EST PLUS UNE PASTILLE.

    « Jour 2 / 4 » était un `Badge` posé sur la ligne du TITRE, en
    `shrink-0` : il ne cédait rien, et le titre — seul élément
    rétractable des trois — tombait à cinq pixels de large sur une
    colonne de week-end, soit une lettre par ligne, très exactement sur
    le cas que cette refonte devait corriger. Le titre doit être le
    dernier à céder de la place, jamais le premier. Le rang redevient
    donc du texte, dans la ligne méta, où il se tronque comme le reste.

    AUCUNE DURÉE SUR UN CHANTIER DE PLUSIEURS JOURS. Le recouvrement
    calendaire d'un jour intermédiaire vaut vingt-quatre heures :
    la carte annonçait « journée entière · 24 h », c'est-à-dire une
    journée de minuit à minuit. La durée qu'on veut lire là n'est pas
    celle du calendrier, et on préfère n'en écrire aucune.
  */
  const quand = suite
    ? (carte.dernier ? `jusqu'à ${formatTime(iv.scheduled_end)}` : "journée entière")
    : formatTime(iv.scheduled_start);
  const heures = plusieursJours ? null : overlapHours(iv, dayIso);

  const meta = [
    plusieursJours ? `Jour ${carte.rang}/${carte.jours}` : null,
    quand,
    heures === null ? null : formatDuree(heures),
    client,
  ].filter((morceau): morceau is string => Boolean(morceau)).join(" · ");

  return (
    <article
      draggable={deplacable}
      onDragStart={(event) => {
        // Firefox refuse de démarrer un glisser sans données.
        event.dataTransfer.setData("text/plain", iv.id);
        event.dataTransfer.effectAllowed = "move";
        surPrise(iv.id);
      }}
      onDragEnd={surFin}
      title={iv.notes ?? undefined}
      className={`group relative flex flex-col gap-1 rounded-[var(--radius-control)] border-l-[3px] px-2.5 py-2 transition-opacity ${
        deplacable ? "cursor-grab active:cursor-grabbing" : ""
      } ${enDeplacement ? "opacity-40" : ""} ${weekend ? "bg-surface" : "bg-canvas"}`}
      style={{
        borderLeftColor: couleur,
        // Une équipe absente est une FORME, pas seulement un gris : un
        // gris de plus sur une carte grise ne se remarque pas.
        borderLeftStyle: equipe ? (suite ? "dashed" : "solid") : "dashed",
      }}
    >
      <div className="flex items-start gap-1.5">
        <KindGlyph kind={iv.kind} className="mt-[3px] h-4 w-4 shrink-0 text-ink-faint" />

        <Link
          href={`/projets/interventions/${iv.id}`}
          draggable={false}
          className="min-w-0 flex-1 text-[length:var(--text-body)] font-medium leading-snug transition-colors after:absolute after:inset-0 hover:text-accent"
        >
          <span className="line-clamp-2">{iv.title}</span>
        </Link>

        {/* TOUJOURS VISIBLE, SUR TOUS LES ÉCRANS.
            Ce menu est le seul chemin de replanification au doigt et
            au clavier : le glisser-déposer HTML5 n'émet rien sur un
            écran tactile. Il portait `md:opacity-0
            md:group-hover:opacity-100`, que Tailwind enferme dans
            `@media (hover: hover)` — sur une tablette, c'est-à-dire
            sur l'appareil pour lequel il a été écrit, il
            n'apparaissait jamais.

            ICI ET NON AU PIED : 28 px pris au titre lui coûtent un mot
            reporté sur sa seconde ligne, quand les mêmes 28 px pris au
            pied s'ajoutaient à un badge de statut qui ne cède rien et
            effaçaient le nom de l'équipe. */}
        {peutModifier && (
          <span className="relative z-10 shrink-0">
            <Modal
              triggerLabel="⋯"
              triggerTitle={`Déplacer « ${iv.title} »`}
              triggerClassName="-mt-0.5 flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink"
              title="Déplacer l'intervention"
              description={iv.title}
              width="22rem"
            >
              <ChoixDuJour
                jours={jours}
                jourActuel={dayIso}
                deplacable={carte.premier}
                surChoix={(jour) => surDeplacement(iv.id, jour)}
              />
            </Modal>
          </span>
        )}
      </div>

      {/* PLEINE LARGEUR, et c'est tout l'objet du déplacement des
          commandes. La poignée et le menu « ⋯ » vivaient ici en
          `opacity-0` : invisibles, ils occupaient quand même leur place
          et réservaient de 38 % à 54 % de la ligne. « 08:00 · 8 h ·
          Dupont » était donc tronqué sur TOUTES les cartes, et le nom
          du client — la première chose qu'on cherche le matin —
          n'était jamais lisible. Les deux sont descendus au pied, qui
          a de la place. */}
      <p className="truncate text-[length:var(--text-secondary)] text-ink-soft">
        <span className="tabular">{meta}</span>
      </p>

      <div className="flex items-center gap-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[length:var(--text-secondary)] text-ink-soft">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: couleur }}
          />
          <span className="truncate">{nomEquipe}</span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {iv.notes && (
            <span
              title={iv.notes}
              aria-label="Compte rendu renseigné"
              className="text-ink-faint"
            >
              ✎
            </span>
          )}
          {enRetard && (
            <span
              title="Devait être terminée, et toujours planifiée."
              className="text-[length:var(--text-secondary)] font-medium text-warning"
            >
              • à clôturer
            </span>
          )}
          {/* « Planifiée » est le défaut : un défaut ne s'écrit pas. */}
          {iv.status !== "scheduled" && (
            <Badge tone={INTERVENTION_STATUS_TONE[iv.status]}>
              {INTERVENTION_STATUS_LABELS[iv.status]}
            </Badge>
          )}
        </span>
      </div>
    </article>
  );
}

/**
 * L'équivalent CLAVIER et TACTILE du glisser-déposer.
 *
 * Non négociable : `dragstart` n'est émis par aucun navigateur tactile,
 * et la tablette est très exactement l'appareil que le paysagiste tient
 * debout. Sans ce menu, replanifier depuis le terrain impose d'ouvrir
 * la fiche et de manipuler deux champs `datetime-local`, et l'écran
 * n'est pas utilisable au clavier du tout.
 *
 * Même Server Action, même champ `day` que le dépôt : un second chemin
 * de code aurait fini par diverger, et c'est le clavier qui aurait
 * perdu.
 */
function ChoixDuJour({
  jours, jourActuel, deplacable, surChoix,
}: {
  jours: string[];
  jourActuel: string;
  deplacable: boolean;
  surChoix: (jour: string) => void;
}) {
  const conteneur = useRef<HTMLDivElement>(null);

  if (!deplacable) {
    return (
      <p className="text-[length:var(--text-body)] text-ink-soft">
        Ce chantier s&apos;étend sur plusieurs jours. Déplacez la carte de son premier
        jour : elle emporte le chantier entier, heure et durée comprises.
      </p>
    );
  }

  return (
    <div ref={conteneur} className="flex flex-col gap-0.5">
      {jours.map((jour) => {
        const actuel = jour === jourActuel;
        return (
          <button
            key={jour}
            type="button"
            disabled={actuel}
            onClick={() => {
              // Fermer AVANT d'agir : l'action rafraîchit la page, et
              // une boîte de dialogue laissée ouverte sur une carte qui
              // vient de changer de colonne n'a plus de sujet.
              conteneur.current?.closest("dialog")?.close();
              surChoix(jour);
            }}
            className={`rounded-[var(--radius-control)] px-3 py-2 text-left text-[length:var(--text-body)] transition-colors ${
              actuel
                ? "cursor-default text-ink-faint"
                : "text-ink hover:bg-accent-wash hover:text-accent"
            }`}
          >
            {formatDayIsoLong(jour)}
            {actuel && <span className="text-ink-faint"> — jour actuel</span>}
          </button>
        );
      })}
      <p className="mt-2 text-[length:var(--text-secondary)] text-ink-faint">
        L&apos;heure et la durée sont conservées.
      </p>
    </div>
  );
}
