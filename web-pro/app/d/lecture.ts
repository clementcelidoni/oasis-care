import type {
  ClientQuote,
  ClientQuoteLine,
  ClientQuoteSection,
} from "@/lib/portal/types";

/**
 * §PORTE ANONYME — LIRE UN DEVIS AVEC UN JETON, SANS COMPTE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER NE PARLE PAS À LA BASE, ET C'EST VOULU
 * ══════════════════════════════════════════════════════════════════
 *
 * Il reçoit une FONCTION D'APPEL et ne connaît qu'elle. Toute la
 * décision — la forme du jeton, ce qu'on affiche, ce qu'on refuse, ce
 * qu'on ne dit pas — vit donc dans un module que les tests jouent sans
 * réseau et sans base. La page, elle, ne fait plus que du câblage.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES QUATRE ÉTATS D'UN LIEN, ET POURQUOI IL N'EN RESTE QUE DEUX ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * Un lien est VALIDE, EXPIRÉ, RÉVOQUÉ ou INCONNU. Les trois derniers
 * partagent une seule page et une seule phrase, et ce n'est pas une
 * économie de moyens : c'est la règle. Dire « ce lien a expiré » plutôt
 * que « ce lien n'existe pas », c'est confirmer à qui tape au hasard
 * qu'il vient de tomber sur un vrai devis — et lui offrir l'oracle qui
 * rend l'énumération intéressante.
 *
 * `devis_par_jeton` (0089 § 8.d) applique déjà cette règle : elle rend
 * la MÊME phrase dans les trois cas et ne dit jamais lequel. Ce module
 * ne cherche donc pas à en apprendre plus qu'elle n'en dit — il n'y a
 * rien à apprendre, et c'est le but.
 *
 * IL EXISTE UN CINQUIÈME ÉTAT, ET LE CONFONDRE AVEC LES AUTRES SERAIT
 * UNE FAUTE : LA PANNE. Un service indisponible n'est pas un lien
 * périmé. Répondre « ce lien n'est plus valable » à quelqu'un dont le
 * lien est parfaitement bon le ferait renoncer — et il ne rappellera
 * pas son paysagiste pour un lien qu'on vient de lui dire mort. La
 * panne a donc sa propre phrase, et elle donne une autre voie.
 */

/**
 * LA PHRASE DE REFUS, RECOPIÉE DE LA BASE MOT POUR MOT.
 *
 * Elle sert quand on refuse AVANT d'appeler la base — un jeton qui n'a
 * pas la bonne forme n'a jamais existé, et on ne dérange pas le serveur
 * pour lui. Les deux textes doivent rester identiques : deux phrases
 * différentes selon l'endroit du refus REDONNERAIENT l'oracle qu'on
 * vient de fermer. `lecture.test.ts` relit la migration 0089 et échoue
 * si elles divergent d'un caractère.
 */
export const PHRASE_LIEN_CLOS =
  "Ce lien n'est plus valable. Demandez-en un nouveau à votre paysagiste.";

/** Ce qu'on dit quand c'est NOUS qui sommes en panne, pas le lien. */
export const PHRASE_PANNE =
  "Nous n'arrivons pas à ouvrir ce document à l'instant. Réessayez dans quelques minutes, " +
  "ou demandez à votre paysagiste de vous le renvoyer.";

/** Ce qu'on dit à qui insiste. Aucune information sur le document. */
export const PHRASE_TROP_DE_TENTATIVES =
  "Trop de tentatives depuis cet appareil. Patientez quelques minutes, puis rouvrez le lien " +
  "que vous avez reçu.";

/**
 * L'ENTREPRISE, TELLE QUE LA PORTE LA REND : TROIS COLONNES.
 *
 * Ni SIRET, ni adresse, ni coordonnées — 0089 § 8.d s'en tient là. La
 * page publique est donc plus pauvre que le portail d'un client
 * identifié, et cette pauvreté a un coût qu'il faut connaître : elle ne
 * peut porter ni les mentions légales d'un devis papier, ni l'adresse à
 * laquelle renvoyer un accord signé. Élargir la porte est une décision
 * de la migration, pas d'un composant d'affichage : on ne la prend pas
 * ici, on la signale.
 */
export type EntreprisePublique = {
  id: string;
  name: string;
  business_type: string | null;
};

/**
 * LE DEVIS : le type du PORTAIL, augmenté des deux identifiants que la
 * porte rend en plus.
 *
 * On réutilise `ClientQuote` plutôt que d'en écrire un jumeau. Le jour
 * où quelqu'un touche à ce que le portail montre, il n'existe pas deux
 * définitions dont une seule aurait été relue.
 */
export type DevisPublic = ClientQuote & {
  organization_id: string;
  customer_id: string;
};

export type Resultat =
  | {
      etat: "ouvert";
      entreprise: EntreprisePublique;
      devis: DevisPublic;
      sections: ClientQuoteSection[];
      lignes: ClientQuoteLine[];
    }
  /** Expiré, révoqué, inconnu ou mal formé : une seule porte fermée. */
  | { etat: "clos"; message: string }
  | { etat: "panne"; message: string };

/**
 * Ce que rend `devis_par_jeton` : une ligne, six colonnes. Les `jsonb`
 * arrivent en `unknown`, et on ne fait confiance à rien.
 */
type LigneRendue = {
  ok?: unknown;
  message?: unknown;
  entreprise?: unknown;
  devis?: unknown;
  sections?: unknown;
  lignes?: unknown;
};

export type AppelPorte = (jeton: string) => Promise<{
  data: unknown;
  error: { message: string } | null;
}>;

/**
 * On normalise comme la base : rognage et minuscules. Un lien recopié
 * depuis un message porte souvent un espace de trop, et refuser pour ça
 * serait refuser un client légitime.
 */
export function normaliserJeton(brut: string | null | undefined): string {
  return (brut ?? "").trim().toLowerCase();
}

/**
 * LA FORME DU JETON, VÉRIFIÉE AVANT DE DÉRANGER LA BASE.
 *
 * 32 octets en hexadécimal, soit 64 caractères. C'est le contrôle que
 * `devis_par_jeton` fait en première ligne ; le refaire ici n'est pas
 * une redondance décorative :
 *
 *   • un balayage qui tente `/d/admin`, `/d/1` ou `/d/wp-login` ne coûte
 *     alors AUCUN aller-retour à la base et n'écrit rien dans son
 *     journal de tentatives — ce journal doit compter les vraies
 *     tentatives d'énumération, pas le bruit de fond d'Internet ;
 *   • le jeton ne descend jamais jusqu'à la base sous une forme qu'elle
 *     n'attend pas.
 */
export function jetonBienForme(jeton: string): boolean {
  return /^[0-9a-f]{64}$/.test(jeton);
}

/**
 * L'appel, et la lecture de ce qu'il rend.
 *
 * L'ORDRE DES CONTRÔLES EST LE SUJET : la forme d'abord (aucun appel),
 * l'erreur de transport ensuite (une PANNE, jamais un refus), le refus
 * métier enfin. Inverser les deux derniers ferait dire « votre lien est
 * mort » à chaque hoquet du réseau, sur un lien parfaitement valide.
 */
export async function lireDevisParJeton(
  brut: string | null | undefined,
  appel: AppelPorte,
): Promise<Resultat> {
  const jeton = normaliserJeton(brut);
  if (!jetonBienForme(jeton)) {
    return { etat: "clos", message: PHRASE_LIEN_CLOS };
  }

  let reponse: { data: unknown; error: { message: string } | null };
  try {
    reponse = await appel(jeton);
  } catch {
    // Une exception du client HTTP est une panne, pas un verdict.
    return { etat: "panne", message: PHRASE_PANNE };
  }

  if (reponse.error !== null) {
    return { etat: "panne", message: PHRASE_PANNE };
  }

  const ligne = premiereLigne(reponse.data);
  if (ligne === null) {
    // La fonction rend TOUJOURS une ligne, refus compris. N'en recevoir
    // aucune n'est donc pas un refus : c'est qu'autre chose s'est passé,
    // et on ne le maquille pas en « lien périmé ».
    return { etat: "panne", message: PHRASE_PANNE };
  }

  if (ligne.ok !== true) {
    // LA PHRASE VIENT DE LA BASE quand elle en donne une : c'est elle qui
    // décide de ce qu'on révèle, et la recopier ici la ferait diverger.
    const message =
      typeof ligne.message === "string" && ligne.message.trim() !== ""
        ? ligne.message
        : PHRASE_LIEN_CLOS;
    return { etat: "clos", message };
  }

  const entreprise = lireEntreprise(ligne.entreprise);
  const devis = lireDevis(ligne.devis);
  const sections = lireTableau(ligne.sections, lireSection);
  const lignes = lireTableau(ligne.lignes, lireLigne);
  if (entreprise === null || devis === null || sections === null || lignes === null) {
    // `ok` vaut vrai mais la charge est inexploitable : on ne devine pas,
    // et on n'affiche surtout pas un devis à trous. Un document
    // commercial amputé vaut moins qu'une page d'attente honnête.
    return { etat: "panne", message: PHRASE_PANNE };
  }

  return {
    etat: "ouvert",
    entreprise,
    devis,
    sections: sections.sort((a, b) => a.position - b.position),
    lignes: lignes.sort((a, b) => a.position - b.position),
  };
}

function premiereLigne(data: unknown): LigneRendue | null {
  const brut = Array.isArray(data) ? data[0] : data;
  if (brut === null || brut === undefined || typeof brut !== "object") return null;
  return brut as LigneRendue;
}

function lireEntreprise(brut: unknown): EntreprisePublique | null {
  if (brut === null || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  return {
    id: o.id,
    name: o.name,
    business_type: typeof o.business_type === "string" ? o.business_type : null,
  };
}

function lireDevis(brut: unknown): DevisPublic | null {
  if (brut === null || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.number !== "string") return null;
  return {
    id: o.id,
    organization_id: typeof o.organization_id === "string" ? o.organization_id : "",
    customer_id: typeof o.customer_id === "string" ? o.customer_id : "",
    number: o.number,
    title: typeof o.title === "string" ? o.title : "",
    status: typeof o.status === "string" ? o.status : "",
    issued_on: typeof o.issued_on === "string" ? o.issued_on : "",
    valid_until: typeof o.valid_until === "string" ? o.valid_until : null,
    introduction: typeof o.introduction === "string" ? o.introduction : null,
    terms: typeof o.terms === "string" ? o.terms : null,
    // Ici le zéro est LU, pas inventé : la colonne est `not null default
    // 0` en base et il s'agit d'un pourcentage de remise, dont l'absence
    // veut bien dire « aucune remise ». La règle « jamais de `?? 0`
    // derrière un montant » vise les montants inconnus, et c'est
    // pourquoi aucun centime n'est reconstitué dans ce fichier.
    global_discount_percent:
      typeof o.global_discount_percent === "number" ? o.global_discount_percent : 0,
    created_at: typeof o.created_at === "string" ? o.created_at : "",
  };
}

/**
 * LES SECTIONS ET LES LIGNES SE RECONSTRUISENT AUSSI CHAMP PAR CHAMP.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FILTRE A ÉTÉ ÉCRIT DEUX FOIS, ET LA PREMIÈRE VERSION FUITAIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle se contentait de vérifier la présence d'un identifiant, puis
 * laissait passer l'objet ENTIER tel que la base l'avait rendu. Le
 * devis et l'entreprise, eux, étaient déjà reconstruits champ par champ.
 * La défense était donc asymétrique — et elle manquait justement à
 * l'endroit où vivent le coût d'achat et la marge : `unit_cost_cents`,
 * `cost_total_cents`, `cost_kind` sont des colonnes de `quote_lines`.
 *
 * Rien ne fuyait aujourd'hui, parce que `devis_par_jeton` ne rend que
 * les onze colonnes choisies. Mais une porte ne se juge pas sur ce que
 * la base rend AUJOURD'HUI : le jour où quelqu'un élargit la fonction
 * SQL sans relire cette page — pour ajouter une colonne d'affichage,
 * disons — la marge du paysagiste partirait chez son client, dans le
 * HTML d'une page publique, sans qu'aucune erreur ne se produise. Le
 * test « AUCUN COÛT NE PEUT TRANSITER » simule exactement cela.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN ÉLÉMENT ILLISIBLE FAIT ÉCHOUER TOUT LE DOCUMENT
 * ══════════════════════════════════════════════════════════════════
 *
 * On rend `null`, ce qui donne une page de panne — et surtout pas un
 * devis auquel il manquerait une ligne. Les deux raisons de ne pas
 * simplement écarter l'élément fautif :
 *
 *   • un devis amputé d'une ligne présente un TOTAL qui ne correspond
 *     à rien, en face d'un client qui va s'en servir pour décider ;
 *   • une section écartée emporte silencieusement toutes ses lignes,
 *     puisque l'affichage groupe les lignes par section.
 *
 * Et aucun montant n'est reconstitué : pas de `?? 0` derrière des
 * centimes qu'on n'a pas su lire. Zéro euro est un montant, « je n'ai
 * pas su lire » n'en est pas un.
 */
function lireTableau<T>(brut: unknown, lire: (element: unknown) => T | null): T[] | null {
  // `null` de la base — aucune section, aucune ligne — est un tableau
  // vide, pas une panne : un devis peut n'avoir aucune section.
  if (brut === null || brut === undefined) return [];
  if (!Array.isArray(brut)) return null;
  const resultat: T[] = [];
  for (const element of brut) {
    const lu = lire(element);
    if (lu === null) return null;
    resultat.push(lu);
  }
  return resultat;
}

function lireSection(brut: unknown): ClientQuoteSection | null {
  if (brut === null || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.quote_id !== "string") return null;
  if (typeof o.title !== "string" || !estNombre(o.position)) return null;
  return {
    id: o.id,
    quote_id: o.quote_id,
    title: o.title,
    description: typeof o.description === "string" ? o.description : null,
    position: o.position,
  };
}

function lireLigne(brut: unknown): ClientQuoteLine | null {
  if (brut === null || typeof brut !== "object") return null;
  const o = brut as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.quote_id !== "string") return null;
  if (typeof o.description !== "string" || typeof o.unit !== "string") return null;
  // LES SIX NOMBRES SONT EXIGÉS, SANS REPLI. Un prix unitaire illisible
  // ne vaut pas zéro, et une quantité illisible ne vaut pas un.
  if (
    !estNombre(o.position) ||
    !estNombre(o.quantity) ||
    !estNombre(o.unit_sale_price_cents) ||
    !estNombre(o.vat_rate) ||
    !estNombre(o.discount_percent) ||
    !estNombre(o.sale_total_cents)
  ) {
    return null;
  }
  return {
    id: o.id,
    quote_id: o.quote_id,
    section_id: typeof o.section_id === "string" ? o.section_id : null,
    position: o.position,
    description: o.description,
    unit: o.unit,
    quantity: o.quantity,
    unit_sale_price_cents: o.unit_sale_price_cents,
    vat_rate: o.vat_rate,
    discount_percent: o.discount_percent,
    sale_total_cents: o.sale_total_cents,
  };
}

function estNombre(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isFinite(valeur);
}
