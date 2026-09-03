import type { createClient } from "@/lib/supabase/server";
import { connu, inconnu, type PeutEtreInconnu } from "./types.ts";

/**
 * §11V — les taux du calcul de déplacement, pris dans les tables
 * existantes et nulle part ailleurs.
 *
 * « Le coût véhicule et le coût horaire viennent des tables existantes
 * (matériel 0067, employees) ; quand une donnée manque, la sortie le
 * dit au lieu de prendre zéro. »
 *
 * CE QUE LA BASE NE CONTIENT PAS, ET QU'ON N'INVENTE DONC PAS : il
 * n'existe aujourd'hui AUCUN barème kilométrique dans le schéma — ni
 * colonne sur l'entreprise, ni sur le matériel, ni table de frais. Le
 * coût véhicule ne peut donc être que DÉDUIT D'UNE OBSERVATION, et
 * l'observation disponible est partielle. Elle est rendue avec ses
 * limites écrites plutôt que complétée au jugé.
 */

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * LE COÛT HORAIRE : LA MÉDIANE, PAS LA MOYENNE.
 *
 * Une moyenne se laisse tirer par le salaire du patron s'il figure
 * parmi les salariés — cas courant en TPE, où il est aussi le mieux
 * payé et le moins souvent sur la route. La médiane décrit mieux « la
 * personne qui monte dans la camionnette ».
 *
 * Un coût horaire à zéro n'est pas un coût : c'est une fiche non
 * remplie. On l'exclut du calcul au lieu de le laisser tirer la
 * médiane vers le bas.
 */
export async function tauxHoraireMedianCents(
  supabase: Client,
  organizationId: string,
): Promise<PeutEtreInconnu<number>> {
  const { data, error } = await supabase
    .from("employees")
    .select("hourly_cost_cents")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .gt("hourly_cost_cents", 0)
    .order("hourly_cost_cents", { ascending: true });

  if (error) {
    return inconnu(
      "lectureImpossible",
      "Les coûts horaires des salariés n'ont pas pu être lus : votre rôle ne donne peut-être pas accès aux fiches du personnel.",
    );
  }

  const couts = (data ?? [])
    .map((ligne) => ligne.hourly_cost_cents as number | null)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0);

  if (couts.length === 0) {
    return inconnu(
      "aucunCoutHoraireSaisi",
      "Aucun salarié n'a de coût horaire renseigné : le temps de déplacement ne peut pas être valorisé en euros. Renseignez les fiches du personnel.",
    );
  }

  const milieu = Math.floor(couts.length / 2);
  const mediane =
    couts.length % 2 === 1
      ? couts[milieu]
      : Math.round((couts[milieu - 1] + couts[milieu]) / 2);

  return connu(
    mediane,
    `coût horaire médian de ${couts.length} salarié(s)`,
  );
}

/** Le kilométrage minimal en dessous duquel une observation ne dit rien. */
const KM_MINIMUM_OBSERVES = 1000;

/**
 * LE COÛT VÉHICULE AU KILOMÈTRE, DÉDUIT DES RELEVÉS DE COMPTEUR.
 *
 * `equipment` porte un `meter_kind` et `equipment_maintenance` porte un
 * `meter_reading` : entre le premier et le dernier relevé d'un véhicule,
 * on connaît des kilomètres parcourus ET des dépenses d'entretien
 * engagées. Le rapport des deux est un coût par kilomètre RÉELLEMENT
 * OBSERVÉ chez cette entreprise, ce qui vaut mieux qu'un barème
 * fiscal recopié.
 *
 * CE QU'IL NE CONTIENT PAS, et c'est considérable : ni carburant, ni
 * assurance, ni amortissement — rien de tout cela n'est rattaché à un
 * véhicule dans le schéma. Le chiffre rendu est donc un PLANCHER, et il
 * le dit dans sa source. L'écran laisse saisir un coût kilométrique
 * réel, qui prend alors le pas sur cette déduction.
 *
 * DEUX GARDE-FOUS. Le coût du premier entretien est exclu : il a été
 * engagé sur des kilomètres antérieurs à la fenêtre d'observation, et
 * l'inclure gonflerait le taux d'autant. Et sous mille kilomètres
 * observés, on refuse de conclure : deux vidanges à trois semaines
 * d'intervalle produiraient un coût au kilomètre grotesque.
 */
export async function coutVehiculeParKmCents(
  supabase: Client,
  organizationId: string,
): Promise<PeutEtreInconnu<number>> {
  const { data: vehicules, error: erreurVehicules } = await supabase
    .from("equipment")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("category", "vehicle")
    .eq("meter_kind", "kilometers")
    .is("archived_at", null)
    .neq("status", "retired");

  if (erreurVehicules) {
    return inconnu(
      "lectureImpossible",
      "Le parc de véhicules n'a pas pu être lu : votre rôle ne donne peut-être pas accès au matériel.",
    );
  }

  const identifiants = (vehicules ?? []).map((v) => v.id as string);
  if (identifiants.length === 0) {
    return inconnu(
      "aucunVehiculeAuCompteurKilometrique",
      "Aucun véhicule du parc n'a de compteur kilométrique : le coût au kilomètre ne peut pas être observé. Saisissez-le à la main ci-dessous.",
    );
  }

  const { data: entretiens, error: erreurEntretiens } = await supabase
    .from("equipment_maintenance")
    .select("equipment_id, cost_cents, meter_reading")
    .eq("organization_id", organizationId)
    .in("equipment_id", identifiants)
    .not("meter_reading", "is", null)
    .order("meter_reading", { ascending: true });

  if (erreurEntretiens) {
    return inconnu(
      "lectureImpossible",
      "L'historique d'entretien n'a pas pu être lu : votre rôle ne donne peut-être pas accès au matériel.",
    );
  }

  let kmObserves = 0;
  let coutObserveCents = 0;
  let vehiculesRetenus = 0;

  for (const identifiant of identifiants) {
    const releves = (entretiens ?? [])
      .filter((e) => e.equipment_id === identifiant)
      .map((e) => ({
        km: e.meter_reading as number | null,
        coutCents: e.cost_cents as number | null,
      }))
      .filter((e): e is { km: number; coutCents: number | null } => typeof e.km === "number")
      .sort((a, b) => a.km - b.km);

    if (releves.length < 2) continue;

    const km = releves[releves.length - 1].km - releves[0].km;
    if (km <= 0) continue;

    // Le premier relevé sert de borne, pas de dépense : son coût a été
    // engagé avant la fenêtre.
    const cout = releves
      .slice(1)
      .reduce((somme, r) => somme + (typeof r.coutCents === "number" ? r.coutCents : 0), 0);

    kmObserves += km;
    coutObserveCents += cout;
    vehiculesRetenus += 1;
  }

  if (vehiculesRetenus === 0) {
    return inconnu(
      "relevesInsuffisants",
      "Aucun véhicule n'a deux relevés de compteur : sans deux points, aucun kilométrage n'est observable. Saisissez le coût kilométrique à la main ci-dessous.",
    );
  }

  if (kmObserves < KM_MINIMUM_OBSERVES) {
    return inconnu(
      "kilometrageObserveTropFaible",
      `Seuls ${Math.round(kmObserves)} km sont observés sur le parc, sous le seuil de ${KM_MINIMUM_OBSERVES} km : un coût au kilomètre calculé là-dessus n'aurait aucune valeur.`,
    );
  }

  return connu(
    Math.round(coutObserveCents / kmObserves),
    `entretien observé sur ${Math.round(kmObserves)} km et ${vehiculesRetenus} véhicule(s) — hors carburant, assurance et amortissement`,
  );
}

const UNITES_HORAIRES = new Set(["h", "hr", "heure", "heures", "hh"]);

const FAMILLES_PAR_TYPE_ARTICLE: Record<string, string> = {
  plant: "plant",
  material: "material",
  labor: "labor",
  equipment: "equipment",
  transport: "transport",
  waste: "waste",
  subcontracting: "subcontracting",
  rental: "equipment",
  service: "other",
  custom: "other",
};

/**
 * La famille de coût d'une ligne, dans les mêmes termes que
 * `ai_cost_family` (migration 0073) : le `cost_kind` s'il est saisi,
 * sinon le type d'article du catalogue.
 *
 * POURQUOI RECOPIER UNE FONCTION SQL ICI. Parce que 0072 et 0073 ne
 * sont pas encore appliquées, et qu'un panneau qui ne dirait rien tant
 * qu'une migration n'est pas passée ne serait pas testable. La
 * duplication est assumée et bornée à ces onze lignes ; si les deux
 * divergent un jour, c'est la fonction SQL qui fait foi.
 */
function familleDeCout(costKind: string | null, itemType: string | null): string {
  if (costKind !== null && costKind !== "") return costKind;
  if (itemType === null) return "nonClasse";
  return FAMILLES_PAR_TYPE_ARTICLE[itemType] ?? "nonClasse";
}

export type DeplacementDevise = {
  heures: PeutEtreInconnu<number>;
  /** Le montant HT déjà facturé au titre du transport, quelle que soit l'unité. */
  montantHtCents: number;
  nombreDeLignes: number;
};

/**
 * CE QUE LE DEVIS CHIFFRE DÉJÀ EN DÉPLACEMENT.
 *
 * On ne retient que les lignes de famille « transport » exprimées en
 * HEURES : c'est la seule unité comparable à des heures humaines de
 * déplacement. Un forfait « transport, 1 unité, 250 € » chiffre bien un
 * déplacement, mais pas un temps — le compter pour une heure serait
 * inventer.
 *
 * ZÉRO LIGNE DE TRANSPORT = ZÉRO HEURE CHIFFRÉE, et c'est un fait
 * observé, pas une donnée manquante : le devis ne facture aucun
 * déplacement. L'écran ajoute la nuance qui compte — le déplacement
 * peut être noyé dans le prix de la main-d'œuvre — mais il ne peut pas
 * la deviner à la place de l'utilisateur.
 */
export async function deplacementDeviseEnHeures(
  supabase: Client,
  organizationId: string,
  quoteId: string,
): Promise<DeplacementDevise> {
  const { data, error } = await supabase
    .from("quote_lines")
    .select("quantity, unit, cost_kind, sale_total_cents, catalog_items ( item_type )")
    .eq("organization_id", organizationId)
    .eq("quote_id", quoteId);

  if (error) {
    return {
      heures: inconnu(
        "lectureImpossible",
        "Les lignes du devis n'ont pas pu être relues pour y chercher le déplacement.",
      ),
      montantHtCents: 0,
      nombreDeLignes: 0,
    };
  }

  // PostgREST type la relation vers le catalogue comme un tableau, alors
  // qu'elle est « vers un ». On accepte les deux formes plutôt que de
  // caster : un cast qui ment ferait passer toutes les lignes pour
  // « nonClasse » sans le moindre message.
  const lignes = (data ?? []).map((brut) => {
    const ligne = brut as Record<string, unknown>;
    const catalogue = Array.isArray(ligne.catalog_items) ? ligne.catalog_items[0] : ligne.catalog_items;
    const itemType =
      typeof catalogue === "object" && catalogue !== null
        ? ((catalogue as { item_type?: unknown }).item_type ?? null)
        : null;
    return {
      quantity: typeof ligne.quantity === "number" ? ligne.quantity : null,
      unit: typeof ligne.unit === "string" ? ligne.unit : null,
      costKind: typeof ligne.cost_kind === "string" ? ligne.cost_kind : null,
      saleTotalCents: typeof ligne.sale_total_cents === "number" ? ligne.sale_total_cents : null,
      itemType: typeof itemType === "string" ? itemType : null,
    };
  });

  const transport = lignes.filter((l) => familleDeCout(l.costKind, l.itemType) === "transport");

  const montantHtCents = transport.reduce((somme, l) => somme + (l.saleTotalCents ?? 0), 0);

  const enHeures = transport.filter((l) =>
    UNITES_HORAIRES.has((l.unit ?? "").trim().toLowerCase()),
  );

  if (transport.length > 0 && enHeures.length === 0) {
    return {
      heures: inconnu(
        "transportNonExprimeEnHeures",
        `Le devis chiffre ${transport.length} ligne(s) de transport, mais aucune en heures : impossible de les comparer à un temps de déplacement.`,
      ),
      montantHtCents,
      nombreDeLignes: transport.length,
    };
  }

  const heures = enHeures.reduce((somme, l) => somme + (l.quantity ?? 0), 0);

  return {
    heures: connu(
      heures,
      transport.length === 0
        ? "aucune ligne de transport dans le devis"
        : `${enHeures.length} ligne(s) de transport exprimée(s) en heures`,
    ),
    montantHtCents,
    nombreDeLignes: transport.length,
  };
}
