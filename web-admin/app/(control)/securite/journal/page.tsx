import type { Metadata } from "next";
import Link from "next/link";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  EmptyState,
  FilterBar,
  PageHeader,
  Pagination,
  Panel,
  SearchBar,
  StatusBadge,
} from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { roleLabel } from "@/lib/auth/roles";
import { formatDateTime, formatRelative, shortId } from "@/lib/format";
import {
  borneBasse,
  champsCachesJournal,
  FENETRES,
  LIBELLES_FENETRE,
  lienJournal,
  lireFiltresJournal,
} from "@/lib/security/filtres";
import {
  DESCRIPTIONS_FAMILLE,
  FAMILLES_ORDONNEES,
  familleAction,
  libelleAction,
  LIBELLES_FAMILLE,
  tonAction,
} from "@/lib/security/journal";
import {
  chargerAdressesAdmins,
  listerEvenements,
  TAILLE_PAGE_JOURNAL,
  type PageJournal,
} from "@/lib/security/source";
import type { EvenementAudit } from "@/lib/security/types";

/**
 * ==================================================================
 * LE JOURNAL DES ACTIONS ADMINISTRATIVES — spec p.31
 * ==================================================================
 *
 * « Toute action administrative importante doit être enregistrée »,
 * avec admin, action, target, oldValue, newValue, reason, timestamp,
 * ip / session metadata. Les huit sont dans `admin_audit_events`
 * (0075 § 3) et les huit sont ici.
 *
 * ------------------------------------------------------------------
 * C'EST LA PIÈCE QUI REND TOUTES LES AUTRES REDEVABLES
 * ------------------------------------------------------------------
 * Chaque écriture du Control Center passe par une fonction
 * `security definer` qui rend l'identifiant de SA ligne de journal. La
 * trace n'est pas un effet de bord : c'est la valeur de retour, et si
 * `record_admin_event()` refuse, l'écriture est annulée avec elle. Il
 * n'existe pas d'état « fait mais non tracé ».
 *
 * ------------------------------------------------------------------
 * L'AVANT ET L'APRÈS SONT AFFICHÉS EN JSON BRUT
 * ------------------------------------------------------------------
 * Tels que la base les a enregistrés, mot pour mot, et repliés par
 * défaut. Les reformater risquerait de faire dire à une trace autre
 * chose que ce qu'elle dit — et une trace vaut par son exactitude, pas
 * par sa mise en page. C'est la même décision que `components/ia/journal.tsx`,
 * prise pour la même raison.
 *
 * ------------------------------------------------------------------
 * QUI LIT CET ÉCRAN
 * ------------------------------------------------------------------
 * `platform.audit.read` : le super-administrateur et le responsable
 * sécurité. Ni le produit, ni la facturation — ceux-là mêmes qui
 * ÉCRIVENT ces lignes — ne les relisent. C'est le principe : le journal
 * des actions administratives n'est pas relu par celui qui agit.
 */

export const metadata: Metadata = {
  title: "Journal des actions — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

function Acte({
  evenement,
  adresses,
  lienAuteur,
}: {
  evenement: EvenementAudit;
  adresses: Map<string, string>;
  lienAuteur: string | null;
}) {
  const auteur =
    evenement.admin_user_id !== null
      ? (adresses.get(evenement.admin_user_id) ?? shortId(evenement.admin_user_id))
      : null;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tonAction(evenement.action)}>{libelleAction(evenement.action)}</Badge>
        <StatusBadge tone="neutral" dot={false}>
          {LIBELLES_FAMILLE[familleAction(evenement.action)]}
        </StatusBadge>
        {evenement.target_label !== null && (
          <span className="font-medium text-ink">{evenement.target_label}</span>
        )}
        <span
          className="ml-auto shrink-0 text-[var(--text-secondary)] text-ink-faint"
          title={formatDateTime(evenement.occurred_at) ?? undefined}
        >
          {formatDateTime(evenement.occurred_at)} · {formatRelative(evenement.occurred_at)}
        </span>
      </div>

      {/* LE MOTIF EST EN PREMIER ET EN GRAND. C'est la seule colonne
          écrite en langue naturelle, la seule que la base rende
          obligatoire et non vide, et la seule qui réponde à la question
          qu'on se pose six mois plus tard : pourquoi. */}
      <p className="mt-1.5 max-w-4xl text-[var(--text-body)] leading-relaxed text-ink">
        « {evenement.reason} »
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-secondary)] text-ink-faint">
        <span>
          {lienAuteur !== null ? (
            <Link href={lienAuteur} className="font-medium text-ink-soft hover:text-accent">
              {auteur ?? "auteur supprimé depuis"}
            </Link>
          ) : (
            <span className="font-medium text-ink-soft">{auteur ?? "auteur supprimé depuis"}</span>
          )}{" "}
          — {roleLabel(evenement.admin_role)}
        </span>
        <span>
          sur <span className="font-mono text-[11px]">{evenement.target_type}</span>
          {evenement.target_id !== null && (
            <span className="font-mono text-[11px]"> {shortId(evenement.target_id)}</span>
          )}
        </span>
        {evenement.ip !== null && (
          <span className="font-mono text-[11px]">depuis {evenement.ip}</span>
        )}
      </div>

      {(evenement.old_value !== null || evenement.new_value !== null) && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[var(--text-secondary)] text-ink-faint">
            Avant / après, tels qu&apos;enregistrés
          </summary>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <pre className="overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-ink-soft">
              {evenement.old_value === null
                ? "avant : aucun (rien n'existait)"
                : `avant : ${JSON.stringify(evenement.old_value)}`}
            </pre>
            <pre className="overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-ink-soft">
              {evenement.new_value === null
                ? "après : aucun (retiré)"
                : `après : ${JSON.stringify(evenement.new_value)}`}
            </pre>
          </div>
        </details>
      )}

      {evenement.user_agent !== null && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[var(--text-secondary)] text-ink-faint">
            Contexte de session
          </summary>
          <p className="mt-1 break-all font-mono text-[11px] text-ink-faint">
            {evenement.user_agent}
          </p>
          {evenement.session_metadata !== null && evenement.session_metadata !== undefined && (
            <pre className="mt-1 overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-ink-faint">
              {JSON.stringify(evenement.session_metadata)}
            </pre>
          )}
        </details>
      )}
    </li>
  );
}

export default async function JournalActionsPage({
  searchParams,
}: PageProps<"/securite/journal">) {
  await requireAdmin("platform.audit.read");

  const filtres = lireFiltresJournal(await searchParams);
  const depuis = borneBasse(filtres.fenetre);

  let page: PageJournal;
  let adresses: Map<string, string>;
  try {
    [page, adresses] = await Promise.all([
      listerEvenements({
        famille: filtres.famille,
        adminUserId: filtres.adminUserId,
        depuis,
        recherche: filtres.recherche,
        page: filtres.page,
      }),
      chargerAdressesAdmins(),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader eyebrow="Sécurité" title="Journal des actions administratives" />
        <ReadFailure error={error} retryHref="/securite/journal" />
      </>
    );
  }

  const total = page.total;
  const filtre = filtres.famille !== null || filtres.adminUserId !== null || filtres.recherche !== null;

  return (
    <>
      <PageHeader
        eyebrow="Sécurité"
        breadcrumb={{ label: "Centre de sécurité", href: "/securite" }}
        title="Journal des actions administratives"
        subtitle="Qui, quoi, sur quoi, avant, après, pourquoi, quand. C'est la pièce qui rend tous les autres écrans redevables."
      />

      <FilterBar
        label="Filtrer par famille"
        current={lienJournal("/securite/journal", filtres, { famille: filtres.famille })}
        filters={[
          {
            label: "Toutes familles",
            href: lienJournal("/securite/journal", filtres, { famille: null }),
          },
          ...FAMILLES_ORDONNEES.filter((famille) => famille !== "autre").map((famille) => ({
            label: LIBELLES_FAMILLE[famille],
            href: lienJournal("/securite/journal", filtres, { famille }),
          })),
          {
            label: LIBELLES_FAMILLE.autre,
            href: lienJournal("/securite/journal", filtres, { famille: null }),
            // « Autres » n'a aucun préfixe : on ne sait pas la demander
            // à la base. Le filtre est dessiné éteint avec sa raison
            // plutôt que masqué — son absence pure ferait croire à un
            // oubli d'interface.
            disabledReason:
              "Cette famille rassemble les actions dont le préfixe n'est connu d'aucune famille. Elle ne peut pas se demander à la base : il faudrait énumérer ce qu'on ne connaît pas. Parcourez « Toutes familles ».",
          },
        ]}
      />

      <FilterBar
        label="Fenêtre"
        current={lienJournal("/securite/journal", filtres, { fenetre: filtres.fenetre })}
        filters={FENETRES.map((fenetre) => ({
          label: LIBELLES_FENETRE[fenetre],
          href: lienJournal("/securite/journal", filtres, { fenetre }),
        }))}
      />

      <SearchBar
        action="/securite/journal"
        defaultValue={filtres.recherche ?? undefined}
        placeholder="Chercher dans les motifs…"
      >
        {champsCachesJournal(filtres).map((champ) => (
          <input key={champ.nom} type="hidden" name={champ.nom} value={champ.valeur} />
        ))}
      </SearchBar>

      {filtres.famille !== null && (
        <p className="mb-3 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          {DESCRIPTIONS_FAMILLE[filtres.famille]}
        </p>
      )}

      {filtres.adminUserId !== null && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[var(--text-secondary)] text-ink-soft">
          <span>
            Filtré sur{" "}
            <span className="font-medium text-ink">
              {adresses.get(filtres.adminUserId) ?? shortId(filtres.adminUserId)}
            </span>
          </span>
          <Link
            href={lienJournal("/securite/journal", filtres, { adminUserId: null })}
            className="font-medium text-accent hover:underline"
          >
            Retirer ce filtre
          </Link>
        </p>
      )}

      <Panel
        title="Actes enregistrés"
        count={total ?? undefined}
        description="Les plus récents d'abord. Le motif est obligatoire et non vide : la base refuse un acte qui n'en porte pas."
        footer={
          total !== null && total > TAILLE_PAGE_JOURNAL ? (
            <Pagination
              page={filtres.page}
              pageSize={TAILLE_PAGE_JOURNAL}
              total={total}
              hrefFor={(numero) => lienJournal("/securite/journal", filtres, { page: numero })}
            />
          ) : undefined
        }
      >
        {page.lignes.length === 0 ? (
          <div className="p-4">
            <EmptyState
              tone={filtre ? "neutral" : "unknown"}
              title={filtre ? "Aucun acte ne correspond" : "Le journal est vide"}
              description={
                filtre
                  ? "Ce découpage ne rend rien. Élargissez la fenêtre ou retirez la famille : les actes existent peut-être en dehors."
                  : "Ce zéro est vrai : la table admin_audit_events existe depuis 0075 et n'a reçu aucune ligne. Elle se remplira au premier geste administratif — un prix posé, un rôle changé, une session ouverte. Attention à ce qu'elle ne dira jamais : un réglage modifié à la main dans l'éditeur SQL n'y figure pas."
              }
              action={
                filtre ? (
                  <Link
                    href="/securite/journal?fenetre=tout"
                    className="text-[var(--text-body)] font-medium text-accent hover:underline"
                  >
                    Tout voir, depuis le début
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {page.lignes.map((evenement) => (
              <Acte
                key={evenement.id}
                evenement={evenement}
                adresses={adresses}
                lienAuteur={
                  evenement.admin_user_id !== null && evenement.admin_user_id !== filtres.adminUserId
                    ? lienJournal("/securite/journal", filtres, {
                        adminUserId: evenement.admin_user_id,
                      })
                    : null
                }
              />
            ))}
          </ul>
        )}
      </Panel>

      <p className="mt-4 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
        Ce journal se conserve. `admin_audit_events` n&apos;a aucune politique d&apos;écriture, de
        modification ni de suppression : la seule façon d&apos;y écrire est{" "}
        <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">
          record_admin_event()
        </code>
        , qui impose l&apos;auteur, refuse un motif vide, et refuse nommément le rôle « analyste
        (lecture seule) ». Personne ne peut effacer une ligne depuis cette application.
      </p>
    </>
  );
}
