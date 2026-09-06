import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Panel, StatusBadge, ButtonLink } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { perimetreBioLab } from "@/lib/biolab/cultures";
import { lireFicheLot } from "@/lib/biolab/lots";
import {
  lireMatiereChaine,
  chaineDeTracabilite,
  maillonsRenseignes,
  type EtatMaillon,
  type Maillon,
} from "@/lib/biolab/tracabilite";
import { LectureImpossible, refusBioLab } from "@/lib/biolab/etats";

/**
 * §27 — LA CHAÎNE D'UN LOT, MAILLON PAR MAILLON.
 *
 * Neuf maillons, dans l'ordre du §27, et chacun dit lequel des quatre
 * états il a : renseigné, vide, hors de portée, ou rompu. La
 * distinction n'est pas cosmétique — elle change ce qu'un producteur
 * doit faire :
 *
 *   • VIDE    : la donnée s'attend, il suffit de la saisir sur le
 *               téléphone. C'est réparable ce matin.
 *   • HORS DE PORTÉE : la donnée existe, mais elle appartient à un autre
 *               espace de travail. Ce n'est pas une saisie manquante,
 *               c'est une frontière de propriété.
 *   • ROMPU   : la base ne porte pas le lien. Aucune saisie ne le
 *               comblera, et aucun écran ne doit faire croire le
 *               contraire.
 *
 * Une chaîne qui se prétend complète alors qu'elle ne l'est pas est
 * pire qu'une chaîne qui montre sa rupture : la première fait croire
 * qu'on saurait répondre à un client, la seconde prévient qu'on ne
 * saurait pas.
 */
export default async function ChaineTracabilitePage({
  params,
}: PageProps<"/biolab/tracabilite/[id]">) {
  const { id } = await params;
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "Le laboratoire");
  if (refus) notFound();

  const fiche = await lireFicheLot(perimetre.workspaceId, id);
  if (fiche.erreur) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <PageHeader eyebrow="Chaîne de traçabilité" title="Lot de culture" />
        <LectureImpossible sujet="Ce lot" erreur={fiche.erreur} />
      </div>
    );
  }
  const lot = fiche.donnees;
  if (!lot) notFound();

  // UNE CHAÎNE AMPUTÉE MENT SUR LA CHAÎNE ENTIÈRE. Si l'une des cinq
  // lectures échoue, l'écran conclurait « la traçabilité s'arrête ici »
  // — un diagnostic, alors que la vérité est « je n'ai pas pu
  // regarder ». C'est exactement la distinction que ce module existe
  // pour tenir.
  const lecture = await lireMatiereChaine(perimetre.workspaceId, lot);
  if (lecture.erreur) {
    return (
      <div className="mx-auto max-w-4xl px-8 py-10">
        <PageHeader
          breadcrumb={{ label: "Traçabilité", href: "/biolab/tracabilite" }}
          eyebrow="Chaîne de traçabilité"
          title={lot.batch_code}
        />
        <LectureImpossible sujet="La chaîne de ce lot" erreur={lecture.erreur} />
      </div>
    );
  }
  const matiere = lecture.donnees;
  const maillons = chaineDeTracabilite(matiere);
  const renseignes = maillonsRenseignes(maillons);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        breadcrumb={{ label: "Traçabilité", href: "/biolab/tracabilite" }}
        eyebrow="Chaîne de traçabilité"
        title={lot.batch_code}
        subtitle={`${lot.species_name}${lot.cultivar ? ` ‘${lot.cultivar}’` : ""} — ${renseignes} maillon${renseignes > 1 ? "s" : ""} renseigné${renseignes > 1 ? "s" : ""} sur ${maillons.length}.`}
        action={
          <ButtonLink href={`/biolab/lots/${lot.id}`} variant="secondary">
            Fiche du lot
          </ButtonLink>
        }
      />

      <ol className="space-y-3">
        {maillons.map((maillon, index) => (
          <li key={maillon.clef}>
            <CarteMaillon maillon={maillon} numero={index + 1} dernier={index === maillons.length - 1} />
          </li>
        ))}
      </ol>

      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Les maillons marqués <strong>rompu</strong> ne sont pas des saisies oubliées : la base ne
        porte pas la colonne qui les tiendrait. Les combler demanderait une migration, pas un
        écran — et déduire un lien qui n&apos;existe pas ferait passer une supposition pour une
        preuve, ce qui est exactement ce qu&apos;une traçabilité doit empêcher.
      </p>
    </div>
  );
}

const TON_MAILLON: Record<EtatMaillon, "positive" | "neutral" | "warning" | "critical"> = {
  present: "positive",
  vide: "neutral",
  horsPortee: "warning",
  rompu: "critical",
};

const MOT_MAILLON: Record<EtatMaillon, string> = {
  present: "Renseigné",
  vide: "À saisir",
  horsPortee: "Hors de portée",
  rompu: "Rompu",
};

function CarteMaillon({
  maillon,
  numero,
  dernier,
}: {
  maillon: Maillon;
  numero: number;
  dernier: boolean;
}) {
  return (
    <div className="relative">
      <Panel
        title={`${numero}. ${maillon.titre}`}
        action={
          <StatusBadge tone={TON_MAILLON[maillon.etat]}>{MOT_MAILLON[maillon.etat]}</StatusBadge>
        }
      >
        <div className="px-5 py-4">
          <p className="text-[var(--text-body)]">{maillon.resume}</p>

          {maillon.elements.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {maillon.elements.map((element) => (
                <li key={element.id} className="flex flex-wrap items-baseline gap-2">
                  {element.href ? (
                    <Link href={element.href} className="font-medium hover:text-accent">
                      {element.libelle}
                    </Link>
                  ) : (
                    <span className="font-medium">{element.libelle}</span>
                  )}
                  {element.sousTitre && (
                    <span className="text-[var(--text-secondary)] text-ink-soft">
                      {element.sousTitre}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {maillon.limite && (
            <p
              className={`mt-3 flex gap-2 text-[var(--text-secondary)] ${
                maillon.etat === "rompu" ? "text-critical" : "text-ink-soft"
              }`}
            >
              <Icon
                name={maillon.etat === "rompu" ? "close" : "help"}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>{maillon.limite}</span>
            </p>
          )}
        </div>
      </Panel>

      {/* La flèche entre deux maillons. Elle s'arrête au dernier : la
          prolonger suggérerait une suite qui n'existe pas — et c'est
          précisément le mensonge que cet écran existe pour éviter. */}
      {!dernier && (
        <div aria-hidden className="flex justify-center py-1 text-ink-faint">
          ↓
        </div>
      )}
    </div>
  );
}
