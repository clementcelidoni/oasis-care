import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { ButtonLink, FilterBar, PageHeader } from "@/components/ui";
import {
  addDaysIso, estUnJourIso, employeeName, formatWeekRange, interventionDaysIso,
  mondayIsoOf, parisDay, parisMidnight, weekDaysIso,
  type DayNote, type Intervention, type Team,
} from "@/lib/field/types";
import { WeekPlanner } from "./WeekPlanner";
import type { EquipeVue, NoteVue, SiteVue } from "./vue";

/**
 * §11G — le planning.
 *
 * La SEMAINE est la vue par défaut, et la seule pour l'instant. C'est
 * l'horizon réel d'un conducteur de travaux : le mois ne tient pas dans
 * un écran lisible, et la journée ne montre pas ce qui arrive.
 *
 * PLEINE LARGEUR, contrairement au reste du produit. Une grille de sept
 * colonnes est le seul écran dont la lisibilité dépend directement de
 * la largeur disponible ; lui retirer 112 px pour respecter une
 * gouttière de lecture serait un mauvais échange.
 */
export default async function PlanningPage({ searchParams }: PageProps<"/planning">) {
  const params = await searchParams;
  const organization = await requireOrganization();
  const supabase = await createClient();

  // Le jour vécu à PARIS, pas la date UTC du serveur : entre minuit et
  // deux heures du matin l'heure d'été, les deux diffèrent, et le
  // planning s'ouvrait alors sur la semaine de la veille.
  const aujourdhui = parisDay(new Date());
  const ancre = estUnJourIso(params.semaine) ? params.semaine : aujourdhui;
  const mondayIso = mondayIsoOf(ancre);
  const jours = weekDaysIso(mondayIso);

  // La fenêtre commence à MINUIT PARIS, pas à `T00:00:00Z` : une
  // intervention du lundi 00 h 30 tombait hors fenêtre et
  // n'apparaissait nulle part.
  const debutSemaine = parisMidnight(mondayIso).toISOString();
  const finSemaine = parisMidnight(addDaysIso(mondayIso, 7)).toISOString();

  const equipeFiltre = typeof params.equipe === "string" ? params.equipe : "";
  const peutModifier = organization.permissions.includes("projects.manage");

  /*
    TOUTES LES REQUÊTES SONT BORNÉES À L'ENTREPRISE ACTIVE.

    La RLS ne suffit pas ici, et c'est contre-intuitif : elle rend
    TOUTES les organisations dont on est membre, et le produit est
    explicitement multi-entreprises (cookie `oasis_org`, sélecteur
    d'entreprise). Sans ce filtre, le planning d'une société affichait
    les chantiers et les équipes de l'autre, le filtre proposait des
    équipes étrangères, et cliquer l'une d'elles faisait échouer
    l'enregistrement d'une note sur le déclencheur de 0078 — pour une
    puce que l'écran avait lui-même dessinée. C'est la discipline que
    tient déjà `materiel/page.tsx` sur chacune de ses requêtes.
  */
  const cetteEntreprise = organization.organizationId;

  const [
    { data: interventionsBrutes },
    { data: equipesBrutes },
    { data: projets },
    { data: clients },
    { data: notesBrutes },
    { data: membres },
    { data: salaries },
    { count: totalInterventions, error: erreurDeComptage },
    utilisateur,
  ] = await Promise.all([
    /*
      LE CHEVAUCHEMENT, ET NON LE SEUL JOUR DE DÉBUT.
      L'ancienne fenêtre ne prenait que `scheduled_start` dans la
      semaine : un chantier de soixante-dix heures n'apparaissait que le
      jour de son début, et le mercredi paraissait libre alors que
      l'équipe y était mobilisée. Une intervention sans fin n'occupe que
      son jour de début — d'où la branche `and(...)`.
    */
    supabase
      .from("field_interventions")
      .select("*")
      .eq("organization_id", cetteEntreprise)
      .lt("scheduled_start", finSemaine)
      .or(`scheduled_end.gt.${debutSemaine},and(scheduled_end.is.null,scheduled_start.gte.${debutSemaine})`)
      .neq("status", "cancelled")
      .order("scheduled_start"),

    supabase.from("teams").select("id, name, color, lead_employee_id")
      .eq("organization_id", cetteEntreprise)
      .is("archived_at", null).order("name"),
    supabase.from("projects").select("id, number, name")
      .eq("organization_id", cetteEntreprise)
      .is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("crm_customers").select("id, display_name")
      .eq("organization_id", cetteEntreprise)
      .is("archived_at", null).order("display_name"),

    supabase.from("planning_day_notes").select("*")
      .eq("organization_id", cetteEntreprise)
      .gte("day", mondayIso).lte("day", jours[6]).order("created_at"),

    supabase.from("team_members").select("team_id, employee_id")
      .eq("organization_id", cetteEntreprise),
    // Les archivés compris : ils ne composent plus une équipe, mais ils
    // ont pu écrire une note qui, elle, reste. Une consigne dont
    // l'auteur devient anonyme le jour de son départ ne se conteste plus.
    supabase.from("employees").select("id, first_name, last_name, user_id, archived_at")
      .eq("organization_id", cetteEntreprise),

    // §7 — distinguer « rien cette semaine » de « rien du tout ».
    supabase.from("field_interventions").select("id", { count: "exact", head: true })
      .eq("organization_id", cetteEntreprise),

    // Pour signer les notes qu'on écrit soi-même — voir plus bas.
    getCurrentUser(),
  ]);

  const interventions = (interventionsBrutes ?? []) as Intervention[];
  const equipesBase = (equipesBrutes ?? []) as Team[];

  type SalarieLigne = {
    id: string; first_name: string; last_name: string;
    user_id: string | null; archived_at: string | null;
  };
  const listeSalaries = (salaries ?? []) as SalarieLigne[];
  const salarieParId = new Map(listeSalaries.map((s) => [s.id, s]));

  // Les prénoms de chaque équipe, le chef d'abord : à sept heures du
  // matin on lit trois prénoms, pas un nom d'équipe.
  const equipes: EquipeVue[] = equipesBase.map((equipe) => {
    const rattaches = ((membres ?? []) as { team_id: string; employee_id: string }[])
      .filter((m) => m.team_id === equipe.id)
      .map((m) => salarieParId.get(m.employee_id))
      .filter((s): s is SalarieLigne => Boolean(s) && !s!.archived_at);

    const chefDAbord = [...rattaches].sort((a, b) => {
      if (a.id === equipe.lead_employee_id) return -1;
      if (b.id === equipe.lead_employee_id) return 1;
      return employeeName(a).localeCompare(employeeName(b), "fr");
    });

    return { ...equipe, membres: chefDAbord.map((s) => s.first_name || employeeName(s)) };
  });

  /*
    L'AUTEUR D'UNE NOTE, ET LE REPLI QUI MANQUAIT.

    `created_by` porte l'identifiant du COMPTE ; le nom vit sur la fiche
    SALARIÉ, reliée au compte par `user_id` (lien unique depuis 0070).
    Quand ce rattachement n'a jamais été fait — c'est le cas de toute
    entreprise qui vient d'ouvrir, et de la seule qui existe
    aujourd'hui — la jointure ne rend rien et l'auteur ne s'affichait
    JAMAIS. Or c'est l'argument même de `created_by` : une consigne
    anonyme ne se conteste pas.

    Le repli est celui que `entreprise/equipe/page.tsx` emploie déjà, et
    il a la même limite, qui est celle du schéma : `public.profiles`
    n'expose que SA PROPRE ligne (RLS de 0001), et aucune table
    lisible ne porte le nom des autres comptes. On sait donc se nommer
    soi-même — ce qui couvre l'immense majorité des notes qu'on relit —
    et pas encore nommer un collègue non rattaché à une fiche salarié.
  */
  const nomParCompte = new Map(
    listeSalaries.filter((s) => s.user_id).map((s) => [s.user_id!, employeeName(s)]),
  );

  const notesBase = (notesBrutes ?? []) as DayNote[];
  const moiNonRattache = Boolean(utilisateur)
    && !nomParCompte.has(utilisateur!.id)
    && notesBase.some((n) => n.created_by === utilisateur!.id);

  if (moiNonRattache) {
    const { data: profil } = await supabase
      .from("profiles")
      .select("display_name, email")
      .eq("id", utilisateur!.id)
      .maybeSingle();
    const nom = (profil as { display_name: string | null; email: string | null } | null);
    const moi = nom?.display_name?.trim() || nom?.email || utilisateur!.email || null;
    if (moi) nomParCompte.set(utilisateur!.id, moi);
  }

  const notes: NoteVue[] = notesBase.map((note) => ({
    ...note,
    auteur: note.created_by ? nomParCompte.get(note.created_by) ?? null : null,
  }));

  // Les sites des seules interventions affichées : le planning n'a
  // besoin ni des autres adresses ni des autres colonnes.
  const siteIds = [...new Set(interventions.map((i) => i.site_id).filter((id): id is string => Boolean(id)))];
  const sites: SiteVue[] = siteIds.length === 0
    ? []
    : await chargerSites(supabase, siteIds, cetteEntreprise);

  // Les compteurs du filtre décrivent la SEMAINE ENTIÈRE, jamais la
  // sélection courante : c'est précisément « ÉQUIPE 2 : 0 » qu'il faut
  // pouvoir lire, et un `<select>` ne le dit pas.
  const dansLaSemaine = interventions.filter((iv) => interventionDaysIso(iv, jours).length > 0);
  const base = `/planning?semaine=${mondayIso}`;
  const filtres = [
    { label: "Toutes", href: base, count: dansLaSemaine.length },
    // La pastille reprend la couleur que l'utilisateur a donnée à
    // l'équipe, la même que la barre gauche des cartes : c'est ce qui
    // permet de suivre une équipe à l'œil du filtre jusqu'à la grille.
    // Le nom reste ÉCRIT à côté — la couleur ne porte jamais seule.
    ...equipes.map((equipe) => ({
      label: equipe.name,
      dot: equipe.color,
      href: `${base}&equipe=${equipe.id}`,
      count: dansLaSemaine.filter((iv) => iv.team_id === equipe.id).length,
    })),
    {
      label: "Sans équipe",
      href: `${base}&equipe=sans`,
      count: dansLaSemaine.filter((iv) => iv.team_id === null).length,
    },
  ];
  const filtreCourant = equipeFiltre === "" ? base : `${base}&equipe=${equipeFiltre}`;

  const estSemaineCourante = mondayIso === mondayIsoOf(aujourdhui);

  // Changer de semaine ne défait pas le filtre : on suit UNE équipe
  // d'une semaine à l'autre, c'est même la question qu'on se pose en
  // avançant.
  const suffixeEquipe = equipeFiltre === "" ? "" : `&equipe=${equipeFiltre}`;

  return (
    <div className="w-full px-6 py-8">
      <PageHeader
        title="Planning"
        subtitle={formatWeekRange(mondayIso)}
        action={
          <>
            <ButtonLink
              href={`/planning?semaine=${addDaysIso(mondayIso, -7)}${suffixeEquipe}`}
              variant="secondary"
            >
              <span aria-hidden>←</span>
              <span className="sr-only">Semaine précédente</span>
            </ButtonLink>

            {estSemaineCourante ? (
              <span className="px-3.5 py-2 text-[length:var(--text-secondary)] font-medium text-ink-faint">
                Aujourd&apos;hui
              </span>
            ) : (
              <Link
                href={`/planning?semaine=${mondayIsoOf(aujourdhui)}${suffixeEquipe}`}
                className="rounded-[var(--radius-control)] px-3.5 py-2 text-[length:var(--text-secondary)] font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
              >
                Aujourd&apos;hui
              </Link>
            )}

            <ButtonLink
              href={`/planning?semaine=${addDaysIso(mondayIso, 7)}${suffixeEquipe}`}
              variant="secondary"
            >
              <span aria-hidden>→</span>
              <span className="sr-only">Semaine suivante</span>
            </ButtonLink>
          </>
        }
      />

      {/* Par l'URL et non par un état local : le filtre survit au
          rafraîchissement qui suit un dépôt, et il se partage. */}
      <FilterBar filters={filtres} current={filtreCourant} label="Filtrer par équipe" />

      <WeekPlanner
        mondayIso={mondayIso}
        aujourdhui={aujourdhui}
        maintenantIso={new Date().toISOString()}
        interventions={interventions}
        equipes={equipes}
        notes={notes}
        clients={(clients ?? []) as { id: string; display_name: string }[]}
        sites={sites}
        options={{
          projets: (projets ?? []) as { id: string; number: string; name: string }[],
          clients: (clients ?? []) as { id: string; display_name: string }[],
        }}
        equipeFiltre={equipeFiltre}
        peutModifier={peutModifier}
        /* INCONNU N'EST PAS ZÉRO. Un `?? 0` derrière un comptage
           raté aurait annoncé « le planning est encore vide » sur une
           panne de réseau, et supprimé au passage le lien vers la
           semaine précédente — la seule issue quand la semaine
           affichée ne montre rien. Dans le doute, on garde l'issue. */
        premiereFois={erreurDeComptage ? false : totalInterventions === 0}
      />
    </div>
  );
}

/** L'adresse d'un chantier, écrite comme on la dicte. */
async function chargerSites(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[],
  organizationId: string,
): Promise<SiteVue[]> {
  const { data } = await supabase
    .from("crm_customer_sites")
    .select("id, name, address_line1, postal_code, city, latitude, longitude")
    .eq("organization_id", organizationId)
    .in("id", ids);

  return ((data ?? []) as {
    id: string; name: string; address_line1: string | null;
    postal_code: string | null; city: string | null;
    latitude: number | null; longitude: number | null;
  }[]).map((site) => {
    const adresse = [site.address_line1, [site.postal_code, site.city].filter(Boolean).join(" ")]
      .filter((morceau) => morceau && morceau.trim() !== "")
      .join(", ");

    // Le lien de carte n'est jamais deviné : sans coordonnées ni
    // adresse, on n'en propose pas — un lien qui tombe au milieu de
    // nulle part est pire que pas de lien.
    const cible = site.latitude !== null && site.longitude !== null
      ? `${site.latitude},${site.longitude}`
      : adresse;

    return {
      id: site.id,
      name: site.name,
      adresse: adresse === "" ? null : adresse,
      carteHref: cible ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(cible)}` : null,
    };
  });
}
