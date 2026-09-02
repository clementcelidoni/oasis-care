import { InterventionList } from "@/lib/field/list";

/**
 * Les visites.
 *
 * Une visite EST une intervention, de type `visit` : mêmes champs, même
 * planning, même pointage. Ce qui la distingue est ce qui en sort — un
 * devis plutôt qu'un chantier. Lui donner sa propre table aurait obligé
 * à tout recopier le jour où une visite débouche sur des travaux.
 */
export default async function VisitsPage() {
  return (
    <InterventionList
      kind="visit"
      title="Visites"
      emptyDescription="Planifiez une visite depuis le planning, en choisissant le type « Visite »."
    />
  );
}
