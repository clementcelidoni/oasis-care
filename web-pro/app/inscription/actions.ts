"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  ACTIVE_ORGANIZATION_COOKIE,
  getActiveOrganization,
  getUserOrganizations,
} from "@/lib/auth/organization";
import { updateCompanyProfile } from "@/lib/company/actions";
import { flash } from "@/lib/ui/flash";
import { BUSINESS_TYPES, type BusinessType } from "@/lib/auth/permissions";
import {
  getBillingProvider,
  type CheckoutOutcome,
  type ResumeSouscription,
} from "@/lib/billing/provider";
import { jourDeReference } from "@/lib/billing/composition";
import { lirePlansActifs } from "@/lib/billing/plans";
import { lireIntention, peutSouscrire } from "@/app/api/stripe/intention";
import { programmerValidationTva } from "@/lib/tva/file";
import { oublierPaiementEnCours, poserPaiementEnCours } from "./paiement-en-cours.ts";
import {
  annoncesParOffre,
  lireDerniereAcceptation,
  lireOffresEngageantes,
  lireTexteEngagement,
} from "./engagement-lecture.ts";
import {
  verifierAcceptation,
  verifierPreuve,
  verifierTarifAnnonce,
} from "./engagement.ts";
import {
  avertissements,
  chiffresSeuls,
  normaliserTva,
  verifierCoherenceSirenSiret,
  verifierSiren,
  verifierSiret,
  verifierTvaIntracom,
} from "./identite.ts";
import { traduireRefus } from "@/lib/peage/messages";

/**
 * §INSCRIPTION — LES ÉCRITURES, ET CE QU'ELLES REFUSENT D'ÉCRIRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE NAVIGATEUR VALIDE POUR AIDER ; LE SERVEUR VALIDE POUR DÉCIDER
 * ══════════════════════════════════════════════════════════════════
 *
 * Le formulaire de `FormulaireSociete.tsx` contrôle la saisie au fil de
 * la frappe, avec LES MÊMES fonctions que celles appelées ici — c'est
 * tout l'intérêt d'avoir gardé `identite.ts` pur. Mais ce contrôle-là
 * est un CONFORT : il montre la faute avant l'envoi. Il ne décide rien.
 *
 * La décision est prise ici, côté serveur, où aucune valeur postée ne
 * peut sauter le contrôle. Un `fetch` fabriqué à la main ne voit pas le
 * formulaire ; il voit cette fonction.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI EST REFUSÉ À L'ÉCRITURE, ET CE QUI NE L'EST PAS
 * ══════════════════════════════════════════════════════════════════
 *
 * REFUSÉ : un identifiant PRÉSENT ET FAUX. Un SIRET dont la clé de
 * contrôle ne tombe pas est une faute de frappe ; l'enregistrer, c'est
 * fabriquer la facture non conforme de dans trois mois, et personne ne
 * la corrigera parce que personne ne saura qu'elle est fausse.
 *
 * ACCEPTÉ : un identifiant ABSENT. Quelqu'un qui découvre le produit un
 * dimanche soir n'a pas son Kbis sous la main. Le lui réclamer pour
 * entrer, c'est le perdre. L'écran d'abonnement dira ce qui manque, et
 * le tunnel de paiement l'exigera — parce que payer, lui, déclenche une
 * facture.
 *
 * Cette asymétrie est la décision de conception de tout ce chantier.
 * Elle n'est pas un compromis mou : les deux seuils sont placés là où
 * leur conséquence tombe.
 */

/** Les champs de la fiche que `updateCompanyProfile` réécrit à chaque appel. */
const CHAMPS_PORTES = [
  "name", "business_type", "legal_name", "trade_name", "legal_form",
  "siren", "siret", "vat_number", "rcs_city", "share_capital",
  "address_line1", "address_line2", "postal_code", "city", "country",
  "email", "phone", "website", "currency", "locale", "timezone",
  "employee_count_override",
] as const;

function texte(formData: FormData, cle: string): string {
  return String(formData.get(cle) ?? "").trim();
}

/**
 * Retour à l'étape avec la faute affichée ET la saisie conservée.
 *
 * Renvoyer vers un formulaire vide après un refus est la façon la plus
 * sûre de faire abandonner : la personne a saisi douze champs, on lui
 * en rend zéro. Les valeurs repartent donc dans l'URL — ce sont des
 * identifiants d'entreprise, publics par nature (le registre Sirene
 * l'est), et jamais une donnée personnelle.
 */
function retourAvecFaute(formData: FormData, champ: string, message: string): never {
  const params = new URLSearchParams();
  params.set("etape", "societe");
  params.set("champ", champ);
  params.set("erreur", message);
  // L'INTENTION SURVIT AU REFUS. Sans cette ligne, une faute de frappe
  // dans le SIRET d'une SECONDE entreprise ramènerait un formulaire qui
  // modifie la première : le drapeau serait perdu en chemin, et la
  // correction se serait écrite sur la mauvaise société.
  if (texte(formData, "nouvelle") === "1") params.set("nouvelle", "1");
  for (const cle of CHAMPS_PORTES) {
    const valeur = texte(formData, cle);
    if (valeur !== "") params.set(`v_${cle}`, valeur);
  }
  redirect(`/inscription?${params.toString()}`);
}

/**
 * Le contrôle des identifiants, commun à la création et à la mise à
 * jour. Il ne rend rien : il laisse passer, ou il redirige.
 */
function refuserLesIdentifiantsFaux(formData: FormData): void {
  const pays = texte(formData, "country") || "FR";

  const siret = verifierSiret(texte(formData, "siret"));
  if (siret.etat === "invalide") {
    retourAvecFaute(formData, "siret", siret.message ?? "Ce SIRET est invalide.");
  }

  const siren = verifierSiren(texte(formData, "siren"));
  if (siren.etat === "invalide") {
    retourAvecFaute(formData, "siren", siren.message ?? "Ce SIREN est invalide.");
  }

  // Deux champs qui se contredisent : l'un des deux appartient à une
  // autre entreprise, et aucun service extérieur n'est nécessaire pour
  // le voir.
  const coherence = verifierCoherenceSirenSiret(texte(formData, "siren"), texte(formData, "siret"));
  if (coherence.etat === "invalide") {
    retourAvecFaute(formData, "siret", coherence.message ?? "Le SIREN et le SIRET se contredisent.");
  }

  const tva = verifierTvaIntracom(texte(formData, "vat_number"), pays, texte(formData, "siren"));
  if (tva.etat === "invalide") {
    retourAvecFaute(formData, "vat_number", tva.message ?? "Ce numéro de TVA est invalide.");
  }
  // « invérifiable » passe : refuser un numéro étranger faute d'avoir pu
  // le contrôler fermerait la porte à toute entreprise européenne.
}

/**
 * NORMALISER AVANT D'ÉCRIRE.
 *
 * Ce qui part en base est la forme canonique — chiffres seuls pour le
 * SIREN et le SIRET, majuscules sans espace pour la TVA. Sinon la même
 * entreprise s'enregistre « 732 829 320 00074 » un jour et
 * « 73282932000074 » le lendemain, et la facture porte l'une des deux au
 * hasard. La base n'a pas à ranger ce que le formulaire aurait dû
 * ranger.
 */
function normaliserDansLeFormulaire(formData: FormData): void {
  const siret = chiffresSeuls(texte(formData, "siret"));
  const siren = chiffresSeuls(texte(formData, "siren"));
  const tva = normaliserTva(texte(formData, "vat_number"));

  formData.set("siret", siret);
  // Le SIREN se DÉDUIT du SIRET quand il n'a pas été saisi : le
  // redemander serait faire recopier neuf chiffres déjà présents dans
  // les quatorze d'à côté.
  formData.set("siren", siren !== "" ? siren : siret.length === 14 ? siret.slice(0, 9) : "");
  formData.set("vat_number", tva);
  formData.set("country", (texte(formData, "country") || "FR").toUpperCase());
}

/**
 * Les avertissements DOUX, déposés dans le bandeau après l'écriture.
 * Ils ne bloquent rien — ils disent ce qu'on n'a pas pu vérifier.
 */
async function signalerCeQuOnNaPasPuVerifier(formData: FormData): Promise<void> {
  const doux = avertissements({
    legalName: texte(formData, "legal_name") || null,
    legalForm: texte(formData, "legal_form") || null,
    siren: texte(formData, "siren") || null,
    siret: texte(formData, "siret") || null,
    vatNumber: texte(formData, "vat_number") || null,
    addressLine1: texte(formData, "address_line1") || null,
    postalCode: texte(formData, "postal_code") || null,
    city: texte(formData, "city") || null,
    country: texte(formData, "country") || null,
  });
  // Ton « info » et non « error » : ce n'est pas un échec, l'écriture a
  // eu lieu. C'est une chose qu'on n'a PAS PU vérifier, et le dire en
  // rouge ferait croire à un refus. (`FlashTone` ne connaît que
  // success / error / info : il n'y a pas de ton intermédiaire.)
  if (doux.length > 0) await flash("info", doux[0]);
}

/**
 * L'AVANCEMENT DU PARCOURS D'INSTALLATION, POSÉ À LA CRÉATION.
 *
 * `onboarding_step` est ce qui fait retomber quelqu'un sur la bonne
 * étape de `/bienvenue` le lendemain. La colonne vaut ZÉRO par défaut
 * (migration 0060), et `/bienvenue` traite « en dessous de 3 » comme
 * « entreprise née avant que ce parcours existe » : elle renvoie alors
 * à l'accueil.
 *
 * Tant que `/bienvenue` créait les entreprises, il posait 3 lui-même.
 * Maintenant que la création vit ICI et nulle part ailleurs, c'est ici
 * qu'il faut le poser — sans quoi TOUTE entreprise neuve se verrait
 * refuser l'installation de son propre espace, avec son logo, ses
 * modules et son équipe. C'est le défaut mesuré en production sur la
 * première organisation du produit.
 *
 * Une écriture qui échoue n'annule rien : l'entreprise existe, elle est
 * facturable, et rater le fil du parcours d'installation ne vaut pas de
 * perdre une inscription.
 */
async function poserLeDepartDeLInstallation(organizationId: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase
      .from("business_organizations")
      .update({ onboarding_step: 3, updated_at: new Date().toISOString() })
      .eq("id", organizationId)
      // JAMAIS EN ARRIÈRE. Sur une création, la colonne vaut zéro et ce
      // filtre ne change rien ; il est là pour que la ligne reste juste
      // si ce code venait un jour à être appelé deux fois.
      .lt("onboarding_step", 3);
  } catch {
    // Voir ci-dessus : un fil de parcours perdu ne vaut pas une
    // inscription perdue.
  }
}

/**
 * ÉTAPE « SOCIÉTÉ » — création de l'entreprise si elle n'existe pas
 * encore, puis enregistrement de son identité légale.
 *
 * ══════════════════════════════════════════════════════════════════
 * C'EST DÉSORMAIS LE SEUL ENDROIT DU PRODUIT QUI CRÉE UNE ENTREPRISE
 * ══════════════════════════════════════════════════════════════════
 *
 * `/bienvenue` en créait une lui aussi, avec son propre formulaire et
 * ses propres écritures. Les deux appelaient la même fonction Postgres
 * mais n'enregistraient PAS la même chose : celui-ci pose la fiche
 * entière et met le numéro de TVA dans la file de vérification, l'autre
 * posait un nom et un métier. Une entreprise née par l'autre chemin
 * n'avait donc aucun dossier fiscal, et `saas_issue_invoice` aurait
 * refusé d'émettre sa première facture — mesuré en production sur la
 * première organisation du produit.
 *
 * Deux chemins de création finissent toujours par diverger. Il n'en
 * reste qu'un, et c'est celui qui sait facturer, parce que la règle du
 * dirigeant — carte obligatoire avant l'essai — impose que le contrat
 * précède l'accès. Un chemin de création qui ne sait pas facturer ne
 * peut pas être le premier.
 *
 * La création passe par `create_professional_organization()`, comme
 * partout ailleurs : elle fabrique l'espace de travail, l'organisation
 * et l'appartenance du propriétaire EN UNE SEULE TRANSACTION. Trois
 * appels séparés laisseraient, au premier échec, une organisation sans
 * propriétaire — c'est-à-dire une organisation dont plus personne ne
 * peut ouvrir la porte.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA DEUXIÈME ENTREPRISE — `nouvelle`
 * ══════════════════════════════════════════════════════════════════
 *
 * Sans ce drapeau, cette action ne crée que lorsqu'AUCUNE entreprise
 * n'est active : elle modifie l'existante le reste du temps, ce qui est
 * exactement ce qu'il faut quand on revient corriger sa fiche. Mais le
 * produit est multi-entreprises (§13), et un paysagiste qui en fonde
 * une seconde doit pouvoir le faire quelque part. `nouvelle=1` est ce
 * quelque part, et il est explicite : il vient d'un champ caché du
 * formulaire, jamais d'une déduction.
 */
export async function enregistrerSociete(formData: FormData): Promise<void> {
  const nom = texte(formData, "name").slice(0, 120);
  if (nom === "") {
    retourAvecFaute(formData, "name", "Le nom de l'entreprise est nécessaire pour aller plus loin.");
  }

  const metierDemande = texte(formData, "business_type");
  const metier: BusinessType = BUSINESS_TYPES.includes(metierDemande as BusinessType)
    ? (metierDemande as BusinessType)
    : "landscaper";
  formData.set("business_type", metier);

  normaliserDansLeFormulaire(formData);
  refuserLesIdentifiantsFaux(formData);

  // Le drapeau vient du champ caché du formulaire, et de lui seul.
  const nouvelle = texte(formData, "nouvelle") === "1";

  let organisation = await getActiveOrganization();

  if (organisation === null || nouvelle) {
    if (nouvelle) {
      // UN DOUBLE ENVOI NE FONDE PAS DEUX SOCIÉTÉS. Le bouton
      // « Continuer » cliqué deux fois, ou une page rechargée, ne doit
      // pas laisser deux entreprises jumelles derrière lui — deux
      // abonnements à payer, deux jeux de clients, et personne pour
      // dire laquelle est la bonne.
      const deja = await getUserOrganizations();
      const homonyme = deja.find(
        (o) => o.name.trim().toLocaleLowerCase("fr") === nom.toLocaleLowerCase("fr"),
      );
      if (homonyme) {
        retourAvecFaute(
          formData,
          "name",
          `Vous avez déjà une entreprise nommée « ${homonyme.name} ». Choisissez un autre nom, ou basculez dessus depuis le menu en haut de la barre latérale.`,
        );
      }
    }

    const supabase = await createClient();
    const { data: identifiantCree, error } = await supabase.rpc(
      "create_professional_organization",
      { org_name: nom, org_business_type: metier },
    );
    if (error) throw new Error(traduireRefus(error));

    /**
     * LA NOUVELLE ENTREPRISE DEVIENT L'ACTIVE, TOUT DE SUITE.
     *
     * `getActiveOrganization()` suit le cookie du sélecteur
     * d'entreprise et, à défaut, prend la première par ordre
     * alphabétique. Sans cette ligne, fonder « Atelier Vert » depuis un
     * compte qui possède déjà « Paysages Martin » remplirait la fiche
     * de Paysages Martin et lui souscrirait l'abonnement : le tunnel
     * entier travaillerait sur la mauvaise société, sans rien signaler.
     *
     * Le cookie n'exprime qu'une PRÉFÉRENCE, comme celui de
     * `switchOrganization` : `getActiveOrganization` la confronte aux
     * appartenances réelles avant de la suivre, et RLS refuserait de
     * toute façon.
     */
    if (typeof identifiantCree === "string" && identifiantCree !== "") {
      const store = await cookies();
      store.set(ACTIVE_ORGANIZATION_COOKIE, identifiantCree, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
        httpOnly: true,
      });
    }

    // La mise en page entière dépend de l'existence de l'organisation :
    // barre latérale, menu, sélecteur d'entreprise.
    revalidatePath("/", "layout");

    organisation = await getActiveOrganization();
    if (organisation === null) {
      // La fonction a rendu sans erreur mais l'appartenance n'est pas
      // visible : mieux vaut le dire que d'enchaîner sur une écriture
      // qui échouera plus loin, sans rapport apparent avec la cause.
      throw new Error(
        "L'entreprise a été créée mais reste introuvable pour votre compte. Rechargez la page.",
      );
    }

    // L'INSTALLATION DU LOGICIEL COMMENCE ICI, même si elle se joue
    // ailleurs. Voir `poserLeDepartDeLInstallation`.
    await poserLeDepartDeLInstallation(organisation.organizationId);
  }

  // `updateCompanyProfile` réécrit la fiche ENTIÈRE : c'est pour cela
  // que le formulaire renvoie tous les champs, y compris ceux qu'il
  // n'affiche pas (en champs cachés). Un second chemin d'écriture aurait
  // fini par diverger de celui de `/entreprise`, et l'inscription aurait
  // enregistré des champs que la fiche société ne relit pas.
  await updateCompanyProfile(formData);

  /**
   * LA VÉRIFICATION DU NUMÉRO DE TVA PART ICI, ET L'INSCRIPTION NE
   * L'ATTEND PAS.
   *
   * Le service européen VIES tombe régulièrement, État membre par État
   * membre. Une inscription qui exigerait sa réponse serait fermée à
   * tout un pays chaque fois que son registre est indisponible — et la
   * personne devant l'écran n'y comprendrait rien.
   *
   * On se contente donc de METTRE L'ENTREPRISE DANS LA FILE. Ce qui
   * attend la réponse, c'est l'émission de la facture, et c'était déjà
   * le comportement de la base depuis 0081.
   *
   * IL FAUT L'APPELER À CHAQUE ENREGISTREMENT, pas seulement à la
   * création : c'est `saas_vies_enqueue()` qui détecte qu'un numéro a
   * changé et qui efface alors la validation de l'ancien. Sans cet
   * appel, corriger son numéro laisserait la vérification du précédent
   * valoir pour le nouveau.
   *
   * ELLE NE LANCE PAS, par construction (`lib/tva/file.ts`) : une panne
   * de la base à cet instant ne doit pas coûter une inscription.
   */
  const supabaseTva = await createClient();
  await programmerValidationTva(supabaseTva, organisation.organizationId);

  await signalerCeQuOnNaPasPuVerifier(formData);

  redirect("/inscription?etape=offre");
}

// ==================================================================
// ÉTAPE « OFFRE » — L'OUVERTURE DU PAIEMENT, ET SES QUATRE VERROUS
// ==================================================================

/**
 * §3.bis « avant de souscrire, celui qui s'abonne est au courant qu'il
 * est engagé » — et c'est LE SERVEUR qui le vérifie.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE SERVER ACTION ET NON LE `fetch` VERS L'API
 * ══════════════════════════════════════════════════════════════════
 *
 * L'écran appelait autrefois une route `POST /api/stripe/checkout`.
 * Cette route ne connaissait pas l'engagement : lui poster un champ
 * « case cochée » qu'elle ignorait aurait laissé la vérification au
 * seul navigateur, c'est-à-dire nulle part. Une case cochée dans un
 * `fetch` fabriqué à la main coûte trois secondes.
 *
 * ELLE A ÉTÉ SUPPRIMÉE, et pas seulement contournée. Tant qu'elle
 * existait, elle restait montée et atteignable — donc elle était le
 * contournement du verrou, pas un vestige : sur une entreprise portant
 * la remise fondateur, un `fetch` de trois lignes déclenchait douze
 * mois d'engagement sans qu'aucune case n'ait jamais existé. Garder
 * deux portes dont une seule vérifie, c'est garder celle qui ne
 * vérifie pas.
 *
 * Cette action est donc la SEULE porte. Le moteur, lui, n'a pas changé
 * — `provider.startCheckout()` relit tout en base et recalcule : il n'y
 * a pas deux calculs de montant, il n'y en a jamais eu qu'un.
 *
 * Si une porte HTTP redevient nécessaire un jour — client mobile,
 * intégration tierce — elle devra appeler LE MÊME préambule que cette
 * action, pas le réécrire.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI NE FRANCHIT PAS CETTE PORTE
 * ══════════════════════════════════════════════════════════════════
 *
 * AUCUN MONTANT, AUCUN CODE DE REMISE, AUCUNE ENTREPRISE. L'entreprise
 * vient de la session ; le prix est relu en base ; la remise est celle
 * qui est ACCORDÉE, jamais celle qui est réclamée. Ce qui entre, c'est
 * une intention et un geste d'acceptation — et le geste lui-même est
 * revérifié contre la base, pas cru sur parole.
 */

export type DemandePaiement = {
  planKey: string;
  billingCycle: string;
  moduleKeys: string[];
  /** La case d'engagement a-t-elle été cochée ? Jamais pré-cochée. */
  engagementCoche: boolean;
  /** La version du texte d'engagement AFFICHÉE au moment de cocher. */
  versionEngagementAffichee: string | null;
  /**
   * LE CLIENT ENTRE-T-IL PAR L'ESSAI D'UN MOIS ?
   *
   * Un booléen, pas une date ni un montant : le serveur calcule la date
   * de fin et décide si l'essai est seulement possible. Ce que le
   * navigateur envoie, c'est un CHEMIN.
   */
  avecEssai: boolean;
};

function refus(reason: string): CheckoutOutcome {
  return { kind: "unavailable", reason };
}

// ==================================================================
// L'ÉTAPE « RÉSUMÉ » — CE QUI SERA PRÉLEVÉ, ET QUAND
// ==================================================================

/**
 * §15 « Choisir → Résumé → Paiement → Confirmation ». L'étape RÉSUMÉ,
 * qui n'engage rien.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UNE SERVER ACTION, ALORS QU'UNE ROUTE EXISTAIT DÉJÀ
 * ══════════════════════════════════════════════════════════════════
 *
 * L'écran demandait son résumé à `POST /api/stripe/resume`. Cette route
 * lit l'intention avec `lireIntention()`, qui n'accepte que TROIS clés
 * — offre, rythme, modules — et écarte tout le reste. C'est une bonne
 * porte, et elle le restera : c'est elle qui garantit qu'aucun montant
 * ne franchit la frontière.
 *
 * Mais elle ne sait pas dire « avec essai » ou « sans essai ». Le
 * résumé aurait donc annoncé une date de prélèvement calculée sur le
 * chemin par défaut, pendant que le bouton d'à côté en aurait envoyé
 * une autre au prestataire. Un écran qui annonce une date et en prélève
 * une autre est exactement ce que ce chantier existe pour empêcher.
 *
 * Cette action-ci pose donc LA MÊME question que le paiement, avec la
 * MÊME réponse, calculée par le MÊME code — c'est le raisonnement déjà
 * suivi quand la route de paiement a été supprimée au profit d'une
 * action. La route de résumé, elle, n'est PAS supprimée : elle
 * n'appartient pas à ce chantier, elle reste juste sur le chemin par
 * défaut. Le compte rendu demande à l'intégration de trancher son sort.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES MÊMES DEUX VERROUS QUE LA ROUTE
 * ══════════════════════════════════════════════════════════════════
 *
 * Le résumé montre l'effectif facturable et la remise accordée : ce
 * sont des informations de direction, pas des informations d'écran. On
 * les réserve à ceux qui peuvent souscrire, comme le fait la route.
 */
export async function resumerSouscription(demande: {
  planKey: string;
  billingCycle: string;
  moduleKeys: string[];
  avecEssai: boolean;
}): Promise<ResumeSouscription> {
  const organisation = await getActiveOrganization();
  if (organisation === null) {
    return {
      jouable: false,
      code: "sessionExpiree",
      motif: "Votre session a expiré. Reconnectez-vous pour continuer.",
    };
  }

  if (!peutSouscrire(organisation.role)) {
    return {
      jouable: false,
      code: "roleInsuffisant",
      motif:
        "Seul le propriétaire ou un administrateur de l'entreprise peut consulter le détail d'une souscription.",
    };
  }

  // LE MÊME LECTEUR QUE LA ROUTE ET QUE LE PAIEMENT. Une troisième
  // lecture écrite ici aurait fini par accepter ce que les deux autres
  // refusent.
  const lecture = lireIntention({
    planKey: demande.planKey,
    billingCycle: demande.billingCycle,
    moduleKeys: demande.moduleKeys,
  });
  if (!lecture.ok) {
    return { jouable: false, code: "intentionInvalide", motif: lecture.motif };
  }

  const provider = getBillingProvider();
  if (provider.previewCheckout === undefined) {
    return {
      jouable: false,
      code: "encaissementIndisponible",
      motif:
        provider.unavailableReason
        ?? "Le détail d'une souscription n'est pas disponible pour le moment.",
    };
  }

  return provider.previewCheckout({
    // L'ENTREPRISE VIENT DE LA SESSION, jamais de la requête.
    organizationId: organisation.organizationId,
    planKey: lecture.intention.planKey,
    billingCycle: lecture.intention.billingCycle,
    moduleKeys: lecture.intention.moduleKeys,
    avecEssai: demande.avecEssai,
  });
}

export async function ouvrirLePaiement(demande: DemandePaiement): Promise<CheckoutOutcome> {
  // ---- 1. QUI DEMANDE, ET A-T-IL LE DROIT D'ENGAGER LA SOCIÉTÉ ? ---
  const organisation = await getActiveOrganization();
  if (organisation === null) {
    return refus("Votre session a expiré. Reconnectez-vous pour souscrire.");
  }
  // Souscrire engage financièrement la société. L'absence de bouton n'a
  // jamais arrêté personne ; ce contrôle-ci, si.
  if (!peutSouscrire(organisation.role)) {
    return refus(
      "Seul le propriétaire ou un administrateur de l'entreprise peut souscrire un abonnement.",
    );
  }

  // ---- 2. CE QUI EST DEMANDÉ, RELU AVEC LE MÊME LECTEUR ------------
  // `lireIntention` est celui de la route : une seconde lecture écrite
  // ici aurait fini par accepter ce que l'autre refuse.
  const lecture = lireIntention({
    planKey: demande.planKey,
    billingCycle: demande.billingCycle,
    moduleKeys: demande.moduleKeys,
  });
  if (!lecture.ok) return refus(lecture.motif);
  const intention = lecture.intention;

  const supabase = await createClient();
  const leJour = jourDeReference();

  // ---- 3. Y A-T-IL UN ENGAGEMENT SUR CETTE OFFRE ? -----------------
  // Les trois chiffres sont RELUS EN BASE, jamais repris de la requête :
  // ce que le navigateur affirme avoir affiché ne prouve rien.
  const [texte, offresEngageantes, offres] = await Promise.all([
    lireTexteEngagement(supabase),
    lireOffresEngageantes(supabase, leJour),
    lirePlansActifs(supabase),
  ]);

  const prixPublics = new Map(offres.map((offre) => [offre.key, offre.monthlyPriceCents]));

  const provider = getBillingProvider();

  // ---- 4. CE QUI SERAIT RÉELLEMENT PRÉLEVÉ, RELU AVANT TOUT --------
  //
  // LE RÉSUMÉ EST DEMANDÉ SYSTÉMATIQUEMENT, et non plus seulement quand
  // une annonce d'engagement a pu être lue. C'est ce qui ferme la faille
  // : l'annonce vient du catalogue, que la RLS cache au client ; la
  // REMISE, elle, est lisible, et c'est elle qui dit si la souscription
  // engage. Ne consulter le résumé qu'« en cas d'annonce » revenait à ne
  // jamais regarder dans le seul cas où il fallait regarder.
  if (provider.previewCheckout === undefined) {
    return refus(
      "Le détail de ce qui serait prélevé ne peut pas être vérifié ici. Nous n'ouvrons pas la caisse sans lui : écrivez-nous, rien n'a été prélevé.",
    );
  }

  const resume = await provider.previewCheckout({
    organizationId: organisation.organizationId,
    planKey: intention.planKey,
    billingCycle: intention.billingCycle,
    moduleKeys: intention.moduleKeys,
    avecEssai: demande.avecEssai,
  });
  if (!resume.jouable) return refus(resume.motif);

  // ---- 4 bis. L'ANNONCE D'ENGAGEMENT, DATÉE PAR LE SERVEUR ---------
  //
  // ELLE EST CONSTRUITE APRÈS LE RÉSUMÉ, ET C'EST LE POINT.
  //
  // L'engagement ne commence pas le jour de la souscription quand il y
  // a un essai : il commence au PREMIER PRÉLÈVEMENT. C'est la règle du
  // socle, et la base la rend non contournable — le déclencheur
  // `subscription_discounts_trial_guard` refuse toute remise engageante
  // qui démarrerait un autre jour. La raison est chiffrée : poser la
  // remise à la souscription ferait payer ONZE mois à 49,90 € au lieu
  // de douze, et le douzième basculerait au tarif public en silence.
  //
  // La date vient donc du RÉSUMÉ — c'est-à-dire du même calcul que
  // celui qui partira au prestataire — et non d'un second calcul fait
  // ici. Deux calendriers, ce sont deux dates, et c'est la mauvaise
  // qu'on ferait cocher.
  const debutEngagementLe = resume.essai?.plan.premierPrelevementLe ?? leJour;
  const annonce =
    annoncesParOffre(offresEngageantes, prixPublics, { debutLe: debutEngagementLe }).get(
      intention.planKey,
    ) ?? null;

  // ---- 5. LE GESTE D'ACCEPTATION -----------------------------------
  const acceptation = verifierAcceptation({
    annonce,
    cochee: demande.engagementCoche,
    versionAcceptee: demande.versionEngagementAffichee,
    versionCourante: texte?.version ?? null,
    // LA SOURCE DE VÉRITÉ SUR « EST-CE QUE ÇA ENGAGE ? ». Elle vient de
    // la remise accordée, pas du catalogue.
    engageJusquAu: resume.remise?.engageJusquAu ?? null,
  });
  if (!acceptation.ok) return refus(acceptation.motif);

  // Les contrôles suivants ne concernent QUE les souscriptions dont
  // l'engagement a pu être annoncé. Le cas « ça engage mais on n'a pas
  // pu l'annoncer » vient d'être refusé juste au-dessus.
  if (annonce !== null) {
    // ---- 6. CE QUI EST ANNONCÉ EST-IL CE QUI SERA PRÉLEVÉ ? --------
    const tarif = verifierTarifAnnonce({
      annonce,
      remiseAppliquee:
        resume.remise === null
          ? null
          : { code: resume.remise.code, prixRemiseHtCents: resume.remise.prixRemiseHtCents },
    });
    if (!tarif.ok) return refus(tarif.motif);

    // ---- 7. LA PREUVE EXISTE-T-ELLE ? ------------------------------
    const enregistree = await lireDerniereAcceptation(supabase, organisation.organizationId);
    const preuve = verifierPreuve({
      annonce,
      preuveEnregistree:
        enregistree === null
          ? null
          : { version: enregistree.version, discountCode: enregistree.discountCode },
      versionAffichee: texte?.version ?? null,
    });
    if (!preuve.ok) return refus(preuve.motif);
  }

  // ---- 8. ET SEULEMENT MAINTENANT, LA CAISSE ----------------------
  // Aucun droit n'est ouvert ici : c'est l'événement SIGNÉ reçu par le
  // webhook qui fera foi. Cette action ne fait qu'ouvrir la porte.
  try {
    /**
     * CE QU'ON VIENT DE DEMANDER, RETENU LE TEMPS DU TRAJET.
     *
     * Le client part chez le prestataire et revient chez nous quelques
     * secondes plus tard — presque toujours AVANT l'événement signé.
     * À cet instant, `organization_subscriptions` est encore vide : la
     * page de confirmation n'aurait littéralement rien à afficher, au
     * moment précis où la personne vient de donner sa carte.
     *
     * On pose donc un aide-mémoire, AVANT d'ouvrir la caisse plutôt
     * qu'après : la fonction ci-dessous rend une URL, et le navigateur
     * peut partir dessus sans nous laisser le temps d'écrire quoi que
     * ce soit ensuite.
     *
     * IL N'OUVRE AUCUN DROIT — c'est un texte de paragraphe, et rien
     * d'autre. Voir `paiement-partage.ts`.
     *
     * Les dates viennent du RÉSUMÉ, c'est-à-dire du même calcul que
     * celui qui part au prestataire. Un second calcul fait ici dirait
     * une autre date à l'écran que celle qui sera prélevée.
     */
    await poserPaiementEnCours({
      planKey: intention.planKey,
      cycle: intention.billingCycle,
      avecEssai: resume.essai?.plan.avecEssai ?? demande.avecEssai,
      premierPrelevementLe: resume.essai?.plan.premierPrelevementLe ?? leJour,
      finEssaiLe: resume.essai?.plan.finEssaiLe ?? null,
    });

    return await provider.startCheckout({
      // L'ENTREPRISE VIENT DE LA SESSION, jamais de la requête.
      organizationId: organisation.organizationId,
      planKey: intention.planKey,
      billingCycle: intention.billingCycle,
      moduleKeys: intention.moduleKeys,
      // LE MÊME CHEMIN QUE CELUI QUI VIENT D'ÊTRE CHIFFRÉ. Le résumé a
      // annoncé une date de prélèvement ; c'est celle-là qui part.
      avecEssai: demande.avecEssai,
    });
  } catch (erreur) {
    console.error(
      "souscription : ouverture de session de paiement refusée —",
      erreur instanceof Error ? erreur.message : String(erreur),
    );
    return refus(
      "La page de paiement n'a pas pu être ouverte. Rien n'a été prélevé ; réessayez dans un instant.",
    );
  }
}

// ==================================================================
// L'ÉTAPE « CONFIRMATION » — LES DEUX SORTIES
// ==================================================================

/**
 * §15 « Choisir → Résumé → Paiement → Confirmation ». La sortie.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI DEUX ACTIONS PLUTÔT QUE DEUX LIENS
 * ══════════════════════════════════════════════════════════════════
 *
 * Parce qu'un lien ne peut pas effacer un cookie. L'aide-mémoire du
 * paiement (`paiement-partage.ts`) vaut deux heures : il est ce qui
 * permet de dire « nous attendons la confirmation de votre paiement »
 * pendant que le prestataire nous répond. Passé la confirmation lue, il
 * n'a plus rien à dire, et le laisser traîner ferait retomber sur
 * l'écran d'attente quelqu'un qui est déjà entré dans le logiciel.
 *
 * On l'efface donc AU MOMENT OÙ LA PERSONNE S'EN VA, et pas avant :
 * tant qu'elle est sur la confirmation, elle peut recharger, revenir,
 * relire — et c'est le cookie qui lui permet d'y retrouver ce qu'elle a
 * demandé tant que la base ne le sait pas encore.
 *
 * Aucune des deux ne touche à un droit ni à un abonnement. Elles
 * ferment un aide-mémoire et changent de page.
 */
export async function installerMonEspace(): Promise<void> {
  await oublierPaiementEnCours();
  // L'installation du LOGICIEL : logo, mentions, effectif, modules,
  // équipe. Facultative de bout en bout — c'était une bonne décision,
  // et brancher le péage ne la défait pas.
  redirect("/bienvenue");
}

export async function entrerDansLApplication(): Promise<void> {
  await oublierPaiementEnCours();
  redirect("/");
}
