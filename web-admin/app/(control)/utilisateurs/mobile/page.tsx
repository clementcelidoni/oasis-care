import type { Metadata } from "next";

import { GapList } from "@/components/customers/facts";
import { ReadFailure } from "@/components/customers/read-failure";
import { UsersTable } from "@/components/customers/users-table";
import { MobileOsTable, MobileVersionTable } from "@/components/dashboard/mobile-distribution";
import { ReadError } from "@/components/dashboard/read-error";
import {
  ButtonLink,
  EmptyState,
  FilterBar,
  MetricCard,
  Notice,
  PageHeader,
  Pagination,
  Panel,
  SearchBar,
  SectionHeader,
} from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth/guard";
import { listHref, parseFilter } from "@/lib/customers/filters";
import { MOBILE_GAPS } from "@/lib/customers/gaps";
import { isBeyondLastPage, parsePage, parseSearch, type Paged } from "@/lib/customers/pagination";
import { listUsers } from "@/lib/customers/source";
import type { AdminUserRow } from "@/lib/customers/types";
import { declaredInstallations, mobileBreakdown, mobilePresence } from "@/lib/dashboard/mobile";
import {
  readMobileOsDistribution,
  readMobileVersionDistribution,
  readPlatformKpis,
} from "@/lib/dashboard/source";
import type { MobileOsRow, MobileVersionRow, PlatformKpisRow } from "@/lib/dashboard/types";
import { formatCount, formatDate } from "@/lib/format";

/**
 * ==================================================================
 * OASIS CARE MOBILE — l'écran qui expliquait, et qui compte enfin
 * ==================================================================
 *
 * Spec p.5 (barre latérale) et p.8-9 (la fiche mobile).
 *
 * Cette page a passé tout le jalon 1 à dire pourquoi la liste des
 * utilisateurs mobiles ne pouvait pas exister : rien n'enregistrait par
 * quelle application un compte était entré, et le seul proxy imaginable
 * — « posséder un espace personnel » — était faux, le trigger
 * `on_auth_user_created` en créant un pour tout nouveau compte. La
 * migration 0077 a répondu, et la liste existe.
 *
 * ------------------------------------------------------------------
 * CE QU'ELLE NE DOIT PAS DEVENIR EN CHANGEANT DE NATURE
 * ------------------------------------------------------------------
 * Un écran qui affirme. Le chiffre de cette page est une BORNE
 * INFÉRIEURE, et il le restera :
 *
 *   • un compte qui n'a pas rouvert l'application depuis la mise en
 *     service de la collecte est invisible, et il le sera jusqu'à ce
 *     qu'il la rouvre ;
 *   • le mode invité n'est jamais compté — l'application entière
 *     s'utilise sans compte, et la synchronisation ne part qu'une fois
 *     authentifié ;
 *   • une partie des comptes affichés n'est pas MESURÉE mais DÉDUITE
 *     d'une activité passée que seule l'application iPhone écrit : ils
 *     ne portent ni version, ni date de dernière ouverture.
 *
 * Les trois sont écrits à l'écran, pas seulement ici. Le troisième a
 * même son propre filtre : « qui a rouvert l'application depuis la mise
 * en service ? » est la seule question qui dise si le parc a basculé, et
 * elle n'est pas la même que « qui est passé par l'iPhone un jour ? ».
 *
 * ------------------------------------------------------------------
 * DEUX PERMISSIONS, ET UNE SEULE OUVRE LA PAGE
 * ------------------------------------------------------------------
 * La liste demande `platform.users.read` ; les chiffres et les
 * distributions demandent `platform.dashboard.read` — c'est la
 * migration 0077 qui en décide, et le support porte l'une sans l'autre.
 * La permission est donc VÉRIFIÉE avant d'appeler, et non attrapée
 * après : un refus rattrapé aurait affiché « la lecture a échoué » à un
 * administrateur dont le rôle fonctionne parfaitement.
 */

export const metadata: Metadata = {
  title: "Oasis Care Mobile — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

/**
 * Les trois vues de cette page. Elles sont écrites ICI et non prises
 * dans `USER_FILTERS` : ce catalogue-là sert la liste générale, où
 * « Mobile » est un filtre parmi douze. Ici, le mobile est le SUJET, et
 * aucune de ces trois valeurs ne peut ramener un compte non mobile —
 * une page dont le titre affirme « Oasis Care Mobile » ne doit pas
 * pouvoir afficher autre chose.
 */
const VUES = [
  { value: "mobile", label: "Tous les comptes mobiles" },
  { value: "mobile_declare", label: "Déclarés par l'application" },
  { value: "mobile_deduit", label: "Déduits d'une activité passée" },
] as const;

/** Le filtre de l'URL, ramené aux trois vues. Toute autre valeur retombe sur « tous ». */
function vueDemandee(raw: string | string[] | undefined): string {
  const value = parseFilter(raw);
  return VUES.some((vue) => vue.value === value) ? (value as string) : "mobile";
}

export default async function UtilisateursMobilePage({
  searchParams,
}: PageProps<"/utilisateurs/mobile">) {
  const admin = await requireAdmin("platform.users.read");
  const voitLesChiffres = can(admin, "platform.dashboard.read");

  const params = await searchParams;
  const search = parseSearch(params.q);
  const filtre = vueDemandee(params.filtre);
  const page = parsePage(params.page);

  const hrefFor = (target: { q?: string | null; filtre?: string | null; page?: number }) =>
    listHref("/utilisateurs/mobile", { q: search, filtre, ...target });

  let paged: Paged<AdminUserRow>;
  try {
    paged = await listUsers({ search, filter: filtre, page });
  } catch (error) {
    return (
      <>
        <Entete />
        <ReadFailure error={error} retryHref="/utilisateurs/mobile" />
      </>
    );
  }

  // Les chiffres et les deux distributions voyagent ensemble : ils
  // viennent de la même migration, ils demandent la même permission, et
  // un écran qui montrerait la distribution sans le chiffre — ou
  // l'inverse — inviterait à calculer un rapport entre deux populations
  // différentes.
  let kpis: PlatformKpisRow | null = null;
  let versions: MobileVersionRow[] = [];
  let systemes: MobileOsRow[] = [];
  let erreurChiffres: unknown = null;

  if (voitLesChiffres) {
    try {
      [kpis, versions, systemes] = await Promise.all([
        readPlatformKpis(),
        readMobileVersionDistribution(),
        readMobileOsDistribution(),
      ]);
    } catch (error) {
      erreurChiffres = error;
    }
  }

  const presence = kpis === null ? null : mobilePresence(kpis);
  const ligne = presence === null ? null : mobileBreakdown(presence);
  const installations = declaredInstallations(versions);
  // Mise en forme AVANT le rendu : `formatDate` rend `null` pour une
  // date illisible, et `${null}` s'écrit « null » dans un gabarit. Une
  // phrase « depuis le null » est le genre de faute qui survit des mois
  // parce qu'elle n'apparaît que sur une donnée abîmée.
  const debutCollecte = presence === null ? null : formatDate(presence.startedAt);

  return (
    <>
      <Entete total={paged.total} />

      {/*
        LE BANDEAU DU JOUR DU DÉPLOIEMENT. Tant qu'aucune installation ne
        s'est annoncée, tout ce que cet écran montre vient de la reprise
        rétroactive et les deux distributions sont VIDES. Sans cette
        phrase, deux tableaux vides sous un chiffre non nul se liraient
        comme une panne.

        DEUX ÉTATS ET NON UN, parce qu'ils ne décrivent pas la même
        chose. « Rien du tout » — la base rend un chiffre INCONNU — veut
        dire que même la reprise rétroactive n'a rien reconnu : la liste
        plus bas est vide, et lui annoncer des comptes « connus par
        déduction » serait décrire un écran qui n'existe pas. « Rien que
        des déductions » veut dire que la liste est pleine mais qu'aucune
        de ses lignes n'est mesurée. Le premier est l'état d'attente
        complet, le second la première marche.
      */}
      {presence !== null && presence.awaitingFirstDeclaration && (
        <Notice tone="unknown" title="Le parc n'a pas encore basculé">
          Aucune installation ne s&apos;est encore annoncée
          {debutCollecte !== null && ` depuis le ${debutCollecte}`}.{" "}
          {presence.users === null ? (
            <>
              La reprise rétroactive n&apos;a par ailleurs reconnu aucun compte : la liste ci-dessous
              est vide, et ce vide ne dit pas « personne n&apos;utilise l&apos;application ». Il dit
              que rien ne l&apos;atteste encore — le décompte est INCONNU, pas nul. Il se remplira à
              mesure que les téléphones ouvriront la version qui déclare sa présence.
            </>
          ) : (
            <>
              Les comptes ci-dessous sont donc tous connus par DÉDUCTION : ils ont laissé dans la
              base une trace que seule l&apos;application iPhone écrit. Ni leur version, ni leur
              dernière ouverture ne sont connues, et les distributions plus bas resteront vides
              jusqu&apos;à la première déclaration.
            </>
          )}
        </Notice>
      )}

      {erreurChiffres !== null && <ReadError error={erreurChiffres} />}

      {!voitLesChiffres && (
        <Notice tone="info" title="Les chiffres du parc demandent une autre permission">
          Votre rôle ouvre la liste des comptes, mais pas la lecture du tableau de bord (
          <code className="font-mono text-[12px]">platform.dashboard.read</code>), dont dépendent le
          décompte et les distributions de versions — c&apos;est la migration 0077 qui en décide, et
          le moindre privilège de la spec p.30 est respecté ici, pas contourné. La liste ci-dessous,
          elle, est complète.
        </Notice>
      )}

      {presence !== null && (
        <section className="mb-8">
          <SectionHeader
            title="Le parc"
            description="Des comptes, jamais des personnes : le mode invité n'écrit rien et n'est jamais compté. Ce décompte est une borne inférieure, et il le restera."
          />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Usage mobile attesté"
              tone="accent"
              value={formatCount(presence.users)}
              hint={ligne ?? undefined}
              unknownReason={presence.note}
            />
            <MetricCard
              size="small"
              label="Déclarés par l'application"
              value={formatCount(presence.declared)}
              hint="comptes dont au moins une installation s'est annoncée"
              unknownReason="La base n'a pas rendu la répartition entre déclarations et déductions."
            />
            <MetricCard
              size="small"
              label="Déduits d'une activité passée"
              value={formatCount(presence.inferred)}
              hint="reconnus par une trace que seule l'application iPhone écrit"
              unknownReason="La base n'a pas rendu la répartition entre déclarations et déductions."
            />
            {/*
              LE SEUL ZÉRO VRAI DE CET ÉCRAN, et il ne se lit pas
              « personne n'utilise l'application » : la fonction a
              répondu, elle n'avait aucune installation déclarée à
              décrire. Il compte des INSTALLATIONS et non des appareils —
              `identifierForVendor` est remis à zéro à la
              désinstallation, donc quelqu'un qui réinstalle deux fois en
              vaut trois.
            */}
            <MetricCard
              size="small"
              label="Installations déclarées"
              value={formatCount(installations)}
              hint="des installations, pas des appareils : une réinstallation en fait une nouvelle"
            />
          </div>
        </section>
      )}

      {voitLesChiffres && erreurChiffres === null && (
        <section className="mb-8">
          <SectionHeader
            title="Ce que le parc porte"
            description="Deux questions distinctes : « peut-on arrêter de corriger une vieille version ? » et « peut-on relever la cible de déploiement iOS sans couper quelqu'un ? ». Seules les installations DÉCLARÉES y répondent — une déduction ne porte aucune version."
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel
              title="Versions de l'application"
              description="La version publiée et le numéro de build de la CI. Les deux, parce que la version marketing est figée à 0.1.0 dans project.yml : seul le build distingue deux livraisons."
            >
              <MobileVersionTable rows={versions} />
            </Panel>
            <Panel
              title="Versions d'iOS"
              description="La version MAJEURE seule. La mineure ne change aucune décision de cible de déploiement, et la collecter rendrait l'empreinte plus fine pour rien."
            >
              <MobileOsTable rows={systemes} />
            </Panel>
          </div>
        </section>
      )}

      <section className="mb-8">
        <SectionHeader
          title="Les comptes"
          description="Leurs métadonnées et leurs rattachements, jamais leur contenu (spec p.9)."
        />

        <SearchBar
          action="/utilisateurs/mobile"
          defaultValue={search ?? ""}
          placeholder="Nom, adresse e-mail, ou identifiant exact…"
        >
          {/* La vue voyage avec la recherche : chercher « dupont » parmi
              les comptes déduits ne doit pas rendre les déclarés. La
              page, elle, n'est pas reportée — une nouvelle recherche
              recommence à la première, sinon elle s'ouvrirait au-delà de
              la fin. */}
          <input type="hidden" name="filtre" value={filtre} />
        </SearchBar>

        <FilterBar
          label="Restreindre aux comptes"
          current={hrefFor({ page: 1 })}
          filters={VUES.map((vue) => ({
            label: vue.label,
            href: hrefFor({ filtre: vue.value, page: 1 }),
          }))}
        />

        {isBeyondLastPage(paged) ? (
          <EmptyState
            title={`La page ${page} est au-delà de la fin de la liste`}
            description="Le nombre total est rendu par la base sur les lignes elles-mêmes : sans ligne, il n'est pas connu."
            action={<ButtonLink href={hrefFor({ page: 1 })}>Revenir à la première page</ButtonLink>}
          />
        ) : (
          <UsersTable
            rows={paged.rows}
            empty={
              <EmptyState
                tone="unknown"
                title={
                  search
                    ? "Aucun compte mobile ne correspond à cette recherche"
                    : filtre === "mobile_declare"
                      ? "Aucune installation ne s'est encore annoncée"
                      : filtre === "mobile_deduit"
                        ? "Aucun compte n'est connu par déduction"
                        : "Aucun usage mobile n'est attesté"
                }
                description={
                  search
                    ? "Le compte existe peut-être sans trace mobile : la liste complète des utilisateurs le dirait. L'identifiant se cherche en entier — une portion d'uuid ne correspond à rien."
                    : "Ce vide ne dit pas « personne n'utilise l'application ». Il dit que la collecte, ou la reprise rétroactive, n'a rien à montrer sous cette vue — un compte qui n'a pas rouvert l'application depuis la mise en service reste invisible, et le mode invité n'est jamais compté."
                }
                action={
                  search || filtre !== "mobile" ? (
                    <ButtonLink href="/utilisateurs/mobile" variant="secondary">
                      Revenir à tous les comptes mobiles
                    </ButtonLink>
                  ) : undefined
                }
              />
            }
            footer={
              paged.total !== null ? (
                <Pagination
                  page={paged.page}
                  pageSize={paged.pageSize}
                  total={paged.total}
                  hrefFor={(target) => hrefFor({ page: target })}
                />
              ) : undefined
            }
          />
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Ce que la collecte enregistre — et ce qu'elle refuse"
          description="Donnée personnelle, minimisée à la source. La liste de droite n'est pas un projet : c'est ce qu'aucune colonne de mobile_app_installations ne porte."
        >
          <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
            <div>
              <p className="eyebrow mb-1.5">Enregistré</p>
              <ul className="flex flex-col gap-1 text-[var(--text-body)] leading-relaxed text-ink-soft">
                <li>La plateforme — « ios », la seule valeur acceptée.</li>
                <li>La version publiée et le build de l&apos;application.</li>
                <li>La version MAJEURE d&apos;iOS, jamais la mineure.</li>
                <li>La date de la dernière annonce, ÉCRASÉE à chaque fois.</li>
                <li>
                  Un identifiant d&apos;INSTALLATION, jamais rendu par aucune fonction
                  d&apos;administration — il ne s&apos;affiche donc nulle part, pas même derrière
                  « Afficher détails techniques ».
                </li>
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-1.5">Jamais enregistré</p>
              <ul className="flex flex-col gap-1 text-[var(--text-body)] leading-relaxed text-ink-soft">
                <li>Aucune adresse IP.</li>
                <li>Aucune position.</li>
                <li>Aucun modèle d&apos;appareil.</li>
                <li>
                  Aucun nom d&apos;appareil — « iPhone de Clément » est un nom de personne, et la
                  déclaration refuse tout identifiant contenant un espace.
                </li>
                <li>Aucun identifiant publicitaire.</li>
                <li>
                  Aucun historique : une ligne par installation, mise à jour, jamais empilée. Cette
                  table décrit un état présent, elle n&apos;accumule pas un comportement.
                </li>
              </ul>
            </div>
          </div>
          <div className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            La suppression d&apos;un compte l&apos;emporte : la clé pointe vers{" "}
            <code className="font-mono text-[12px]">auth.users</code> en{" "}
            <code className="font-mono text-[12px]">on delete cascade</code>, et la fonction de
            suppression RGPD efface ces lignes explicitement avant de détruire le compte.
          </div>
        </Panel>

        <Panel
          title="Ce que cette page ne sait toujours pas dire"
          description="Les champs de la spec p.9 qui restent hors de portée, et pourquoi."
        >
          <GapList gaps={MOBILE_GAPS} />
        </Panel>
      </div>
    </>
  );
}

function Entete({ total }: { total?: number | null }) {
  return (
    <PageHeader
      eyebrow="Clients"
      title="Oasis Care Mobile"
      subtitle={
        total !== null && total !== undefined
          ? `${formatCount(total)} compte${total > 1 ? "s" : ""} dont un usage de l'application iPhone est attesté — déclaré par l'application, ou déduit d'une activité passée qu'elle seule sait écrire.`
          : "Les comptes dont un usage de l'application iPhone est attesté, la version qu'ils portent, et depuis quand on le sait."
      }
      action={
        <ButtonLink href="/utilisateurs" variant="secondary">
          Tous les utilisateurs →
        </ButtonLink>
      }
    />
  );
}
