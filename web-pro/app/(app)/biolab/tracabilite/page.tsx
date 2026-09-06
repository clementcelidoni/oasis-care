import Link from "next/link";
import { PageHeader, Panel, EmptyState, ButtonLink, SearchBar, SubmitButton, Badge } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { formatDate } from "@/lib/crm/types";
import {
  perimetreBioLab,
  STADE_LABELS,
  STADE_TON,
  libelle,
  tonDe,
  formatNombre,
} from "@/lib/biolab/cultures";
import { lireLots, lireParametres } from "@/lib/biolab/lots";
import { refusBioLab } from "@/lib/biolab/etats";

/**
 * §27 TRAÇABILITÉ TRANSVERSALE — LA PORTE D'ENTRÉE.
 *
 * La chaîne du §27 se lit toujours DEPUIS UN LOT : c'est lui qui a une
 * plante mère au-dessus et une vente en dessous. Cet écran n'est donc
 * pas une chaîne, c'est le choix du lot dont on veut la chaîne — plus
 * l'énoncé, sans détour, de ce que la chaîne saura dire et de ce
 * qu'elle ne saura pas.
 *
 * ON ÉNONCE LES RUPTURES ICI, AVANT D'OUVRIR QUOI QUE CE SOIT. Un
 * producteur qui vient chercher « d'où vient cette plante » doit savoir
 * en trente secondes jusqu'où la réponse porte. Le découvrir au
 * neuvième maillon, après avoir cru la question résolue, est la
 * mauvaise manière de l'apprendre.
 */
export default async function TracabilitePage({ searchParams }: PageProps<"/biolab/tracabilite">) {
  const perimetre = await perimetreBioLab();
  // Un seul garde pour les deux refus possibles : le droit manquant
  // et le module que l'entreprise a éteint (§43). Voir lib/biolab/etats.tsx.
  const refus = refusBioLab(perimetre, "Le laboratoire");

  if (refus) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <PageHeader title="Traçabilité" subtitle="D'où vient une plante, et où elle est allée." />
        <EmptyState
          icon={<Icon name="projects" className="h-6 w-6" />}
          title="Accès non autorisé"
          description="Votre rôle ne donne pas accès au laboratoire de cette entreprise. Un responsable ou un administrateur peut vous l'ouvrir depuis Entreprise › Équipe."
        />
      </div>
    );
  }

  const params = await searchParams;
  const p = lireParametres(params);
  const { lignes, total } = await lireLots(perimetre.workspaceId, p);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        breadcrumb={{ label: "BioLab", href: "/biolab" }}
        title="Traçabilité"
        subtitle="Remonter d'une plante à sa plante mère, ou descendre d'un lot jusqu'au jardin où il a été planté. Choisissez le lot dont vous voulez la chaîne."
      />

      {/* -------------------------------------------------------------
          CE QUE LA CHAÎNE SAIT DIRE, ET CE QU'ELLE NE SAIT PAS.
         ------------------------------------------------------------- */}
      <Panel
        title="Ce que la chaîne porte aujourd'hui"
        description="Mesuré sur la base elle-même, lien par lien. Rien ici n'est une intention."
        className="mb-6"
      >
        <div className="space-y-4 px-5 py-5 text-[var(--text-body)]">
          <p className="text-ink-soft">
            La continuité attendue va de la plante mère au suivi de la plante chez le client :
            plante mère → lot de culture → multiplication → acclimatation → pépinière → stock →
            vente → jardin client → suivi. Voici où elle tient, et où elle casse.
          </p>

          <div>
            <p className="mb-2 flex items-center gap-2 font-medium">
              <Icon name="check" className="h-4 w-4 text-positive" />
              Six maillons sont réellement enregistrés
            </p>
            <p className="text-ink-soft">
              La plante mère d&apos;un lot, la division en sous-lots, l&apos;acclimatation, les
              plantes créées à sa sortie, le lot de pépinière qui en descend, et la ligne de
              commande qui le vend. Chacun est une clé étrangère existante, pas une convention de
              nommage.
            </p>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-2 font-medium">
              <Icon name="close" className="h-4 w-4 text-critical" />
              Trois maillons manquent, et il faut le savoir avant de promettre une réponse
            </p>
            <ul className="ml-1 space-y-2 text-ink-soft">
              <li>
                <strong>L&apos;acclimatation est enjambée.</strong> Un lot de pépinière cite le lot
                de CULTURE dont il descend, jamais le passage d&apos;acclimatation. Si un lot a été
                acclimaté deux fois, sur deux substrats, rien en aval ne dira lequel des deux est
                en godet — donc rien ne permettra de comparer les deux substrats depuis la vente.
              </li>
              <li>
                <strong>La vente ne désigne pas un jardin.</strong> Une commande porte un client
                et, facultativement, un chantier ; le jardin ne s&apos;obtient que si ce chantier
                en porte un. Et la livraison elle-même n&apos;enregistre aucune destination. On
                sait à qui les plantes sont parties, rarement où.
              </li>
              <li>
                <strong>La plante livrée n&apos;est rattachée à rien.</strong> Une plante de jardin
                peut citer son lot de culture d&apos;origine, mais aucune ne cite le lot de
                pépinière vendu ni la commande. Le dernier maillon recommence donc une chaîne
                neuve au lieu de prolonger celle-ci.
              </li>
            </ul>
          </div>

          <p className="text-ink-faint">
            Ces trois manques ne sont pas des écrans à ajouter : ce sont des colonnes que la base
            ne porte pas. Les écrans ci-dessous montrent la chaîne jusqu&apos;où elle va et
            s&apos;arrêtent en le disant, plutôt que de combler les trous par déduction.
          </p>
        </div>
      </Panel>

      <SearchBar
        action="/biolab/tracabilite"
        defaultValue={p.q}
        placeholder="Rechercher le lot dont vous voulez la chaîne…"
      >
        <SubmitButton variant="secondary">Chercher</SubmitButton>
      </SearchBar>

      {lignes.length === 0 ? (
        <EmptyState
          icon={<Icon name="projects" className="h-6 w-6" />}
          title={p.q ? "Aucun lot ne correspond" : "Aucun lot de culture dans cet espace"}
          description={
            p.q
              ? "Aucun lot ne porte ce code, cette espèce ni ce cultivar. Élargissez la recherche."
              : "La chaîne part toujours d'un lot de culture. Les lots se créent sur le téléphone, à la paillasse."
          }
          action={
            p.q ? (
              <ButtonLink href="/biolab/tracabilite" variant="secondary">
                Effacer la recherche
              </ButtonLink>
            ) : (
              <ButtonLink href="/biolab" variant="secondary">
                Retour au tableau de bord
              </ButtonLink>
            )
          }
        />
      ) : (
        <Panel
          title={p.q ? "Résultats" : "Lots récents"}
          description="Ouvrez un lot pour voir sa chaîne complète, maillon par maillon."
          count={total}
        >
          <ul className="divide-y divide-line">
            {lignes.map((lot) => (
              <li key={lot.id}>
                <Link
                  href={`/biolab/tracabilite/${lot.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-canvas"
                >
                  <span className="min-w-0">
                    <span className="tabular font-medium">{lot.batch_code}</span>
                    <span className="ml-2.5 text-[var(--text-body)] text-ink-soft">
                      {lot.species_name}
                      {lot.cultivar && <span className="text-ink-faint"> ‘{lot.cultivar}’</span>}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="tabular text-[var(--text-secondary)] text-ink-soft">
                      {formatNombre(lot.current_count)} explants
                    </span>
                    <span className="text-[var(--text-secondary)] text-ink-faint">
                      {formatDate(lot.started_at)}
                    </span>
                    <Badge tone={tonDe(STADE_TON, lot.culture_stage)}>
                      {libelle(STADE_LABELS, lot.culture_stage)}
                    </Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
