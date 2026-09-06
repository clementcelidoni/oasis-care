import type {
  AudienceCourriel,
  CleGabarit,
  DeclencheurCourriel,
  NatureCourriel,
} from "../types.ts";
import { formaterDate, formaterMontant, type Bloc } from "./blocs.ts";

/**
 * §COURRIEL — LES HUIT GABARITS.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LES TEXTES SONT DANS LE CODE ET NON EN BASE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le socle l'a tranché en 0084, et la raison tient en une phrase : ce
 * produit ne range AUCUN texte en base. Un gabarit en base serait le
 * seul texte du dépôt échappant à la relecture, et « Bonjour {{clientt}} »
 * partirait chez un client sans que personne ne l'ait vu passer.
 *
 * Ce qui est en base, c'est le CATALOGUE — nature, audience,
 * déclencheur, exigences — pour que les contraintes du journal soient
 * des contraintes et non des intentions. Les valeurs déclarées ici sont
 * le miroir exact de la table `email_templates` : un test le vérifie
 * gabarit par gabarit, parce qu'un écart ferait échouer la clé étrangère
 * composite au moment de l'envoi, c'est-à-dire au pire moment.
 *
 * LA SEULE EXCEPTION est le corps d'une annonce commerciale, qu'un
 * administrateur rédige dans l'écran : c'est du contenu, pas un gabarit.
 * L'enveloppe, le pied et le désabonnement, eux, restent ici.
 *
 * ══════════════════════════════════════════════════════════════════
 * COMMENT CES TEXTES SONT ÉCRITS
 * ══════════════════════════════════════════════════════════════════
 *
 * Pour un paysagiste et pour SON client, jamais pour un développeur.
 * Phrases courtes. Un objet qui dit ce que c'est et de la part de qui —
 * « Devis n° DV-2026-0031 — Jardins Dupont » se comprend dans une liste
 * de messages sans être ouvert, « Votre document est disponible » non.
 * Aucun jargon : ni « entité », ni « statut », ni « occurrence ».
 *
 * ══════════════════════════════════════════════════════════════════
 * LA VERSION D'UN GABARIT
 * ══════════════════════════════════════════════════════════════════
 *
 * Elle est recopiée dans `email_messages.template_version`. Sans elle,
 * « le client dit que le texte disait autre chose » resterait sans
 * réponse. ON L'INCRÉMENTE À CHAQUE CHANGEMENT DE TEXTE, même une
 * virgule : c'est le seul geste qui rende le journal utile, et le seul
 * qu'on oublie.
 */

export type Gabarit<V> = {
  cle: CleGabarit;
  nature: NatureCourriel;
  audience: AudienceCourriel;
  declencheur: DeclencheurCourriel;
  /** Recopiée dans `email_messages.template_version`. À incrémenter à chaque retouche. */
  version: string;
  objet(v: V): string;
  corps(v: V): Bloc[];
};

// ────────────────────────────────────────────────────────────────
// LES VARIABLES DE CHAQUE GABARIT
// ────────────────────────────────────────────────────────────────
//
// TOUTES VIENNENT DE LA BASE, aucune d'une zone de saisie au moment de
// l'envoi. Le nom du client, le numéro du devis, le montant : ce sont
// des faits enregistrés. Ce qui n'est pas un fait enregistré n'a pas sa
// place dans un message qui part sous le nom d'une entreprise depuis un
// domaine authentifié.
//
// `lienDocument` EST FACULTATIF, ET C'EST UN CONSTAT, PAS UN OUBLI. Le
// portail client est verrouillé par `auth.uid()` : aujourd'hui, un lien
// « Voir votre devis » tomberait sur un mur de connexion. Tant qu'aucun
// chemin de lecture par jeton n'est décidé, les gabarits n'affichent pas
// de bouton — et le corps porte donc l'essentiel (numéro, montant,
// échéance) pour que le message reste utile sans lien.

export type VariablesDevis = {
  numero: string;
  nomClient: string;
  totalTtcCentimes: number;
  valableJusquau?: string | null;
  /** Absent tant qu'aucun chemin de lecture anonyme n'existe. */
  lienDocument?: string | null;
  /** Le mot du paysagiste, saisi dans l'écran d'envoi. Facultatif. */
  motPersonnel?: string | null;
};

export type VariablesDevisRelance = VariablesDevis & {
  /** 1 pour la première relance, 2 pour la seconde. Le plafond est de deux. */
  rang: number;
};

export type VariablesFacture = {
  numero: string;
  nomClient: string;
  totalTtcCentimes: number;
  echeanceLe?: string | null;
  lienDocument?: string | null;
};

export type VariablesFactureRelance = {
  numero: string;
  nomClient: string;
  resteDuCentimes: number;
  echeanceLe: string;
  joursDeRetard: number;
  rang: number;
  lienDocument?: string | null;
};

export type VariablesInvitation = {
  nomClient: string;
  /** Le lien porte le jeton opaque de `client_invitations.token`. */
  lienInvitation: string;
  expireLe: string;
};

export type VariablesBienvenue = {
  nomEntreprise: string;
  lienApplication: string;
};

export type VariablesParametre = {
  nomEntreprise: string;
  /** « Le taux de TVA par défaut », « L'adresse de facturation »… */
  intitule: string;
  ancienneValeur?: string | null;
  nouvelleValeur?: string | null;
  quand: string;
  /** Qui a fait le changement. Absent quand c'est un traitement automatique. */
  auteur?: string | null;
};

export type VariablesAnnonce = {
  nomEntreprise: string;
  /** L'objet rédigé par l'administrateur, recopié de `email_campaigns.subject`. */
  objet: string;
  /** Le corps rédigé par l'administrateur, recopié de `email_campaigns.body_text`. */
  corpsTexte: string;
};

export type VariablesParGabarit = {
  devisEnvoye: VariablesDevis;
  devisRelance: VariablesDevisRelance;
  factureEmise: VariablesFacture;
  factureRelance: VariablesFactureRelance;
  invitationPortail: VariablesInvitation;
  bienvenueEntreprise: VariablesBienvenue;
  parametreImportant: VariablesParametre;
  annonceCommerciale: VariablesAnnonce;
};

// ────────────────────────────────────────────────────────────────
// DEUX AIDES DE RÉDACTION
// ────────────────────────────────────────────────────────────────

/** « Bonjour Marie Martin, » — et « Bonjour, » quand le nom manque. */
function salutation(nom: string | null | undefined): Bloc {
  const propre = (nom ?? "").trim();
  return { type: "paragraphe", texte: propre === "" ? "Bonjour," : `Bonjour ${propre},` };
}

/**
 * Le bouton vers le document, s'il y a un document à montrer.
 *
 * Rend un tableau vide plutôt qu'un bouton mort. Un lien « Voir votre
 * devis » qui tombe sur une page de connexion est pire que pas de lien :
 * le client croit avoir mal fait quelque chose et n'appelle pas.
 */
function boutonDocument(lien: string | null | undefined, libelle: string): Bloc[] {
  const propre = (lien ?? "").trim();
  return propre === "" ? [] : [{ type: "bouton", libelle, url: propre }];
}

// ────────────────────────────────────────────────────────────────
// 1. LE DEVIS ENVOYÉ
// ────────────────────────────────────────────────────────────────
//
// Déclencheur HUMAIN : le paysagiste bascule lui-même le devis en
// « envoyé ». C'est le plus propre du lot — déjà daté par
// `quotes.sent_at`, déjà journalisé, et déjà volontaire.

const devisEnvoye: Gabarit<VariablesDevis> = {
  cle: "devisEnvoye",
  nature: "transactionnel",
  audience: "clientFinal",
  declencheur: "humain",
  version: "devisEnvoye@1",
  objet: (v) => `Votre devis n° ${v.numero}`,
  corps: (v) => {
    const montant = formaterMontant(v.totalTtcCentimes);
    const validite = formaterDate(v.valableJusquau);
    const blocs: Bloc[] = [
      salutation(v.nomClient),
      { type: "paragraphe", texte: "Voici le devis que vous nous avez demandé." },
    ];
    if (v.motPersonnel && v.motPersonnel.trim() !== "") {
      blocs.push({ type: "paragraphe", texte: v.motPersonnel.trim() });
    }
    blocs.push({
      type: "encadre",
      lignes: [
        { libelle: "Devis n°", valeur: v.numero },
        ...(montant ? [{ libelle: "Montant TTC", valeur: montant, fort: true }] : []),
        ...(validite ? [{ libelle: "Valable jusqu'au", valeur: validite }] : []),
      ],
    });
    blocs.push(...boutonDocument(v.lienDocument, "Voir le devis"));
    blocs.push({
      type: "paragraphe",
      texte:
        "Pour l'accepter, le refuser ou nous poser une question, répondez simplement à ce message.",
    });
    return blocs;
  },
};

// ────────────────────────────────────────────────────────────────
// 2. LA RELANCE DE DEVIS
// ────────────────────────────────────────────────────────────────
//
// Déclencheur PÉRIODIQUE — et il n'existe pas encore d'ordonnanceur
// (`pg_cron` et `pg_net` sont absents du projet). Ce gabarit est donc
// écrit et éprouvé, mais rien ne l'appelle : il attend une décision
// d'infrastructure, pas une ligne de code.
//
// LE TON EST LE SUJET. Un paysagiste qui découvre que son logiciel a
// relancé un client avec qui il était au téléphone la veille perd la
// confiance d'un coup. Le texte suppose donc que le client a de bonnes
// raisons de ne pas avoir répondu, ne réclame rien, et rappelle
// seulement l'échéance.

const devisRelance: Gabarit<VariablesDevisRelance> = {
  cle: "devisRelance",
  nature: "transactionnel",
  audience: "clientFinal",
  declencheur: "periodique",
  version: "devisRelance@1",
  objet: (v) => `Votre devis n° ${v.numero} — encore valable`,
  corps: (v) => {
    const montant = formaterMontant(v.totalTtcCentimes);
    const validite = formaterDate(v.valableJusquau);
    const blocs: Bloc[] = [
      salutation(v.nomClient),
      {
        type: "paragraphe",
        texte:
          v.rang <= 1
            ? "Nous revenons vers vous au sujet du devis que nous vous avons adressé. Il est toujours valable."
            : "Un dernier mot au sujet de notre devis : sa date de validité approche.",
      },
      {
        type: "encadre",
        lignes: [
          { libelle: "Devis n°", valeur: v.numero },
          ...(montant ? [{ libelle: "Montant TTC", valeur: montant, fort: true }] : []),
          ...(validite ? [{ libelle: "Valable jusqu'au", valeur: validite }] : []),
        ],
      },
      ...boutonDocument(v.lienDocument, "Revoir le devis"),
      {
        type: "paragraphe",
        texte:
          "Si le projet n'est plus d'actualité, dites-le nous d'un mot : nous ne vous relancerons plus.",
      },
    ];
    return blocs;
  },
};

// ────────────────────────────────────────────────────────────────
// 3. LA FACTURE ÉMISE
// ────────────────────────────────────────────────────────────────
//
// Déclencheur CHANGEMENT D'ÉTAT : `issue_invoice()` attribue le numéro
// et pose `issued_at`. C'est la PRÉSENCE de ce fait daté, et non le
// statut, que le déclencheur regarde — un statut se change, un fait daté
// non.
//
// C'EST UN ENVOI AUTOMATIQUE, ET IL EST LÉGITIME. La frontière du
// produit n'est pas entre « humain » et « automatique » : elle est entre
// un changement d'état, qui expédie, et un MODÈLE, qui n'expédie jamais.
// L'IA prépare des brouillons, un humain valide ; le catalogue des
// gabarits n'a d'ailleurs pas de déclencheur pour elle.

const factureEmise: Gabarit<VariablesFacture> = {
  cle: "factureEmise",
  nature: "transactionnel",
  audience: "clientFinal",
  declencheur: "changementEtat",
  version: "factureEmise@1",
  objet: (v) => `Votre facture n° ${v.numero}`,
  corps: (v) => {
    const montant = formaterMontant(v.totalTtcCentimes);
    const echeance = formaterDate(v.echeanceLe);
    return [
      salutation(v.nomClient),
      { type: "paragraphe", texte: "Voici votre facture." },
      {
        type: "encadre",
        lignes: [
          { libelle: "Facture n°", valeur: v.numero },
          ...(montant ? [{ libelle: "Montant TTC", valeur: montant, fort: true }] : []),
          ...(echeance ? [{ libelle: "À régler avant le", valeur: echeance }] : []),
        ],
      },
      ...boutonDocument(v.lienDocument, "Voir la facture"),
      {
        type: "paragraphe",
        texte: "Une question sur cette facture ? Répondez à ce message, nous vous répondrons.",
      },
    ];
  },
};

// ────────────────────────────────────────────────────────────────
// 4. LA RELANCE DE FACTURE
// ────────────────────────────────────────────────────────────────
//
// Déclencheur PÉRIODIQUE, et le piège est documenté en 0084 :
// `refresh_overdue_invoices()` n'est appelée que quand quelqu'un ouvre
// l'écran des factures. Une facture peut être en retard depuis trois
// semaines sans que la base le sache. La relance devra donc lire
// `invoices.due_on` directement, jamais le basculement en « overdue ».

const factureRelance: Gabarit<VariablesFactureRelance> = {
  cle: "factureRelance",
  nature: "transactionnel",
  audience: "clientFinal",
  declencheur: "periodique",
  version: "factureRelance@1",
  objet: (v) => `Facture n° ${v.numero} — échue le ${formaterDate(v.echeanceLe) ?? v.echeanceLe}`,
  corps: (v) => {
    const reste = formaterMontant(v.resteDuCentimes);
    const echeance = formaterDate(v.echeanceLe);
    return [
      salutation(v.nomClient),
      {
        type: "paragraphe",
        texte:
          v.rang <= 1
            ? "Sauf erreur de notre part, la facture ci-dessous n'a pas encore été réglée."
            : "Nous n'avons toujours pas reçu le règlement de la facture ci-dessous.",
      },
      {
        type: "encadre",
        lignes: [
          { libelle: "Facture n°", valeur: v.numero },
          ...(reste ? [{ libelle: "Reste à régler", valeur: reste, fort: true }] : []),
          ...(echeance ? [{ libelle: "Échéance", valeur: echeance }] : []),
          { libelle: "Retard", valeur: `${v.joursDeRetard} jour${v.joursDeRetard > 1 ? "s" : ""}` },
        ],
      },
      ...boutonDocument(v.lienDocument, "Voir la facture"),
      {
        type: "paragraphe",
        texte:
          "Si le règlement vient d'être fait, ce message s'est croisé avec votre paiement : n'en tenez pas compte. Sinon, répondez-nous, nous trouverons une solution.",
      },
    ];
  },
};

// ────────────────────────────────────────────────────────────────
// 5. L'INVITATION AU PORTAIL
// ────────────────────────────────────────────────────────────────
//
// `invite_client_to_portal()` fabrique déjà le jeton, supprime
// l'invitation en attente pour ne pas laisser deux portes ouvertes, et
// rend le jeton à l'appelant — qui aujourd'hui n'en fait RIEN. Le jeton
// est fabriqué et jamais transmis : ce message est le morceau manquant.
//
// LE LIEN PORTE UN JETON OPAQUE ET À DURÉE LIMITÉE (0055 :
// `gen_random_bytes(32)`, `expires_at not null`). C'est le mécanisme qui
// existe déjà, on n'en invente pas un second. Et l'échéance est écrite
// dans le message : un lien mort sans explication fait abandonner.

const invitationPortail: Gabarit<VariablesInvitation> = {
  cle: "invitationPortail",
  nature: "transactionnel",
  audience: "clientFinal",
  declencheur: "humain",
  version: "invitationPortail@1",
  objet: () => "Accédez à votre espace client",
  corps: (v) => {
    const expiration = formaterDate(v.expireLe);
    return [
      salutation(v.nomClient),
      {
        type: "paragraphe",
        texte:
          "Nous vous avons ouvert un espace personnel : vous y retrouverez vos devis, vos factures et l'avancement de vos chantiers.",
      },
      { type: "bouton", libelle: "Ouvrir mon espace", url: v.lienInvitation },
      ...(expiration
        ? ([
            {
              type: "note",
              texte: `Ce lien est personnel et cesse de fonctionner après le ${expiration}. Passé cette date, demandez-nous simplement un nouveau lien.`,
            },
          ] as Bloc[])
        : []),
    ];
  },
};

// ────────────────────────────────────────────────────────────────
// 6. LA BIENVENUE À UNE ENTREPRISE
// ────────────────────────────────────────────────────────────────
//
// À NE PAS CONFONDRE avec les messages d'authentification, qui partent
// déjà par le réglage SMTP du projet Supabase et qui FONCTIONNENT. Ce
// chantier commence APRÈS l'authentification ; on ne reprend pas ce qui
// marche.

const bienvenueEntreprise: Gabarit<VariablesBienvenue> = {
  cle: "bienvenueEntreprise",
  nature: "transactionnel",
  audience: "entreprise",
  declencheur: "changementEtat",
  version: "bienvenueEntreprise@1",
  objet: () => "Bienvenue sur Oasis Care Pro",
  corps: (v) => [
    { type: "paragraphe", texte: `Bonjour, et bienvenue à ${v.nomEntreprise}.` },
    {
      type: "paragraphe",
      texte: "Votre espace est prêt. Trois choses valent la peine d'être faites tout de suite :",
    },
    {
      type: "liste",
      elements: [
        "Compléter les informations de votre entreprise (SIRET, adresse, assurance) : elles apparaissent sur vos devis et vos factures.",
        "Vérifier l'adresse e-mail de votre entreprise : c'est à elle que vos clients répondront.",
        "Ajouter votre logo : il figurera en haut des messages envoyés à vos clients.",
      ],
    },
    { type: "bouton", libelle: "Ouvrir mon espace", url: v.lienApplication },
    {
      type: "paragraphe",
      texte: "Une question ? Répondez à ce message, quelqu'un le lira.",
    },
  ],
};

// ────────────────────────────────────────────────────────────────
// 7. LE CHANGEMENT DE PARAMÈTRE IMPORTANT
// ────────────────────────────────────────────────────────────────
//
// Le fait est déjà journalisé dans `audit_events`, dont la colonne
// `source` distingue déjà l'humain de l'IA et dont `actor_user_id` est
// nullable PAR DESSEIN — une action déclenchée par un traitement
// automatique n'a pas d'auteur humain. Le message dit donc « par X »
// quand on sait, et rien quand on ne sait pas : inventer un auteur
// serait pire que de ne pas en nommer.

const parametreImportant: Gabarit<VariablesParametre> = {
  cle: "parametreImportant",
  nature: "transactionnel",
  audience: "entreprise",
  declencheur: "humain",
  version: "parametreImportant@1",
  objet: (v) => `Modification importante : ${v.intitule}`,
  corps: (v) => {
    const lignes = [
      { libelle: "Réglage", valeur: v.intitule },
      ...(v.ancienneValeur ? [{ libelle: "Avant", valeur: v.ancienneValeur }] : []),
      ...(v.nouvelleValeur
        ? [{ libelle: "Maintenant", valeur: v.nouvelleValeur, fort: true }]
        : []),
      { libelle: "Le", valeur: formaterDate(v.quand) ?? v.quand },
      ...(v.auteur ? [{ libelle: "Par", valeur: v.auteur }] : []),
    ];
    return [
      { type: "paragraphe", texte: `Bonjour ${v.nomEntreprise},` },
      {
        type: "paragraphe",
        texte:
          "Un réglage important de votre compte vient d'être modifié. Nous vous prévenons pour que rien ne vous échappe.",
      },
      { type: "encadre", lignes },
      {
        type: "paragraphe",
        texte:
          "Si ce changement vient de vous ou de votre équipe, il n'y a rien à faire. Sinon, répondez à ce message immédiatement.",
      },
    ];
  },
};

// ────────────────────────────────────────────────────────────────
// 8. L'ANNONCE COMMERCIALE — LE SEUL GABARIT PUBLICITAIRE
// ────────────────────────────────────────────────────────────────
//
// UNIQUEMENT vers les entreprises clientes d'Oasis Care, JAMAIS vers
// leurs clients. Le client final du paysagiste n'a rien signé avec Oasis
// Care : il reçoit du transactionnel de la part de son paysagiste, rien
// d'autre. La base l'interdit deux fois (0084 : une publicité ne peut
// viser qu'une entreprise, et un message adressé à une entreprise ne
// peut même pas référencer une fiche client du CRM).
//
// LE CORPS EST ÉCRIT PAR UN ADMINISTRATEUR et vient de
// `email_campaigns.body_text`. Il est découpé en paragraphes sur les
// lignes vides et ÉCHAPPÉ au rendu comme tout le reste : un
// administrateur ne compose pas du HTML, il écrit un texte.
//
// LE LIEN DE DÉSABONNEMENT n'est pas ici. Il est ajouté par
// `habiller()`, dont le type EXIGE un jeton pour une publicité — de
// sorte qu'un gabarit publicitaire ne peut pas être rendu sans lui,
// même en l'oubliant.

const annonceCommerciale: Gabarit<VariablesAnnonce> = {
  cle: "annonceCommerciale",
  nature: "publicite",
  audience: "entreprise",
  declencheur: "humain",
  version: "annonceCommerciale@1",
  objet: (v) => v.objet,
  corps: (v) => {
    const paragraphes = v.corpsTexte
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter((part) => part !== "");
    return [
      { type: "paragraphe", texte: `Bonjour ${v.nomEntreprise},` },
      ...paragraphes.map((texte): Bloc => ({ type: "paragraphe", texte })),
    ];
  },
};

/**
 * LE CATALOGUE. Une clé, un gabarit, et rien qui se cherche par chaîne.
 *
 * Le type impose qu'il soit COMPLET : ajouter une valeur à `CleGabarit`
 * sans écrire le gabarit correspondant ne compile pas. C'est ce qui
 * évite le cas où la base connaît un gabarit que le code ne sait pas
 * rendre — l'envoi échouerait alors au moment de partir, jamais avant.
 */
export const CATALOGUE: { [K in CleGabarit]: Gabarit<VariablesParGabarit[K]> } = {
  devisEnvoye,
  devisRelance,
  factureEmise,
  factureRelance,
  invitationPortail,
  bienvenueEntreprise,
  parametreImportant,
  annonceCommerciale,
};
