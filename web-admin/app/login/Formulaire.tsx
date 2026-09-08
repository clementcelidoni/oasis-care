"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  aUneIdentiteEmail,
  codeComplet,
  DELAI_RENVOI_S,
  envoiDoitResterMuet,
  interpreterEchecCode,
  LONGUEUR_CODE,
  LONGUEUR_CODE_SECOND_FACTEUR,
  LONGUEUR_MOT_DE_PASSE,
  messageEchecEnvoi,
  messageEchecIdentifiants,
  messageEchecMotDePasse,
  nettoyerCode,
  REGLE_MOT_DE_PASSE,
  verifierNouveauMotDePasse,
} from "./parcours.ts";
import Turnstile, { type PoigneeCaptcha } from "./Turnstile.tsx";

/**
 * ==================================================================
 * LA PORTE D'ENTRÉE DU CONTROL CENTER
 * ==================================================================
 *
 * Elle ressemble volontairement peu à celle d'Oasis Care Pro. Pas de
 * promesse produit, pas de logo en couleur : personne n'arrive ici par
 * hasard, et cette page n'a rien à vendre. Elle dit où l'on est, elle
 * demande une identité, elle s'arrête là.
 *
 * ------------------------------------------------------------------
 * CE QUI A CHANGÉ : IL Y A DÉSORMAIS UN MOT DE PASSE
 * ------------------------------------------------------------------
 * Cette page ne connaissait que le lien de connexion, et l'expliquait :
 * « l'écosystème Oasis Care n'a jamais créé de mot de passe ». C'est
 * fini, et ce n'est pas un renoncement au confort.
 *
 * Tous les courriels du produit partent d'un seul domaine, partagé
 * entre tous les clients. La réputation d'envoi est donc commune, et
 * les courriels d'authentification empruntent le même chemin. Avec des
 * liens magiques, une panne de courrier devient une panne d'ACCÈS :
 * plus personne n'entre, nulle part — pas même l'équipe qui devrait
 * réparer la panne. Avec un mot de passe, une panne de courrier reste
 * une panne de courrier.
 *
 * ------------------------------------------------------------------
 * UN SEUL ÉCRAN QUI AVANCE
 * ------------------------------------------------------------------
 *   identifiants → (code) → (mot de passe) → on entre
 *
 * Le cas courant — j'ai un mot de passe, je le tape — ne traverse aucun
 * des temps entre parenthèses : un aller-retour, aucun courriel.
 *
 * ------------------------------------------------------------------
 * TROIS CHOSES QU'ELLE NE FAIT TOUJOURS PAS, ET POURQUOI
 * ------------------------------------------------------------------
 * 1. Elle ne dit JAMAIS si l'adresse saisie appartient à un
 *    administrateur. Le tri se fait après, côté serveur, contre
 *    `platform_admins`. Répondre « cette adresse n'est pas
 *    administratrice » offrirait à qui veut la liste de l'équipe qui
 *    exploite la plateforme, une adresse à la fois.
 *
 *    ET C'EST ICI QUE SE TROUVAIT LA FUITE. Avec `shouldCreateUser:
 *    false`, le service d'authentification refuse une adresse inconnue
 *    avec `otp_disabled` — et l'ancienne page affichait ce refus tel
 *    quel. Adresse connue : panneau calme. Adresse inconnue : bandeau
 *    rouge. La différence était visible à l'œil nu, sans aucun outil.
 *    `envoiDoitResterMuet` la bouche : ces refus-là sont TUS, et
 *    l'écran continue exactement comme si le code était parti.
 *
 *    IL Y EN AVAIT UNE SECONDE, PLUS DISCRÈTE ET AUSSI EFFICACE. Le
 *    plafond « un courriel par minute et par adresse » n'est atteignable
 *    que si un courriel EST PARTI, donc jamais pour une adresse
 *    inconnue : deux clics de suite affichaient un bandeau rouge pour
 *    un collègue et rien du tout pour un inconnu. Deux gestes bouchent
 *    ce trou — le refus rejoint la liste des refus tus, et la page
 *    n'appelle plus le serveur tant que sa propre minute court, y
 *    compris après un « Changer d'adresse » (voir `dernierEnvoi`).
 *
 *    ET IL EN RESTE UNE QU'AUCUNE LIGNE DE CETTE PAGE NE PEUT FERMER :
 *    le TEMPS DE RÉPONSE. Le serveur d'authentification ne calcule
 *    l'empreinte du mot de passe que s'il a trouvé un compte, et il
 *    refuse une adresse inconnue avant tout envoi. Mesuré : une adresse
 *    connue répond en deux fois plus de temps, sans recouvrement entre
 *    les séries. Le seul levier est le CAPTCHA du projet, qui s'active
 *    dans le tableau de bord — c'est dans la notice de mise en service.
 *    Le dire ici plutôt que de laisser croire le contraire.
 *
 * 2. Elle ne propose pas Apple — voir `signInWithProvider`. Un
 *    administrateur doit être identifiable par son adresse ; le relais
 *    privé d'Apple rend cela impossible.
 *
 * 3. Elle ne transporte pas de paramètre `next`. Une seule porte, une
 *    seule destination : la racine. Pas de redirection ouverte à
 *    valider, à tester, ni à réparer un jour.
 *
 * ------------------------------------------------------------------
 * LE CODE D'ENTRÉE N'EST PAS LE CODE DU SECOND FACTEUR
 * ------------------------------------------------------------------
 * Un administrateur peut voir DEUX champs de chiffres à trois écrans
 * d'intervalle : celui-ci, puis celui de `/second-facteur`. Les
 * confondre serait grave — on n'attend pas le même geste.
 *
 * Ils diffèrent déjà par nature, et l'écran le dit dans les mots :
 *   ici                → 8 chiffres, REÇUS PAR E-MAIL, valables 1 heure
 *   au second facteur  → 6 chiffres, LUS DANS UNE APPLICATION, 30 s
 *
 * D'où la règle de vocabulaire, tenue des deux côtés : ne jamais écrire
 * « code de vérification ». Ici on dit « code reçu par e-mail » ;
 * là-bas on dit « code de votre application d'authentification ». La
 * SOURCE du code est la seule chose qui distingue les deux gestes pour
 * la personne qui les subit.
 *
 * ------------------------------------------------------------------
 * LE MÊME COMPTE QUE PARTOUT — ET CE QUE ÇA N'IMPLIQUE PAS
 * ------------------------------------------------------------------
 * C'est le même projet Supabase que l'app iPhone et qu'Oasis Care Pro,
 * donc le même compte. Se connecter ici ne donne RIEN de plus : la
 * session obtenue est celle d'un utilisateur ordinaire, et c'est
 * `platform_admins` — une table sans aucune politique d'écriture — qui
 * décide de la suite. Spec p.32 : « Ne pas considérer simplement
 * organization owner comme admin Oasis Care. »
 *
 * ------------------------------------------------------------------
 * OÙ VIT LE MOT DE PASSE, ET OÙ IL NE VA JAMAIS
 * ------------------------------------------------------------------
 * Dans un `useState` de ce composant, le temps d'un appel. Il ne part
 * que vers Supabase. Jamais dans une URL, jamais dans un journal,
 * jamais dans un message d'erreur, jamais dans le stockage du
 * navigateur. `page.test.ts` relit ce fichier pour le prouver.
 *
 * ------------------------------------------------------------------
 * POURQUOI CE FICHIER N'EST PAS `page.tsx`
 * ------------------------------------------------------------------
 * `/auth/callback` renvoie ici avec `?error=…` quand un lien de
 * courriel échoue, et ce message doit s'afficher. Le lire depuis le
 * navigateur obligerait à poser l'état dans un effet — une cascade de
 * rendus que React déconseille, et que le linteur du projet refuse à
 * juste titre. Or ce paramètre est déjà connu du SERVEUR au moment où
 * il rend la page : `page.tsx` le lit et le passe ici en propriété,
 * disponible dès le premier rendu.
 */

type Etape = "identifiants" | "code" | "motdepasse";

export default function Formulaire({
  /**
   * Le message du lien qui a échoué, déjà traduit par `page.tsx`.
   *
   * Il sert de VALEUR INITIALE à l'erreur affichée, et non de valeur
   * permanente : dès que la personne tente quoi que ce soit, chaque
   * gestionnaire remet `erreur` à zéro et le message d'un lien périmé
   * s'efface tout seul.
   */
  erreurDeLien,
}: {
  erreurDeLien: string | null;
}) {
  const [etape, setEtape] = useState<Etape>("identifiants");

  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [code, setCode] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [afficherLesMotsDePasse, setAfficherLesMotsDePasse] = useState(false);

  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(erreurDeLien);
  const [avis, setAvis] = useState<string | null>(null);

  const [codeEnvoyeLe, setCodeEnvoyeLe] = useState<number | null>(null);
  const [renvoiPossibleA, setRenvoiPossibleA] = useState<number | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  /**
   * LA MINUTE DÉJÀ ENTAMÉE POUR UNE ADRESSE, ET POURQUOI ELLE SURVIT AU
   * RETOUR EN ARRIÈRE.
   *
   * « Changer d'adresse » remet le décompte à zéro, et c'est normal :
   * on change peut-être d'adresse. Mais le serveur, lui, n'oublie
   * rien — il compte PAR ADRESSE, une minute entre deux envois.
   * Redemander un code pour la MÊME adresse quarante secondes plus tard
   * se fait donc refuser… et ce refus n'existe que pour une adresse qui
   * a un compte. Deux clics et l'on savait qui est administrateur.
   *
   * Cette référence retient, pour la dernière adresse servie, quand un
   * nouvel envoi a une chance d'aboutir. Tant que ce moment n'est pas
   * venu, ON N'APPELLE PAS LE SERVEUR DU TOUT : l'écran avance vers le
   * champ de code comme si un code venait de partir. Il n'y a rien à
   * distinguer, parce qu'il ne s'est rien passé.
   *
   * C'est une commodité d'affichage, pas un garde-fou : le vrai
   * plafond est celui du serveur, et un script ne passe pas par cet
   * écran. Mais la fuite, elle, passait par cet écran.
   */
  const dernierEnvoi = useRef<{
    adresse: string;
    envoyeLe: number;
    possibleA: number;
  } | null>(null);

  // Le client Supabase est construit AU MOMENT DU CLIC, pas au rendu.
  //
  // Ce n'est pas une micro-optimisation : `createBrowserClient` LÈVE si
  // l'URL ou la clé publishable manquent. Or ce composant est rendu une
  // première fois côté serveur, avant d'être hydraté — le construire
  // pendant le rendu ferait donc échouer la page entière, en 500, dès
  // que l'environnement n'a pas les variables. C'est ce qui cassait
  // `next build` du temps où cette page était pré-calculée, et le
  // raisonnement vaut toujours pour le rendu à la demande.
  //
  // Au clic, en revanche, on est forcément dans le navigateur, les
  // variables publiques ont été intégrées au bundle, et une valeur
  // manquante devient un message affiché plutôt qu'une page blanche.
  function client() {
    return createClient();
  }

  /**
   * LA VÉRIFICATION ANTI-ROBOT, ET SES DEUX SEULS POINTS D'ATTACHE.
   *
   * Un seul widget pour tout l'écran (voir `Turnstile.tsx`), et deux
   * appels seulement en réclament un jeton :
   *   • `signInWithPassword` → POST /token
   *   • `signInWithOtp`      → POST /otp
   *
   * Ce sont les deux seules routes de ce parcours que le serveur
   * d'authentification place derrière son contrôle de CAPTCHA. Les
   * autres n'en veulent pas, et leur en donner un serait une faute —
   * un jeton ne sert qu'une fois, celui qu'on gaspille ici manque au
   * suivant. Le détail est écrit à chaque appel concerné.
   *
   * CE QUE LE CAPTCHA RÉPARE ICI, ET QUE CETTE PAGE NE POUVAIT PAS
   * RÉPARER SEULE : l'oracle de CHRONOMÉTRAGE décrit en tête de fichier.
   * Toute la discrétion de cet écran — messages égaux, refus tus,
   * décompte tenu localement — ne servait à rien contre quelqu'un qui
   * mesure le temps de réponse. Le CAPTCHA ne supprime pas l'écart : il
   * rend le balayage qui l'exploite trop cher pour valoir la peine.
   */
  const captcha = useRef<PoigneeCaptcha | null>(null);

  /**
   * LE BANDEAU D'ERREUR, ET COMMENT ON S'ASSURE QU'IL EST LU.
   *
   * Il vit tout en bas de la carte. Sur un téléphone, « Se connecter »
   * est déjà à mi-hauteur : l'explication de l'échec tombe trois cents
   * pixels SOUS le pli, et rien ne l'y amène. La personne voit son
   * bouton revenir à sa place, ne lit rien, et conclut qu'il ne s'est
   * rien passé.
   *
   * `role="alert"` le fait annoncer à un lecteur d'écran ; il ne fait
   * rigoureusement rien pour un œil. D'où ce défilement — qui ne se
   * déclenche que si le bandeau est réellement hors de vue, parce
   * qu'une page qui saute alors que tout était visible est plus
   * déroutante que le contraire.
   */
  const bandeauErreur = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (erreur === null) return;
    const element = bandeauErreur.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
    element.scrollIntoView({
      block: "center",
      // Même raison qu'au widget : une animation ne progresse pas dans
      // un onglet caché, et l'explication de l'échec doit être là au
      // retour, pas seulement en chemin.
      behavior: document.hidden ? "auto" : "smooth",
    });
  }, [erreur]);


  /* ================================================================
     LE COMPTE À REBOURS DU RENVOI
     ================================================================ */

  useEffect(() => {
    if (renvoiPossibleA === null) return;
    const battement = window.setInterval(() => setMaintenant(Date.now()), 1000);
    return () => window.clearInterval(battement);
  }, [renvoiPossibleA]);

  const secondesAvantRenvoi =
    renvoiPossibleA === null
      ? 0
      : Math.max(0, Math.ceil((renvoiPossibleA - maintenant) / 1000));

  /* ================================================================
     LES DÉPLACEMENTS
     ================================================================ */

  function callbackUrl() {
    return new URL("/auth/callback", window.location.origin).toString();
  }

  /**
   * On entre — par une navigation complète, pas par le routeur.
   *
   * La session vient d'être écrite dans les cookies par le client de
   * navigateur ; il faut que le serveur les relise pour que
   * `requireAdmin()` tranche. Une destination fixe, la racine : le
   * Control Center n'en a pas d'autre.
   */
  function entrer() {
    // Le linteur de Next suggère `useRouter().push()` pour une
    // destination interne, et il a raison DANS LE CAS GÉNÉRAL. Pas
    // ici : on vient de changer d'identité. Une navigation douce garde
    // l'arbre React déjà monté et le cache de routeur constitué AVANT
    // la connexion — donc, potentiellement, une page « / » mise en
    // réserve du temps où personne n'était connecté. Un chargement
    // complet ne laisse aucune place à cette ambiguïté, et il ne
    // survient qu'une fois par session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/");
  }

  function revenirAuDebut() {
    setEtape("identifiants");
    setCode("");
    setNouveau("");
    setConfirmation("");
    setCodeEnvoyeLe(null);
    setRenvoiPossibleA(null);
    setErreur(null);
    setAvis(null);
  }

  /* ================================================================
     TEMPS 1 — ADRESSE ET MOT DE PASSE
     ================================================================ */

  async function seConnecter(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setAvis(null);
    setOccupe(true);
    // Le jeton est demandé APRÈS `setOccupe(true)` : sur un réseau lent
    // l'attente peut durer une seconde ou deux, et le bouton doit dire
    // « Connexion… » pendant ce temps plutôt que rester inerte.
    //
    // `jetonNeuf` cède son jeton et commande aussitôt le suivant : une
    // seconde tentative après un mot de passe mal tapé — le cas le plus
    // fréquent de tout cet écran — repart donc avec un jeton neuf, sans
    // que cette fonction ait rien à réarmer.
    const jetonCaptcha = await captcha.current?.jetonNeuf();
    const { error } = await client().auth.signInWithPassword({
      email,
      password: motDePasse,
      options: { captchaToken: jetonCaptcha },
    });
    setOccupe(false);
    if (error) {
      // Une seule phrase pour tous les refus. Le message anglais du
      // serveur n'est JAMAIS affiché : il distinguerait des cas que
      // l'on tient à ne pas distinguer.
      setErreur(messageEchecIdentifiants(error.code));
      return;
    }
    // Le mot de passe a servi ; il n'a plus rien à faire en mémoire.
    setMotDePasse("");
    entrer();
  }

  /* ================================================================
     TEMPS 2 — LE CODE PART
     ================================================================ */

  /**
   * Le passage au champ de code, écrit une fois pour les deux chemins :
   * celui où un code vient de partir, et celui où l'on n'a rien
   * demandé parce que la minute précédente court encore. Les deux
   * doivent être RIGOUREUSEMENT indiscernables à l'écran.
   */
  function afficherLeChampDeCode(envoyeLe: number, possibleA: number) {
    setCode("");
    setCodeEnvoyeLe(envoyeLe);
    setRenvoiPossibleA(possibleA);
    setMaintenant(Date.now());
    setEtape("code");
  }

  async function demanderCode(renvoi = false) {
    const adresse = email.trim().toLowerCase();
    if (adresse === "") {
      setErreur("Indiquez d'abord votre adresse e-mail.");
      return;
    }
    setErreur(null);
    setAvis(null);

    // La minute du serveur court encore pour cette adresse : on ne
    // l'appelle pas. Son refus ne parlerait pas d'un plafond, il
    // parlerait du compte.
    const attente = dernierEnvoi.current;
    if (attente !== null && attente.adresse === adresse && Date.now() < attente.possibleA) {
      afficherLeChampDeCode(attente.envoyeLe, attente.possibleA);
      return;
    }

    setOccupe(true);
    // LE JETON SE COMPTE SUR L'APPEL QUI PART, PAS SUR LE CLIC. Il est
    // demandé ici, APRÈS le court-circuit ci-dessus : quand la minute
    // du serveur court encore, aucun appel ne part et aucun jeton n'est
    // dépensé pour rien.
    //
    // Ce même chemin sert au premier envoi ET à « M'envoyer un nouveau
    // code », qui vit à l'étape suivante. C'est la raison pour laquelle
    // le widget est monté hors des blocs d'étape : sans cela, le renvoi
    // s'adresserait à un widget démonté.
    const jetonCaptcha = await captcha.current?.jetonNeuf();
    const { error } = await client().auth.signInWithOtp({
      email,
      options: {
        captchaToken: jetonCaptcha,
        emailRedirectTo: callbackUrl(),
        // Aucune création de compte depuis cette page. Un
        // administrateur de plateforme est nécessairement un compte qui
        // existe déjà — c'est un collègue, pas un visiteur. Sans ce
        // faux, saisir n'importe quelle adresse créerait un compte
        // Oasis Care de plus dans la vraie base de production.
        shouldCreateUser: false,
      },
    });
    setOccupe(false);

    // Le refus qui trahirait l'existence du compte est TU : on continue
    // exactement comme si le code était parti. Voir
    // `envoiDoitResterMuet` — c'est la fuite que cette page avait.
    if (error && !envoiDoitResterMuet(error.code)) {
      setErreur(messageEchecEnvoi(error.code));
      return;
    }

    const envoyeLe = Date.now();
    const possibleA = envoyeLe + DELAI_RENVOI_S * 1000;
    // Retenu même si l'on repasse par « Changer d'adresse » : c'est ce
    // qui empêche de rejouer la demande et d'en tirer une réponse
    // différente selon que le compte existe ou non.
    dernierEnvoi.current = { adresse, envoyeLe, possibleA };
    afficherLeChampDeCode(envoyeLe, possibleA);
    if (renvoi) setAvis("Un nouveau code vient de partir, s'il y a lieu.");
  }

  /* ================================================================
     TEMPS 3 — LE CODE REVIENT
     ================================================================ */

  /**
   * Un seul type, `email`, et c'est la différence avec Oasis Care Pro.
   *
   * Là-bas, une adresse inconnue crée un compte, et le service
   * d'authentification emploie alors un AUTRE gabarit de courriel dont
   * le jeton porte un autre type — d'où une seconde tentative en
   * `signup`. Ici, `shouldCreateUser: false` rend ce cas impossible :
   * le compte existe forcément, le gabarit est celui du lien de
   * connexion, et `email` suffit.
   *
   * ------------------------------------------------------------------
   * AUCUN JETON ANTI-ROBOT ICI, ET C'EST DÉLIBÉRÉ
   * ------------------------------------------------------------------
   * `verifyOtp` vise POST /verify, qui n'est PAS derrière le contrôle
   * de CAPTCHA du serveur d'authentification — et le champ
   * `captchaToken` que le SDK accepte encore à cet endroit est marqué
   * déprécié dans ses propres types : le serveur ne le lit plus.
   *
   * Un jeton posé ici serait donc dépensé pour rien, et VOLÉ au
   * prochain appel qui, lui, en a besoin — « M'envoyer un nouveau
   * code », juste en dessous. C'est écrit noir sur blanc parce que
   * l'endroit est tentant : sinon quelqu'un « corrigera » un jour.
   */
  async function verifierLeCode(saisie: string) {
    setErreur(null);
    setAvis(null);
    setOccupe(true);
    const { data, error } = await client().auth.verifyOtp({
      email,
      token: saisie,
      type: "email",
    });
    setOccupe(false);

    if (error) {
      const issue = interpreterEchecCode({
        code: error.code,
        message: error.message,
        envoyeLe: codeEnvoyeLe,
        maintenant: Date.now(),
      });
      setErreur(issue.message);
      // Un code périmé ne se retape pas : on vide le champ pour que
      // personne ne s'acharne sur des chiffres qui ne peuvent plus rien
      // ouvrir. Un code mal recopié, lui, se corrige — on le garde.
      if (issue.issue === "expire") setCode("");
      return;
    }

    // ICI, ET SEULEMENT ICI, ON A LE DROIT DE REGARDER LE COMPTE :
    // la personne vient de prouver qu'elle possède cette adresse.
    if (aUneIdentiteEmail(data.user?.identities)) {
      setEtape("motdepasse");
      return;
    }
    // Compte purement Google : aucun mot de passe, jamais.
    entrer();
  }

  /**
   * Validation dès que le compte y est.
   *
   * `enCours` empêche le double départ : le collage déclenche un
   * `onChange`, l'auto-remplissage du navigateur aussi, et les deux
   * peuvent se suivre de très près.
   */
  const enCours = useRef(false);

  const changerLeCode = useCallback(
    (brut: string) => {
      const propre = nettoyerCode(brut);
      setCode(propre);
      if (codeComplet(propre) && !enCours.current) {
        enCours.current = true;
        void verifierLeCode(propre).finally(() => {
          enCours.current = false;
        });
      }
    },
    // `verifierLeCode` referme sur `email` et `codeEnvoyeLe`, stables
    // pendant ce temps de l'écran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [email, codeEnvoyeLe],
  );

  /* ================================================================
     TEMPS 4 — LE MOT DE PASSE
     ================================================================ */

  async function enregistrerLeMotDePasse(evenement: React.FormEvent) {
    evenement.preventDefault();
    setErreur(null);
    setAvis(null);

    // Le contrôle des deux saisies est un CONFORT : il attrape une
    // faute de frappe. Ce n'est pas une sécurité, et le serveur n'en
    // reçoit qu'une seule.
    const verdict = verifierNouveauMotDePasse(nouveau, confirmation);
    if (!verdict.ok) {
      setErreur(verdict.message);
      return;
    }

    setOccupe(true);
    // Pas de jeton anti-robot : `updateUser` vise PUT /user, hors du
    // contrôle de CAPTCHA du serveur, et le type `UserAttributes` n'a
    // aucun champ où en loger un. La personne est d'ailleurs déjà
    // connectée à ce stade — le code a ouvert la session.
    const { error } = await client().auth.updateUser({ password: nouveau });
    setOccupe(false);

    if (error) {
      // `same_password` n'est pas un échec : la personne a reposé le
      // mot de passe qu'elle avait déjà. Elle est connectée, elle entre.
      if (error.code === "same_password") {
        setNouveau("");
        setConfirmation("");
        entrer();
        return;
      }
      setErreur(messageEchecMotDePasse(error.code));
      return;
    }

    setNouveau("");
    setConfirmation("");
    entrer();
  }

  /* ================================================================
     GOOGLE, ET PAS APPLE
     ================================================================ */

  /**
   * Google et code par courriel. PAS Apple, et ce n'est pas un oubli.
   *
   * « Se connecter avec Apple » impose à l'éditeur de proposer « Masquer
   * mon adresse e-mail », qui délivre une adresse de relais du type
   * f5d8z7b5jt@privaterelay.appleid.com. C'est très bien pour un
   * particulier qui s'inscrit sur l'iPhone — il y en a déjà un dans
   * cette base — et inutilisable pour une console d'administration :
   *   • on ne reconnaît pas un collègue derrière une adresse aléatoire ;
   *   • `platform_admins` se peuple à la main, en désignant une adresse
   *     qu'on doit pouvoir écrire de mémoire ;
   *   • et le jour où quelqu'un quitte l'équipe, on cherche qui révoquer.
   *
   * Le compte reste le même partout : quelqu'un qui s'est créé un compte
   * par Apple sur l'iPhone se connecte ici par son adresse réelle et
   * retrouve la même session.
   *
   * PAS DE JETON ANTI-ROBOT ICI : ce bouton ne parle pas à notre
   * serveur d'authentification, il envoie la personne chez le
   * fournisseur, qui fait son propre contrôle. `signInWithOAuth` ne
   * possède même pas de champ où en loger un.
   */
  async function signInWithProvider(provider: "google") {
    setErreur(null);
    const { error } = await client().auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl() },
    });
    if (error) {
      setErreur(
        "La connexion avec ce service n'a pas abouti. Réessayez, ou utilisez votre adresse e-mail.",
      );
    }
  }

  /* ================================================================
     L'ÉCRAN
     ================================================================ */

  const boutonFournisseur =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-raised px-4 py-2.5 text-[var(--text-body)] font-medium text-ink transition-colors hover:border-ink-faint disabled:opacity-60";
  const boutonPrincipal =
    "w-full rounded-[var(--radius-control)] bg-accent px-4 py-2.5 text-[var(--text-body)] font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60";
  const boutonSecondaire =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-raised px-4 py-2 text-[var(--text-body)] font-medium text-ink transition-colors hover:border-ink-faint disabled:opacity-50";
  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-2.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";
  const lien =
    "text-[var(--text-secondary)] font-medium text-accent transition-colors hover:text-accent-hover";
  const etiquette = "text-[var(--text-secondary)] font-medium text-ink-soft";

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <header className="mb-10">
          <p className="wordmark text-[12px] text-ink-soft">Oasis Care</p>
          <h1 className="wordmark mt-1.5 text-[length:var(--text-page)] text-accent">
            Control Center
          </h1>
          <p className="mt-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
            Administration de la plateforme. Réservé à l&apos;équipe Oasis Care.
          </p>
        </header>

        {/* ============================================================
            TEMPS 1 — ADRESSE ET MOT DE PASSE
            ============================================================ */}
        {etape === "identifiants" && (
          <>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => signInWithProvider("google")}
                className={boutonFournisseur}
              >
                Continuer avec Google
              </button>
            </div>

            <div className="my-5 flex items-center gap-3 text-[var(--text-secondary)] text-ink-faint">
              <span className="h-px flex-1 bg-line" />
              ou
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={seConnecter} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>Adresse e-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="vous@oasiscare.com"
                  className={champ}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>Mot de passe</span>
                <input
                  type={afficherLesMotsDePasse ? "text" : "password"}
                  required
                  // Sans cet attribut, aucun gestionnaire de mots de
                  // passe ne fait son travail — et c'est justement ce
                  // qui rend un mot de passe supportable.
                  autoComplete="current-password"
                  value={motDePasse}
                  onChange={(event) => setMotDePasse(event.target.value)}
                  className={champ}
                />
              </label>

              <label className="flex items-center gap-2 text-[var(--text-secondary)] text-ink-soft">
                <input
                  type="checkbox"
                  checked={afficherLesMotsDePasse}
                  onChange={(event) => setAfficherLesMotsDePasse(event.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Afficher ce que je tape
              </label>

              <button type="submit" disabled={occupe} className={boutonPrincipal}>
                {occupe ? "Connexion…" : "Se connecter"}
              </button>
            </form>

            {/* LE CHEMIN DE RETOUR, ET IL N'EST PAS EN PETIT EN BAS DE
                PAGE. C'est aussi le chemin de CRÉATION du premier mot de
                passe : aucun compte n'en a jamais eu. */}
            <div className="mt-5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <p className="text-[var(--text-body)] leading-relaxed text-ink-soft">
                Pas encore de mot de passe, ou vous l&apos;avez oublié ? Nous
                envoyons un code à {LONGUEUR_CODE} chiffres par e-mail pour
                entrer et en choisir un.
              </p>
              <button
                type="button"
                onClick={() => demanderCode()}
                disabled={occupe}
                className={`${boutonSecondaire} mt-3`}
              >
                {occupe ? "Envoi…" : "Recevoir un code par e-mail"}
              </button>
            </div>
          </>
        )}

        {/* ============================================================
            TEMPS 2 — LE CODE REÇU PAR E-MAIL
            (à ne pas confondre avec celui du second facteur)
            ============================================================ */}
        {etape === "code" && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="text-[length:var(--text-card)] font-medium">
              Entrez le code reçu par e-mail
            </p>
            {/* « s'il y a lieu » : cette page ne dit jamais si l'adresse
                appartient à quelqu'un. La phrase est rigoureusement la
                même pour une adresse connue et pour une inconnue — c'est
                le pendant à l'écran de `envoiDoitResterMuet`. */}
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Si un compte Oasis Care existe pour{" "}
              <span className="font-medium text-ink">{email}</span>, un code à{" "}
              {LONGUEUR_CODE} chiffres vient d&apos;y être envoyé. Il est valable
              une heure.
            </p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (codeComplet(code)) void verifierLeCode(code);
              }}
              className="mt-4 flex flex-col gap-2"
            >
              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>
                  Code à {LONGUEUR_CODE} chiffres reçu par e-mail
                </span>
                <input
                  // Un SEUL champ, et non huit petites cases. Les cases
                  // séparées sont jolies et cassent tout ce qui compte :
                  // l'auto-remplissage ne vise qu'un champ, le retour
                  // arrière devient un labyrinthe, et le collage demande
                  // du code pour répartir les chiffres. Ici le collage
                  // marche tout seul — `nettoyerCode` retire ce qui
                  // n'est pas un chiffre, espaces et « Code : » compris.
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  pattern="[0-9]*"
                  // PAS DE `maxLength` ICI, ET C'EST DÉLIBÉRÉ.
                  // Il annulerait tout le nettoyage ci-dessus : le
                  // navigateur tronque le texte collé à N CARACTÈRES
                  // AVANT de nous le passer, donc avant que les espaces
                  // aient été retirés. Coller « 12 34 56 78 » ne
                  // laissait entrer que « 12 34 56 », nettoyé en
                  // « 123456 » — six chiffres, bouton éteint, et rien à
                  // l'écran pour l'expliquer. Mesuré dans un vrai
                  // navigateur. C'est `nettoyerCode` qui tronque, et
                  // lui seul : il compte les chiffres, pas les
                  // caractères.
                  value={code}
                  onChange={(event) => changerLeCode(event.target.value)}
                  placeholder={"0".repeat(LONGUEUR_CODE)}
                  className={`${champ} text-center text-[length:var(--text-section)] tracking-[0.35em] font-mono`}
                />
              </label>

              <button
                type="submit"
                disabled={occupe || !codeComplet(code)}
                className={boutonPrincipal}
              >
                {occupe ? "Vérification…" : "Vérifier le code"}
              </button>
            </form>

            {/* LA PHRASE QUI ÉVITE LA CONFUSION LA PLUS COÛTEUSE DE CET
                ÉCRAN. Un administrateur enrôlé verra un second champ de
                chiffres juste après celui-ci ; sans cet avertissement,
                il chercherait le mauvais code dans la mauvaise
                application. */}
            <p className="mt-3 rounded-[var(--radius-control)] bg-info-wash px-3 py-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              Ce n&apos;est pas le code de votre application
              d&apos;authentification : celui-là fait{" "}
              {LONGUEUR_CODE_SECOND_FACTEUR} chiffres et vous sera demandé
              après, si votre compte en utilise une.
            </p>

            {/* Les deux gestes possibles, toujours côte à côte : le
                serveur ne distingue pas « faux » de « périmé », alors
                l'écran ne parie sur aucun des deux et laisse choisir. */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void demanderCode(true)}
                disabled={occupe || secondesAvantRenvoi > 0}
                className={`${lien} disabled:cursor-not-allowed disabled:text-ink-faint`}
              >
                {secondesAvantRenvoi > 0
                  ? `Nouveau code dans ${secondesAvantRenvoi} s`
                  : "M'envoyer un nouveau code"}
              </button>
              <button type="button" onClick={revenirAuDebut} className={lien}>
                Changer d&apos;adresse
              </button>
            </div>
          </div>
        )}

        {/* ============================================================
            TEMPS 3 — LE MOT DE PASSE
            ============================================================ */}
        {etape === "motdepasse" && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <p className="text-[length:var(--text-card)] font-medium">
              Choisissez votre mot de passe
            </p>
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Votre adresse est confirmée. Ce mot de passe vous ouvrira le
              Control Center les prochaines fois, sans attendre d&apos;e-mail.
            </p>

            {/* La règle est dite AVANT la saisie. Une règle qu'on
                découvre en se faisant refuser est une règle qu'on subit. */}
            <p className="mt-3 rounded-[var(--radius-control)] bg-accent-wash px-3 py-2 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              {REGLE_MOT_DE_PASSE}
            </p>

            <form onSubmit={enregistrerLeMotDePasse} className="mt-4 flex flex-col gap-2">
              {/* Le compte concerné, en lecture seule. Utile à lire, et
                  utile aux gestionnaires de mots de passe : sans un
                  champ `username` à côté, beaucoup refusent
                  d'enregistrer la nouvelle clé. */}
              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>Compte</span>
                <input
                  type="email"
                  value={email}
                  readOnly
                  autoComplete="username"
                  className={`${champ} text-ink-soft`}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>Mot de passe</span>
                <input
                  type={afficherLesMotsDePasse ? "text" : "password"}
                  required
                  minLength={LONGUEUR_MOT_DE_PASSE}
                  autoComplete="new-password"
                  value={nouveau}
                  onChange={(event) => setNouveau(event.target.value)}
                  className={champ}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>Le même, une seconde fois</span>
                <input
                  type={afficherLesMotsDePasse ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className={champ}
                />
              </label>

              {/* Saisir deux fois à l'aveugle une phrase longue est le
                  meilleur moyen d'abandonner. */}
              <label className="flex items-center gap-2 text-[var(--text-secondary)] text-ink-soft">
                <input
                  type="checkbox"
                  checked={afficherLesMotsDePasse}
                  onChange={(event) => setAfficherLesMotsDePasse(event.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Afficher ce que je tape
              </label>

              <button type="submit" disabled={occupe} className={boutonPrincipal}>
                {occupe ? "Enregistrement…" : "Enregistrer et entrer"}
              </button>
            </form>

            {/* On est DÉJÀ connecté à ce stade : le code a ouvert la
                session. Forcer le mot de passe ici enfermerait quelqu'un
                dehors de son propre compte pour une case obligatoire. */}
            <button
              type="button"
              onClick={entrer}
              disabled={occupe}
              className={`${lien} mt-4`}
            >
              Plus tard — entrer sans mot de passe
            </button>
          </div>
        )}

        {avis && (
          <p className="mt-4 rounded-[var(--radius-control)] bg-positive-wash px-3 py-2 text-[var(--text-body)] text-positive">
            {avis}
          </p>
        )}

        {erreur && (
          <p
            ref={bandeauErreur}
            role="alert"
            className="mt-4 rounded-[var(--radius-control)] bg-critical-wash px-3 py-2 text-[var(--text-body)] leading-relaxed text-critical"
          >
            {erreur}
          </p>
        )}

        {/* ============================================================
            LA VÉRIFICATION ANTI-ROBOT — UNE SEULE, POUR TOUT L'ÉCRAN
            ============================================================

            HORS DES TROIS BLOCS D'ÉTAPE, ET C'EST LA SEULE PLACE JUSTE.
            La poser dans le bloc « identifiants » aurait paru plus
            propre : les deux appels protégés du premier temps y sont.
            Mais « M'envoyer un nouveau code » vit à l'étape « code », et
            ce bouton appelle la même route protégée. Un widget qui
            disparaît en changeant d'étape n'a plus de jeton à donner
            exactement quand on en redemande un.

            EN DERNIER, APRÈS LES DEUX BANDEAUX — ET C'EST UNE CORRECTION,
            PAS UN DÉTAIL. Il était posé juste au-dessus d'eux. Le jour
            où il a quelque chose à montrer, son bloc mesure de cent
            cinquante à deux cent vingt-cinq pixels : il repoussait
            d'autant le bandeau qui explique l'échec, c'est-à-dire la
            phrase même que la personne doit lire après avoir cliqué.
            Mesuré sur un écran de téléphone : trois cent cinquante-six
            pixels sous le pli. Placé ici, il ne déplace plus rien. */}
        <Turnstile ref={captcha} className="mt-4" />
      </div>
    </main>
  );
}
