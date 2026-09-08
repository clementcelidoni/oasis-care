"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  aUneIdentiteEmail,
  codeComplet,
  DELAI_RENVOI_S,
  destinationSure,
  interpreterEchecCode,
  LONGUEUR_CODE,
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
 * ══════════════════════════════════════════════════════════════════
 * LA PORTE D'ENTRÉE D'OASIS CARE PRO
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est la seule page du produit que voient des gens qui ne le
 * connaissent pas encore. Elle dit donc CE QUE FAIT le logiciel avant
 * de demander quoi que ce soit.
 *
 * ------------------------------------------------------------------
 * CE QUI A CHANGÉ, ET POURQUOI
 * ------------------------------------------------------------------
 * Cette page ne connaissait que le lien de connexion, et elle s'en
 * vantait : « Aucun mot de passe à retenir. » Elle en demande un
 * désormais, et ce n'est pas un renoncement au confort.
 *
 * Tous les courriels du produit partent d'un SEUL domaine, partagé
 * entre tous les paysagistes clients. La réputation d'envoi est donc
 * commune : qu'un seul client soit signalé comme indésirable, et la
 * délivrabilité tombe pour tout le parc — y compris pour les courriels
 * d'authentification, qui empruntent le même chemin. Avec des liens
 * magiques, une panne de courrier devient une panne d'ACCÈS : plus
 * personne n'entre, nulle part. Avec un mot de passe, une panne de
 * courrier reste une panne de courrier.
 *
 * ------------------------------------------------------------------
 * UN SEUL ÉCRAN QUI AVANCE, PAS CINQ ÉCRANS
 * ------------------------------------------------------------------
 *   identifiants → (code) → (mot de passe) → on entre
 *
 * Les parenthèses sont les temps qu'on ne traverse pas toujours : le
 * cas courant — j'ai un mot de passe, je le tape — n'en traverse aucun
 * et reste le plus rapide de tous, un seul aller-retour, aucun
 * courriel. À chaque temps, l'écran dit où l'on en est et comment
 * revenir en arrière.
 *
 * INSCRIPTION ET CONNEXION SONT LE MÊME CHEMIN. Une adresse inconnue
 * qui demande un code voit son compte créé par le service
 * d'authentification, le code confirme l'adresse, et le mot de passe
 * choisi dans la foulée ouvrira la porte les fois suivantes. Il n'y a
 * donc rien à choisir entre « me connecter » et « m'inscrire », et
 * c'est tant mieux : personne ne sait jamais dans quel cas il est.
 *
 * ------------------------------------------------------------------
 * LA CONTRAINTE QUI FAÇONNE TOUT LE PREMIER TEMPS
 * ------------------------------------------------------------------
 * L'ÉCRAN NE DOIT JAMAIS RÉVÉLER QU'UNE ADRESSE EXISTE. C'est ce qui
 * interdit la forme la plus naturelle — demander l'adresse, aller voir,
 * puis afficher le bon champ. Ce coup d'œil serait un oracle : une
 * adresse à la fois, on saurait qui est client.
 *
 * D'où le choix retenu : LES DEUX CHAMPS SONT LÀ D'EMBLÉE, adresse et
 * mot de passe, et un bouton permanent « je n'ai pas de mot de passe,
 * ou je l'ai oublié » mène au code. Aucun branchement, donc aucune
 * requête préalable : cet écran N'AJOUTE aucun moyen d'apprendre qui
 * est client. Et le chemin de retour n'est pas un pis-aller relégué en
 * bas de page : c'est lui qui rend l'écran insensible à l'existence du
 * compte.
 *
 * ------------------------------------------------------------------
 * CE QUE CE DESSIN NE PEUT PAS FAIRE, ET IL FAUT LE DIRE
 * ------------------------------------------------------------------
 * Il n'ajoute pas d'oracle ; il n'en SUPPRIME pas un qui vit ailleurs.
 * Le serveur d'authentification ne calcule l'empreinte du mot de passe
 * que s'il a trouvé un compte : une adresse connue répond en deux fois
 * plus de temps qu'une adresse inconnue. Mesuré sur la production, dix
 * essais chacune, sans le moindre recouvrement entre les deux séries.
 * Aucune ligne de cette page n'y peut quoi que ce soit — la seule
 * parade est un CAPTCHA, qui s'active dans le tableau de bord et rend
 * le balayage coûteux. C'est écrit dans la notice de mise en service ;
 * ce n'est pas une raison de renoncer à l'égalité des messages, qui
 * reste la seule chose qu'un écran puisse tenir.
 *
 * ------------------------------------------------------------------
 * GOOGLE ET APPLE NE BOUGENT PAS
 * ------------------------------------------------------------------
 * Ils restent la première rangée, avant le formulaire. Et un compte
 * entré par là ne se voit JAMAIS réclamer un mot de passe : après la
 * vérification du code, on lit `user.identities`, et sans identité
 * « e-mail » on entre directement (voir `aUneIdentiteEmail`).
 *
 * ------------------------------------------------------------------
 * OÙ VIT LE MOT DE PASSE, ET OÙ IL NE VA JAMAIS
 * ------------------------------------------------------------------
 * Dans un `useState` de ce composant, le temps d'un appel, et c'est
 * tout. Il ne part que vers Supabase. Jamais dans une URL, jamais dans
 * un journal, jamais dans un message d'erreur, jamais dans le stockage
 * du navigateur. `page.test.ts` relit ce fichier pour le prouver.
 *
 * Les trois appels partent du NAVIGATEUR, comme `lib/supabase/client`
 * l'impose : `lib/supabase/server.ts` avale l'exception de `setAll()`,
 * si bien qu'une session obtenue depuis un composant serveur serait
 * perdue en silence. C'est le même raisonnement que
 * `web-admin/lib/auth/enrolement-totp.tsx`.
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
 * disponible dès le premier rendu, sans effet et sans clignotement.
 */

type Etape = "identifiants" | "code" | "motdepasse";

export default function Formulaire({
  /**
   * Le message du lien qui a échoué, déjà traduit par `page.tsx`.
   *
   * Il sert de VALEUR INITIALE à l'erreur affichée, et non de valeur
   * permanente : dès que la personne tente quoi que ce soit, chaque
   * gestionnaire remet `erreur` à zéro et le message d'un lien périmé
   * s'efface tout seul, sans qu'on ait à le ranger.
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

  /**
   * Quand CE navigateur a demandé le code, et à partir de quand il
   * pourra en redemander un. Deux dates, deux usages distincts :
   * la première sert à choisir le bon mot quand un code est refusé
   * (`interpreterEchecCode`), la seconde à éteindre un bouton qui
   * serait de toute façon refusé par le serveur.
   */
  const [codeEnvoyeLe, setCodeEnvoyeLe] = useState<number | null>(null);
  const [renvoiPossibleA, setRenvoiPossibleA] = useState<number | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  /**
   * LA MINUTE DÉJÀ ENTAMÉE POUR UNE ADRESSE.
   *
   * « Changer d'adresse » remet le décompte à zéro, et c'est normal.
   * Le serveur, lui, n'oublie rien : il compte PAR ADRESSE, une minute
   * entre deux envois. Redemander un code pour la même adresse
   * quarante secondes plus tard se fait donc refuser — un aller-retour
   * pour rien, et une minute de courrier gaspillée sur un plafond
   * d'envoi partagé par tout le parc.
   *
   * Ici ce n'est pas une question de discrétion : sur Oasis Care Pro,
   * une adresse inconnue reçoit elle aussi un courriel, donc le refus
   * ne distingue rien. C'est chez le Control Center que ce même refus
   * était un aveu, et le code des deux applications reste jumeau pour
   * qu'on n'ait jamais à se demander lequel des deux a raison.
   */
  const dernierEnvoi = useRef<{
    adresse: string;
    envoyeLe: number;
    possibleA: number;
  } | null>(null);

  const supabase = createClient();

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

  /** Là où l'on retourne une fois entré. */
  function destination() {
    return destinationSure(new URLSearchParams(window.location.search).get("next"));
  }

  /**
   * On entre — par une navigation complète, pas par le routeur.
   *
   * La session vient d'être écrite dans les cookies par le client de
   * navigateur ; il faut que le serveur les relise pour rendre la page
   * suivante. `router.push` garderait le rendu client déjà en mémoire.
   */
  function entrer() {
    window.location.assign(destination());
  }

  function callbackUrl() {
    const url = new URL("/auth/callback", window.location.origin);
    const suite = destination();
    if (suite !== "/") url.searchParams.set("next", suite);
    return url.toString();
  }

  /** Revenir au premier temps sans rien garder du précédent. */
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
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: motDePasse,
      options: { captchaToken: jetonCaptcha },
    });
    setOccupe(false);
    if (error) {
      // Une seule phrase pour tous les refus : voir
      // `messageEchecIdentifiants`. Le message anglais du serveur n'est
      // JAMAIS affiché — il distinguerait des cas que l'on tient à ne
      // pas distinguer.
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
   * demandé parce que la minute précédente court encore.
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

    // La minute du serveur court encore pour cette adresse : inutile de
    // l'appeler, il refusera. Le code déjà reçu est toujours bon — il
    // vit une heure.
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
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        captchaToken: jetonCaptcha,
        // `shouldCreateUser` reste à sa valeur par défaut, c'est-à-dire
        // VRAI : inscription et connexion sont le même chemin, et une
        // adresse inconnue doit pouvoir ouvrir un compte ici. C'est
        // aussi ce qui rend cet écran insensible à l'existence du
        // compte — la réponse est identique dans les deux cas.
        //
        // Le lien de retour reste fourni pour ceux qui préfèrent
        // cliquer, mais il est un CONFORT : le code, lui, marche depuis
        // n'importe quel appareil, y compris quand le courriel est
        // ouvert sur un autre téléphone que celui qui l'a demandé.
        emailRedirectTo: callbackUrl(),
      },
    });
    setOccupe(false);
    if (error) {
      setErreur(messageEchecEnvoi(error.code));
      return;
    }
    const envoyeLe = Date.now();
    const possibleA = envoyeLe + DELAI_RENVOI_S * 1000;
    dernierEnvoi.current = { adresse, envoyeLe, possibleA };
    afficherLeChampDeCode(envoyeLe, possibleA);
    if (renvoi) setAvis("Un nouveau code vient de partir.");
  }

  /* ================================================================
     TEMPS 3 — LE CODE REVIENT
     ================================================================ */

  /**
   * Deux types d'affilée, et ce n'est pas de la superstition.
   *
   * Le gabarit de courriel employé par Supabase DIFFÈRE selon que
   * l'adresse existait déjà ou non : « Magic Link » d'un côté,
   * « Confirm signup » de l'autre — alors que l'appel, lui, est
   * rigoureusement le même. C'est exactement le piège qui a laissé un
   * compte dehors pendant quatre jours.
   *
   * `email` est le type documenté et couvre le cas courant. Si le
   * serveur refuse, on retente en `signup` avant de conclure : une
   * vérification qui échoue NE CONSOMME PAS le jeton, la seconde
   * tentative ne coûte donc qu'un aller-retour.
   *
   * ------------------------------------------------------------------
   * MAIS ELLE NE PART PAS À TOUS LES COUPS, ET C'EST NOUVEAU
   * ------------------------------------------------------------------
   * Le repli n'a de sens que pour un jeton INTROUVABLE sous ce type-là.
   * Le serveur signale ce cas par `otp_expired` — le seul code d'erreur
   * qu'il possède pour « ce code ne correspond à rien ». Tout le reste
   * — plafond de vérifications atteint, adresse malformée, compte
   * suspendu, panne de réseau — ne changera pas de réponse parce qu'on
   * a changé le type : rejouer ne ferait que consommer une seconde
   * unité de `rate_limit_verify`, c'est-à-dire diviser par deux le
   * nombre de fautes de frappe qu'une personne a le droit de commettre.
   *
   * DITE HONNÊTEMENT, LA LIMITE DE CETTE PRÉCAUTION : elle ne supprime
   * pas le double appel dans le cas le plus fréquent, la faute de
   * frappe, qui rend justement `otp_expired`. Le supprimer là
   * demanderait de savoir si `email` suffit déjà pour un compte neuf —
   * ce que je ne peux vérifier qu'en créant un vrai compte et en
   * expédiant un vrai courriel. Le jour où le gabarit « Confirm
   * signup » portera son code (c'est un réglage, il est dans la
   * notice), cet essai devra être fait : si `email` suffit, ces six
   * lignes disparaissent. Se tromper dans l'autre sens enfermerait
   * dehors tout client neuf, et c'est bien pire qu'un aller-retour.
   *
   * En cas de double échec, c'est la PREMIÈRE erreur qui est rapportée :
   * c'est celle du chemin nominal, donc la plus parlante.
   *
   * ------------------------------------------------------------------
   * AUCUN JETON ANTI-ROBOT ICI, ET C'EST DÉLIBÉRÉ
   * ------------------------------------------------------------------
   * Ces deux appels consécutifs sont le cas d'école du jeton à usage
   * unique : deux appels d'affilée, sans passage par l'utilisateur.
   * C'est précisément pour cela qu'il faut l'écrire noir sur blanc,
   * sinon quelqu'un « corrigera » un jour en y collant un jeton.
   *
   * `verifyOtp` vise POST /verify, qui n'est PAS derrière le contrôle
   * de CAPTCHA du serveur d'authentification — et le champ
   * `captchaToken` que le SDK accepte encore à cet endroit est marqué
   * déprécié dans ses propres types : le serveur ne le lit plus.
   *
   * Un jeton posé ici serait donc dépensé pour rien, et VOLÉ au
   * prochain appel qui, lui, en a besoin — « M'envoyer un nouveau
   * code », juste en dessous.
   */
  async function verifierLeCode(saisie: string) {
    setErreur(null);
    setAvis(null);
    setOccupe(true);

    let session = await supabase.auth.verifyOtp({ email, token: saisie, type: "email" });
    if (session.error?.code === "otp_expired") {
      const secours = await supabase.auth.verifyOtp({
        email,
        token: saisie,
        type: "signup",
      });
      if (!secours.error) session = secours;
    }

    setOccupe(false);

    if (session.error) {
      const issue = interpreterEchecCode({
        code: session.error.code,
        message: session.error.message,
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
    if (aUneIdentiteEmail(session.data.user?.identities)) {
      setEtape("motdepasse");
      return;
    }
    // Compte purement Google ou Apple : aucun mot de passe, jamais.
    entrer();
  }

  /**
   * Validation dès que le compte y est.
   *
   * `enCours` empêche le double départ : le collage déclenche un
   * `onChange`, l'auto-remplissage d'iOS aussi, et les deux peuvent se
   * suivre de très près.
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
    // `verifierLeCode` referme sur `email` et `codeEnvoyeLe`, qui sont
    // stables pendant ce temps de l'écran.
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
    const { error } = await supabase.auth.updateUser({ password: nouveau });
    setOccupe(false);

    if (error) {
      // `same_password` n'est pas un échec : la personne a simplement
      // reposé le mot de passe qu'elle avait déjà. Elle est connectée,
      // on la laisse entrer.
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
     LES FOURNISSEURS
     ================================================================ */

  /**
   * PAS DE JETON ANTI-ROBOT ICI NON PLUS, et pour une raison encore
   * plus nette qu'ailleurs : ce bouton ne parle pas à notre serveur
   * d'authentification. Il envoie la personne chez Google ou chez
   * Apple, qui font leur propre contrôle. `signInWithOAuth` ne
   * possède même pas de champ où loger un jeton.
   */
  async function signInWithProvider(provider: "google" | "apple") {
    setErreur(null);
    const { error } = await supabase.auth.signInWithOAuth({
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
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-4 py-3 text-[var(--text-body)] font-medium transition-colors hover:bg-canvas disabled:opacity-60";
  const boutonPrincipal =
    "w-full rounded-[var(--radius-control)] bg-accent px-4 py-3 text-[var(--text-body)] font-medium text-accent-ink transition-colors hover:bg-accent-hover disabled:opacity-60";
  const boutonSecondaire =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-4 py-2.5 text-[var(--text-body)] font-medium text-ink transition-colors hover:bg-canvas disabled:opacity-50";
  const champ =
    "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-3 text-[var(--text-body)] outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";
  const lien =
    "text-[var(--text-secondary)] font-medium text-accent transition-colors hover:text-accent-hover";
  const etiquette = "text-[var(--text-secondary)] font-medium text-ink-soft";

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <header className="mb-10 text-center">
          <Image
            src="/oasis-logo.png"
            alt=""
            width={64}
            height={64}
            priority
            className="mx-auto rounded-[var(--radius-control)]"
          />
          <h1 className="mt-5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
            Oasis Care Pro
          </h1>
          <p className="mx-auto mt-4 max-w-xs text-[length:var(--text-card)] leading-snug text-ink-soft text-balance">
            Pilotez votre entreprise, vos jardins et votre pépinière depuis un
            seul endroit.
          </p>
        </header>

        {/* ============================================================
            TEMPS 1 — ADRESSE ET MOT DE PASSE
            ============================================================ */}
        {etape === "identifiants" && (
          <>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => signInWithProvider("apple")}
                className={boutonFournisseur}
              >
                Continuer avec Apple
              </button>
              <button
                type="button"
                onClick={() => signInWithProvider("google")}
                className={boutonFournisseur}
              >
                Continuer avec Google
              </button>
            </div>

            <div className="my-6 flex items-center gap-3 text-[var(--text-secondary)] text-ink-faint">
              <span className="h-px flex-1 bg-line" />
              ou
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={seConnecter} className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>Adresse e-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@entreprise.fr"
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
                  onChange={(e) => setMotDePasse(e.target.value)}
                  className={champ}
                />
              </label>

              <label className="flex items-center gap-2 text-[var(--text-secondary)] text-ink-soft">
                <input
                  type="checkbox"
                  checked={afficherLesMotsDePasse}
                  onChange={(e) => setAfficherLesMotsDePasse(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Afficher ce que je tape
              </label>

              <button type="submit" disabled={occupe} className={boutonPrincipal}>
                {occupe ? "Connexion…" : "Se connecter"}
              </button>
            </form>

            {/* LE CHEMIN DE RETOUR, ET IL N'EST PAS EN PETIT EN BAS DE
                PAGE. « J'ai oublié mon mot de passe » est la première
                demande d'assistance de tous les logiciels du monde ; et
                ici c'est aussi le chemin de CRÉATION du premier mot de
                passe, donc celui que prendront les quatre comptes
                existants et tous les nouveaux clients. */}
            <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
              <p className="text-[var(--text-body)] leading-relaxed text-ink-soft">
                Pas encore de mot de passe, ou vous l&apos;avez oublié ? Nous
                vous envoyons un code à {LONGUEUR_CODE} chiffres pour entrer et
                en choisir un.
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
            TEMPS 2 — LE CODE
            ============================================================ */}
        {etape === "code" && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
            <p className="text-[length:var(--text-card)] font-medium">
              Entrez le code reçu
            </p>
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Un code à {LONGUEUR_CODE} chiffres vient de partir vers{" "}
              {/* L'adresse est affichée EN ENTIER, et c'est voulu : la
                  personne vient de la taper, elle est sur son écran, et
                  la masquer l'empêcherait de repérer sa faute de frappe
                  — le premier motif d'échec, très loin devant. */}
              <span className="font-medium text-ink">{email}</span>. Il est
              valable une heure.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (codeComplet(code)) void verifierLeCode(code);
              }}
              className="mt-4 flex flex-col gap-2.5"
            >
              <label className="flex flex-col gap-1.5">
                <span className={etiquette}>
                  Code à {LONGUEUR_CODE} chiffres reçu par e-mail
                </span>
                <input
                  // Un SEUL champ, et non huit petites cases. Les cases
                  // séparées sont jolies et cassent tout ce qui compte :
                  // l'auto-remplissage d'iOS ne vise qu'un champ, le
                  // retour arrière devient un labyrinthe, et le collage
                  // demande du code pour répartir les chiffres. Ici le
                  // collage marche tout seul — `nettoyerCode` retire ce
                  // qui n'est pas un chiffre, espaces et « Code : »
                  // compris.
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  // Le clavier numérique sur téléphone, et rien d'autre
                  // que des chiffres depuis un clavier physique.
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
                  onChange={(e) => changerLeCode(e.target.value)}
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
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
            <p className="text-[length:var(--text-card)] font-medium">
              Choisissez votre mot de passe
            </p>
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Votre adresse est confirmée. Ce mot de passe vous ouvrira Oasis
              Care les prochaines fois, sans attendre d&apos;e-mail.
            </p>

            {/* La règle est dite AVANT la saisie. Une règle qu'on
                découvre en se faisant refuser est une règle qu'on subit. */}
            <p className="mt-3 rounded-[var(--radius-control)] bg-accent-wash px-3.5 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              {REGLE_MOT_DE_PASSE}
            </p>

            <form onSubmit={enregistrerLeMotDePasse} className="mt-4 flex flex-col gap-2.5">
              {/* Le compte concerné, en lecture seule. Utile à lire, et
                  utile aux gestionnaires de mots de passe : sans un
                  champ `username` à côté, beaucoup refusent d'enregistrer
                  la nouvelle clé. */}
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
                  onChange={(e) => setNouveau(e.target.value)}
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
                  onChange={(e) => setConfirmation(e.target.value)}
                  className={champ}
                />
              </label>

              {/* Saisir deux fois à l'aveugle une phrase longue sur un
                  téléphone est le meilleur moyen d'abandonner. */}
              <label className="flex items-center gap-2 text-[var(--text-secondary)] text-ink-soft">
                <input
                  type="checkbox"
                  checked={afficherLesMotsDePasse}
                  onChange={(e) => setAfficherLesMotsDePasse(e.target.checked)}
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
          <p className="mt-4 rounded-[var(--radius-control)] bg-positive-wash px-3.5 py-2.5 text-[var(--text-body)] text-positive">
            {avis}
          </p>
        )}

        {erreur && (
          <p
            ref={bandeauErreur}
            role="alert"
            className="mt-4 rounded-[var(--radius-control)] bg-critical-wash px-3.5 py-2.5 text-[var(--text-body)] leading-relaxed text-critical"
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

        {/* §19 — la ligne qui évite le doublon de compte. Quelqu'un qui
            utilise déjà l'application iPhone n'a rien à créer ici, et
            créer un second compte lui ferait perdre ses jardins. */}
        <p className="mt-8 text-center text-[var(--text-secondary)] text-ink-soft">
          Déjà utilisateur Oasis Care ? Utilisez le même compte.
        </p>
      </div>
    </main>
  );
}
