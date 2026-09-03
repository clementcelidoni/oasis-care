"use server";

import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/organization";
import { parseNumber } from "@/lib/quotes/types";
import { calculerCoutDeplacement } from "./cost.ts";
import {
  coutVehiculeParKmCents,
  deplacementDeviseEnHeures,
  tauxHoraireMedianCents,
} from "./donnees.ts";
import { situerCommune } from "./geocodage.ts";
import {
  construireRecommandations,
  construireRisques,
  lireAnalysePrix,
  type AnalysePrix,
  type Recommandation,
  type Risque,
} from "./analyse.ts";
import {
  connu,
  inconnu,
  type PeutEtreInconnu,
  type PointGeographique,
  type ResultatTravelCost,
} from "./types.ts";

/**
 * §11V — le panneau d'analyse d'un devis, côté serveur.
 *
 * TROIS RÈGLES DE SÉCURITÉ DE LA SPEC TIENNENT DANS CE FICHIER.
 *
 *   « L'organisation vient de la SESSION, jamais d'un paramètre choisi
 *   par le modèle. » → `requireOrganization()`, et le devis est relu
 *   avec un filtre explicite sur cette organisation. Un identifiant de
 *   devis appartenant à une autre entreprise ne trouve rien, avant même
 *   que la RLS ait à s'en mêler.
 *
 *   « Un agent agit avec LES PERMISSIONS DE L'UTILISATEUR. » → tout
 *   passe par le client Supabase de la session. `ai_quote_price_analysis`
 *   est `security invoker` : elle voit ce que l'utilisateur voit, et
 *   rien de plus.
 *
 *   « Récupération contextuelle ciblée, données minimisées. » → on lit
 *   UN devis, ses lignes de transport, le siège, le site du chantier, et
 *   deux taux agrégés. Jamais le portefeuille, jamais la base.
 *
 * ET UNE RÈGLE DE PRODUIT : cette action ne calcule QUE. Elle n'écrit
 * rien, ne propose aucun enregistrement, ne touche pas au prix du devis.
 * Le panneau est un avis, pas une action.
 */

export type EtatAnalyseDevis =
  | { statut: "vide" }
  | { statut: "erreur"; message: string }
  | {
      statut: "ok";
      devis: { id: string; numero: string | null; titre: string | null };
      analysePrix: AnalysePrix | null;
      motifAnalysePrixIndisponible: string | null;
      deplacement: ResultatTravelCost;
      hypothesesRetenues: HypothesesRetenues;
      montantTransportDeviseCents: number;
      risques: Risque[];
      recommandations: Recommandation[];
    };

/** Ce que l'écran doit réafficher dans ses champs après un calcul. */
export type HypothesesRetenues = {
  effectif: string;
  jours: string;
  vehicules: string;
  minutes: string;
  coutKmEuros: string;
  peagesEuros: string;
  /** Vrai quand la durée a été reprise du chantier plutôt que saisie. */
  joursDeduitsDuChantier: boolean;
};

export async function analyserDevis(
  _precedent: EtatAnalyseDevis,
  formulaire: FormData,
): Promise<EtatAnalyseDevis> {
  const organisation = await requireOrganization();
  const supabase = await createClient();

  const quoteId = String(formulaire.get("quote_id") ?? "").trim();
  if (!quoteId) return { statut: "erreur", message: "Devis introuvable." };

  // ---------- Le devis, filtré sur l'organisation de la session ----------
  const { data: devis } = await supabase
    .from("quotes")
    .select(
      `id, number, title, site_id, customer_id,
       crm_customer_sites ( city, postal_code, latitude, longitude, address_line1 ),
       crm_customers ( billing_city, billing_postal_code )`,
    )
    .eq("id", quoteId)
    .eq("organization_id", organisation.organizationId)
    .maybeSingle();

  if (!devis) {
    return {
      statut: "erreur",
      message: "Ce devis n'existe pas, ou n'appartient pas à l'entreprise active.",
    };
  }

  // ---------- Les hypothèses saisies ----------
  const saisie = {
    effectif: String(formulaire.get("effectif") ?? "").trim(),
    jours: String(formulaire.get("jours") ?? "").trim(),
    vehicules: String(formulaire.get("vehicules") ?? "").trim(),
    minutes: String(formulaire.get("minutes") ?? "").trim(),
    coutKmEuros: String(formulaire.get("cout_km") ?? "").trim(),
    peagesEuros: String(formulaire.get("peages") ?? "").trim(),
  };

  const joursSaisis = parseNumber(saisie.jours);
  const joursDuChantier = await dureeDuChantier(supabase, organisation.organizationId, quoteId);
  const jours = joursSaisis ?? joursDuChantier;

  // ---------- Situer les deux bouts du trajet ----------
  const site = premierObjet(devis.crm_customer_sites) as {
    city: string | null;
    postal_code: string | null;
    latitude: number | null;
    longitude: number | null;
    address_line1: string | null;
  } | null;
  const client = premierObjet(devis.crm_customers) as {
    billing_city: string | null;
    billing_postal_code: string | null;
  } | null;

  const [siege, chantier] = await Promise.all([
    situerSiege(supabase, organisation.organizationId),
    situerChantier(site, client),
  ]);

  // ---------- Les taux, et ce qui manque ----------
  const [tauxHoraire, coutKmObserve, deplacementDevise] = await Promise.all([
    tauxHoraireMedianCents(supabase, organisation.organizationId),
    coutVehiculeParKmCents(supabase, organisation.organizationId),
    deplacementDeviseEnHeures(supabase, organisation.organizationId, quoteId),
  ]);

  // Un coût kilométrique saisi l'emporte sur la déduction : l'utilisateur
  // connaît son carburant, la base ne le connaît pas.
  const coutKmSaisiEuros = parseNumber(saisie.coutKmEuros);
  const coutVehicule: PeutEtreInconnu<number> =
    coutKmSaisiEuros !== null && coutKmSaisiEuros >= 0
      ? connu(Math.round(coutKmSaisiEuros * 100), "coût kilométrique saisi")
      : coutKmObserve;

  const peagesSaisisEuros = parseNumber(saisie.peagesEuros);
  const peages: PeutEtreInconnu<number> =
    peagesSaisisEuros !== null && peagesSaisisEuros >= 0
      ? connu(Math.round(peagesSaisisEuros * 100), "péages saisis par aller-retour")
      : inconnu(
          "aucunePeageEnBase",
          "Aucun péage n'est enregistré dans Oasis : si le trajet en comporte, saisissez le montant d'un aller-retour.",
        );

  const deplacement = calculerCoutDeplacement({
    siege,
    chantier,
    hypotheses: {
      effectif: parseNumber(saisie.effectif),
      joursChantier: jours,
      nombreDeVehicules: parseNumber(saisie.vehicules),
      tempsAllerMinutesFourni: parseNumber(saisie.minutes),
      tauxHoraireCents: tauxHoraire,
      coutVehiculeParKmCents: coutVehicule,
      peagesAllerRetourCents: peages,
      heuresDeplacementDevisees: deplacementDevise.heures,
    },
  });

  // ---------- L'analyse de prix, qui vient du SQL ----------
  const { data: brut, error: erreurAnalyse } = await supabase.rpc("ai_quote_price_analysis", {
    p_quote_id: quoteId,
  });

  const analysePrix = erreurAnalyse ? null : lireAnalysePrix(brut);

  return {
    statut: "ok",
    devis: {
      id: quoteId,
      numero: (devis.number as string | null) ?? null,
      titre: (devis.title as string | null) ?? null,
    },
    analysePrix,
    motifAnalysePrixIndisponible: erreurAnalyse ? messageAnalyseIndisponible(erreurAnalyse) : null,
    deplacement,
    hypothesesRetenues: {
      ...saisie,
      jours: saisie.jours !== "" ? saisie.jours : jours === null ? "" : String(jours),
      joursDeduitsDuChantier: joursSaisis === null && joursDuChantier !== null,
    },
    montantTransportDeviseCents: deplacementDevise.montantHtCents,
    risques: construireRisques(analysePrix, deplacement),
    recommandations: construireRecommandations(analysePrix, deplacement),
  };
}

// ============================================================
// Les morceaux qui touchent la base
// ============================================================

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * PostgREST rend une relation « vers un » tantôt comme objet, tantôt
 * comme tableau selon la façon dont il déduit la cardinalité. On accepte
 * les deux plutôt que de parier sur l'une.
 */
function premierObjet(valeur: unknown): Record<string, unknown> | null {
  if (Array.isArray(valeur)) return (valeur[0] as Record<string, unknown>) ?? null;
  if (typeof valeur === "object" && valeur !== null) return valeur as Record<string, unknown>;
  return null;
}

async function situerSiege(
  supabase: Client,
  organizationId: string,
): Promise<PointGeographique> {
  const { data } = await supabase
    .from("business_organizations")
    .select("address_line1, postal_code, city")
    .eq("id", organizationId)
    .maybeSingle();

  const ville = (data?.city as string | null) ?? null;
  const codePostal = (data?.postal_code as string | null) ?? null;
  const adresse = (data?.address_line1 as string | null) ?? null;

  const libelle = [adresse, [codePostal, ville].filter(Boolean).join(" ")]
    .filter((x) => x && x.trim() !== "")
    .join(", ");

  // `business_organizations` ne stocke aucune coordonnée : le seul
  // moyen de situer le siège est de situer sa commune.
  const situee = await situerCommune(ville, codePostal);

  return {
    libelle: libelle === "" ? "Siège sans adresse" : libelle,
    commune: ville,
    codePostal,
    coordonnees: situee?.coordonnees ?? null,
    origine: situee ? "centreCommune" : "inconnue",
  };
}

async function situerChantier(
  site: {
    city: string | null;
    postal_code: string | null;
    latitude: number | null;
    longitude: number | null;
    address_line1: string | null;
  } | null,
  client: { billing_city: string | null; billing_postal_code: string | null } | null,
): Promise<PointGeographique> {
  const ville = site?.city ?? client?.billing_city ?? null;
  const codePostal = site?.postal_code ?? client?.billing_postal_code ?? null;
  const libelle =
    [codePostal, ville].filter((x) => x && x.trim() !== "").join(" ") || "Chantier sans adresse";

  // DES COORDONNÉES SAISIES BATTENT TOUT LE RESTE : elles désignent le
  // chantier lui-même, pas la mairie de sa ville.
  const latitude = site?.latitude ?? null;
  const longitude = site?.longitude ?? null;
  if (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    return {
      libelle,
      commune: ville,
      codePostal,
      coordonnees: { latitude, longitude },
      origine: "coordonneesSaisies",
    };
  }

  const situee = await situerCommune(ville, codePostal);
  return {
    libelle,
    commune: ville,
    codePostal,
    coordonnees: situee?.coordonnees ?? null,
    origine: situee ? "centreCommune" : "inconnue",
  };
}

/**
 * La durée du chantier, quand le devis en a déjà produit un.
 *
 * C'est une reprise de donnée, pas une estimation : si aucun chantier
 * n'est planifié, on rend `null` et l'écran demande la durée. Deviner
 * « cinq jours » ferait apparaître des heures de déplacement qui ne
 * reposent sur rien.
 */
async function dureeDuChantier(
  supabase: Client,
  organizationId: string,
  quoteId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("projects")
    .select("planned_start_on, planned_end_on")
    .eq("organization_id", organizationId)
    .eq("quote_id", quoteId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const debut = data?.planned_start_on as string | null | undefined;
  const fin = data?.planned_end_on as string | null | undefined;
  if (!debut || !fin) return null;

  const jours =
    Math.round((Date.parse(fin) - Date.parse(debut)) / 86_400_000) + 1;
  return Number.isFinite(jours) && jours > 0 ? jours : null;
}

/**
 * Pourquoi l'analyse de prix manque.
 *
 * Le cas le plus probable aujourd'hui n'est pas un refus de droits mais
 * une migration non appliquée : 0072 et 0073 créent cette fonction.
 * Dire « indisponible » sans dire laquelle enverrait chercher un bug
 * là où il n'y en a pas.
 */
function messageAnalyseIndisponible(erreur: { code?: string; message?: string }): string {
  if (erreur.code === "PGRST202" || (erreur.message ?? "").includes("Could not find the function")) {
    return (
      "L'analyse de prix repose sur la fonction « ai_quote_price_analysis », " +
      "créée par les migrations 0072 et 0073 : elles ne sont pas encore appliquées sur cette base. " +
      "Le déplacement, lui, est calculé ici et reste affiché."
    );
  }
  return (
    erreur.message?.trim() ||
    "L'analyse de prix n'a pas pu être calculée. Le déplacement reste affiché."
  );
}
