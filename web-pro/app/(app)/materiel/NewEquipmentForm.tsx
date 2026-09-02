"use client";

import { Modal, Field, SelectField, SubmitButton } from "@/components/ui";
import { createEquipment } from "@/lib/equipment/actions";
import {
  EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS,
  OWNERSHIPS, OWNERSHIP_LABELS,
  METER_KINDS, METER_KIND_LABELS,
} from "@/lib/equipment/types";

/**
 * §9 MODALES — « ajout rapide ». Un matériel qu'on entre au parc tient
 * en sept champs ; la fiche complète — la propriété, le coût, le
 * fournisseur, les notes — s'ouvre juste après.
 *
 * CE QUE CE FORMULAIRE NE DEMANDE PAS, et c'est délibéré : les
 * échéances. Elles sont la valeur du module, mais on ne les saisit pas
 * au milieu d'un formulaire d'identité — on les pose sur la fiche, une
 * par une, avec leur préavis et leur périodicité. La création redirige
 * donc vers la fiche, qui les réclame en toutes lettres.
 */
export function NewEquipmentForm() {
  return (
    <Modal
      triggerLabel="Ajouter un matériel"
      triggerVariant="primary"
      title="Nouveau matériel"
      description="Le strict nécessaire pour l'identifier. Les échéances et l'entretien se posent ensuite sur sa fiche."
      width="34rem"
    >
      <form action={createEquipment} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Nom"
            name="name"
            required
            placeholder="Master benne, Mini-pelle 1,8 t…"
          />
          <SelectField
            label="Catégorie"
            name="category"
            defaultValue="vehicle"
            options={EQUIPMENT_CATEGORIES.map((c) => ({
              value: c,
              label: EQUIPMENT_CATEGORY_LABELS[c],
            }))}
            hint="Un engin de levage n'a pas les mêmes obligations qu'une tondeuse."
          />
          <Field label="Marque" name="brand" placeholder="Renault, Kubota…" />
          <Field label="Modèle" name="model" />
          <Field
            label="Numéro interne"
            name="internal_number"
            placeholder="12"
            hint="Le numéro peint sur la machine, celui qu'on donne au téléphone."
          />
          <Field
            label="Immatriculation"
            name="registration"
            placeholder="AB-123-CD"
            hint="Pour un véhicule ou une remorque. Laissez vide sinon."
          />
          <SelectField
            label="Propriété"
            name="ownership"
            defaultValue="owned"
            options={OWNERSHIPS.map((o) => ({ value: o, label: OWNERSHIP_LABELS[o] }))}
          />
          <SelectField
            label="Compteur"
            name="meter_kind"
            defaultValue="none"
            options={METER_KINDS.map((m) => ({ value: m, label: METER_KIND_LABELS[m] }))}
            hint="Heures pour un engin, kilomètres pour un véhicule."
          />
        </div>

        <div className="flex justify-end">
          <SubmitButton>Créer et ouvrir la fiche</SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
