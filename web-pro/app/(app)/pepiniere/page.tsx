import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageHeader, Panel, EmptyState, MetricCard, ButtonLink, Badge,
  ActivityTimeline, StatusBadge,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { ensureStages } from "@/lib/nursery/actions";
import {
  LOT_STATUS_LABELS, LOT_STATUS_TONE, MOVEMENT_KIND_LABELS,
  MOVEMENTS_WITHOUT_QUANTITY, formatCount,
  type LotStatus, type MovementKind, type StockRow,
} from "@/lib/nursery/types";
import { NewLotForm } from "./NewLotForm";
import { StockTable } from "@/components/nursery/StockTable";
import { RepartitionEspeces } from "./RepartitionEspeces";

/**
 * §40 NURSERY UX — « Créer dashboard Nursery ».
 *
 * Avant, cet écran était une deuxième liste de lots : un tableau de
 * trois cents lignes, avec sa recherche et ses filtres, exactement ce
 * que fait déjà « Lots » dans le menu. On y arrivait par « Tableau de
 * bord » et on n'y trouvait aucun bord de table — juste des lignes.
 *
 * Il répond maintenant aux cinq questions du document, dans l'ordre où
 * on se les pose le matin : combien de plantes ai-je (§1 « grandes
 * cartes KPI »), qu'est-ce qui cloche, qu'est-ce qui a bougé hier, à
 * quoi ressemble mon stock par espèce, et où en sont mes derniers lots.
 * La liste complète des lots reste à un clic, sur son propre écran, où
 * elle a la recherche, les filtres, le tri et la pagination.
 *
 * §9 — aucun chiffre n'est inventé ici : tout vient de la vue
 * `nursery_stock` (migration 0053) et de comptages exacts.
 */

/** Ce que la vue `nursery_stock` rend vraiment — `expected` compris. */
type LigneStock = StockRow & { expected: number };

type LigneMouvement = {
  id: string;
  kind: MovementKind;
  quantity: number;
  occurred_at: string;
  nursery_lots: { id: string; lot_code: string; species_name: string } | null;
};

type LigneLot = {
  id: string;
  lot_code: string;
  species_name: string;
  cultivar: string | null;
  current_quantity: number;
  status: LotStatus;
  created_at: string;
};

/** Les mouvements qui appellent l'œil : une perte n'est pas une réception. */
const TON_MOUVEMENT: Partial<Record<MovementKind, "accent" | "warning" | "critical">> = {
  receive: "accent",
  loss: "critical",
  quarantine: "critical",
  release: "accent",
  sell: "accent",
  adjustment: "warning",
};

export default async function NurseryPage() {
  // Les étapes de production à la première visite — voir `ensureStages`.
  await ensureStages();

  const supabase = await createClient();

  const [
    { data: stock },
    { count: nbLots },
    { count: nbIsoles },
    { count: nbSansEmplacement },
    { data: mouvements },
    { data: derniersLots },
    { data: alertesSante },
    { data: locations },
    { data: stages },
  ] = await Promise.all([
    supabase.from("nursery_stock").select("*").order("species_name"),

    supabase
      .from("nursery_lots")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null),

    // Hors vente pour raison sanitaire ou matérielle : c'est la même
    // sélection que l'écran Santé, pour que les deux ne se contredisent
    // jamais.
    supabase
      .from("nursery_lots")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .in("status", ["quarantine", "hold", "damaged"]),

    // Un lot sans emplacement est un lot qu'on finit par perdre de vue.
    supabase
      .from("nursery_lots")
      .select("id", { count: "exact", head: true })
      .is("archived_at", null)
      .is("location_id", null),

    supabase
      .from("nursery_stock_movements")
      .select("id, kind, quantity, occurred_at, nursery_lots ( id, lot_code, species_name )")
      .order("occurred_at", { ascending: false })
      .limit(8),

    supabase
      .from("nursery_lots")
      .select("id, lot_code, species_name, cultivar, current_quantity, status, created_at")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(5),

    supabase
      .from("nursery_inspections")
      .select("id")
      .in("result", ["problem", "critical"])
      .order("inspected_on", { ascending: false })
      .limit(20),

    supabase
      .from("nursery_locations")
      .select("id, code, name")
      .is("archived_at", null)
      .order("code"),

    supabase.from("nursery_stages").select("id, code, label").order("position"),
  ]);

  const stockRows = (stock ?? []) as LigneStock[];

  // §40 — « 48 240 plantes · Disponible 31 400 · Réservé 7 850 ·
  // Production 8 300 · Quarantaine 690 ». Les cinq chiffres se
  // totalisent depuis la vue, espèce par espèce.
  const totaux = stockRows.reduce(
    (acc, row) => ({
      physique: acc.physique + row.physical,
      disponible: acc.disponible + row.available,
      reserve: acc.reserve + row.reserved,
      production: acc.production + row.in_production,
      quarantaine: acc.quarantaine + row.quarantine,
      attendu: acc.attendu + (row.expected ?? 0),
    }),
    { physique: 0, disponible: 0, reserve: 0, production: 0, quarantaine: 0, attendu: 0 },
  );

  const lignesMouvements = (mouvements ?? []) as unknown as LigneMouvement[];
  const lots = (derniersLots ?? []) as LigneLot[];
  const nbAlertesSante = (alertesSante ?? []).length;

  const alertes = [
    nbIsoles && nbIsoles > 0
      ? {
          id: "isoles",
          ton: "critical" as const,
          titre: `${nbIsoles} lot${nbIsoles > 1 ? "s" : ""} hors vente`,
          detail: `${formatCount(totaux.quarantaine)} plantes en quarantaine. Elles comptent dans le stock physique — elles existent — mais rien n'en est vendable.`,
          lien: { label: "Voir la santé", href: "/pepiniere/sante" },
        }
      : null,
    nbAlertesSante > 0
      ? {
          id: "inspections",
          ton: "warning" as const,
          titre: `${nbAlertesSante} inspection${nbAlertesSante > 1 ? "s" : ""} signalent un problème`,
          detail: "Parmi les vingt dernières inspections enregistrées.",
          lien: { label: "Voir les inspections", href: "/pepiniere/sante" },
        }
      : null,
    nbSansEmplacement && nbSansEmplacement > 0
      ? {
          id: "sans-emplacement",
          ton: "warning" as const,
          titre: `${nbSansEmplacement} lot${nbSansEmplacement > 1 ? "s" : ""} sans emplacement`,
          detail: "Personne ne sait où les trouver sans ouvrir leur fiche.",
          lien: { label: "Les situer", href: "/pepiniere/lots?emplacement=aucun" },
        }
      : null,
  ].filter((a): a is Exclude<typeof a, null> => a !== null);

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        title="Pépinière"
        subtitle={
          nbLots
            ? `${formatCount(nbLots)} lot${nbLots > 1 ? "s" : ""} actifs, ${formatCount(stockRows.length)} espèce${stockRows.length > 1 ? "s" : ""}.`
            : "Le stock vivant, ses mouvements et ce qui demande votre attention."
        }
        action={
          <NewLotForm
            locations={(locations ?? []) as { id: string; code: string; name: string }[]}
            stages={(stages ?? []) as { id: string; code: string; label: string }[]}
          />
        }
      />

      {stockRows.length === 0 ? (
        /* §32 — un tableau de bord sans stock ne doit pas afficher cinq
           zéros : cinq zéros ressemblent à une panne de calcul. */
        <EmptyState
          icon={<Icon name="nursery" className="h-5 w-5" />}
          title="Aucune plante en stock pour le moment"
          description="Créez votre premier lot pour suivre ses quantités, ses déplacements et ce qu'il vous reste à vendre. Sa quantité entrera par un mouvement de réception, pour que son journal commence par son origine."
          action={
            <>
              <NewLotForm
                locations={(locations ?? []) as { id: string; code: string; name: string }[]}
                stages={(stages ?? []) as { id: string; code: string; label: string }[]}
              />
              <ButtonLink href="/pepiniere/emplacements" variant="secondary">
                Dessiner mes emplacements
              </ButtonLink>
            </>
          }
        />
      ) : (
        <>
          <section className="mb-8">
            {/* §1 — « grandes cartes KPI ». Le chiffre qu'on vient
                chercher se lit sans parcourir une seule ligne. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <MetricCard
                label="Plantes"
                value={formatCount(totaux.physique)}
                hint="Sur place, quarantaine comprise"
              />
              <MetricCard
                label="Disponible"
                value={formatCount(totaux.disponible)}
                hint="Vendable aujourd'hui"
                tone="accent"
              />
              <MetricCard
                label="Réservé"
                value={formatCount(totaux.reserve)}
                hint="Promis à un client"
              />
              <MetricCard
                label="Production"
                value={formatCount(totaux.production)}
                hint="Pas encore vendable"
              />
              <MetricCard
                label="Quarantaine"
                value={formatCount(totaux.quarantaine)}
                hint="Présent, interdit de vente"
              />
            </div>

            {/* « Attendu » n'est affiché que lorsqu'il existe : une carte
                à zéro se lirait « rien n'arrive », ce qui n'est pas la
                même chose que « aucune commande en cours ». */}
            {totaux.attendu > 0 && (
              <p className="mt-3 text-[var(--text-body)] text-ink-soft">
                Et {formatCount(totaux.attendu)} plantes attendues, commandées à un
                fournisseur et pas encore reçues.{" "}
                <Link href="/achats" className="text-accent hover:underline">
                  Voir les commandes d&apos;achat
                </Link>
              </p>
            )}
          </section>

          {/* §40 « alertes » — ce qui demande une décision aujourd'hui,
              avant tout le reste. */}
          <Panel
            title="À surveiller"
            description="Ce qui empêche de vendre, ou de retrouver une plante."
            className="mb-4"
          >
            {alertes.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-5 text-[var(--text-body)] text-ink-soft">
                <Icon name="check" className="h-4 w-4 text-positive" />
                Rien à signaler : aucun lot isolé, aucun lot sans emplacement.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {alertes.map((alerte) => (
                  <li
                    key={alerte.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[var(--text-body)] font-medium">
                        <StatusBadge tone={alerte.ton} dot>
                          {alerte.titre}
                        </StatusBadge>
                      </p>
                      <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
                        {alerte.detail}
                      </p>
                    </div>
                    <Link
                      href={alerte.lien.href}
                      className="shrink-0 text-[var(--text-secondary)] font-medium text-accent hover:underline"
                    >
                      {alerte.lien.label} →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            {/* §40 « mouvements » — le journal de la pépinière. Ce qui
                est entré, sorti, déplacé, réservé. */}
            <Panel
              title="Derniers mouvements"
              description="Le stock ne se corrige pas, il s'explique : chaque ligne est un mouvement enregistré."
            >
              {lignesMouvements.length === 0 ? (
                <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
                  Aucun mouvement enregistré. Ils apparaîtront ici dès la première réception,
                  depuis la fiche d&apos;un lot.
                </p>
              ) : (
                <div className="px-5 py-5">
                  <ActivityTimeline
                    items={lignesMouvements.map((m) => ({
                      id: m.id,
                      time: jourEtMois(m.occurred_at),
                      title: MOVEMENTS_WITHOUT_QUANTITY.includes(m.kind)
                        ? MOVEMENT_KIND_LABELS[m.kind]
                        : `${MOVEMENT_KIND_LABELS[m.kind]} · ${formatCount(m.quantity)}`,
                      detail: m.nursery_lots
                        ? `${m.nursery_lots.lot_code} — ${m.nursery_lots.species_name}`
                        : undefined,
                      href: m.nursery_lots ? `/pepiniere/lots/${m.nursery_lots.id}` : undefined,
                      tone: TON_MOUVEMENT[m.kind] ?? "neutral",
                    }))}
                  />
                </div>
              )}
            </Panel>

            {/* §40 « graphiques » — la forme du stock, espèce par espèce. */}
            <Panel
              title="Répartition par espèce"
              description="Les huit espèces les plus nombreuses, et la part qui en est vendable."
            >
              <RepartitionEspeces rows={stockRows} />
            </Panel>
          </div>

          {/* §40 « stock » — l'extrait, la liste complète est à côté. */}
          <Panel
            title="Stock vivant"
            description="Ne pas confondre stock physique et disponible à vendre."
            count={stockRows.length}
            action={
              <Link
                href="/pepiniere/stock"
                className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
              >
                Tout voir →
              </Link>
            }
            className="mb-4"
          >
            <div className="px-5 py-5">
              <StockTable rows={stockRows.slice(0, 6)} />
            </div>
          </Panel>

          <Panel
            title="Derniers lots créés"
            action={
              <Link
                href="/pepiniere/lots"
                className="text-[var(--text-secondary)] font-medium text-accent hover:underline"
              >
                Tous les lots →
              </Link>
            }
          >
            {lots.length === 0 ? (
              <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
                Aucun lot pour le moment.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {lots.map((lot) => (
                  <li key={lot.id}>
                    <Link
                      href={`/pepiniere/lots/${lot.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-canvas"
                    >
                      <span className="min-w-0">
                        <span className="tabular font-medium">{lot.lot_code}</span>
                        <span className="ml-2.5 text-[var(--text-body)] text-ink-soft">
                          {lot.species_name}
                          {lot.cultivar && (
                            <span className="text-ink-faint"> ‘{lot.cultivar}’</span>
                          )}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="tabular text-[var(--text-secondary)] text-ink-soft">
                          {formatCount(lot.current_quantity)}
                        </span>
                        <Badge tone={LOT_STATUS_TONE[lot.status]}>
                          {LOT_STATUS_LABELS[lot.status]}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

/**
 * Une date courte pour la colonne d'heure de la frise.
 *
 * La colonne fait quatorze caractères de large : « 12 août 2026 » y
 * passerait à la ligne, et la frise perdrait son alignement — or c'est
 * cette colonne-là que l'œil descend.
 */
function jourEtMois(valeur: string): string {
  return new Date(valeur).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}
