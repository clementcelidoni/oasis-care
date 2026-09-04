import { LONGUEUR_QUESTION_MAX } from "@/lib/ai/conversations/types";
import { Composeur } from "./Composeur";

/**
 * §11W — UN FIL NEUF, ET CE QU'IL DOIT MONTRER DE SON PROPRE VIDE.
 *
 * ══════════════════════════════════════════════════════════════════
 * IL N'Y A PAS DE LISTE VIDE + FIL VIDE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le rail dit déjà « Aucune conversation — celle-ci sera la première ».
 * Poser en plus une carte en pointillés « aucune conversation » au
 * milieu de l'écran répéterait la même absence deux fois. L'invitation,
 * c'est le fil lui-même : les quatre amorces, et le champ.
 *
 * ══════════════════════════════════════════════════════════════════
 * « REPART DE ZÉRO » SE MONTRE, IL NE S'ÉCRIT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * Cet écran est l'état « aucune mémoire » rendu visible. Pas de
 * bandeau d'avertissement, pas de phrase en petit sous le champ : une
 * page vide avec quatre propositions dit tout ce qu'il y a à dire, et
 * le rail à gauche montre que les fils d'avant existent toujours,
 * ailleurs, chacun chez soi.
 *
 * Il n'y a AUCUNE écriture en base ici. Le fil est créé par la
 * première question, pas par la visite : sinon, ouvrir l'onglet et
 * changer d'avis laisserait une ligne vide dans le rail à chaque fois.
 */

/**
 * Quatre amorces, et pas une de plus.
 *
 * Elles couvrent les quatre familles de questions que le produit sait
 * traiter — marge, achats, priorités du jour, préparation d'un
 * document. Une cinquième n'ajouterait pas une capacité : elle
 * ajouterait un choix.
 */
const AMORCES = [
  "Quels chantiers ont dépassé leur budget ?",
  "Quels végétaux dois-je commander pour les chantiers signés ?",
  "Que dois-je faire aujourd'hui ?",
  "Prépare un brouillon de devis de taille de haie pour Madame Martin",
] as const;

export default async function NouvelleConversationPage({
  searchParams,
}: PageProps<"/oasis-ai/conversations">) {
  const params = await searchParams;

  // La question amorcée depuis une décision (« En parler à Oasis »).
  // Bornée : un lien forgé ne doit pas remplir le champ d'un roman, et
  // la Server Action refuse de toute façon au-delà de la limite.
  const questionInitiale =
    typeof params.q === "string" ? params.q.slice(0, LONGUEUR_QUESTION_MAX) : undefined;

  return (
    <div className="flex min-h-[24rem] flex-col">
      <div className="flex-1">
        <h2 className="text-[length:var(--text-section)] font-semibold tracking-tight">
          Nouvelle conversation
        </h2>
        <p className="mt-1 max-w-xl text-[var(--text-body)] text-ink-soft">
          Elle part de zéro : Oasis ne relit aucune de vos conversations
          précédentes. Il lira celle-ci, du début, à chaque réponse.
        </p>
      </div>

      <div className="mt-8">
        <Composeur
          variante="fil"
          questionInitiale={questionInitiale}
          // Les amorces disparaissent dès qu'une question est arrivée
          // par lien : la proposer À CÔTÉ d'une question déjà écrite
          // ferait hésiter entre les deux.
          suggestions={questionInitiale ? undefined : AMORCES}
        />
      </div>
    </div>
  );
}

export const dynamic = "force-dynamic";
