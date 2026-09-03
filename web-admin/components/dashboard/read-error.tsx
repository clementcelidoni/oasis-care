import { EmptyState } from "@/components/ui";
import { AdminAccessDenied, AdminReadFailed } from "@/lib/dashboard/errors";

/**
 * Ce qu'on montre quand la lecture n'a pas eu lieu.
 *
 * Les deux cas ne se ressemblent pas et ne doivent pas se confondre.
 *
 * UN REFUS est le fonctionnement normal du moindre privilège (spec
 * p.30). Il ne devrait pas arriver jusqu'ici — `requireAdmin()` a déjà
 * détourné l'administrateur au rôle trop étroit — et s'il arrive, il
 * signale que la garde de la page et la barrière SQL de 0075 ne sont
 * pas d'accord entre elles. C'est une information précieuse, pas une
 * panne à masquer.
 *
 * UNE PANNE mérite le message de la base : l'équipe qui lit cet écran
 * est celle qui exploite la plateforme, elle sait quoi en faire. Et
 * AUCUN chiffre n'est affiché à côté — un tableau de bord à moitié
 * chargé qui ne dit pas qu'il est à moitié chargé est pire que pas de
 * tableau de bord.
 *
 * Toute autre erreur est RELANCÉE : elle n'a pas été comprise, et une
 * erreur incomprise ne se déguise pas en page normale.
 */
export function ReadError({ error }: { error: unknown }) {
  if (error instanceof AdminAccessDenied) {
    return (
      <EmptyState
        tone="unknown"
        title="La base a refusé cette lecture"
        description={`Les fonctions du tableau de bord exigent d'être administrateur de la plateforme et de porter la permission platform.dashboard.read. Le message de la base : ${error.message}`}
      />
    );
  }

  if (error instanceof AdminReadFailed) {
    return (
      <EmptyState
        title="Les chiffres n'ont pas pu être lus"
        description={`Aucun chiffre n'est affiché : un tableau de bord partiel qui ne dit pas qu'il est partiel serait pire que pas de tableau de bord. Le message de la base : ${error.message}`}
      />
    );
  }

  throw error;
}
