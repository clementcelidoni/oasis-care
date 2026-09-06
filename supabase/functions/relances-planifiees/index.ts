// Oasis Care — Les relances. LE CÂBLAGE.
//
// ==================================================================
// POURQUOI CETTE FONCTION EXISTE
// ==================================================================
//
// 0089 § 9 pose la file `relances_planifiees` et le calcul qui la
// remplit. Le calcul tourne DANS la base, déclenché par pg_cron, et il
// n'appelle personne : « une tâche qui échoue au milieu d'un appel
// réseau laisse un état indéterminé, alors qu'une insertion est
// atomique ».
//
// Restait à VIDER la file. C'est ce fichier. Il est appelé par le
// PLANIFICATEUR DE FONCTIONS EDGE de Supabase, et surtout PAS par
// pg_cron + pg_net : ce motif-là écrirait la clé de service en clair
// dans `cron.job.command`, une table lisible en base — la clé la plus
// puissante du projet rangée à côté des données qu'elle protège. La
// voie retenue n'a besoin ni de pg_net ni de Vault, et aucun secret ne
// descend jamais dans la base.
//
// ==================================================================
// LES VARIABLES D'ENVIRONNEMENT — À POSER PAR LE DIRIGEANT, PAS ICI
// ==================================================================
//
//   SUPABASE_URL                 fournies automatiquement par Supabase.
//   SUPABASE_SERVICE_ROLE_KEY
//   BREVO_API_KEY                le transporteur. Déjà posée pour
//                                `envoi-email` ; les secrets de
//                                fonction sont communs au projet, il
//                                n'y a donc rien de neuf à poser.
//   OASIS_EMAIL_EXPEDITEUR
//   OASIS_EMAIL_BASE_URL
//   OASIS_URL_ENVOI_EMAIL        FACULTATIF. L'adresse de la fonction
//                                d'envoi, quand elle n'est pas celle
//                                que l'on déduit de SUPABASE_URL.
//
// AUCUN SECRET N'EST ÉCRIT DANS CE FICHIER, ni en commentaire, ni en
// exemple. Le code lit des variables, point.
//
// ==================================================================
// LE DÉPLOIEMENT
// ==================================================================
//
//     npx supabase functions deploy relances-planifiees --no-verify-jwt
//
// `--no-verify-jwt` EST OBLIGATOIRE, et pour la même raison que pour
// `envoi-email` et les deux webhooks : les clés de service récentes
// (`sb_secret_…`) ne sont pas des JWT, et la vérification de plateforme
// rendrait 401 avant que ce fichier ne s'exécute. La défense est donc
// ici, en toutes lettres : la clé de service, comparée en TEMPS
// CONSTANT, et rien d'autre ne passe.
//
// LE PLANIFICATEUR : une invocation par jour suffit, après celle de
// `relances_calculer()` posée par pg_cron. L'ordre importe peu en
// réalité — une file vide rend un bilan à zéro sans rien coûter — mais
// calculer avant d'expédier évite d'attendre un jour de plus.
//
// ==================================================================
// LA RÉPARTITION DES RÔLES DANS CE DOSSIER
// ==================================================================
//   file.ts          l'interface vers la file        (pure)
//   traitement.ts    l'orchestration                 (pure, éprouvée)
//   index.ts         CE FICHIER — l'HTTP, l'environnement, la base

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { obtenirEnvoyeurCourriel } from "../envoi-email/bibliotheque.ts";
import type { Issue, OrdreEnvoi } from "../envoi-email/traitement.ts";
import type { PorteFile, RelanceReservee } from "./file.ts";
import { viderFileRelances, type Expediteur } from "./traitement.ts";

/** Le nom du passage qui réserve, pour l'enquête. Jamais pour la logique. */
const NOM_PASSAGE = "relances-planifiees";

function json(charge: unknown, statut = 200): Response {
  return new Response(JSON.stringify(charge), {
    status: statut,
    headers: { "content-type": "application/json" },
  });
}

/**
 * LA COMPARAISON DE SECRETS EN TEMPS CONSTANT.
 *
 * `a === b` sur des chaînes s'arrête au premier caractère différent : le
 * temps de réponse dit alors combien de caractères sont justes, et un
 * secret se devine caractère par caractère. Le coût de la version
 * constante est nul ; l'absence de version constante est une faille
 * qu'on ne voit jamais dans un journal.
 */
function memeSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let ecart = 0;
  for (let i = 0; i < a.length; i += 1) ecart |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return ecart === 0;
}

/**
 * LA PORTE RÉELLE — TROIS FONCTIONS DE 0089, ET RIEN D'AUTRE.
 *
 * Les trois sont réservées à `service_role` (0089 § 11.c) et REFONT le
 * contrôle à l'intérieur avec `saas_contexte_machine()` : posséder la
 * clé n'est pas être autorisé.
 *
 * TOUTES LES ÉCRITURES LISENT LEUR `{ error }`. Un `await rpc(...)` dont
 * on jette la réponse transforme un délai dépassé en succès apparent :
 * la ligne resterait réservée, et personne ne la reprendrait jamais.
 */
function porteSupabase(service: SupabaseClient): PorteFile {
  return {
    async reserver(limite): Promise<RelanceReservee[]> {
      const { data, error } = await service.rpc("relances_a_expedier", {
        p_limit: limite,
        p_worker: NOM_PASSAGE,
      });
      // ON LÈVE PLUTÔT QUE DE RENDRE UNE FILE VIDE. « Rien à faire » et
      // « je n'ai pas pu regarder » sont deux réponses différentes, et
      // les confondre ferait rendre un bilan « tout va bien, zéro
      // relance » à chaque panne de base — le genre de silence qu'on ne
      // remarque qu'au bout de trois semaines sans relance partie.
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[]).map((ligne) => ({
        id: ligne.id as string,
        organizationId: ligne.organization_id as string,
        entityType: ligne.entity_type as RelanceReservee["entityType"],
        entityId: ligne.entity_id as string,
        templateKey: ligne.template_key as string,
        occurrence: ligne.occurrence as number,
        customerId: (ligne.customer_id as string | null) ?? null,
        referenceOn: ligne.reference_on as string,
      }));
    },

    async marquerFaite(id, emailMessageId): Promise<boolean> {
      const { data, error } = await service.rpc("relance_marquer_faite", {
        p_id: id,
        p_email_message_id: emailMessageId,
        p_motif_abandon: null,
      });
      if (error) return false;
      return data === true;
    },

    async marquerAbandonnee(id, motif): Promise<boolean> {
      const { data, error } = await service.rpc("relance_marquer_faite", {
        p_id: id,
        p_email_message_id: null,
        p_motif_abandon: motif,
      });
      if (error) return false;
      return data === true;
    },
  };
}

/**
 * L'EXPÉDITION — DÉLÉGUÉE, ET C'EST LE CHOIX STRUCTURANT DE CE DOSSIER.
 *
 * Ce fichier ne rend AUCUN gabarit et n'appelle PAS `email_enqueue()`.
 * Il passe l'ordre à `envoi-email`, qui sait déjà tout faire : relire le
 * document sous les yeux de la base, fabriquer les variables, rendre le
 * gabarit, mettre au journal, transporter, marquer.
 *
 * POURQUOI PAS EN DIRECT, PUISQUE `traiterOrdre()` EST IMPORTABLE.
 * Parce que son adaptateur vers la base — les treize méthodes de
 * `PorteBase` — vit dans `envoi-email/index.ts` et n'en est pas
 * exporté. Le recopier ici ferait deux implémentations de la même porte,
 * dont une seule serait corrigée le jour d'un correctif. Deux moteurs
 * pour un même message finissent par écrire deux messages différents, et
 * personne ne sait plus lequel le client a reçu.
 *
 * LE COÛT ASSUMÉ : un aller-retour HTTP par relance, et la clé de
 * service portée en en-tête vers une fonction du MÊME projet, qui la
 * détient déjà. Aucun secret nouveau n'apparaît, aucun ne descend en
 * base.
 *
 * LE REMÈDE PROPRE, signalé à l'intégration : exporter `porteSupabase`
 * depuis un module partagé, et cet aller-retour disparaît.
 */
function expediteurParFonctionEdge(
  urlEnvoi: string,
  cleService: string,
): Expediteur {
  return async (ordre: OrdreEnvoi): Promise<Issue> => {
    const reponse = await fetch(urlEnvoi, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + cleService,
      },
      body: JSON.stringify({ ordre }),
    });

    // UN STATUT AUTRE QUE 200 N'EST PAS UN VERDICT SUR LE MESSAGE.
    // `envoi-email` rend 200 pour TOUTES ses issues, refus compris — un
    // refus motivé n'est pas une panne. Un autre statut veut donc dire
    // que la fonction elle-même n'a pas tourné : on lève, et
    // l'orchestration arrête le passage sans terminer la ligne.
    if (reponse.status !== 200) {
      const detail = await reponse.text().catch(() => "");
      throw new Error(
        "La fonction d'envoi a répondu " + reponse.status + " " + detail.slice(0, 200),
      );
    }

    const charge = (await reponse.json().catch(() => null)) as { etat?: unknown } | null;
    if (charge === null || typeof charge.etat !== "string") {
      throw new Error("La fonction d'envoi n'a rien rendu d'exploitable.");
    }
    // Une issue inconnue serait interprétée par défaut, et le défaut
    // choisi serait le mauvais un jour. On lève : la ligne reste à
    // reprendre, ce qui est réparable, plutôt que terminée à tort.
    const connues = ["envoye", "deja", "refuse", "incertain", "indisponible"];
    if (!connues.includes(charge.etat)) {
      throw new Error("Issue d'envoi inconnue : " + charge.etat);
    }
    return charge as Issue;
  };
}

Deno.serve(async (requete: Request): Promise<Response> => {
  if (requete.method !== "POST") return json({ erreur: "Méthode non autorisée." }, 405);

  const urlSupabase = Deno.env.get("SUPABASE_URL") ?? "";
  const cleService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (urlSupabase === "" || cleService === "") {
    return json({ erreur: "La machine n'est pas configurée sur ce serveur." }, 503);
  }

  // ---- LA DÉFENSE DU CHEMIN ---------------------------------------
  // Ce point de terminaison fait partir des courriels au nom
  // d'entreprises clientes. Il n'a pas d'appelant humain, et n'en aura
  // jamais : la clé de service, ou rien.
  const porteur = (requete.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!memeSecret(cleService, porteur)) return json({ erreur: "Refusé." }, 401);

  const service = createClient(urlSupabase, cleService, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // LE TRANSPORTEUR EST REGARDÉ AVANT TOUTE RÉSERVATION. Voir le § 0 de
  // `traitement.ts` : découvrir son absence après avoir réservé une
  // ligne laisserait cette ligne sans issue honnête.
  const envoyeur = obtenirEnvoyeurCourriel();

  const urlEnvoi =
    Deno.env.get("OASIS_URL_ENVOI_EMAIL") ??
    urlSupabase.replace(/\/+$/, "") + "/functions/v1/envoi-email/envoyer";

  const corps = (await requete.json().catch(() => null)) as { plafond?: unknown } | null;
  const plafond =
    typeof corps?.plafond === "number" && Number.isFinite(corps.plafond)
      ? Math.trunc(corps.plafond)
      : undefined;

  const bilan = await viderFileRelances(
    porteSupabase(service),
    expediteurParFonctionEdge(urlEnvoi, cleService),
    { plafond, raisonIndisponibilite: envoyeur.raisonIndisponibilite },
  );

  // 200 MÊME QUAND LE PASSAGE S'ARRÊTE. Un planificateur qui reçoit des
  // erreurs finit par désactiver la tâche, et l'on perdrait alors TOUTES
  // les relances — y compris celles qui seraient parties sans encombre.
  // Ce qui s'est passé se lit dans `arret`, et le bilan est journalisé
  // par le planificateur.
  return json(bilan, 200);
});
