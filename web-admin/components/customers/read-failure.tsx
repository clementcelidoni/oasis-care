import { ButtonLink, EmptyState } from "@/components/ui";
import { AdminAccessDenied, AdminFilterRefused, AdminReadFailed } from "@/lib/customers/errors";

/**
 * Ce qu'on montre quand la lecture n'a pas eu lieu.
 *
 * Les trois cas ne se ressemblent pas, et les confondre coûterait cher :
 * un refus de filtre parfaitement documenté passerait pour une panne, et
 * une panne passerait pour un écran vide.
 *
 * Toute erreur non reconnue est RELANCÉE. Une erreur qu'on n'a pas
 * comprise ne se déguise pas en page normale — c'est ainsi qu'un bug
 * survit des mois derrière un « aucun résultat ».
 */
export function ReadFailure({ error, retryHref }: { error: unknown; retryHref?: string }) {
  if (error instanceof AdminFilterRefused) {
    return (
      <EmptyState
        tone="unknown"
        title="Ce filtre ne peut pas être honoré"
        description={`La base refuse ce filtre, et elle a raison de le faire : rendre la liste entière sous ce titre serait un mensonge, et une liste vide se confondrait avec « aucun résultat ». Le message de la base : ${error.message}`}
        action={retryHref ? <ButtonLink href={retryHref}>Retirer le filtre</ButtonLink> : undefined}
      />
    );
  }

  if (error instanceof AdminAccessDenied) {
    return (
      <EmptyState
        tone="unknown"
        title="La base a refusé cette lecture"
        description={`Cet écran exige d'être administrateur de la plateforme ET de porter la permission correspondante. Ce refus ne devrait pas arriver jusqu'ici — la garde de la page l'aurait déjà détourné : il signale que la garde et la barrière SQL de 0075 ne sont pas d'accord entre elles. Le message de la base : ${error.message}`}
      />
    );
  }

  if (error instanceof AdminReadFailed) {
    return (
      <EmptyState
        title="La lecture a échoué"
        description={`Aucune ligne n'est affichée : une liste partielle qui ne dit pas qu'elle est partielle serait pire qu'une absence de liste. Le message de la base : ${error.message}`}
      />
    );
  }

  throw error;
}
