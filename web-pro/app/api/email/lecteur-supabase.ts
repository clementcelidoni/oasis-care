import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FaitDevis, FaitFacture, LecteurEmail, RangsDejaEnvoyes, ReglagesRelances,
} from "./lecteur.ts";
import { reglagesParDefaut } from "./lecteur.ts";

/**
 * §EMAILS — LE LECTEUR, BRANCHÉ SUR SUPABASE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA SESSION DE L'UTILISATEUR, ET RIEN D'AUTRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Ce module lit avec le client ordinaire — celui qui porte les cookies
 * de la personne connectée — et donc SOUS RLS. C'est délibéré : le
 * cloisonnement entre entreprises n'est pas assuré par les `eq()`
 * qu'on écrit ici, il est assuré par la base. Les filtres
 * `organization_id` qui suivent servent à ne pas rapatrier ce dont on
 * n'a pas besoin, pas à protéger quoi que ce soit.
 *
 * `web-pro` ne détient AUCUNE clé de service, et `.env.example`
 * l'interdit explicitement. C'est aussi pour cette raison que la mise
 * en file n'est pas ici : `email_enqueue` n'est exécutable que par
 * `service_role` (0084 § 15.c). Voir `port.ts`.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES TABLES DE 0084 PEUVENT NE PAS EXISTER, ET C'EST PRÉVU
 * ══════════════════════════════════════════════════════════════════
 *
 * La production tourne aujourd'hui sur la migration 0080. Tant que 0084
 * n'est pas appliquée, `email_organization_settings` et `email_messages`
 * n'existent pas, et PostgREST rend une erreur. Aucune de ces erreurs ne
 * doit remonter jusqu'à une facture qu'on émet : elles retombent sur le
 * réglage par défaut (relances éteintes) et sur « aucun rang connu ».
 *
 * Le second repli mérite un mot, parce qu'il a l'air imprudent : ne
 * connaître aucun rang laisserait croire que rien n'est parti et
 * pourrait faire renvoyer un message. Il ne le peut pas — la garantie
 * d'idempotence est la CONTRAINTE D'UNICITÉ sur la colonne générée
 * `idempotency_key`, jamais cette lecture. Et si la table n'existe pas,
 * il n'y a de toute façon pas de chemin d'envoi.
 */

const COLONNES_DEVIS =
  "id, organization_id, customer_id, number, title, status, sent_at, decided_at, valid_until, archived_at";

const COLONNES_FACTURE =
  "id, organization_id, customer_id, number, status, issued_at, due_on, archived_at";

type LigneDevis = {
  id: string;
  organization_id: string;
  customer_id: string;
  number: string;
  title: string | null;
  status: string;
  sent_at: string | null;
  decided_at: string | null;
  valid_until: string | null;
  archived_at: string | null;
};

type LigneFacture = {
  id: string;
  organization_id: string;
  customer_id: string;
  number: string | null;
  status: string;
  issued_at: string | null;
  due_on: string | null;
  archived_at: string | null;
};

/**
 * Les totaux vivent dans des VUES (`quote_totals`, `invoice_balance`),
 * pas dans les tables : PostgREST ne sait pas les imbriquer faute de
 * clé étrangère. D'où une seconde requête, en lot, plutôt qu'une par
 * ligne — trente devis ne doivent pas faire trente et un allers-retours.
 */
async function totauxDevis(
  supabase: SupabaseClient, ids: string[],
): Promise<Map<string, number | null>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("quote_totals")
    .select("quote_id, total_including_vat_cents")
    .in("quote_id", ids);
  const table = new Map<string, number | null>();
  for (const ligne of (data ?? []) as { quote_id: string; total_including_vat_cents: number | null }[]) {
    table.set(ligne.quote_id, ligne.total_including_vat_cents ?? null);
  }
  return table;
}

async function soldesFactures(
  supabase: SupabaseClient, ids: string[],
): Promise<Map<string, { total: number | null; reste: number | null }>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("invoice_balance")
    .select("invoice_id, total_including_vat_cents, outstanding_cents")
    .in("invoice_id", ids);
  const table = new Map<string, { total: number | null; reste: number | null }>();
  for (const ligne of (data ?? []) as {
    invoice_id: string; total_including_vat_cents: number | null; outstanding_cents: number | null;
  }[]) {
    // `?? null` et jamais `?? 0` : un total inconnu doit rester inconnu.
    // Un zéro par défaut ferait partir un devis à 0,00 €, ou empêcherait
    // la relance d'une facture réellement impayée — deux erreurs
    // silencieuses qui ont l'air de montants.
    table.set(ligne.invoice_id, {
      total: ligne.total_including_vat_cents ?? null,
      reste: ligne.outstanding_cents ?? null,
    });
  }
  return table;
}

function versFaitDevis(ligne: LigneDevis, total: number | null): FaitDevis {
  return {
    id: ligne.id,
    organizationId: ligne.organization_id,
    customerId: ligne.customer_id,
    numero: ligne.number,
    titre: ligne.title ?? "",
    envoyeLe: ligne.sent_at,
    decideLe: ligne.decided_at,
    valableJusquau: ligne.valid_until,
    archiveLe: ligne.archived_at,
    statut: ligne.status,
    totalTtcCents: total,
  };
}

function versFaitFacture(
  ligne: LigneFacture, solde: { total: number | null; reste: number | null } | undefined,
): FaitFacture {
  return {
    id: ligne.id,
    organizationId: ligne.organization_id,
    customerId: ligne.customer_id,
    numero: ligne.number,
    emiseLe: ligne.issued_at,
    echeanceLe: ligne.due_on,
    archiveLe: ligne.archived_at,
    statut: ligne.status,
    totalTtcCents: solde?.total ?? null,
    resteDuCents: solde?.reste ?? null,
  };
}

export class LecteurSupabase implements LecteurEmail {
  readonly #supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.#supabase = supabase;
  }

  async lireDevis(quoteId: string): Promise<FaitDevis | null> {
    const { data } = await this.#supabase
      .from("quotes").select(COLONNES_DEVIS).eq("id", quoteId).maybeSingle();
    if (!data) return null;
    const ligne = data as LigneDevis;
    const totaux = await totauxDevis(this.#supabase, [ligne.id]);
    return versFaitDevis(ligne, totaux.get(ligne.id) ?? null);
  }

  async lireFacture(invoiceId: string): Promise<FaitFacture | null> {
    const { data } = await this.#supabase
      .from("invoices").select(COLONNES_FACTURE).eq("id", invoiceId).maybeSingle();
    if (!data) return null;
    const ligne = data as LigneFacture;
    const soldes = await soldesFactures(this.#supabase, [ligne.id]);
    return versFaitFacture(ligne, soldes.get(ligne.id));
  }

  async lireReglages(organizationId: string): Promise<ReglagesRelances> {
    const { data, error } = await this.#supabase
      .from("email_organization_settings")
      .select("organization_id, reminders_enabled, reminder_delay_days, reminder_max, suspended_at, suspended_reason")
      .eq("organization_id", organizationId)
      .maybeSingle();

    // Table absente (0084 pas encore appliquée) OU aucune ligne : dans
    // les deux cas, le défaut de la colonne, c'est-à-dire relances
    // ÉTEINTES. Se tromper dans ce sens ne fait de mal à personne.
    if (error || !data) return reglagesParDefaut(organizationId);

    const ligne = data as {
      reminders_enabled: boolean;
      reminder_delay_days: number;
      reminder_max: number;
      suspended_at: string | null;
      suspended_reason: string | null;
    };
    return {
      organizationId,
      actives: ligne.reminders_enabled === true,
      delaiJours: ligne.reminder_delay_days,
      nombreMaximum: ligne.reminder_max,
      suspendueLe: ligne.suspended_at,
      motifSuspension: ligne.suspended_reason,
    };
  }

  async listerDevisRelancables(organizationId: string): Promise<FaitDevis[]> {
    const { data } = await this.#supabase
      .from("quotes")
      .select(COLONNES_DEVIS)
      .eq("organization_id", organizationId)
      .in("status", ["sent", "viewed"])
      .is("decided_at", null)
      .is("archived_at", null)
      .not("sent_at", "is", null)
      // Une entreprise qui aurait dix mille devis ouverts n'existe pas ;
      // le plafond est là pour qu'un passage de relances reste borné en
      // mémoire et en temps, pas pour filtrer.
      .limit(1000);

    const lignes = (data ?? []) as LigneDevis[];
    const totaux = await totauxDevis(this.#supabase, lignes.map((l) => l.id));
    return lignes.map((l) => versFaitDevis(l, totaux.get(l.id) ?? null));
  }

  async listerFacturesRelancables(organizationId: string): Promise<FaitFacture[]> {
    const { data } = await this.#supabase
      .from("invoices")
      .select(COLONNES_FACTURE)
      .eq("organization_id", organizationId)
      // On lit `due_on` — jamais le seul statut « overdue », que
      // `refresh_overdue_invoices` ne pose que si quelqu'un ouvre
      // l'écran. Ces trois états décrivent une facture vivante ; le
      // retard se juge sur la date, plus bas, dans `relances.ts`.
      .in("status", ["issued", "partiallyPaid", "overdue"])
      .is("archived_at", null)
      .not("issued_at", "is", null)
      .not("due_on", "is", null)
      .limit(1000);

    const lignes = (data ?? []) as LigneFacture[];
    const soldes = await soldesFactures(this.#supabase, lignes.map((l) => l.id));
    return lignes.map((l) => versFaitFacture(l, soldes.get(l.id)));
  }

  async lireRangsEnvoyes(
    typeObjet: "quote" | "invoice", objetIds: string[], gabarit: string,
  ): Promise<RangsDejaEnvoyes[]> {
    if (objetIds.length === 0) return [];

    const { data, error } = await this.#supabase
      .from("email_messages")
      .select("entity_id, occurrence")
      .eq("entity_type", typeObjet)
      .eq("template_key", gabarit)
      // ON NE COMPTE QUE CE QUI EST RÉELLEMENT PARTI, OU EN TRAIN DE
      // PARTIR. Sans ce filtre, un rang en échec définitif ou annulé
      // comptait comme « déjà envoyé » : la relance perdue devenait une
      // relance ANNULÉE, et le rang suivant sautait le sien. Le
      // paysagiste n'avait aucun moyen de s'en apercevoir.
      //
      // Cela ne relâche PAS l'idempotence : la garantie est la
      // contrainte d'unicité en base, qui refusera de recréer une ligne
      // pour le même rang. Ce qu'on obtient, c'est de ne pas SAUTER un
      // rang — et si la base refuse, le résultat est « déjà parti »,
      // qui n'expédie rien.
      //
      // « queued » EN FAIT PARTIE : ce message-là va partir, il attend
      // seulement son tour. Le recompter comme à envoyer ferait
      // travailler la couche pour se faire refuser par la contrainte.
      .in("status", [
        "queued", "sending", "sent", "deferred", "delivered",
        "bounced", "complained", "blocked",
      ])
      .in("entity_id", objetIds);

    if (error || !data) return [];

    const parId = new Map<string, number[]>();
    for (const ligne of data as { entity_id: string; occurrence: number }[]) {
      const rangs = parId.get(ligne.entity_id) ?? [];
      rangs.push(ligne.occurrence);
      parId.set(ligne.entity_id, rangs);
    }
    return [...parId.entries()].map(([objetId, rangs]) => ({ typeObjet, objetId, gabarit, rangs }));
  }
}
