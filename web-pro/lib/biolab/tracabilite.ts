import { echecDeLecture, type Lecture } from "./cultures.ts";
import { nomDePlante, type Acclimatation, type FicheLot, type PlanteMere } from "./lots.ts";

/**
 * §27 TRAÇABILITÉ TRANSVERSALE — LA CHAÎNE, ET LÀ OÙ ELLE SE ROMPT.
 *
 * Le §27 demande une continuité complète :
 *
 *     plante mère → BioLab → lot → multiplication → acclimatation
 *       → Nursery → stock → vente → jardin client → suivi de la plante
 *
 * Ce fichier ne fabrique AUCUN des maillons manquants. Il affiche la
 * chaîne jusqu'où elle va, et il dit où elle s'arrête. Une chaîne qui
 * se prétend complète alors qu'elle ne l'est pas est pire qu'une chaîne
 * qui montre sa rupture : la première fait croire qu'on saurait
 * répondre à un client, la seconde prévient qu'on ne saurait pas.
 *
 * ────────────────────────────────────────────────────────────────
 * LES LIENS QUI EXISTENT VRAIMENT, mesurés clé étrangère par clé
 * étrangère dans la base de production :
 *
 *   culture_batches.mother_plant_id      → plants
 *   culture_batches.parent_batch_id      → culture_batches (les sous-lots)
 *   acclimatization_batches.culture_batch_id → culture_batches
 *   plants.origin_batch_id               → culture_batches
 *   nursery_lots.source_biolab_batch_id  → culture_batches
 *   sales_order_lines.lot_id             → nursery_lots
 *   sales_orders.customer_id             → crm_customers
 *   sales_orders.project_id              → projects
 *   projects.garden_id                   → gardens
 *
 * ────────────────────────────────────────────────────────────────
 * LES TROIS RUPTURES, mesurées elles aussi, et énoncées à l'écran.
 *
 * RUPTURE 1 — L'ACCLIMATATION EST ENJAMBÉE.
 * `nursery_lots.source_biolab_batch_id` et `plants.origin_batch_id`
 * pointent tous les deux vers `culture_batches`, JAMAIS vers
 * `acclimatization_batches`. Le §27 place pourtant l'acclimatation
 * entre le lot et la pépinière — et c'est l'étape qui décide combien de
 * plantules survivent. Conséquence concrète : un lot acclimaté deux
 * fois, sur deux substrats différents, produit deux lots de pépinière
 * que rien ne distingue en aval. La comparaison de substrats, qui est
 * précisément la raison d'être de deux essais, est donc impossible à
 * refaire depuis la vente.
 *
 * RUPTURE 2 — LA VENTE NE DÉSIGNE PAS UN JARDIN.
 * `sales_orders` porte `customer_id` et `project_id`, jamais de jardin.
 * Le jardin n'apparaît que si la commande porte un chantier ET que ce
 * chantier porte un jardin : deux maillons facultatifs à la suite. Et
 * `deliveries` / `delivery_lines` — le moment où les plantes partent
 * réellement — n'enregistrent aucune destination au-delà de la
 * commande. « Vente → jardin client » est donc une probabilité, pas un
 * fait.
 *
 * RUPTURE 3 — LA PLANTE LIVRÉE N'EST RATTACHÉE À RIEN.
 * `plants.origin_batch_id` remonte vers un lot de culture, jamais vers
 * le `nursery_lot` vendu ni vers la ligne de commande. Le dernier
 * maillon du §27 — « jardin client → suivi de la plante » — recommence
 * donc une chaîne neuve au lieu de continuer celle-ci. Et pour une
 * plante achetée à un fournisseur, sans origine BioLab, il n'y a aucun
 * lien du tout.
 *
 * ────────────────────────────────────────────────────────────────
 * UNE QUATRIÈME FAIBLESSE, qui n'est pas une rupture mais une couture.
 * Les vingt et une tables BioLab sont clés par `workspace_id` ; la
 * pépinière et la vente sont clés par `organization_id`. Le seul lien
 * qui traverse — `nursery_lots.source_biolab_batch_id` — relie donc une
 * ligne possédée par une ENTREPRISE à une ligne possédée par un ESPACE
 * DE TRAVAIL, et rien en base ne garantit que les deux appartiennent au
 * même monde. C'est écrit ici pour que personne ne prenne cette
 * jointure pour une preuve d'appartenance.
 */

// ==================================================================
// 1. CE QU'UN MAILLON PEUT VALOIR
// ==================================================================

export type EtatMaillon =
  /** Le maillon est là, avec de la matière derrière. */
  | "present"
  /** Le maillon existe dans le produit, mais rien n'a encore été saisi. */
  | "vide"
  /** Le maillon est référencé, mais cet espace n'a pas le droit de le voir. */
  | "horsPortee"
  /** Le §27 attend un maillon que la base ne sait pas porter. */
  | "rompu";

export type ElementMaillon = {
  id: string;
  libelle: string;
  sousTitre?: string;
  href?: string;
};

export type Maillon = {
  clef: string;
  titre: string;
  etat: EtatMaillon;
  /** Ce qu'on a trouvé, en une phrase. */
  resume: string;
  /** Pourquoi ça s'arrête là, quand ça s'arrête. Jamais du remplissage. */
  limite?: string;
  elements: ElementMaillon[];
};

// ==================================================================
// 2. LA MATIÈRE
// ==================================================================

export type LotPepiniere = {
  id: string;
  lot_code: string;
  species_name: string;
  current_quantity: number;
  status: string;
  source_biolab_batch_id: string | null;
};

export type LigneVente = {
  id: string;
  quantity: number;
  lot_id: string | null;
  sales_orders: {
    id: string;
    number: string;
    status: string;
    ordered_on: string | null;
    project_id: string | null;
    crm_customers: { id: string; display_name: string } | null;
    projects: { id: string; name: string; garden_id: string | null } | null;
  } | null;
};

export type PlanteIssue = {
  id: string;
  custom_name: string | null;
  common_name: string | null;
  scientific_name: string | null;
  garden_id: string | null;
  is_archived: boolean | null;
};

export type MatiereChaine = {
  lot: FicheLot;
  /**
   * Vrai quand `mother_plant_id` est renseigné mais que la plante n'est
   * pas revenue de la base. Ce n'est pas une donnée manquante, c'est la
   * RLS qui a fait son travail : la plante vit dans un autre espace.
   * Le dire est le seul comportement honnête ; afficher « aucune plante
   * mère » serait un mensonge.
   */
  planteMereHorsPortee: boolean;
  planteMere: PlanteMere | null;
  sousLots: { id: string; batch_code: string; culture_stage: string; current_count: number }[];
  acclimatations: Acclimatation[];
  plantesIssues: PlanteIssue[];
  lotsPepiniere: LotPepiniere[];
  lignesVente: LigneVente[];
};

// ==================================================================
// 3. LA CHAÎNE
// ==================================================================

/**
 * Les neuf maillons du §27, dans l'ordre du §27.
 *
 * FONCTION PURE : elle ne lit rien, elle ne compte que ce qu'on lui
 * donne. C'est ce qui permet d'éprouver, sans base ni réseau, le seul
 * comportement qui compte ici — qu'une chaîne incomplète se DÉCLARE
 * incomplète.
 */
export function chaineDeTracabilite(m: MatiereChaine): Maillon[] {
  const maillons: Maillon[] = [];

  // ---------------------------------------------------------------
  // 1. Plante mère
  // ---------------------------------------------------------------
  if (m.planteMere) {
    maillons.push({
      clef: "mere",
      titre: "Plante mère",
      etat: "present",
      resume: "La donneuse d'explants dont ce lot est issu.",
      elements: [
        {
          id: m.planteMere.id,
          libelle: nomDePlante(m.planteMere),
          sousTitre: m.planteMere.scientific_name ?? undefined,
        },
      ],
    });
  } else if (m.planteMereHorsPortee) {
    maillons.push({
      clef: "mere",
      titre: "Plante mère",
      etat: "horsPortee",
      resume: "Ce lot cite une plante mère que cet espace ne peut pas lire.",
      limite:
        "La plante existe, mais elle appartient à un autre espace de travail — un jardin personnel, le plus souvent. La chaîne commence donc un cran trop tard, et ce n'est pas une donnée manquante : c'est une frontière de propriété.",
      elements: [],
    });
  } else {
    maillons.push({
      clef: "mere",
      titre: "Plante mère",
      etat: "vide",
      resume: "Aucune plante mère n'est rattachée à ce lot.",
      limite:
        "Le §27 fait commencer la chaîne ici. Sans elle, on peut dire d'où vient le lot dans le laboratoire, pas de quel pied il descend. Le rattachement se fait depuis la fiche du lot sur le téléphone.",
      elements: [],
    });
  }

  // ---------------------------------------------------------------
  // 2. Le lot de culture
  // ---------------------------------------------------------------
  maillons.push({
    clef: "lot",
    titre: "Lot de culture",
    etat: "present",
    resume: `${m.lot.batch_code} — ${m.lot.species_name}${m.lot.cultivar ? ` ‘${m.lot.cultivar}’` : ""}.`,
    elements: [
      {
        id: m.lot.id,
        libelle: m.lot.batch_code,
        sousTitre: `${m.lot.current_count} explants, entré à ${m.lot.initial_explant_count}`,
        href: `/biolab/lots/${m.lot.id}`,
      },
    ],
  });

  // ---------------------------------------------------------------
  // 3. Multiplication — les sous-lots
  // ---------------------------------------------------------------
  maillons.push(
    m.sousLots.length > 0
      ? {
          clef: "multiplication",
          titre: "Multiplication",
          etat: "present",
          resume: `${m.sousLots.length} sous-lot${m.sousLots.length > 1 ? "s" : ""} issu${m.sousLots.length > 1 ? "s" : ""} de ce lot.`,
          elements: m.sousLots.map((s) => ({
            id: s.id,
            libelle: s.batch_code,
            sousTitre: `${s.current_count} explants`,
            href: `/biolab/lots/${s.id}`,
          })),
        }
      : {
          clef: "multiplication",
          titre: "Multiplication",
          etat: "vide",
          resume: "Ce lot n'a pas encore été divisé.",
          limite:
            "La division se fait sur le téléphone ; elle crée des sous-lots qui gardent ce lot pour parent. Tant qu'elle n'a pas eu lieu, il n'y a pas de branche à suivre — ce n'est pas une lacune.",
          elements: [],
        },
  );

  // ---------------------------------------------------------------
  // 4. Acclimatation
  // ---------------------------------------------------------------
  maillons.push(
    m.acclimatations.length > 0
      ? {
          clef: "acclimatation",
          titre: "Acclimatation",
          etat: "present",
          resume: `${m.acclimatations.length} passage${m.acclimatations.length > 1 ? "s" : ""} du bocal à la terre.`,
          limite:
            "Attention : rien en aval ne dira LEQUEL de ces passages a produit un lot de pépinière donné. Voir la rupture signalée au maillon « Pépinière ».",
          elements: m.acclimatations.map((a) => ({
            id: a.id,
            libelle: `${a.current_survivor_count} survivantes sur ${a.initial_plantlet_count}`,
            sousTitre: [a.substrate, a.location].filter(Boolean).join(" · ") || undefined,
            href: "/biolab/acclimatation",
          })),
        }
      : {
          clef: "acclimatation",
          titre: "Acclimatation",
          etat: "vide",
          resume: "Aucune acclimatation enregistrée pour ce lot.",
          limite:
            "C'est l'étape qui décide combien de plantules survivent à la sortie du bocal. Elle se saisit sur le téléphone.",
          elements: [],
        },
  );

  // ---------------------------------------------------------------
  // 5. Les plantes créées
  // ---------------------------------------------------------------
  maillons.push(
    m.plantesIssues.length > 0
      ? {
          clef: "plantes",
          titre: "Plantes créées",
          etat: "present",
          resume: `${m.plantesIssues.length} plante${m.plantesIssues.length > 1 ? "s" : ""} porte${m.plantesIssues.length > 1 ? "nt" : ""} ce lot pour origine.`,
          elements: m.plantesIssues.map((p) => ({
            id: p.id,
            libelle:
              p.custom_name?.trim() ||
              p.common_name?.trim() ||
              p.scientific_name?.trim() ||
              "Plante sans nom",
            sousTitre: p.garden_id ? "Rattachée à un jardin" : "Sans jardin",
          })),
        }
      : {
          clef: "plantes",
          titre: "Plantes créées",
          etat: "vide",
          resume: "Aucune plante ne porte ce lot pour origine.",
          limite:
            "Les plantes sont créées depuis la fiche d'acclimatation, sur le téléphone, une fois les plantules stabilisées.",
          elements: [],
        },
  );

  // ---------------------------------------------------------------
  // 6. Pépinière — LA PREMIÈRE RUPTURE
  // ---------------------------------------------------------------
  maillons.push(
    m.lotsPepiniere.length > 0
      ? {
          clef: "pepiniere",
          titre: "Pépinière",
          etat: "present",
          resume: `${m.lotsPepiniere.length} lot${m.lotsPepiniere.length > 1 ? "s" : ""} de pépinière cite${m.lotsPepiniere.length > 1 ? "nt" : ""} ce lot de culture pour origine.`,
          limite:
            "RUPTURE : le lien de la pépinière pointe vers le LOT DE CULTURE, jamais vers l'acclimatation. Si ce lot a été acclimaté deux fois, rien ici ne dit de quel passage vient ce qui est en godet.",
          elements: m.lotsPepiniere.map((l) => ({
            id: l.id,
            libelle: l.lot_code,
            sousTitre: `${l.species_name} · ${l.current_quantity} plantes`,
            href: `/pepiniere/lots/${l.id}`,
          })),
        }
      : {
          clef: "pepiniere",
          titre: "Pépinière",
          etat: "vide",
          resume: "Aucun lot de pépinière ne cite ce lot de culture.",
          limite:
            "Le rattachement se fait à la création du lot de pépinière, en désignant le lot de culture d'origine. Sans lui, la plante existe en stock mais son histoire s'arrête au laboratoire.",
          elements: [],
        },
  );

  // ---------------------------------------------------------------
  // 7. Vente
  // ---------------------------------------------------------------
  const ventes = m.lignesVente.filter((l) => l.sales_orders !== null);
  maillons.push(
    ventes.length > 0
      ? {
          clef: "vente",
          titre: "Vente",
          etat: "present",
          resume: `${ventes.length} ligne${ventes.length > 1 ? "s" : ""} de commande porte${ventes.length > 1 ? "nt" : ""} ces plantes.`,
          elements: ventes.map((l) => ({
            id: l.id,
            libelle: `${l.sales_orders?.number ?? "Commande"} — ${l.quantity} plantes`,
            sousTitre: l.sales_orders?.crm_customers?.display_name ?? "Client non renseigné",
            href: l.sales_orders ? `/pepiniere/commandes/${l.sales_orders.id}` : undefined,
          })),
        }
      : {
          clef: "vente",
          titre: "Vente",
          etat: "vide",
          resume: "Ces plantes n'ont pas encore été vendues.",
          elements: [],
        },
  );

  // ---------------------------------------------------------------
  // 8. Jardin client — LA DEUXIÈME RUPTURE
  // ---------------------------------------------------------------
  const jardins = ventes
    .map((l) => l.sales_orders?.projects)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.garden_id));

  if (jardins.length > 0) {
    maillons.push({
      clef: "jardin",
      titre: "Jardin client",
      etat: "present",
      resume: `${jardins.length} chantier${jardins.length > 1 ? "s" : ""} de destination porte${jardins.length > 1 ? "nt" : ""} un jardin.`,
      limite:
        "RUPTURE : ce jardin est déduit du chantier de la commande, pas enregistré à la livraison. Une commande sans chantier, ou un chantier sans jardin, coupe le lien — et la livraison elle-même n'enregistre aucune destination.",
      elements: jardins.map((p) => ({
        id: p.id,
        libelle: p.name,
        sousTitre: "Chantier rattaché à un jardin",
        href: `/projets/${p.id}`,
      })),
    });
  } else if (ventes.length > 0) {
    maillons.push({
      clef: "jardin",
      titre: "Jardin client",
      etat: "rompu",
      resume: "Les plantes sont vendues, mais aucun jardin ne peut être désigné.",
      limite:
        "RUPTURE : une commande de vente porte un client et, facultativement, un chantier — jamais un jardin. Le jardin ne s'obtient que si la commande porte un chantier ET que ce chantier porte un jardin. Ici, cette suite est interrompue : on sait à QUI les plantes sont parties, pas OÙ.",
      elements: [],
    });
  } else {
    maillons.push({
      clef: "jardin",
      titre: "Jardin client",
      etat: "vide",
      resume: "Pas de vente, donc pas de destination.",
      elements: [],
    });
  }

  // ---------------------------------------------------------------
  // 9. Suivi de la plante — LA TROISIÈME RUPTURE
  // ---------------------------------------------------------------
  maillons.push({
    clef: "suivi",
    titre: "Suivi de la plante",
    etat: "rompu",
    resume: "La chaîne s'arrête ici, et ce n'est pas une donnée manquante.",
    limite:
      "RUPTURE : aucune plante de jardin ne référence le lot de pépinière vendu ni la ligne de commande. Une plante peut citer son lot de CULTURE d'origine — c'est le maillon « Plantes créées » plus haut — mais une plante plantée chez un client après une vente ne cite rien du tout. Le dernier maillon du §27 recommence donc une chaîne neuve au lieu de prolonger celle-ci. Le rattacher demande une colonne que la base ne porte pas ; ce n'est pas un écran qui peut l'inventer.",
    elements: [],
  });

  return maillons;
}

/** Combien de maillons portent effectivement de la matière. */
export function maillonsRenseignes(maillons: Maillon[]): number {
  return maillons.filter((m) => m.etat === "present").length;
}

/** Le premier maillon qui interrompt la chaîne, s'il y en a un. */
export function premiereRupture(maillons: Maillon[]): Maillon | null {
  return maillons.find((m) => m.etat === "rompu" || m.etat === "horsPortee") ?? null;
}

// ==================================================================
// 4. LA LECTURE
// ==================================================================

/**
 * Rassemble la matière de la chaîne pour un lot.
 *
 * Chaque requête est portée par la RLS du client serveur. Deux mondes
 * de propriété s'y croisent : `culture_batches`, `acclimatization_batches`
 * et `plants` sont clés par espace de travail ; `nursery_lots` et
 * `sales_order_lines` par entreprise. On ne force ni l'un ni l'autre —
 * ce qui ne revient pas ne revient pas, et l'écran le dit.
 */
export async function lireMatiereChaine(
  workspaceId: string,
  lot: FicheLot,
): Promise<Lecture<MatiereChaine>> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  const [sousLots, acclimatations, plantes, lotsPepiniere] = await Promise.all([
    supabase
      .from("culture_batches")
      .select("id, batch_code, culture_stage, current_count")
      .eq("workspace_id", workspaceId)
      .eq("parent_batch_id", lot.id)
      .order("batch_code")
      .limit(200),

    supabase
      .from("acclimatization_batches")
      .select(
        "id, culture_batch_id, started_at, initial_plantlet_count, current_survivor_count, substrate, humidity_program, temperature, location, status, plants_created, notes",
      )
      .eq("workspace_id", workspaceId)
      .eq("culture_batch_id", lot.id)
      .order("started_at", { ascending: false })
      .limit(50),

    // PAS DE FILTRE SUR L'ESPACE ICI, ET C'EST DÉLIBÉRÉ.
    //
    // Une plante appartient au monde du JARDIN : elle porte `garden_id`
    // et son espace suit celui de son jardin, que 0086 recale. Filtrer
    // sur l'espace du laboratoire ferait donc disparaître, sans un mot,
    // les plantes issues de ce lot dès qu'un jardin change de mains —
    // c'est-à-dire au moment précis où l'on veut suivre la chaîne. La
    // RLS reste la frontière : ce qui ne doit pas revenir ne revient
    // pas, et le maillon dit ce qu'il a trouvé.
    supabase
      .from("plants")
      .select("id, custom_name, common_name, scientific_name, garden_id, is_archived")
      .eq("origin_batch_id", lot.id)
      .is("deleted_at", null)
      .limit(200),

    // Même raison : un lot de pépinière est clé par `organization_id`,
    // pas par espace de travail. C'est la couture décrite en tête de
    // fichier ; la RLS de l'entreprise la tient.
    supabase
      .from("nursery_lots")
      .select("id, lot_code, species_name, current_quantity, status, source_biolab_batch_id")
      .eq("source_biolab_batch_id", lot.id)
      .is("archived_at", null)
      .order("lot_code")
      .limit(200),
  ]);

  // UNE CHAÎNE AMPUTÉE D'UN MAILLON MENT SUR LA CHAÎNE ENTIÈRE. Si la
  // lecture des lots de pépinière échoue, l'écran conclurait « la
  // traçabilité s'arrête à l'acclimatation » — un diagnostic, alors que
  // la vérité est « je n'ai pas pu regarder ». La panne l'emporte donc
  // sur le constat.
  const vide: MatiereChaine = {
    lot,
    planteMere: null,
    planteMereHorsPortee: false,
    sousLots: [],
    acclimatations: [],
    plantesIssues: [],
    lotsPepiniere: [],
    lignesVente: [],
  };
  const premiereErreur =
    sousLots.error?.message ??
    acclimatations.error?.message ??
    plantes.error?.message ??
    lotsPepiniere.error?.message ??
    null;
  if (premiereErreur) return echecDeLecture(vide, premiereErreur);

  const lots = (lotsPepiniere.data ?? []) as LotPepiniere[];

  let lignesVente: LigneVente[] = [];
  if (lots.length > 0) {
    const { data, error } = await supabase
      .from("sales_order_lines")
      .select(
        `id, quantity, lot_id,
         sales_orders ( id, number, status, ordered_on, project_id,
                        crm_customers ( id, display_name ),
                        projects ( id, name, garden_id ) )`,
      )
      .in(
        "lot_id",
        lots.map((l) => l.id),
      )
      .limit(200);
    if (error) return echecDeLecture(vide, error.message);
    lignesVente = (data ?? []) as unknown as LigneVente[];
  }

  return {
    donnees: {
      lot,
      planteMere: lot.plants ?? null,
      // Référencée mais absente de la réponse : la RLS l'a écartée.
      planteMereHorsPortee: Boolean(lot.mother_plant_id) && !lot.plants,
      sousLots: (sousLots.data ?? []) as MatiereChaine["sousLots"],
      acclimatations: (acclimatations.data ?? []) as Acclimatation[],
      plantesIssues: (plantes.data ?? []) as PlanteIssue[],
      lotsPepiniere: lots,
      lignesVente,
    },
    erreur: null,
  };
}
