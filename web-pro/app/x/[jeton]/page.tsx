import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { adresseVisiteur, creerGarde, empreinteVisiteur } from "../../d/garde";
import { Coquille } from "../Coquille";
import {
  lireEtiquetteParJeton,
  PHRASE_PANNE,
  PHRASE_TROP_DE_TENTATIVES,
  type Resultat,
} from "../lecture";
import { Fiche } from "./Fiche";

/**
 * §15 — /x/<jeton> : LE RÉSOLVEUR D'ÉTIQUETTE, CÔTÉ WEB.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CETTE ROUTE REMPLACE
 * ══════════════════════════════════════════════════════════════════
 *
 * Avant elle, un QR ne pouvait être lu que par un téléphone qui
 * possédait DÉJÀ la donnée : la résolution se faisait entièrement dans
 * la base locale de l'iPhone, et le seul appel réseau du produit
 * demandait `plant_id` à travers la RLS ordinaire. Un client, un
 * salarié d'une autre équipe, un contrôleur : personne d'autre ne
 * pouvait scanner quoi que ce soit.
 *
 * Le § 15 demande l'inverse : « le QR ne doit pas contenir les
 * informations, mais un identifiant sécurisé. Le backend détermine
 * ensuite l'organisation, l'entité, les permissions, l'écran à
 * ouvrir. » C'est `etiquette_resoudre` (0090 § 6) qui décide ; cette
 * page ne fait que lui obéir.
 *
 * ══════════════════════════════════════════════════════════════════
 * QUATRE ISSUES, DÉCIDÉES PAR LA BASE, PAS PAR CETTE PAGE
 * ══════════════════════════════════════════════════════════════════
 *
 *   1. PORTÉE « complet » AVEC UN CHEMIN → on redirige vers la fiche
 *      complète dans l'application. Cette page n'affiche alors rien du
 *      tout : elle ne reçoit même pas les détails de l'objet.
 *   2. PORTÉE « complet » SANS CHEMIN → un objet réel dont aucun écran
 *      web ne montre la fiche (une plante dont le jardin a disparu, une
 *      famille que le web ne sait pas encore ouvrir). On donne son nom,
 *      et rien d'autre.
 *   3. ÉTIQUETTE VIERGE → sa propre page. Elle appartient bien à
 *      l'entreprise du porteur, mais rien ne lui est encore associé.
 *   4. INCONNUE, RÉVOQUÉE, ORPHELINE OU INTERDITE → LA MÊME PAGE, la
 *      même phrase, le même comptage d'échec. Voir `Coquille.tsx` : deux
 *      réponses différentes formeraient un oracle.
 *
 * Et la cinquième, qui n'est pas une issue mais un aveu : LA PANNE. Un
 * service indisponible n'est pas une étiquette morte, et on ne le
 * maquille pas en refus.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CETTE PAGE LIT LES COOKIES, ALORS QUE /d SE L'INTERDIT
 * ══════════════════════════════════════════════════════════════════
 *
 * La porte des devis (`app/d`) n'emploie surtout pas le client porteur
 * de session : un jeton de devis se transfère, et lui laisser ouvrir un
 * compte serait la faute. ICI LA RÈGLE EST L'INVERSE, et c'est le § 15
 * qui la dicte : le résolveur doit répondre DIFFÉREMMENT selon le
 * porteur, et le porteur ne peut venir que de la session.
 *
 * TROIS CHOSES RESTENT VRAIES, ET `page.test.ts` échoue si l'une
 * disparaît :
 *
 *   1. AUCUNE SESSION N'EST CRÉÉE. On lit un cookie s'il existe ; on
 *      n'en fabrique jamais. Un visiteur sans compte reste sans compte,
 *      et son jeton ne lui ouvre rien d'autre que cette page.
 *   2. AUCUNE CLÉ DE SERVICE. La seule clé employée est la publiable,
 *      celle qui est faite pour partir dans un navigateur, et les deux
 *      seules fonctions appelées — `etiquette_resoudre` et
 *      `etiquettes_sous_attaque` — sont celles que 0090 § 10 accorde à
 *      `anon`.
 *   3. LE PORTEUR N'EST JAMAIS UN PARAMÈTRE. `etiquette_resoudre` ne
 *      prend QUE le jeton ; elle lit `auth.uid()` elle-même. Un
 *      résolveur qui accepterait « et je suis untel » en argument
 *      serait une faille béante, et aucune ligne d'ici ne pourrait la
 *      rattraper.
 *
 * ══════════════════════════════════════════════════════════════════
 * LE JETON EST DANS L'URL, ET UNE URL FUIT DE TROIS FAÇONS
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est le prix d'une adresse qu'on imprime sur un autocollant :
 *
 *   • L'EN-TÊTE `Referer`. Un clic sur n'importe quel lien de la page
 *     enverrait l'adresse complète — donc le jeton — au site visité.
 *     D'où `referrer: "no-referrer"` ci-dessous, et le fait que ni
 *     `Coquille` ni `Fiche` ne portent la moindre balise `<a>`.
 *   • LES MOTEURS DE RECHERCHE. Une adresse recopiée sur un forum
 *     finirait indexée. D'où `robots`.
 *   • L'HISTORIQUE, LA PHOTO DE L'ÉTIQUETTE, LE PARTAGE D'ÉCRAN. Contre
 *     ceux-là on ne peut rien — et contrairement au lien d'un devis, CE
 *     JETON N'EXPIRE JAMAIS : il est collé sur un arbre. Ce qui le tue
 *     est la révocation (`active = false`) ou la disparition de l'objet,
 *     jamais l'horloge. C'est précisément pour cela que la fiche
 *     publique se limite à trois champs botaniques : ce qu'elle montre,
 *     elle le montre pour dix ans.
 *
 * ══════════════════════════════════════════════════════════════════
 * CETTE ROUTE NE MARCHERA PAS TANT QUE `proxy.ts` NE LA LAISSERA PAS
 * PASSER — À FAIRE À L'INTÉGRATION, PAS ICI
 * ══════════════════════════════════════════════════════════════════
 *
 * `web-pro/proxy.ts` renvoie vers `/login` toute requête sans session
 * dont le chemin n'est pas dans sa liste `isPublic`. Cette liste
 * contient `/login`, `/auth`, `/invitation` et `/desabonnement` — ni
 * `/d`, ni `/x`. EN L'ÉTAT, UN PASSANT QUI SCANNE UNE ÉTIQUETTE ARRIVE
 * SUR UN ÉCRAN DE CONNEXION, et toute la porte anonyme est murée.
 *
 * La ligne à ajouter est `pathname.startsWith("/x")`. Elle n'est pas
 * écrite ici parce que `proxy.ts` est un fichier partagé que le chantier
 * des devis doit modifier au même endroit, pour la même raison, en même
 * temps : deux chantiers qui y touchent chacun de leur côté produiraient
 * un conflit sur une ligne dont dépend l'accès de tout le site. C'est
 * signalé dans le compte rendu.
 */

/**
 * `force-dynamic` : rien de cette page ne doit être mis en cache.
 *
 * Une réponse rendue une fois puis resservie serait servie À UN AUTRE
 * JETON, et pire, À UN AUTRE PORTEUR — la même adresse doit rendre la
 * fiche complète à un membre et un refus à un inconnu. Et l'écriture du
 * dernier scan, qui a lieu dans le résolveur, n'aurait plus lieu qu'une
 * fois.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Neutre, et le même pour toutes les issues. Le titre part dans
  // l'onglet, dans les favoris et dans l'aperçu d'un partage : y mettre
  // le nom de la plante ou celui de l'entreprise ferait fuiter par la
  // vignette ce que la page prend soin de ne pas dire.
  title: "Étiquette Oasis",
  description: "L'étiquette que vous venez de scanner.",
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
 * ══════════════════════════════════════════════════════════════════
 * ELLE VIENT DE `app/d/garde.ts`, ET CE N'EST PAS UN OUBLI
 * ══════════════════════════════════════════════════════════════════
 *
 * Le mécanisme est rigoureusement le même — compter les ÉCHECS par
 * adresse et par fenêtre, se resserrer quand la base signale qu'elle
 * déborde, refuser vite sans jamais attendre. En écrire une seconde
 * copie donnerait deux gardes qui divergeraient au premier correctif.
 * Le module ne connaît d'ailleurs rien des devis : `creerGarde`,
 * `empreinteVisiteur` et `adresseVisiteur` ne parlent que d'adresses et
 * de compteurs.
 *
 * SA PLACE N'EST PAS `app/d`, ET ELLE N'EST PAS ICI NON PLUS : c'est un
 * outil partagé, il devrait vivre dans `lib/`. Le déplacer voudrait dire
 * écrire dans le périmètre d'un autre chantier en cours ; c'est signalé
 * dans le compte rendu et l'intégration s'en chargera. L'import se
 * corrigera alors en une ligne.
 *
 * `creerGarde()` fabrique un compteur NEUF : /x et /d ne partagent que
 * le code, jamais les compteurs. Un balayage d'étiquettes ne doit pas
 * pouvoir faire refuser un devis à un client.
 *
 * UNE NUANCE HONNÊTE PAR RAPPORT À /d : là-bas la vraie barrière est un
 * jeton de 32 octets, ici de 16 (128 bits). C'est toujours 3 × 10^38
 * possibilités — hors de portée d'une énumération, et la garde n'a pas
 * à compenser autre chose que le bruit de fond d'Internet.
 */
const garde = creerGarde();

/**
 * Le type est écrit à la main plutôt que pris de `PageProps<"…">` : les
 * types de routes de Next sont GÉNÉRÉS au premier `build`, donc absents
 * tant que cette route neuve n'a pas été compilée une fois.
 */
export default async function EtiquettePage({
  params,
}: {
  params: Promise<{ jeton: string }>;
}) {
  const { jeton } = await params;

  const entetes = await headers();
  const empreinte = empreinteVisiteur(adresseVisiteur(entetes));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    // Une configuration absente est une panne de notre côté, pas une
    // étiquette morte. On le dit comme tel.
    return panne();
  }

  const supabase = await createClient();

  // ---- QUI SCANNE ? -----------------------------------------------
  //
  // On ne se sert PAS du résultat pour décider quoi que ce soit : c'est
  // `etiquette_resoudre` qui lit `auth.uid()` et qui tranche, et lui
  // seul. Cet appel est là pour une raison plus modeste et bien réelle :
  // il VALIDE le jeton d'accès du cookie et le rafraîchit s'il est
  // périmé. Sans lui, un membre dont le cookie a vieilli d'une minute
  // verrait PostgREST refuser sa requête, et cette page lui répondrait
  // « panne » devant une étiquette parfaitement bonne.
  //
  // Il ne coûte rien au cas le plus fréquent : sans cookie de session,
  // la bibliothèque répond « pas de session » sans toucher au réseau.
  try {
    await supabase.auth.getUser();
  } catch {
    // Serveur d'authentification injoignable. On continue quand même :
    // le résolveur répondra en anonyme, ce qui rend la fiche publique
    // quand il y en a une. Refuser ici priverait un passant d'une fiche
    // qui ne dépend pas du tout de son identité.
  }

  // ---- LA GARDE, AVANT TOUT APPEL AU RÉSOLVEUR --------------------
  //
  // Le compteur local répond seul dans les deux cas extrêmes ; il n'y a
  // que dans la bande intermédiaire qu'il faut demander à la base si
  // elle déborde. C'est UN BOOLÉEN, sans aucune donnée, et c'est le seul
  // signal qu'elle puisse donner : elle n'a pas de session, donc elle ne
  // sait pas QUI frappe. Le bord, lui, le sait.
  //
  // CONSÉQUENCE VOULUE : un passant qui scanne une étiquette ne provoque
  // QU'UN SEUL aller-retour vers la base, celui qui lui répond.
  const verdict = garde.verdict(empreinte);
  const bloque =
    verdict === "bloque" || (verdict === "aVerifier" && (await lireSaturation(supabase)));
  if (bloque) {
    // ON NE TOUCHE PAS À LA BASE, et on répond tout de suite : une
    // attente artificielle occuperait un emplacement d'exécution, ce qui
    // offrirait le déni de service au lieu de le repousser.
    return (
      <Coquille titre="Trop de tentatives">
        <p>{PHRASE_TROP_DE_TENTATIVES}</p>
      </Coquille>
    );
  }

  const resultat: Resultat = await lireEtiquetteParJeton(jeton, async (propre) => {
    // On attend ici plutôt que de rendre le constructeur de requête tel
    // quel : `rpc()` rend un objet « thenable », pas une promesse, et
    // `lecture.ts` — qui ne connaît rien de Supabase — attend une
    // promesse. C'est aussi ce qui le garde remplaçable par un double
    // dans les tests.
    const { data, error } = await supabase.rpc("etiquette_resoudre", { p_token: propre });
    return { data, error };
  });

  if (resultat.etat === "panne") {
    // UNE PANNE N'EST PAS UN REFUS, et on ne la compte pas comme un
    // échec du visiteur : son étiquette est peut-être parfaite.
    return panne();
  }

  if (resultat.etat === "clos") {
    // Seuls les REFUS comptent. Quelqu'un qui rescanne dix fois une
    // étiquette qui s'ouvre n'est jamais ralenti.
    garde.noterEchec(empreinte);
    return (
      <Coquille titre="Cette étiquette ne mène à rien">
        <p>{resultat.message}</p>
        <p className="mt-3">
          Vérifiez aussi que vous avez bien scanné une étiquette Oasis : un autocollant abîmé
          ou recopié à la main se lit parfois de travers.
        </p>
      </Coquille>
    );
  }

  if (resultat.etat === "publique") {
    return <Fiche titre={resultat.titre} fiche={resultat.fiche} />;
  }

  if (resultat.etat === "vierge") {
    // § 19 — le tag programmé mais pas encore associé. Le résolveur ne
    // le dit qu'à qui a le droit sur l'entreprise qui l'a commandée ; un
    // passant, lui, a déjà reçu un refus plus haut.
    //
    // AUCUN LIEN VERS L'ÉCRAN D'ASSOCIATION : le résolveur rend
    // délibérément un chemin nul pour cette issue, et fabriquer ici une
    // adresse qu'il n'a pas donnée reviendrait à décider à sa place.
    return (
      <Coquille titre="Étiquette pas encore associée">
        <p>
          Cette étiquette appartient bien à votre entreprise, mais aucun objet ne lui a encore
          été attribué.
        </p>
        <p className="mt-3">
          Ouvrez Oasis Care, scannez-la de nouveau, puis choisissez la plante, le lot ou le
          matériel à lui associer.
        </p>
      </Coquille>
    );
  }

  // ---- PORTÉE « complet » : ON NE MONTRE RIEN, ON EMMÈNE ----------
  //
  // `redirect()` lève une exception que Next intercepte : elle doit
  // rester hors de tout `try`, sans quoi on l'avalerait et la page
  // continuerait de se rendre.
  if (resultat.chemin !== null) {
    redirect(resultat.chemin);
  }

  // Un objet réel, un porteur habilité, et pas d'écran où l'ouvrir. Cela
  // arrive pour de vrai : une plante dont le jardin a été effacé n'a
  // plus de plan sur lequel la montrer. On donne son nom et sa famille —
  // c'est l'identité, jamais le contenu — et on ne fabrique pas une
  // adresse qui rendrait 404.
  return (
    <Coquille titre={resultat.titre !== "" ? resultat.titre : "Étiquette reconnue"}>
      <p>
        {libelleFamille(resultat.entiteType)} — cette étiquette est bien la vôtre, mais aucune
        fiche web ne peut l&apos;afficher pour l&apos;instant.
      </p>
      <p className="mt-3">Ouvrez-la depuis Oasis Care sur votre iPhone.</p>
    </Coquille>
  );
}

function panne() {
  return (
    <Coquille titre="Nous n&apos;arrivons pas à lire cette étiquette">
      <p>{PHRASE_PANNE}</p>
    </Coquille>
  );
}

/**
 * LA FAMILLE DE L'OBJET, EN FRANÇAIS.
 *
 * Le vocabulaire de `entity_kind` (0090 § 1.c) est celui de
 * l'application, en camelCase. Cette page-ci n'est vue que par un
 * porteur habilité, mais lui montrer « nurseryLocation » serait quand
 * même lui montrer notre code source. Un mot inconnu retombe sur un
 * libellé générique plutôt que de s'afficher tel quel.
 */
const FAMILLES: Record<string, string> = {
  plant: "Plante",
  garden: "Jardin",
  gardenZone: "Zone de jardin",
  gardenArea: "Massif",
  irrigationZone: "Zone d'arrosage",
  pond: "Bassin",
  sensor: "Capteur",
  connectedDevice: "Équipement connecté",
  equipment: "Matériel",
  nurseryLot: "Lot de pépinière",
  nurseryLocation: "Emplacement de pépinière",
  cultureBatch: "Lot de culture",
  bioreactor: "Incubateur",
  mediumRecipeVersion: "Recette de milieu",
  acclimatizationBatch: "Acclimatation",
  rack: "Rack",
};

function libelleFamille(kind: string): string {
  return FAMILLES[kind] ?? "Objet étiqueté";
}

/**
 * LE SIGNAL DE SATURATION, ET SON REPLI.
 *
 * En cas d'erreur on rend FAUX, c'est-à-dire « pas sous attaque ». Le
 * choix se discute, alors disons-le : rendre VRAI resserrerait la garde
 * pour tout le monde chaque fois que ce seul appel échoue — donc pendant
 * une panne de base, au moment précis où les gens réessaient. Et
 * resserrer ne protège rien de plus : la barrière reste les 128 bits du
 * jeton, que ce booléen ne renforce ni n'affaiblit.
 */
type ClientSupabase = Awaited<ReturnType<typeof createClient>>;

async function lireSaturation(supabase: ClientSupabase): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("etiquettes_sous_attaque");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}
