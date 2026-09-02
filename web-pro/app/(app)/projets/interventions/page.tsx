import { InterventionList } from "@/lib/field/list";

/** §INTERVENTIONS — toutes natures confondues. */
export default async function InterventionsPage() {
  return (
    <InterventionList
      title="Interventions"
      emptyDescription="Planifiez une intervention depuis le planning : elle apparaîtra ici."
    />
  );
}
