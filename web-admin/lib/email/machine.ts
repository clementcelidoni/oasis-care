import "server-only";

/**
 * ==================================================================
 * LE SEUL APPEL SORTANT DU CONTROL CENTER — VIDER LA FILE
 * ==================================================================
 *
 * CE QUI MANQUAIT, ET QUI RENDAIT LES ANNONCES MUETTES.
 * `admin_send_email_campaign` écrit une ligne par entreprise dans le
 * journal d'envoi, et s'arrête là : le transport appartient à la
 * machine (`supabase/functions/envoi-email`), qui seule détient la clé
 * du transporteur. Sans quelqu'un pour l'appeler, une annonce marquée
 * « envoyée » restait indéfiniment en attente, et l'écran affichait des
 * messages qui ne partaient jamais.
 *
 * ------------------------------------------------------------------
 * POURQUOI CE MODULE LIT LA CLÉ DE SERVICE, ET PAS UN AUTRE
 * ------------------------------------------------------------------
 * Le chemin `/file` de la machine n'accepte QUE la clé de service en
 * porteur — ni jeton d'utilisateur, ni secret de transporteur. C'est
 * délibéré : c'est le chemin des campagnes et d'un futur ordonnanceur,
 * jamais celui d'un humain qui clique.
 *
 * Le Control Center est la seule des deux applications à détenir cette
 * clé ; `web-pro/.env.example` l'interdit nommément à l'autre. Ce
 * fichier est donc, avec `lib/supabase/admin.ts`, l'un des DEUX seuls
 * modules du dépôt qui la lisent — et comme lui, il commence par
 * `import "server-only"` : une importation depuis un composant client
 * casse la compilation plutôt que de publier la clé.
 *
 * ------------------------------------------------------------------
 * IL NE LÈVE JAMAIS, ET C'EST UN CHOIX
 * ------------------------------------------------------------------
 * Une annonce dont les lignes sont écrites est une annonce partie du
 * point de vue de la base. Un transport qui échoue est un RETARD — les
 * lignes attendent, durables, et repartiront au passage suivant. Le
 * présenter comme une erreur enverrait chercher une panne là où il n'y
 * a qu'à attendre.
 */

export type BilanTransport = {
  traites: number;
  envoyes: number;
  echecs: number;
  incertains: number;
  arretes: number;
  indisponible: string | null;
};

export async function viderLaFileDEnvoi(): Promise<BilanTransport | null> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cleService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cleService) return null;

  try {
    const reponse = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/envoi-email/file`, {
      method: "POST",
      headers: { authorization: `Bearer ${cleService}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!reponse.ok) return null;
    const charge = (await reponse.json().catch(() => null)) as Partial<BilanTransport> | null;
    if (charge === null) return null;
    return {
      traites: Number(charge.traites ?? 0),
      envoyes: Number(charge.envoyes ?? 0),
      echecs: Number(charge.echecs ?? 0),
      incertains: Number(charge.incertains ?? 0),
      arretes: Number(charge.arretes ?? 0),
      indisponible: charge.indisponible ?? null,
    };
  } catch {
    return null;
  }
}
