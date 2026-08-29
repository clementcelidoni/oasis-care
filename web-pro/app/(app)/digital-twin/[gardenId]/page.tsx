import { notFound } from "next/navigation";
import { loadTwin, twinLastModified } from "@/lib/twin/actions";
import { TwinEditor } from "@/components/twin/TwinEditor";

/**
 * L'éditeur occupe toute la hauteur : c'est un outil de dessin, pas un
 * document qu'on fait défiler. Le layout de l'app fournit déjà un
 * conteneur en `h-screen`, on s'y colle.
 */
export default async function TwinEditorPage({
  params,
}: PageProps<"/digital-twin/[gardenId]">) {
  const { gardenId } = await params;
  const [document, baseModifiedAt] = await Promise.all([
    loadTwin(gardenId),
    twinLastModified(gardenId),
  ]);

  // RLS rend un jardin d'une autre organisation indiscernable d'un
  // jardin inexistant — c'est le bon comportement.
  if (!document) notFound();

  return (
    <div className="h-full">
      {/* `baseModifiedAt` sert de repère pour la détection de conflit :
          si le serveur a bougé depuis, on refuse d'écraser. */}
      <TwinEditor initial={document} baseModifiedAt={baseModifiedAt} />
    </div>
  );
}
