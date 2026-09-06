/**
 * LES TROIS ÉCRANS QUI NE MONTRENT PAS DE DONNÉES.
 *
 * Ils comptent plus que les autres dans ce module, parce que seize des
 * vingt et une tables BioLab sont vides aujourd'hui : l'état vide sera
 * le plus souvent rendu. §32 du document d'UX le dit déjà — « créer de
 * vrais empty states, pas No data » — mais il y a ici une raison plus
 * sérieuse qu'une question de soin.
 *
 * TROIS SITUATIONS SE RESSEMBLENT À L'ÉCRAN ET N'ONT RIEN À VOIR :
 *
 *   1. « Je n'ai pas le droit. » Un refus.
 *   2. « La lecture a échoué. » Une panne.
 *   3. « Il n'y a rien ici. » Un fait — et, dans ce module, souvent un
 *      fait TROMPEUR : les cultures existent, elles sont simplement
 *      rangées dans l'espace personnel du dirigeant et pas dans celui
 *      de l'entreprise.
 *
 * Les rendre toutes les trois par un tableau vide serait la pire des
 * réponses : quelqu'un conclurait que son laboratoire est vide alors
 * qu'il n'a qu'un droit manquant, ou qu'une requête a échoué.
 */

import { EmptyState, Panel } from "@/components/ui";
import type { PerimetreBioLab } from "./cultures.ts";

/** 1 — Le refus. */
export function AccesRefuse({ sujet }: { sujet: string }) {
  return (
    <EmptyState
      title="Vous n'avez pas accès à cette page"
      description={`${sujet} demande le droit « lecture BioLab ». Ce droit existe et il s'accorde par le rôle : responsable, responsable pépinière, ouvrier pépinière et lecture seule l'ont ; l'ouvrier de terrain ne l'a pas. Un administrateur de votre entreprise peut changer votre rôle depuis Entreprise › Équipe.`}
    />
  );
}

/**
 * 1 bis — LE MODULE ÉTEINT, QUI N'EST PAS UN REFUS.
 *
 * §43 : l'entreprise décide elle-même des modules qu'elle utilise. Tant
 * que ce contrôle n'existait qu'au niveau de la barre latérale, taper
 * `/biolab/lots` dans la barre d'adresse ouvrait l'écran d'un module
 * éteint — un interrupteur qui n'éteignait que la lumière du couloir.
 *
 * Le message ne dit surtout pas « vous n'avez pas le droit » : la
 * personne l'a, et l'envoyer réclamer une permission qu'elle détient
 * déjà lui ferait perdre une journée. Elle dit où est l'interrupteur.
 */
export function ModuleEteint({ sujet }: { sujet: string }) {
  return (
    <EmptyState
      title="Le module BioLab est désactivé pour votre entreprise"
      description={`${sujet} fait partie de BioLab, que votre entreprise a choisi de ne pas afficher. Ce n'est pas une question de droits : un administrateur peut le rallumer depuis Paramètres › Modules, et vos données sont intactes — les éteindre n'efface rien.`}
    />
  );
}

/**
 * Le garde d'un écran BioLab, en un seul endroit.
 *
 * Rend `null` quand la page peut s'afficher. Les seize écrans faisaient
 * chacun leur propre test, avec chacun leur formulation ; ajouter un
 * cas — le module éteint — aurait demandé seize modifications et en
 * aurait sûrement oublié une.
 */
export function refusBioLab(
  perimetre: Pick<PerimetreBioLab, "peutLire" | "moduleEteint">,
  sujet: string,
): React.ReactElement | null {
  // L'ordre compte : quelqu'un qui n'a pas le droit ET dont le module
  // est éteint doit lire le message le plus actionnable. Le module se
  // rallume en un clic ; un rôle se change en passant par quelqu'un
  // d'autre.
  if (perimetre.moduleEteint) return <ModuleEteint sujet={sujet} />;
  if (!perimetre.peutLire) return <AccesRefuse sujet={sujet} />;
  return null;
}

/**
 * 2 — La panne.
 *
 * Le message de la base est montré tel quel plutôt que masqué derrière
 * « une erreur est survenue ». C'est un outil professionnel : la
 * personne qui le lit est celle qui appellera à l'aide, et le message
 * exact est ce qui rend cet appel utile. Il ne contient aucune donnée
 * d'un tiers — c'est un diagnostic de requête.
 */
export function LectureImpossible({ sujet, erreur }: { sujet: string; erreur: string }) {
  return (
    <Panel title={`${sujet} — lecture impossible`}>
      <div className="px-5 py-6">
        <p className="text-[var(--text-body)] text-ink-soft">
          La base a refusé cette lecture. Rien n&apos;est affiché plutôt qu&apos;un chiffre à zéro : un
          indicateur absent et un indicateur nul ne se confondent pas.
        </p>
        <p className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-3 py-2 font-mono text-[var(--text-secondary)] text-ink-soft">
          {erreur}
        </p>
      </div>
    </Panel>
  );
}

/**
 * 3 — Le vide, expliqué.
 *
 * LE PIÈGE QUE CE COMPOSANT EXISTE POUR ÉVITER. Le téléphone estampille
 * tout ce qu'il envoie de l'espace PERSONNEL du compte
 * (`SyncEngine.fetchWorkspaceID`), et le web lit l'espace de
 * l'ENTREPRISE. Un dirigeant qui a saisi ses lots sur son iPhone ouvre
 * donc BioLab sur le web et ne voit rien — ses cultures existent, elles
 * sont ailleurs.
 *
 * La tentation serait de faire lire l'espace personnel au web « pour
 * que ça marche ». Ce serait ouvrir l'écriture et la suppression du
 * laboratoire privé du dirigeant à toute son entreprise. On explique
 * donc, au lieu de contourner.
 */
export function EspaceVide({
  quoi,
  aQuoiCaSert,
  lotsAilleurs,
}: {
  /** « Aucune recette de milieu », « Aucune contamination relevée »… */
  quoi: string;
  /** Ce que l'écran montrera quand il y aura de la matière. */
  aQuoiCaSert: string;
  /**
   * LE DIAGNOSTIC N'EST DIT QUE PAR CELUI QUI L'A MESURÉ.
   *
   * La phrase « vos cultures sont dans votre espace personnel » était
   * auparavant collée à TOUS les états vides, sans condition. Elle
   * s'affichait donc sous « Aucune recette de milieu », « Aucun
   * protocole n'a encore servi », « Rien à situer dans cet espace » —
   * des vides qui n'ont rien à voir avec la question de l'espace. Une
   * entreprise ayant quarante lots à elle mais pas encore une seule
   * recette s'entendait dire que ses données étaient ailleurs.
   *
   * Seul le tableau de bord compte réellement les lots visibles dans
   * un espace personnel ; c'est donc le seul à passer ce nombre. Les
   * autres écrans se taisent, ce qui est la seule chose honnête quand
   * on n'a rien mesuré.
   */
  lotsAilleurs?: number;
}) {
  const explication =
    lotsAilleurs && lotsAilleurs > 0
      ? ` ${lotsAilleurs} lot${lotsAilleurs > 1 ? "s" : ""} de culture vous ${lotsAilleurs > 1 ? "sont" : "est"} pourtant accessible${lotsAilleurs > 1 ? "s" : ""} dans un espace personnel : c'est là que l'application iPhone range ce qu'elle écrit, et cet écran ne lit que l'espace de l'entreprise.`
      : "";

  return (
    <EmptyState
      title={quoi}
      description={`${aQuoiCaSert} La saisie se fait à la paillasse, depuis l'application mobile ; le web la supervise.${explication}`}
    />
  );
}
