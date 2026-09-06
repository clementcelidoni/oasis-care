import { redirect } from "next/navigation";

import { PageHeader, EmptyState, ButtonLink } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

import { adresseEtiquettes } from "../adresse.ts";
import { estSource, gisement } from "../familles.ts";
import { droitsEtiquettes } from "../droits.ts";
import {
  lireEtiquettesPosees,
  lireModeles,
  lireObjets,
  PLAFOND_SELECTION,
  SocleManquant,
} from "../lecture.ts";
import { modelePrefere } from "../modeles.ts";
import { SocleAbsent } from "../SocleAbsent";
import { Selection } from "./Selection";

/**
 * § 16 — CHOISIR CE QU'ON ÉTIQUETTE, ET VOIR CE QUI EXISTE DÉJÀ.
 *
 * ══════════════════════════════════════════════════════════════════
 * « ON MONTRE COMBIEN D'ÉTIQUETTES ET LESQUELLES »
 * ══════════════════════════════════════════════════════════════════
 *
 * Le § 16 demande de générer les QR « d'un lot, d'un jardin, d'une
 * zone, d'un rack, d'une sélection, de plusieurs plantes ». Ces six
 * formulations décrivent UN SEUL geste : cocher des lignes dans une
 * liste. Ce qui change d'un cas à l'autre, ce n'est pas le mécanisme,
 * c'est la liste — d'où un écran unique, paramétré par le gisement.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA DISTINCTION QUI ÉVITE LE DOUBLON
 * ══════════════════════════════════════════════════════════════════
 *
 * Chaque ligne dit si l'objet porte DÉJÀ une étiquette active.
 *
 *   • RÉIMPRIMER une étiquette existante est légitime et fréquent :
 *     l'autocollant s'est décollé, le pot a été lavé au jet. Le MÊME
 *     QR ressort, parce que `etiquette_creer()` rend celle qui existe.
 *   • EN CRÉER UNE SECONDE pour le même objet ne l'est pas : deux
 *     jetons vivants sur un même lot, et le jour où l'un des deux est
 *     scanné on ne sait plus lequel fait foi.
 *
 * L'écran ne peut pas se contenter de laisser la base arbitrer : il
 * doit DIRE, avant le clic, combien d'étiquettes seront créées et
 * combien seront simplement réimprimées.
 */

export const metadata = { title: "Imprimer des étiquettes" };

export default async function ImprimerPage({ searchParams }: PageProps<"/etiquettes/imprimer">) {
  const params = await searchParams;
  const brut = typeof params.source === "string" ? params.source : "";
  if (!estSource(brut)) redirect("/etiquettes");

  const g = gisement(brut);
  const organization = await requireOrganization();
  const droits = droitsEtiquettes(organization);
  const supabase = await createClient();
  const adresse = adresseEtiquettes();

  if (!droits.peutLire) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <PageHeader title={g.libelle} breadcrumb={{ label: "Étiquettes", href: "/etiquettes" }} />
        <EmptyState
          title="Pas d'accès aux étiquettes"
          description="Consulter les étiquettes demande le droit « étiquettes ». Demandez-le à un responsable de votre entreprise."
        />
      </div>
    );
  }

  // LE SOCLE D'ABORD. Sans la migration 0090, chacune de ces trois
  // lectures échoue et Next affiche une trace d'exception. On attrape
  // ce cas-là — et lui seul — pour dire en français ce qui manque.
  let objets: Awaited<ReturnType<typeof lireObjets>>;
  let modeles: Awaited<ReturnType<typeof lireModeles>>;
  let posees: Awaited<ReturnType<typeof lireEtiquettesPosees>>;
  try {
    [objets, modeles] = await Promise.all([
      lireObjets(supabase, organization, g.cle, { limite: PLAFOND_SELECTION }),
      lireModeles(supabase),
    ]);
    posees = await lireEtiquettesPosees(
      supabase,
      g.cle,
      objets.map((o) => o.id),
    );
  } catch (erreur) {
    if (!(erreur instanceof SocleManquant)) throw erreur;
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <PageHeader title={g.libelle} breadcrumb={{ label: "Étiquettes", href: "/etiquettes" }} />
        <SocleAbsent detail={erreur.detail} />
      </div>
    );
  }

  const prefere = modelePrefere(modeles, g.famille);

  if (objets.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <PageHeader title={g.libelle} breadcrumb={{ label: "Étiquettes", href: "/etiquettes" }} />
        <EmptyState
          title={`Aucun ${g.singulier} à étiqueter`}
          description={`Cette entreprise n'a enregistré aucun ${g.singulier}. Créez-en un d'abord : une étiquette se pose sur quelque chose.`}
          action={<ButtonLink href="/etiquettes">Revenir aux étiquettes</ButtonLink>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title={g.libelle}
        subtitle={`Cochez les ${g.libelle.toLowerCase()} à étiqueter, choisissez un modèle, et sortez la planche.`}
        breadcrumb={{ label: "Étiquettes", href: "/etiquettes" }}
        eyebrow="Générer et imprimer"
      />

      <Selection
        source={g.cle}
        singulier={g.singulier}
        familleParDefaut={g.famille}
        peutGerer={droits.peutGerer}
        baseAdresse={adresse.base}
        problemeAdresse={adresse.probleme}
        objets={objets.map((o) => ({
          id: o.id,
          libelle: o.libelle,
          valeurs: o.valeurs,
          etiquette: posees.get(o.id) ?? null,
        }))}
        modeles={modeles.map((m) => ({
          id: m.id,
          nom: m.nom,
          famille: m.famille,
          largeurMm: m.largeurMm,
          hauteurMm: m.hauteurMm,
          margeMm: m.margeMm,
          champs: m.champs,
          propre: m.organizationId !== null,
        }))}
        modeleParDefaut={prefere?.id ?? null}
        plafond={PLAFOND_SELECTION}
        listeTronquee={objets.length >= PLAFOND_SELECTION}
      />
    </div>
  );
}
