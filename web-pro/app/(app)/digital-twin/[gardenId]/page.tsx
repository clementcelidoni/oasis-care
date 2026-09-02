import { notFound } from "next/navigation";
import { loadTwin, twinVersion } from "@/lib/twin/actions";
import { TwinEditor } from "@/components/twin/TwinEditor";
import { PleinEcran } from "./PleinEcran";

/**
 * §38 DIGITAL TWIN UX — « Quand Digital Twin ouvert : donner maximum de
 * place au plan. »
 *
 * D'où une page qui ne contient RIEN d'autre que l'éditeur : pas
 * d'en-tête, pas de fil d'Ariane, pas de marge. L'éditeur porte déjà sa
 * propre barre de titre — nom du jardin, Plan / Satellite / Hybride,
 * état de l'enregistrement — et la barre latérale de l'application
 * suffit à revenir en arrière. Chaque bandeau ajouté ici serait volé
 * aux mètres carrés du plan.
 *
 * La disposition demandée par §38 — BIBLIOTHÈQUE | PLAN | PROPRIÉTÉS —
 * vit à l'intérieur de `TwinEditor`, où elle est solidaire de l'outil
 * sélectionné. Ce fichier ne fait que lui donner toute la hauteur
 * disponible, et le bouton plein écran que §38 réclame en plus.
 *
 * L'éditeur est un outil de dessin, pas un document qu'on fait
 * défiler : le layout de l'app fournit un conteneur à hauteur d'écran,
 * on s'y colle par `h-full`.
 */
export default async function TwinEditorPage({
  params,
}: PageProps<"/digital-twin/[gardenId]">) {
  const { gardenId } = await params;
  const [document, baseVersion] = await Promise.all([
    loadTwin(gardenId),
    twinVersion(gardenId),
  ]);

  // RLS rend un jardin d'une autre organisation indiscernable d'un
  // jardin inexistant — c'est le bon comportement.
  if (!document) notFound();

  return (
    <PleinEcran>
      {/* `baseVersion` sert de repère pour la détection de conflit :
          si le serveur a bougé depuis, on refuse d'écraser. */}
      <TwinEditor initial={document} baseVersion={baseVersion} />
    </PleinEcran>
  );
}
