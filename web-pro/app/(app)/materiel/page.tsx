import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import {
  PageHeader, EmptyState, MetricCard, DataTable, SearchBar, FilterBar,
  Panel, ButtonLink, SubmitButton, Badge, StatusBadge, type Column,
} from "@/components/ui";
import { formatCents } from "@/lib/quotes/types";
import { formatDate } from "@/lib/crm/types";
import {
  EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS,
  EQUIPMENT_STATUSES, EQUIPMENT_STATUS_LABELS, EQUIPMENT_STATUS_TONE,
  DEADLINE_STATE_TONE,
  deadlineTitle, formatDelay, formatMeter,
  type EquipmentCategory, type EquipmentStatus,
  type EquipmentOverview, type EquipmentDueDate,
} from "@/lib/equipment/types";
import { completeDeadline } from "@/lib/equipment/actions";
import { NewEquipmentForm } from "./NewEquipmentForm";

/**
 * §5 GESTION → MATÉRIEL — l'écran qui n'existait pas.
 *
 * CE QUE CET ÉCRAN DOIT FAIRE, et qui gouverne sa mise en page : une
 * liste de camions n'apprend rien à personne. L'entreprise sait
 * parfaitement qu'elle possède un Master et une mini-pelle. Ce qu'elle
 * ignore, et ce qui coûte cher, c'est que le contrôle technique du
 * Master expire dans douze jours.
 *
 * D'où l'ordre : les compteurs d'échéances d'abord, la liste de CE QUI
 * EXPIRE ensuite avec son bouton « Faite », et seulement après
 * l'inventaire — trié par urgence, pas par ordre alphabétique.
 *
 * §37 TABLES : recherche, filtres, tri et pagination passent tous par
 * l'URL. « Les engins de levage dont le contrôle est en retard » doit
 * pouvoir s'envoyer par message.
 */

/** §37 — assez de lignes pour balayer, assez peu pour rester légère. */
const PAR_PAGE = 25;

/**
 * Le plafond du total d'entretien affiché en tête.
 *
 * Le total additionne des lignes, ce qui suppose de les charger.
 * Au-delà, on affiche un tiret plutôt qu'une somme partielle : §9, un
 * chiffre faux vaut moins qu'un tiret.
 */
const PLAFOND_ENTRETIEN = 2000;

/** Combien d'échéances urgentes on montre avant de renvoyer à la liste. */
const URGENCES_AFFICHEES = 8;

const TRIS = {
  urgence: { label: "Urgence", column: "next_due_on", ascending: true },
  nom: { label: "Nom", column: "name", ascending: true },
  categorie: { label: "Catégorie", column: "category", ascending: true },
} as const;
type Tri = keyof typeof TRIS;
const TRI_PAR_DEFAUT: Tri = "urgence";

const ECHEANCES = {
  retard: "En retard",
  bientot: "À traiter",
  aucune: "Sans échéance",
} as const;
type FiltreEcheance = keyof typeof ECHEANCES;

export default async function EquipmentPage({ searchParams }: PageProps<"/materiel">) {
  const params = await searchParams;
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const q = lire(params.q).trim();

  const categorieBrute = lire(params.categorie);
  const categorie = (EQUIPMENT_CATEGORIES as readonly string[]).includes(categorieBrute)
    ? (categorieBrute as EquipmentCategory)
    : "";

  const statutBrut = lire(params.statut);
  const statut = (EQUIPMENT_STATUSES as readonly string[]).includes(statutBrut)
    ? (statutBrut as EquipmentStatus)
    : "";

  const echeanceBrute = lire(params.echeance);
  const echeance: FiltreEcheance | "" =
    echeanceBrute in ECHEANCES ? (echeanceBrute as FiltreEcheance) : "";

  const triBrut = lire(params.tri);
  const tri: Tri = triBrut in TRIS ? (triBrut as Tri) : TRI_PAR_DEFAUT;
  const page = Math.max(1, Number.parseInt(lire(params.page), 10) || 1);
  const archives = lire(params.archives) === "1";

  const peutModifier = organization.permissions.includes("projects.manage");
  const supabase = await createClient();

  /**
   * Les filtres, décrits une fois et posés là où il faut.
   *
   * Deux chaînes de `if` séparées finiraient par diverger, et le
   * compteur de la liste annoncerait un nombre que le tableau ne
   * montre pas.
   */
  const requeteFiltree = (colonnes: string) => {
    let r = supabase
      .from("equipment_overview")
      .select(colonnes, { count: "exact" })
      // §13 MULTI-ENTREPRISES : un même utilisateur peut appartenir à
      // plusieurs organisations, et la RLS les lui ouvre TOUTES. Sans
      // ce filtre, la liste mélangerait deux parcs et le sélecteur
      // d'entreprise ne commanderait plus rien. RLS protège des
      // AUTRES ; c'est cette ligne qui respecte le choix de
      // l'utilisateur.
      .eq("organization_id", organization.organizationId);

    // Un matériel archivé est sorti du parc. Il reste consultable —
    // son journal explique ce qu'on a dépensé dessus — mais il ne
    // s'affiche pas au milieu de ce qui roule encore.
    r = archives ? r.not("archived_at", "is", null) : r.is("archived_at", null);

    if (categorie) r = r.eq("category", categorie);
    if (statut) r = r.eq("status", statut);

    if (echeance === "retard") r = r.eq("next_due_state", "overdue");
    else if (echeance === "bientot") r = r.in("next_due_state", ["overdue", "dueSoon"]);
    // « Sans échéance » n'est pas un filtre de confort : c'est la
    // question « qu'est-ce que je surveille sans le savoir ? ». Un
    // camion sans contrôle technique enregistré ne déclenchera jamais
    // d'alerte, et c'est précisément celui qu'on oublie.
    else if (echeance === "aucune") r = r.is("next_due_on", null);

    if (q) {
      // Les caractères que PostgREST lirait comme de la syntaxe de filtre.
      const sur = q.replace(/[%,()]/g, " ");
      r = r.or(
        [
          `name.ilike.%${sur}%`,
          `brand.ilike.%${sur}%`,
          `model.ilike.%${sur}%`,
          `registration.ilike.%${sur}%`,
          `internal_number.ilike.%${sur}%`,
          `serial_number.ilike.%${sur}%`,
        ].join(","),
      );
    }
    return r;
  };

  const ordre = TRIS[tri];
  const debut = (page - 1) * PAR_PAGE;

  // Le seuil de la dépense d'entretien affichée en tête : les douze
  // derniers mois, glissants.
  const ilYAUnAn = new Date();
  ilYAUnAn.setUTCFullYear(ilYAUnAn.getUTCFullYear() - 1);
  const depuis = ilYAUnAn.toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

  const [
    { data: lignes, count, error },
    { count: enRetard },
    { count: aTraiter },
    { count: auParc },
    { data: urgences },
    { data: couts, count: coutsCount },
  ] = await Promise.all([
    requeteFiltree("*")
      .order(ordre.column, { ascending: ordre.ascending, nullsFirst: false })
      // Départage les ex æquo. Sans second critère, deux matériels sans
      // échéance peuvent échanger leur place d'une page à l'autre, et
      // l'un des deux ne s'afficherait jamais.
      .order("name", { ascending: true })
      .range(debut, debut + PAR_PAGE - 1),

    // Les compteurs décrivent le PARC ENTIER, jamais la sélection
    // courante : filtrer sur « tondeuses » ne doit pas faire tomber à
    // zéro le nombre de contrôles techniques en retard. Ce sont deux
    // questions différentes, et celle-ci ne se pose qu'une fois.
    supabase
      .from("equipment_due_dates")
      .select("deadline_id", { count: "exact", head: true })
      .eq("organization_id", organization.organizationId)
      .eq("state", "overdue"),
    supabase
      .from("equipment_due_dates")
      .select("deadline_id", { count: "exact", head: true })
      .eq("organization_id", organization.organizationId)
      .eq("state", "dueSoon"),
    supabase
      .from("equipment")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organization.organizationId)
      .is("archived_at", null),

    supabase
      .from("equipment_due_dates")
      .select("*")
      .eq("organization_id", organization.organizationId)
      .in("state", ["overdue", "dueSoon"])
      .order("due_on", { ascending: true })
      .limit(URGENCES_AFFICHEES),

    supabase
      .from("equipment_maintenance")
      .select("cost_cents", { count: "exact" })
      .eq("organization_id", organization.organizationId)
      .gte("performed_on", depuis)
      .range(0, PLAFOND_ENTRETIEN - 1),
  ]);

  const rows = (lignes ?? []) as unknown as EquipmentOverview[];
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAR_PAGE));
  const urgent = (urgences ?? []) as unknown as EquipmentDueDate[];

  /**
   * La dépense d'entretien des douze derniers mois.
   *
   * `null` quand aucune intervention n'est notée — et ce n'est PAS
   * zéro : « on n'a rien dépensé » et « on n'a rien noté » sont deux
   * affirmations différentes, et la seconde est de loin la plus
   * probable la première année. `null` aussi quand il y en a trop pour
   * les additionner ici, plutôt qu'une somme partielle présentée comme
   * un total.
   */
  const lignesCout = (couts ?? []) as unknown as { cost_cents: number }[];
  const coutComplet = lignesCout.length >= (coutsCount ?? 0);
  const coutEntretien =
    lignesCout.length === 0 || !coutComplet
      ? null
      : lignesCout.reduce((somme, ligne) => somme + (ligne.cost_cents ?? 0), 0);

  // Les noms des destinataires d'affectation, pour les seules lignes
  // affichées. Les vues ne portent que des identifiants : une jointure
  // de plus dans la vue mêlerait trois tables d'autres modules à un
  // objet qui n'en a besoin que pour l'affichage.
  const affectations = await nomsDAffectation(supabase, organization.organizationId, rows);

  const filtreActif = Boolean(q || categorie || statut || echeance || archives);
  const base = { q, categorie, statut, echeance, tri, archives: archives ? "1" : "" };
  const lien = (modifs: Record<string, string>) => construireLien(base, modifs);

  const colonnes: Column<EquipmentOverview>[] = [
    {
      key: "nom",
      header: "Matériel",
      cell: (m) => (
        <span>
          {m.internal_number && <span className="tabular text-ink-faint">{m.internal_number} </span>}
          {m.name}
          {m.registration && (
            <span className="tabular block text-[var(--text-secondary)] text-ink-soft">
              {m.registration}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "categorie",
      header: "Catégorie",
      secondary: true,
      width: "9rem",
      cell: (m) => (
        <span className="text-ink-soft">{EQUIPMENT_CATEGORY_LABELS[m.category]}</span>
      ),
    },
    {
      key: "affectation",
      header: "Où il est",
      secondary: true,
      cell: (m) => {
        const nom = affectations.get(m.equipment_id);
        return nom ? (
          <span className="text-ink-soft">{nom}</span>
        ) : (
          <span className="text-ink-faint">Au dépôt</span>
        );
      },
    },
    {
      key: "compteur",
      header: "Compteur",
      numeric: true,
      secondary: true,
      width: "8rem",
      cell: (m) => (
        <span className={m.current_meter === null ? "text-ink-faint" : ""}>
          {formatMeter(m.current_meter, m.meter_kind)}
        </span>
      ),
    },
    {
      key: "echeance",
      header: "Prochaine échéance",
      width: "15rem",
      // LA COLONNE QUI JUSTIFIE L'ÉCRAN. Le délai en toutes lettres
      // avant la date : « dans 12 jours » fait agir, « 14/09/2026 »
      // demande un calcul mental que personne ne fait en parcourant
      // une liste.
      cell: (m) =>
        m.next_due_on === null || m.next_due_state === null ? (
          <span className="text-ink-faint">Aucune</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={DEADLINE_STATE_TONE[m.next_due_state]}>
              {formatDelay(m.next_due_days_left)}
            </StatusBadge>
            <span className="text-[var(--text-secondary)] text-ink-soft">
              {m.next_due_kind ? deadlineTitle(m.next_due_kind, null) : ""}
            </span>
          </span>
        ),
    },
    {
      key: "statut",
      header: "État",
      width: "8rem",
      cell: (m) => (
        <Badge tone={EQUIPMENT_STATUS_TONE[m.status]}>{EQUIPMENT_STATUS_LABELS[m.status]}</Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Matériel"
        subtitle="Le parc, et surtout ce qui expire dessus : contrôle technique, assurance, révision, vérification réglementaire. Une date oubliée est la seule panne de ce module qui se paie comptant."
        action={peutModifier ? <NewEquipmentForm /> : <Badge tone="neutral">Lecture seule</Badge>}
      />

      {/* §1 « grandes cartes KPI » — les deux premières sont la raison
          d'être de l'écran, et elles portent le parc ENTIER, pas la
          sélection en cours. */}
      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Échéances en retard"
          value={String(enRetard ?? 0)}
          hint={(enRetard ?? 0) > 0 ? "À régler avant tout le reste" : "Rien n'est dépassé"}
          tone={(enRetard ?? 0) > 0 ? "accent" : "neutral"}
          href={lien({ echeance: "retard", page: "" })}
        />
        <MetricCard
          label="À traiter"
          value={String(aTraiter ?? 0)}
          hint="Dans le préavis fixé sur chaque échéance"
          href={lien({ echeance: "bientot", page: "" })}
        />
        <MetricCard
          label="Matériels au parc"
          value={String(auParc ?? 0)}
          hint="Hors matériels archivés"
        />
        <MetricCard
          label="Entretien sur 12 mois"
          value={coutEntretien === null ? null : formatCents(coutEntretien)}
          hint={
            coutEntretien === null
              ? coutComplet
                ? "Aucune intervention notée"
                : "Trop d'interventions pour totaliser ici"
              : "Pièces et main-d'œuvre enregistrées"
          }
        />
      </section>

      {/* CE QUI EXPIRE, en tête et actionnable. Le bouton clôt
          l'échéance et pose la suivante si elle se renouvelle — sans
          quoi l'entreprise devrait ouvrir une fiche pour dire « c'est
          fait », et ne le ferait pas. */}
      {urgent.length > 0 && (
        <Panel
          title="À traiter maintenant"
          description="Les échéances dépassées ou entrées dans leur préavis, la plus urgente en premier."
          className="mb-8"
          count={(enRetard ?? 0) + (aTraiter ?? 0)}
          footer={
            (enRetard ?? 0) + (aTraiter ?? 0) > urgent.length ? (
              <Link
                href={lien({ echeance: "bientot", page: "" })}
                className="text-[var(--text-secondary)] text-ink-soft hover:text-accent"
              >
                Voir les {(enRetard ?? 0) + (aTraiter ?? 0)} échéances →
              </Link>
            ) : undefined
          }
        >
          <ul className="divide-y divide-line">
            {urgent.map((echeanceLigne) => (
              <li
                key={echeanceLigne.deadline_id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/materiel/${echeanceLigne.equipment_id}`}
                    className="font-medium hover:text-accent"
                  >
                    {echeanceLigne.internal_number && (
                      <span className="tabular text-ink-faint">
                        {echeanceLigne.internal_number}{" "}
                      </span>
                    )}
                    {echeanceLigne.equipment_name}
                  </Link>
                  <p className="text-[var(--text-secondary)] text-ink-soft">
                    {deadlineTitle(echeanceLigne.kind, echeanceLigne.label)} ·{" "}
                    {formatDate(echeanceLigne.due_on)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge tone={DEADLINE_STATE_TONE[echeanceLigne.state]}>
                    {formatDelay(echeanceLigne.days_left)}
                  </StatusBadge>
                  {peutModifier && (
                    <form action={completeDeadline}>
                      <input type="hidden" name="deadline_id" value={echeanceLigne.deadline_id} />
                      <input type="hidden" name="equipment_id" value={echeanceLigne.equipment_id} />
                      <SubmitButton variant="secondary">Faite</SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <SearchBar
        defaultValue={q}
        placeholder="Rechercher un nom, une marque, une plaque, un numéro interne…"
      >
        {categorie && <input type="hidden" name="categorie" value={categorie} />}
        {echeance && <input type="hidden" name="echeance" value={echeance} />}
        {archives && <input type="hidden" name="archives" value="1" />}
        {tri !== TRI_PAR_DEFAUT && <input type="hidden" name="tri" value={tri} />}
        <select
          name="statut"
          defaultValue={statut}
          aria-label="État du matériel"
          className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
        >
          <option value="">Tous les états</option>
          {EQUIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EQUIPMENT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary">Filtrer</SubmitButton>
      </SearchBar>

      <FilterBar
        label="Filtrer par échéance"
        current={lien({})}
        filters={[
          { label: "Toutes les échéances", href: lien({ echeance: "", page: "" }) },
          ...(Object.keys(ECHEANCES) as FiltreEcheance[]).map((clef) => ({
            label: ECHEANCES[clef],
            href: lien({ echeance: clef, page: "" }),
          })),
        ]}
      />

      <FilterBar
        label="Filtrer par catégorie"
        current={lien({})}
        filters={[
          { label: "Toutes les catégories", href: lien({ categorie: "", page: "" }) },
          ...EQUIPMENT_CATEGORIES.map((c) => ({
            label: EQUIPMENT_CATEGORY_LABELS[c],
            href: lien({ categorie: c, page: "" }),
          })),
        ]}
      />

      <FilterBar
        label="Trier"
        current={lien({})}
        filters={(Object.keys(TRIS) as Tri[]).map((clef) => ({
          label: TRIS[clef].label,
          href: lien({ tri: clef, page: "" }),
        }))}
      />

      {error && (
        <p className="mb-4 rounded-[var(--radius-card)] bg-critical-wash px-4 py-3 text-[var(--text-body)] text-critical">
          {error.message}
        </p>
      )}

      <DataTable
        columns={colonnes}
        rows={rows}
        rowKey={(m) => m.equipment_id}
        rowHref={(m) => `/materiel/${m.equipment_id}`}
        empty={
          total > 0 ? (
            <EmptyState
              title="Cette page est vide"
              description={`Il n'y a que ${pages} page${pages > 1 ? "s" : ""} de résultats. Revenez à la première.`}
              action={<ButtonLink href={lien({ page: "" })}>Revenir au début</ButtonLink>}
            />
          ) : filtreActif ? (
            <EmptyState
              title="Aucun matériel ne correspond"
              description="Aucun matériel ne réunit ces critères. Élargissez la recherche, ou repartez du parc entier."
              action={
                <ButtonLink href="/materiel" variant="secondary">
                  Effacer les filtres
                </ButtonLink>
              }
            />
          ) : (
            /* §32 — ce qu'il n'y a pas, à quoi ça servira, et par où
               commencer. La phrase dit la VALEUR du module, pas sa
               définition : personne n'ouvre un logiciel pour saisir un
               numéro de série. */
            <EmptyState
              title="Aucun matériel enregistré"
              description="Enregistrez vos véhicules et vos machines pour ne plus laisser passer un contrôle technique, une assurance ou une révision — et pour savoir sur quel chantier se trouve la mini-pelle."
              action={peutModifier ? <NewEquipmentForm /> : undefined}
            />
          )
        }
        footer={
          pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-[var(--text-secondary)] text-ink-soft">
              <span className="tabular">
                Page {page} sur {pages} · {total} matériel{total > 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-3">
                {page > 1 && (
                  <Link href={lien({ page: String(page - 1) })} className="hover:text-accent">
                    ← Précédents
                  </Link>
                )}
                {page < pages && (
                  <Link href={lien({ page: String(page + 1) })} className="hover:text-accent">
                    Suivants →
                  </Link>
                )}
              </span>
            </div>
          ) : undefined
        }
      />

      <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
        {archives ? (
          <>
            Vous consultez les matériels sortis du parc. Leurs échéances ne sont plus
            surveillées.{" "}
            <Link href={lien({ archives: "", page: "" })} className="hover:text-accent">
              Revenir au parc en service
            </Link>
            .
          </>
        ) : (
          <>
            Un matériel vendu ou réformé s&apos;archive : son journal d&apos;entretien reste
            consultable, mais ses échéances cessent de sonner.{" "}
            <Link href={lien({ archives: "1", page: "" })} className="hover:text-accent">
              Voir les matériels archivés
            </Link>
            .
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Où se trouve chaque matériel de la page, en toutes lettres.
 *
 * Trois requêtes bornées aux identifiants réellement affichés, plutôt
 * qu'une jointure dans la vue : `projects`, `teams` et `employees`
 * appartiennent à d'autres modules, et les entraîner dans un objet de
 * lecture les rendrait solidaires de ses évolutions.
 */
async function nomsDAffectation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  rows: EquipmentOverview[],
): Promise<Map<string, string>> {
  const noms = new Map<string, string>();

  const chantiers = [...new Set(rows.map((m) => m.assigned_project_id).filter(Boolean))] as string[];
  const equipes = [...new Set(rows.map((m) => m.assigned_team_id).filter(Boolean))] as string[];
  const salaries = [...new Set(rows.map((m) => m.assigned_employee_id).filter(Boolean))] as string[];

  // `in()` sur une liste vide n'est pas une requête valide : on ne la
  // pose pas plutôt que de la poser pour rien.
  const [chantiersData, equipesData, salariesData] = await Promise.all([
    chantiers.length
      ? supabase
          .from("projects")
          .select("id, number, name")
          .eq("organization_id", organizationId)
          .in("id", chantiers)
          .then((r) => r.data)
      : Promise.resolve(null),
    equipes.length
      ? supabase
          .from("teams")
          .select("id, name")
          .eq("organization_id", organizationId)
          .in("id", equipes)
          .then((r) => r.data)
      : Promise.resolve(null),
    salaries.length
      ? supabase
          .from("employees")
          .select("id, first_name, last_name")
          .eq("organization_id", organizationId)
          .in("id", salaries)
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const parChantier = new Map(
    ((chantiersData ?? []) as unknown as { id: string; number: string; name: string }[]).map((p) => [
      p.id,
      p.name || p.number,
    ]),
  );
  const parEquipe = new Map(
    ((equipesData ?? []) as unknown as { id: string; name: string }[]).map((t) => [t.id, t.name]),
  );
  const parSalarie = new Map(
    (
      (salariesData ?? []) as unknown as { id: string; first_name: string; last_name: string }[]
    ).map((e) => [e.id, `${e.first_name} ${e.last_name}`.trim()]),
  );

  for (const m of rows) {
    const nom =
      (m.assigned_project_id && parChantier.get(m.assigned_project_id)) ||
      (m.assigned_team_id && parEquipe.get(m.assigned_team_id)) ||
      (m.assigned_employee_id && parSalarie.get(m.assigned_employee_id)) ||
      null;
    if (nom) noms.set(m.equipment_id, nom);
  }
  return noms;
}

/** Un paramètre d'URL répété arrive en tableau : on ne garde que le premier. */
function lire(valeur: string | string[] | undefined): string {
  if (Array.isArray(valeur)) return valeur[0] ?? "";
  return valeur ?? "";
}

/**
 * L'URL de la liste, filtres compris.
 *
 * Les clés vides disparaissent et l'ordre est fixe : deux appels qui
 * décrivent le même état produisent la même chaîne, ce dont dépend
 * `FilterBar` pour savoir quelle pastille est active. `page` n'est
 * jamais reporté par défaut — changer de filtre remet au début, sinon
 * on atterrit sur la page 4 d'une liste qui n'en a plus que deux.
 */
function construireLien(
  base: { q: string; categorie: string; statut: string; echeance: string; tri: Tri; archives: string },
  modifs: Record<string, string>,
): string {
  const valeurs: Record<string, string> = {
    q: base.q,
    categorie: base.categorie,
    statut: base.statut,
    echeance: base.echeance,
    tri: base.tri,
    archives: base.archives,
    ...modifs,
  };
  const recherche = new URLSearchParams();
  for (const [clef, valeur] of Object.entries(valeurs)) {
    if (valeur) recherche.set(clef, valeur);
  }
  const chaine = recherche.toString();
  return chaine ? `/materiel?${chaine}` : "/materiel";
}
