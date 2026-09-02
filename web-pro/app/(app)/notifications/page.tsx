import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import {
  PageHeader,
  Card,
  Badge,
  StatusBadge,
  ButtonLink,
  SubmitButton,
  EmptyState,
  FilterBar,
  type Tone,
} from "@/components/ui";
import { Icon, type IconName } from "@/components/shell/Icon";
import { markNotificationRead, markAllNotificationsRead } from "@/lib/notifications/actions";

/**
 * §41 NOTIFICATIONS — « Créer centre notifications ».
 *
 * « Devis Martin accepté · Stock faible Pittosporum C5 · Facture #1045
 * échue · Équipe B intervention terminée. »
 *
 * Cet écran LIT. Rien, dans cette phase, ne crée encore de notification :
 * aucun devis accepté, aucun stock bas, aucune facture échue n'écrit dans
 * `notifications`. La liste sera donc vide chez tout le monde, et l'état
 * vide le dit franchement plutôt que de laisser croire à une panne — c'est
 * aussi pour ça qu'on n'y met aucune ligne de démonstration : une fausse
 * alerte de stock ferait descendre quelqu'un à la pépinière pour rien.
 *
 * §1 PHILOSOPHIE UX : « moins d'informations simultanément ». D'où des
 * cartes groupées par jour plutôt qu'un tableau de quatre colonnes — on
 * lit ses notifications comme une boîte de réception, pas comme un export
 * comptable.
 */

/**
 * Le fuseau dans lequel « aujourd'hui » veut dire quelque chose.
 *
 * Le serveur tourne en UTC : sans ce fuseau, une notification écrite à
 * 23 h 30 à Nice s'afficherait sous « demain », et la première section de
 * la page porterait une date que personne n'a vécue.
 */
const TIMEZONE = "Europe/Paris";

/**
 * Combien de notifications la page charge d'un coup.
 *
 * Assez pour couvrir plusieurs semaines d'activité réelle, assez peu pour
 * que la page reste une page. Au-delà, un pied de liste le dit plutôt que
 * de faire disparaître le reste en silence.
 */
const PAGE_LIMIT = 100;

type NotificationKind = "info" | "success" | "warning" | "critical";

type NotificationRow = {
  id: string;
  kind: NotificationKind;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  created_at: string;
  /**
   * MES lectures, et rien d'autre. La RLS de `notification_reads` ne
   * renvoie que les lignes de `auth.uid()` : un tableau vide veut donc
   * dire « je ne l'ai pas lue », jamais « personne ne l'a lue ».
   */
  notification_reads: { read_at: string }[];
};

const KIND_TONE: Record<NotificationKind, Tone> = {
  info: "info",
  success: "positive",
  warning: "warning",
  critical: "critical",
};

/**
 * §47 ACCESSIBILITÉ — la gravité ne peut pas tenir dans une couleur.
 *
 * Le mot double la teinte. `info` n'en a pas : la plupart des
 * notifications sont informatives, et étiqueter « Information » cent fois
 * de suite n'apprend rien à personne.
 */
const KIND_LABEL: Record<NotificationKind, string | null> = {
  info: null,
  success: "Réussi",
  warning: "Vigilance",
  critical: "Urgent",
};

/**
 * Le jeu d'icônes n'a pas de triangle d'alerte, et on n'en ajoute pas un
 * pour quatre pastilles. L'icône est de toute façon décorative
 * (`aria-hidden`) : c'est l'étiquette ci-dessus qui porte le sens.
 */
const KIND_ICON: Record<NotificationKind, IconName> = {
  info: "bell",
  success: "check",
  warning: "help",
  critical: "close",
};

const KIND_WASH: Record<NotificationKind, string> = {
  info: "bg-info-wash text-info",
  success: "bg-positive-wash text-positive",
  warning: "bg-warning-wash text-warning",
  critical: "bg-critical-wash text-critical",
};

/** `AAAA-MM-JJ` dans le fuseau de l'entreprise — comparable avec `===`. */
function dayKey(date: Date): string {
  // `fr-CA` produit l'ordre ISO. C'est un détournement assumé : c'est le
  // seul format de `toLocaleDateString` qui se compare directement sans
  // reconstruire une date à la main.
  return date.toLocaleDateString("fr-CA", { timeZone: TIMEZONE });
}

function dayLabel(date: Date, todayKey: string, yesterdayKey: string): string {
  const key = dayKey(date);
  if (key === todayKey) return "Aujourd'hui";
  if (key === yesterdayKey) return "Hier";
  return date.toLocaleDateString("fr-FR", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    // L'année seulement quand elle change : « lundi 3 mars » se lit mieux
    // que « lundi 3 mars 2026 » quand on est en 2026. Les deux années se
    // lisent dans les clés, donc dans le même fuseau que l'affichage —
    // `getFullYear()` répondrait selon le fuseau du serveur, et se
    // tromperait le 31 décembre au soir.
    year: key.slice(0, 4) === todayKey.slice(0, 4) ? undefined : "numeric",
  });
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString("fr-FR", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const params = await searchParams;
  const unreadOnly = params.filtre === "non-lues";

  const supabase = await createClient();
  const [{ data, count }, { data: unreadCount }] = await Promise.all([
    supabase
      .from("notifications")
      .select(
        "id, kind, category, title, body, href, created_at, notification_reads ( read_at )",
        { count: "exact" },
      )
      // La RLS filtre déjà sur l'appartenance et sur le destinataire
      // (`user_id is null or user_id = auth.uid()`). L'égalité ci-dessous
      // n'est pas une sécurité, c'est le choix de l'entreprise ACTIVE : un
      // compte qui travaille pour deux sociétés ne doit pas voir les
      // alertes de l'une pendant qu'il consulte l'autre.
      .eq("organization_id", organization.organizationId)
      .order("created_at", { ascending: false })
      .limit(PAGE_LIMIT),
    // Le même compteur que la pastille du header, pour que les deux
    // chiffres ne se contredisent jamais.
    supabase.rpc("unread_notification_count", {
      p_organization_id: organization.organizationId,
    }),
  ]);

  const all = (data ?? []) as unknown as NotificationRow[];
  const total = count ?? all.length;
  const unread = (unreadCount as number | null) ?? 0;

  // Le filtre se fait ici et pas en base : PostgREST ne sait pas exprimer
  // « la relation imbriquée est vide » dans un `where`.
  const rows = unreadOnly ? all.filter((row) => row.notification_reads.length === 0) : all;

  const now = new Date();
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(new Date(now.getTime() - 24 * 3600 * 1000));

  // Groupement par jour. Les lignes arrivent déjà triées du plus récent au
  // plus ancien : les parcourir dans l'ordre suffit à former les sections,
  // sans retrier quoi que ce soit.
  const groups: { key: string; label: string; items: NotificationRow[] }[] = [];
  for (const row of rows) {
    const date = new Date(row.created_at);
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(row);
    } else {
      groups.push({ key, label: dayLabel(date, todayKey, yesterdayKey), items: [row] });
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title="Notifications"
        subtitle="Ce que l'entreprise doit savoir : devis acceptés, stocks bas, factures échues, interventions terminées."
        action={
          unread > 0 ? (
            <form action={markAllNotificationsRead}>
              <SubmitButton variant="secondary">Tout marquer comme lu</SubmitButton>
            </form>
          ) : undefined
        }
      />

      <FilterBar
        label="Filtrer les notifications"
        current={unreadOnly ? "/notifications?filtre=non-lues" : "/notifications"}
        filters={[
          { label: "Toutes", href: "/notifications", count: total },
          { label: "Non lues", href: "/notifications?filtre=non-lues", count: unread },
        ]}
      />

      {groups.length === 0 ? (
        <NotificationsEmpty total={total} unread={unread} unreadOnly={unreadOnly} />
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="eyebrow mb-2.5">{group.label}</h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {group.items.map((row) => (
                    <NotificationItem key={row.id} row={row} />
                  ))}
                </ul>
              </Card>
            </section>
          ))}

          {total > all.length && (
            /* Honnêteté sur ce qui n'est pas affiché : le compteur du
               filtre vient de la base, la liste s'arrête à cent. Sans
               cette phrase, l'écart entre les deux ressemblerait à un
               défaut. */
            <p className="text-[var(--text-secondary)] text-ink-faint">
              Les {PAGE_LIMIT} notifications les plus récentes sont affichées, sur {total}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * §32 EMPTY STATES — « Créer de vrais empty states », pas « No data ».
 *
 * Trois situations que l'on aurait tort de confondre : le produit n'émet
 * pas encore d'alerte, tout est acquitté, ou il reste des non-lues mais
 * elles sont plus vieilles que la fenêtre chargée. Un seul message pour
 * les trois mentirait dans deux cas sur trois.
 */
function NotificationsEmpty({
  total,
  unread,
  unreadOnly,
}: {
  total: number;
  unread: number;
  unreadOnly: boolean;
}) {
  // Rien en base. Ce n'est pas une panne, c'est que rien n'écrit encore
  // dans `notifications` — et le dire évite un appel au support.
  if (total === 0) {
    return (
      <EmptyState
        icon={<Icon name="bell" />}
        title="Aucune notification pour le moment"
        description="Vous serez prévenu ici quand un devis sera accepté, qu'un stock passera sous son seuil, qu'une facture arrivera à échéance ou qu'une équipe terminera son intervention. Aucune de ces alertes n'est encore émise automatiquement : d'ici là, cette liste reste vide."
        action={
          <ButtonLink href="/" variant="secondary">
            Retour au tableau de bord
          </ButtonLink>
        }
      />
    );
  }

  // Le compteur vient de la base, la liste s'arrête à cent : il reste des
  // non-lues, mais plus anciennes que ce qui a été chargé. Afficher
  // « Tout est lu » à côté d'une pastille qui dit le contraire serait la
  // seule chose pire que ce paragraphe.
  if (unreadOnly && unread > 0) {
    return (
      <EmptyState
        icon={<Icon name="bell" />}
        title={`${unread} non ${unread > 1 ? "lues" : "lue"}, hors de cette page`}
        description={`Les notifications non lues qui restent sont plus anciennes que les ${PAGE_LIMIT} dernières. « Tout marquer comme lu » les acquitte toutes.`}
        action={
          <ButtonLink href="/notifications" variant="secondary">
            Voir toutes les notifications
          </ButtonLink>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<Icon name="check" />}
      title="Tout est lu"
      description="Vous n'avez aucune notification en attente. Les précédentes restent consultables."
      action={
        <ButtonLink href="/notifications" variant="secondary">
          Voir toutes les notifications
        </ButtonLink>
      }
    />
  );
}

/**
 * Une notification.
 *
 * §47 : le « non lu » ne peut pas reposer sur la seule couleur. Il se dit
 * ici de trois façons — un liseré à gauche, un titre en gras, et le mot
 * « Non lue » écrit. Chacune survit seule : en niveaux de gris, à
 * l'impression, ou au lecteur d'écran.
 */
function NotificationItem({ row }: { row: NotificationRow }) {
  const unread = row.notification_reads.length === 0;
  const date = new Date(row.created_at);
  const kindLabel = KIND_LABEL[row.kind];

  // §41 : `href` est un chemin interne, et la base l'impose déjà par une
  // contrainte. On revérifie avant de fabriquer le lien — une valeur
  // stockée ne devrait jamais pouvoir envoyer quelqu'un hors du produit.
  const href = row.href && row.href.startsWith("/") ? row.href : null;

  return (
    <li
      className={`flex gap-4 border-l-[3px] px-5 py-4 ${
        unread ? "border-l-accent bg-accent-wash/25" : "border-l-transparent"
      }`}
    >
      <span
        className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] ${KIND_WASH[row.kind]}`}
      >
        <Icon name={KIND_ICON[row.kind]} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <p className={`min-w-0 text-[var(--text-body)] ${unread ? "font-semibold" : ""}`}>
            {row.title}
          </p>
          {unread && <StatusBadge tone="accent">Non lue</StatusBadge>}
          {kindLabel && <Badge tone={KIND_TONE[row.kind]}>{kindLabel}</Badge>}
          {/* La catégorie telle qu'elle est en base. Pas de table de
              correspondance : aucune notification n'existe encore, donc
              aucune catégorie réelle non plus, et traduire des valeurs
              qu'on aurait imaginées reviendrait à les inventer. */}
          {row.category !== "general" && <Badge>{row.category}</Badge>}

          <time
            dateTime={row.created_at}
            className="tabular ml-auto shrink-0 text-[var(--text-secondary)] text-ink-faint"
          >
            {timeLabel(date)}
          </time>
        </div>

        {row.body && <p className="mt-1 text-[var(--text-body)] text-ink-soft">{row.body}</p>}

        {(href || unread) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {href && (
              <Link
                href={href}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-1.5 text-[var(--text-secondary)] font-medium text-ink transition-colors hover:bg-canvas"
              >
                Ouvrir
                <Icon name="chevron" className="h-3.5 w-3.5" />
              </Link>
            )}
            {unread && (
              /* Un formulaire par ligne : acquitter une notification ne
                 doit pas dépendre du JavaScript de la page, et le rendu
                 qui suit rafraîchit aussi la pastille du header. */
              <form action={markNotificationRead}>
                <input type="hidden" name="notification_id" value={row.id} />
                <button
                  type="submit"
                  className="rounded-[var(--radius-control)] px-3 py-1.5 text-[var(--text-secondary)] font-medium text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
                >
                  Marquer comme lue
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
