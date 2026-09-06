import type { Metadata } from "next";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

import { Coquille } from "../Coquille";
import { adresseVisiteur, creerGarde, empreinteVisiteur } from "../garde";
import {
  lireDevisParJeton,
  PHRASE_PANNE,
  PHRASE_TROP_DE_TENTATIVES,
  type Resultat,
} from "../lecture";
import { Devis } from "./Devis";

/**
 * §PORTE ANONYME — /d/<jeton> : LE DEVIS, SANS COMPTE.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA PREMIÈRE PAGE DU PRODUIT QUI S'OUVRE SANS SESSION
 * ══════════════════════════════════════════════════════════════════
 *
 * Le dirigeant a tranché : « Non il doit pas créer de compte. » Or tout
 * le portail client est verrouillé par `auth.uid()`, et un lien « voir
 * votre devis » tombait donc sur un mur de connexion. 0084 § 17 posait
 * la question sans y répondre ; 0089 § 8 a ouvert la porte en base ;
 * cette page est la porte côté web.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE FICHIER N'OUVRE AUCUNE SESSION, ET C'EST VÉRIFIABLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un jeton n'authentifie pas. Il prouve qu'on détient un lien, rien de
 * plus — et un lien se transfère. Trois choses le garantissent ici, et
 * `page.test.ts` échoue si l'une disparaît :
 *
 *   1. LE CLIENT SUPABASE EST FABRIQUÉ ICI, avec la clé PUBLIABLE et
 *      `persistSession: false`. On n'emploie surtout pas
 *      `@/lib/supabase/server`, qui lit et REPOSE les cookies de
 *      session : il en fabriquerait une là où il ne doit pas y en
 *      avoir.
 *   2. AUCUN COOKIE N'EST LU NI ÉCRIT. `headers()` sert à lire
 *      l'adresse du visiteur pour la garde ; `cookies()` n'est jamais
 *      importé.
 *   3. AUCUNE CLÉ DE SERVICE. La seule fonction appelée est
 *      `devis_par_jeton`, accordée à `anon` (0089 § 11.b), et elle ne
 *      rend que les colonnes des vues `client_*`.
 *
 * Conséquence recherchée : un visiteur muni d'un jeton n'a strictement
 * rien gagné pour aucune autre route. Il n'emporte pas de cookie, et
 * `proxy.ts` puis la RLS refuseront tout le reste exactement comme
 * avant.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE JETON EST DANS L'URL, ET UNE URL FUIT DE TROIS FAÇONS
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est le prix d'un lien qu'on colle dans un message, et il se paie :
 *
 *   • L'EN-TÊTE `Referer`. Un clic sur n'importe quel lien de la page
 *     enverrait l'URL complète — donc le jeton — au site visité. D'où
 *     `referrer: "no-referrer"` ci-dessous, et le fait que la page ne
 *     porte AUCUN lien sortant.
 *   • LES MOTEURS DE RECHERCHE. Un lien recopié sur un forum finirait
 *     indexé, et le devis serait public pour de bon. D'où `robots`.
 *   • L'HISTORIQUE ET LE PARTAGE D'ÉCRAN. Contre ceux-là on ne peut
 *     rien, et c'est pour cela que le lien EXPIRE et se RÉVOQUE
 *     (0089 § 8.e).
 */

/**
 * `force-dynamic` : rien de cette page ne doit être mis en cache.
 *
 * Une page de devis rendue une fois puis resservie serait servie À UN
 * AUTRE JETON — le pire résultat imaginable pour cette route. Et
 * l'enregistrement de l'ouverture, qui est une écriture, n'aurait lieu
 * qu'une fois.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Votre devis",
  // « Votre devis » et rien d'autre : le titre part dans l'onglet, dans
  // les favoris et dans l'aperçu d'un partage. Y mettre le numéro ou le
  // nom de l'entreprise ferait fuiter le document par sa vignette.
  description: "Le devis que votre paysagiste vous a adressé.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
  referrer: "no-referrer",
};

/**
 * LA GARDE VIT À L'ÉCHELLE DU MODULE, DONC DU PROCESSUS.
 *
 * C'est volontairement modeste : voir l'en-tête de `garde.ts`, qui dit
 * ce que cela vaut et ce que cela ne vaut pas. La vraie barrière est le
 * tirage de 32 octets ; ceci épargne la base et laisse une trace.
 */
const garde = creerGarde();

/**
 * Le type est écrit à la main plutôt que pris de `PageProps<"…">` : les
 * types de routes de Next sont GÉNÉRÉS au premier `build`, donc absents
 * tant que cette route neuve n'a pas été compilée une fois. Une
 * vérification de types qui échouerait sur une route qui existe n'aide
 * personne.
 */
export default async function DocumentPartagePage({
  params,
}: {
  params: Promise<{ jeton: string }>;
}) {
  const { jeton } = await params;

  const entetes = await headers();
  const empreinte = empreinteVisiteur(adresseVisiteur(entetes));

  const supabase = clientAnonyme();
  if (supabase === null) {
    return (
      <Coquille titre="Ce document n&apos;est pas disponible">
        <p>{PHRASE_PANNE}</p>
      </Coquille>
    );
  }

  // ---- LA GARDE — ET CE QU'ELLE N'A PAS LE DROIT DE FAIRE --------
  //
  // ══════════════════════════════════════════════════════════════
  // UN JETON VALIDE EST TOUJOURS SERVI. TOUJOURS.
  // ══════════════════════════════════════════════════════════════
  //
  // C'est la règle que 0089 § 8.c s'était donnée mot pour mot — « CE
  // QU'ON NE FAIT SURTOUT PAS : refuser les jetons VALIDES pendant une
  // saturation » — et c'est le bord qui la cassait, pas la base.
  //
  // LE DÉFAUT, MESURÉ. `document_share_sous_attaque()` est un drapeau
  // GLOBAL : il se pose à 200 échecs sur cinq minutes, tous visiteurs
  // confondus, et reste vrai un quart d'heure. Il était consulté ICI,
  // AVANT de savoir si le jeton était bon, et la tolérance tombait
  // alors à deux échecs. Résultat : un client qui avait cliqué deux
  // fois sur un ancien lien révoqué se voyait refuser son NOUVEAU lien,
  // parfaitement valide, parce qu'un inconnu tapait au hasard à l'autre
  // bout du pays. Pour environ 0,7 requête par seconde, n'importe qui
  // pouvait faire refuser leur devis aux vrais clients.
  //
  // Et la garde ne gênait même pas l'attaquant : `devis_par_jeton` est
  // accordée à `anon`, donc appelable directement sur `/rest/v1/rpc`
  // avec la clé publiable — qui part dans tous les navigateurs. La
  // garde par adresse ne voyait jamais passer l'attaque qui la
  // resserrait.
  //
  // CE QUI RESTE, ET POURQUOI C'EST SUFFISANT. On ne refuse par avance
  // que sur « bloque » : dix échecs de LA MÊME empreinte, un fait local
  // que personne ne peut poser à distance. La bande « aVerifier » ne
  // décide plus rien avant l'appel — un signal global n'a pas à décider
  // du sort d'un visiteur particulier. La vraie barrière reste les 256
  // bits du jeton, et elle n'a jamais eu besoin d'aide.
  const verdict = garde.verdict(empreinte);
  if (verdict === "bloque") {
    // ON NE TOUCHE PAS À LA BASE, et on répond tout de suite : une
    // attente artificielle occuperait un emplacement d'exécution, ce qui
    // offrirait le déni de service au lieu de le repousser.
    return (
      <Coquille titre="Trop de tentatives">
        <p>{PHRASE_TROP_DE_TENTATIVES}</p>
      </Coquille>
    );
  }

  const resultat: Resultat = await lireDevisParJeton(jeton, async (propre) => {
    // On attend ici plutôt que de rendre le constructeur de requête tel
    // quel : `rpc()` rend un objet « thenable », pas une promesse, et
    // `lecture.ts` — qui ne connaît rien de Supabase — attend une
    // promesse. C'est aussi ce qui garde ce module d'affichage
    // remplaçable par un double dans les tests.
    const { data, error } = await supabase.rpc("devis_par_jeton", { p_token: propre });
    return { data, error };
  });

  if (resultat.etat === "clos") {
    // Seuls les REFUS comptent. Un client qui rouvre son devis vingt
    // fois ne doit jamais être ralenti : c'est la règle de 0089 § 8.c.
    garde.noterEchec(empreinte);

    // LE SIGNAL GLOBAL SE CONSULTE ICI, ET NULLE PART AILLEURS : sur un
    // refus DÉJÀ ACQUIS. Il ne peut donc plus coûter son devis à
    // personne — le document a déjà été refusé par la base, pour ses
    // propres raisons.
    //
    // Ce qu'il change : la phrase. Sous saturation, une empreinte qui
    // vient d'échouer deux fois reçoit « Trop de tentatives » plutôt que
    // le refus habituel. C'est le seul geste honnête qui reste au bord —
    // ralentir un balayeur d'un cran, sans jamais toucher aux clients.
    // Et les deux écrans sont des refus : aucun oracle nouveau.
    if (verdict === "aVerifier" && (await lireSaturation(supabase))) {
      return (
        <Coquille titre="Trop de tentatives">
          <p>{PHRASE_TROP_DE_TENTATIVES}</p>
        </Coquille>
      );
    }

    return (
      <Coquille titre="Ce lien n&apos;est plus valable">
        <p>{resultat.message}</p>
        <p className="mt-3">
          Si vous attendiez un devis, demandez à votre paysagiste de vous envoyer un
          nouveau lien : il lui suffit d&apos;un geste.
        </p>
      </Coquille>
    );
  }

  if (resultat.etat === "panne") {
    // UNE PANNE N'EST PAS UN REFUS, et on ne la compte pas comme un
    // échec du visiteur : son lien est peut-être parfait. Lui répondre
    // « ce lien n'est plus valable » le ferait renoncer, et il ne
    // rappellerait pas son paysagiste pour un lien qu'on vient de lui
    // dire mort.
    return (
      <Coquille titre="Nous n&apos;arrivons pas à ouvrir ce document">
        <p>{resultat.message}</p>
      </Coquille>
    );
  }

  return (
    <Devis
      entreprise={resultat.entreprise}
      devis={resultat.devis}
      sections={resultat.sections}
      lignes={resultat.lignes}
    />
  );
}

/**
 * LE CLIENT ANONYME, FABRIQUÉ ICI ET NULLE PART AILLEURS.
 *
 * La clé PUBLIABLE est celle qui est faite pour partir dans un
 * navigateur ; la seule chose qu'elle permet sur cette route est
 * d'appeler `devis_par_jeton` et `document_share_sous_attaque`, les deux
 * seules fonctions accordées à `anon` par 0089 § 11.b.
 *
 * `persistSession: false` et `autoRefreshToken: false` : sans eux, la
 * bibliothèque tenterait d'écrire un stockage de session. Il n'y a
 * aucune session à tenir, et il ne doit pas y en avoir.
 */
function clientAnonyme() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !cle) return null;
  return createClient(url, cle, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * LE SIGNAL DE SATURATION, ET SON REPLI.
 *
 * En cas d'erreur on rend FAUX, c'est-à-dire « pas sous attaque ». Le
 * choix se discute, alors disons-le : rendre VRAI resserrerait la garde
 * à deux échecs pour tout le monde chaque fois que ce seul appel
 * échoue — donc pendant une panne de base, au moment précis où les
 * clients légitimes réessaient. Et resserrer ne protège rien de plus :
 * la barrière reste les 256 bits du jeton, que ce booléen ne renforce ni
 * n'affaiblit.
 */
type ClientAnonyme = NonNullable<ReturnType<typeof clientAnonyme>>;

async function lireSaturation(supabase: ClientAnonyme): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("document_share_sous_attaque");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
