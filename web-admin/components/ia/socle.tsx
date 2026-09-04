import { EmptyState, PageHeader } from "@/components/ui";
import type { EtatSocleIa } from "@/lib/ia/source";

/**
 * ==================================================================
 * QUAND L'ÉCRAN NE PEUT PAS S'OUVRIR — ET LES DEUX CAUSES POSSIBLES
 * ==================================================================
 *
 * Les autres écrans du Control Center répondent à une permission
 * manquante par une redirection vers `/role-insuffisant`. Ici, ce
 * serait le mauvais réflexe pendant un bon moment, et pour une raison
 * mécanique.
 *
 * Les permissions sont semées par jointure sur le catalogue AU MOMENT
 * où la migration s'exécute (0075). Une permission ajoutée plus tard
 * n'est donc portée par PERSONNE — pas même par le super-administrateur
 * — tant qu'une migration ne rejoue pas ce semis. Tant que 0080 n'est
 * pas appliquée, ces trois écrans disparaissent du menu et refusent
 * tout le monde, ce qui ressemble EXACTEMENT à un problème de rôle.
 *
 * Les deux situations se corrigent à des endroits opposés — l'une par
 * un déploiement de base, l'autre par la matrice des rôles — et un
 * administrateur qui les confond passe la journée du mauvais côté.
 * D'où deux messages, et le mot exact dans chacun.
 */
export function EcranIaFerme({
  etat,
  titre,
  sousTitre,
}: {
  etat: Exclude<EtatSocleIa["etat"], "ok">;
  titre: string;
  sousTitre: string;
}) {
  return (
    <>
      <PageHeader eyebrow="IA" title={titre} subtitle={sousTitre} />

      {etat === "migration-absente" ? (
        <EmptyState
          tone="unknown"
          title="La migration 0080 n'est pas appliquée"
          description={
            "Les trois permissions ai.config.read, ai.models.write et ai.costLimits.write sont " +
            "absentes du catalogue platform_admin_permissions. Ce n'est donc pas votre rôle qui " +
            "est en cause : personne ne peut ouvrir cet écran aujourd'hui, super-administrateur " +
            "compris. Appliquez supabase/migrations/0080_ia_reglages_editeur.sql — elle ajoute " +
            "les trois clés, REJOUE le semis du super-administrateur (sans quoi les clés ne " +
            "seraient portées par personne), et déplace le droit d'écriture des tables IA du " +
            "client vers l'éditeur. Si elle vient d'être appliquée, le cache de schéma de " +
            "PostgREST peut avoir une minute de retard."
          }
        />
      ) : (
        <EmptyState
          tone="unknown"
          title="Votre rôle ne porte pas ai.config.read"
          description={
            "La migration 0080 est bien appliquée — les trois permissions existent — mais votre " +
            "rôle n'en porte aucune. C'est le moindre privilège de la spec p.30, pas une panne : " +
            "seuls le super-administrateur, le produit et la facturation voient l'aiguillage des " +
            "modèles et les plafonds. Le support et la sécurité n'ont volontairement rien reçu " +
            "ici ; ce sera une ligne à écrire le jour où un écran le justifiera."
          }
        />
      )}
    </>
  );
}
