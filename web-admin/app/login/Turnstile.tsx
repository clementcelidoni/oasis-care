"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  ACTION_CAPTCHA,
  cleDeSiteTurnstile,
  DELAI_CHARGEMENT_MS,
  DELAI_DEFI_MS,
  DELAI_JETON_MS,
  INTERVALLE_ATTENTE_MS,
  URL_SCRIPT_TURNSTILE,
  verdictCaptcha,
  type EtatCaptcha,
} from "./captcha.ts";

/**
 * ══════════════════════════════════════════════════════════════════
 * LE WIDGET ANTI-ROBOT — UN SEUL, POUR TOUT L'ÉCRAN
 * ══════════════════════════════════════════════════════════════════
 *
 * Il y a UN SEUL exemplaire de ce composant par page de connexion, et
 * ce n'est pas un détail d'implémentation : c'est la règle qui empêche
 * le défaut le plus fréquent de ce genre d'intégration.
 *
 * ------------------------------------------------------------------
 * LE DÉFAUT QU'ON ÉVITE, ET IL EST SILENCIEUX
 * ------------------------------------------------------------------
 * UN JETON TURNSTILE NE VAUT QUE POUR UN APPEL. Le deuxième appel
 * portant le même jeton est refusé par le serveur, avec le code
 * `captcha_failed`.
 *
 * Or l'écran de connexion enchaîne les appels sans jamais recharger la
 * page :
 *   • un mot de passe mal tapé, puis une seconde tentative ;
 *   • une tentative par mot de passe, puis « Recevoir un code » ;
 *   • « M'envoyer un nouveau code », depuis l'étape suivante ;
 *   • « Changer d'adresse », puis un nouvel envoi.
 *
 * Un widget qu'on oublie de réarmer transforme chacun de ces
 * enchaînements en « échec » incompréhensible — et l'écran, lui,
 * affiche la phrase générique sur les identifiants. La personne conclut
 * qu'elle s'est trompée de mot de passe.
 *
 * ------------------------------------------------------------------
 * LA PARADE : ON NE PEUT PAS OUBLIER DE RÉARMER
 * ------------------------------------------------------------------
 * `jetonNeuf()` ne se contente pas de RENDRE le jeton : il le CONSOMME.
 * Au moment même où il le cède, il l'efface de sa mémoire et demande à
 * Cloudflare d'en fabriquer un autre. Il n'existe donc aucun chemin où
 * un appelant garde un jeton déjà dépensé, parce qu'il n'existe aucun
 * appelant à qui l'on ait confié la charge de le réarmer.
 *
 * L'effet de bord est heureux : le jeton suivant se fabrique PENDANT
 * l'appel en cours. Quand la personne réessaie, il est déjà là.
 *
 * ------------------------------------------------------------------
 * UN SEUL EXEMPLAIRE, MONTÉ EN PERMANENCE
 * ------------------------------------------------------------------
 * `Formulaire.tsx` le pose UNE FOIS, hors des trois blocs d'étape. Le
 * poser dans le bloc « identifiants » aurait paru plus propre et aurait
 * été faux : « M'envoyer un nouveau code » vit à l'étape « code », et
 * ce bouton appelle une route protégée. Un widget qui disparaît en
 * changeant d'étape est un widget qui n'a plus de jeton à donner
 * exactement quand on en redemande un.
 *
 * ------------------------------------------------------------------
 * LA DISCRÉTION, ET COMMENT ELLE EST OBTENUE
 * ------------------------------------------------------------------
 * `appearance: "interaction-only"` : le widget n'occupe AUCUNE place
 * tant que Cloudflare n'a rien à montrer, c'est-à-dire dans l'immense
 * majorité des cas. Pas de grande case blanche « Je ne suis pas un
 * robot » qui attend d'être cochée, pas de zone vide réservée à
 * quelque chose qui n'apparaîtra pas.
 *
 * Et quand une énigme apparaît malgré tout, elle apparaît EN BAS de la
 * carte, après tous les panneaux : rien au-dessus d'elle ne bouge, rien
 * n'est recouvert. Une ligne l'annonce, et l'on amène doucement la vue
 * jusqu'à elle — sans quoi une personne qui vient de cliquer sur « Se
 * connecter » regarderait son bouton pendant que la solution attend
 * hors de l'écran.
 *
 * ------------------------------------------------------------------
 * CE QUI N'EST PAS ICI, ET POURQUOI
 * ------------------------------------------------------------------
 * Aucun `fetch`, aucun stockage, aucun journal. Le jeton naît dans ce
 * composant et repart directement vers Supabase depuis le gestionnaire
 * qui l'a demandé : il ne traverse ni notre serveur, ni une URL, ni le
 * stockage du navigateur.
 *
 * Et surtout : LE BOUTON GOOGLE N'A PAS DE WIDGET. C'est une
 * redirection vers un fournisseur, pas un appel à notre serveur
 * d'authentification. Lui coller un jeton n'apporterait rien et
 * gaspillerait celui de l'appel suivant.
 */

/* ==================================================================
   L'INTERFACE DE CLOUDFLARE, DÉCLARÉE À LA MAIN
   ================================================================== */

/**
 * Turnstile ne publie pas de paquet de types, et en ajouter un pour
 * trois signatures serait une dépendance de plus à surveiller. On
 * déclare donc ce qu'on emploie, et rien d'autre : ce qui n'est pas
 * écrit ici n'est pas appelé.
 */
type ParametresRendu = {
  sitekey: string;
  /** Le widget a fini : voici le jeton. */
  callback: (jeton: string) => void;
  /** Le widget a renoncé (réseau, navigateur non pris en charge…). */
  "error-callback": (code?: string) => void;
  /** Le jeton a dépassé ses 300 secondes sans avoir servi. */
  "expired-callback": () => void;
  /** Cloudflare n'a pas obtenu de réponse à temps. */
  "timeout-callback": () => void;
  /** Une énigme va s'afficher : la personne va devoir agir. */
  "before-interactive-callback": () => void;
  /** L'énigme est finie. */
  "after-interactive-callback": () => void;
  /** Ce navigateur ne sait pas faire. */
  "unsupported-callback": () => void;
  appearance: "always" | "execute" | "interaction-only";
  execution: "render" | "execute";
  retry: "auto" | "never";
  "refresh-expired": "auto" | "manual" | "never";
  theme: "auto" | "light" | "dark";
  size: "normal" | "flexible" | "compact";
  language: string;
  action: string;
};

type ApiTurnstile = {
  render: (conteneur: HTMLElement, parametres: ParametresRendu) => string | undefined;
  reset: (widget?: string) => void;
  remove: (widget?: string) => void;
};

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
  }
}

/* ==================================================================
   LE CHARGEMENT DU SCRIPT
   ================================================================== */

/**
 * La promesse de chargement, partagée par toute la page.
 *
 * Elle est au niveau du MODULE et non du composant : en développement,
 * React monte deux fois chaque composant pour débusquer les effets mal
 * nettoyés, et deux balises `<script>` identiques feraient deux
 * chargements. Un seul suffit.
 *
 * Elle est remise à zéro en cas d'échec — sans quoi le bouton
 * « Réessayer » réessaierait une promesse déjà rejetée, c'est-à-dire
 * rien du tout.
 */
let chargement: Promise<void> | null = null;

function chargerLeScript(): Promise<void> {
  if (window.turnstile !== undefined) return Promise.resolve();
  if (chargement !== null) return chargement;

  const promesse = new Promise<void>((resoudre, rejeter) => {
    const balise = document.createElement("script");
    balise.src = URL_SCRIPT_TURNSTILE;
    balise.async = true;
    balise.defer = true;

    // LE DÉLAI EST INDISPENSABLE. Un réseau qui FILTRE ne renvoie pas
    // toujours une erreur : il laisse souvent la requête pendre. Sans
    // cette minuterie, ni `load` ni `error` ne se déclenchent jamais et
    // l'écran attend pour l'éternité.
    const minuterie = window.setTimeout(() => {
      rejeter(new Error("delai"));
    }, DELAI_CHARGEMENT_MS);

    balise.addEventListener("load", () => {
      window.clearTimeout(minuterie);
      resoudre();
    });
    balise.addEventListener("error", () => {
      window.clearTimeout(minuterie);
      rejeter(new Error("chargement"));
    });

    document.head.appendChild(balise);
  });

  chargement = promesse;
  // Le rejet est traité ici pour qu'il ne remonte jamais en « promesse
  // rejetée non gérée » ; l'appelant le traite de son côté, sur sa
  // propre copie.
  promesse.catch(() => {
    chargement = null;
  });
  return promesse;
}

/* ==================================================================
   LA POIGNÉE OFFERTE AU FORMULAIRE
   ================================================================== */

export type PoigneeCaptcha = {
  /**
   * Un jeton bon pour UN appel, et le suivant est aussitôt commandé.
   *
   * Rend `undefined` dans deux cas, et l'appelant doit alors partir
   * SANS jeton plutôt que renoncer (voir `peutContinuerSansJeton`) :
   *   • aucune clé de site n'est configurée — le CAPTCHA n'existe pas ;
   *   • le widget n'a jamais pu se charger, ou n'a pas répondu à temps.
   */
  jetonNeuf: () => Promise<string | undefined>;
};

export default function Turnstile({
  ref,
  className,
}: {
  ref?: React.Ref<PoigneeCaptcha>;
  className?: string;
}) {
  const cle = cleDeSiteTurnstile();

  const boite = useRef<HTMLDivElement>(null);
  const identifiant = useRef<string | undefined>(undefined);
  const jeton = useRef<string | null>(null);

  // L'état est tenu DEUX FOIS, et c'est voulu : `useState` pour
  // l'affichage, une référence pour l'attente. La boucle d'attente
  // s'exécute hors du cycle de rendu — elle lirait sinon la valeur
  // figée au moment où elle a été créée, donc « chargement » pour
  // toujours.
  const [etat, setEtat] = useState<EtatCaptcha>(cle === "" ? "inactif" : "chargement");
  const etatCourant = useRef<EtatCaptcha>(etat);

  const poserEtat = useCallback((nouvel: EtatCaptcha) => {
    etatCourant.current = nouvel;
    setEtat(nouvel);
  }, []);

  /**
   * Le compteur de montage : l'incrémenter refait tout depuis le début,
   * script compris. C'est ce que fait le bouton « Réessayer ».
   */
  const [essai, setEssai] = useState(0);

  /* ================================================================
     MONTAGE DU WIDGET
     ================================================================ */

  useEffect(() => {
    // Pas de clé : rien à monter, et l'écran fonctionne comme avant.
    if (cle === "") return;

    const conteneur = boite.current;
    if (conteneur === null) return;

    let vivant = true;
    poserEtat("chargement");

    chargerLeScript()
      .then(() => {
        if (!vivant) return;
        const api = window.turnstile;
        if (api === undefined) {
          poserEtat("indisponible");
          return;
        }
        try {
          identifiant.current = api.render(conteneur, {
            sitekey: cle,
            callback: (recu) => {
              jeton.current = recu;
              poserEtat("pret");
            },
            "error-callback": () => {
              // Le widget a renoncé. On le dit plutôt que de laisser
              // l'écran attendre : c'est le seul moyen d'offrir le
              // bouton « Réessayer ».
              jeton.current = null;
              poserEtat("indisponible");
            },
            "expired-callback": () => {
              // Cinq minutes se sont écoulées sans que le jeton serve.
              // `refresh-expired: "auto"` en refait un tout seul ; on
              // se contente d'oublier celui qui ne vaut plus rien.
              jeton.current = null;
              poserEtat("chargement");
            },
            "timeout-callback": () => {
              jeton.current = null;
              poserEtat("indisponible");
            },
            "before-interactive-callback": () => poserEtat("defi"),
            "after-interactive-callback": () => {
              // L'énigme est finie, mais le jeton n'est pas encore
              // arrivé : `callback` posera « pret » juste après.
              if (jeton.current === null) poserEtat("chargement");
            },
            "unsupported-callback": () => poserEtat("indisponible"),

            // LA DISCRÉTION EST ICI, EN UN MOT : le widget n'occupe
            // aucune place tant qu'il n'a rien à montrer.
            appearance: "interaction-only",
            // Il travaille dès le montage, sans attendre le clic : le
            // jeton est prêt pendant qu'on tape son mot de passe.
            execution: "render",
            retry: "auto",
            // Un jeton de plus de 300 secondes est remplacé sans que
            // personne n'ait à s'en occuper.
            "refresh-expired": "auto",
            // `auto` suivrait la préférence du système ; le Control
            // Center est sombre quoi qu'en dise le système (voir
            // `html { color-scheme: dark }` dans globals.css), et un
            // widget clair y ferait une tache blanche.
            theme: "dark",
            // La largeur de la carte, pour qu'une énigme ne déborde pas.
            size: "flexible",
            language: "fr",
            action: ACTION_CAPTCHA,
          });
        } catch {
          poserEtat("indisponible");
        }
      })
      .catch(() => {
        if (vivant) poserEtat("indisponible");
      });

    return () => {
      vivant = false;
      const api = window.turnstile;
      if (identifiant.current !== undefined && api !== undefined) {
        api.remove(identifiant.current);
      }
      identifiant.current = undefined;
      jeton.current = null;
    };
  }, [cle, essai, poserEtat]);

  /* ================================================================
     AMENER LA VUE SUR CE QUI DEMANDE UN GESTE
     ================================================================ */

  /**
   * DEUX ÉTATS SUR CINQ EXIGENT UN GESTE : l'énigme à résoudre, et la
   * panne à réessayer. Les deux vivent tout en bas de la carte — et sur
   * un téléphone, le bas de la carte est à mille pixels du haut d'une
   * fenêtre qui en fait huit cents. La personne clique sur « Se
   * connecter », le bouton tourne, et la solution attend hors de
   * l'écran. C'est exactement le « bouton mort sans explication » que
   * ce chantier existe pour supprimer.
   *
   * `block: "center"` ET NON `"nearest"`. Mesuré dans un vrai
   * navigateur : `"nearest"` ne déplace RIEN ici. Il ne bouge la page
   * que pour un élément à cheval sur un bord ; un élément situé deux
   * cents pixels SOUS le pli n'est pas à cheval, il est simplement
   * absent, et le navigateur considère qu'il n'a rien à faire.
   * `"center"` l'amène au milieu, où on ne peut pas le manquer.
   *
   * ET ON RATTRAPE APRÈS COUP. Au moment où l'état change, l'énigme de
   * Cloudflare n'est pas encore dessinée : la position mesurée est
   * celle d'un conteneur vide, et le défilement s'arrêterait trop haut.
   * Le premier passage amène la phrase d'annonce ; l'observateur de
   * taille rattrape dès que l'énigme occupe sa place.
   */
  const cadre = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (etat !== "defi" && etat !== "indisponible") return;

    function amener() {
      const element = cadre.current;
      if (element === null) return;
      const rect = element.getBoundingClientRect();
      // Déjà entièrement sous les yeux : ne rien bouger. Un écran qui
      // saute alors que tout était visible est plus déroutant que le
      // contraire — c'est la seule chose que `nearest` faisait bien, et
      // elle est reprise ici explicitement.
      if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
      element.scrollIntoView({
        block: "center",
        // `smooth` ANIME le défilement, et une animation ne progresse
        // pas dans un onglet caché : mesuré, zéro image en cinq cents
        // millisecondes. La personne qui change d'onglet en attendant
        // retrouverait sa page exactement là où elle l'a laissée. Dans
        // ce cas on saute, puisque personne ne regarde le saut.
        behavior: document.hidden ? "auto" : "smooth",
      });
    }

    // TOUT DE SUITE, ET NON DANS UNE `requestAnimationFrame`. Un effet
    // s'exécute après que React a posé le nouveau DOM : la position est
    // déjà juste, et `getBoundingClientRect` force le calcul au besoin.
    // La demande d'image, elle, NE SE DÉCLENCHE PAS dans un onglet
    // caché — vérifié : zéro image en cinq cents millisecondes. La
    // personne qui revient sur son onglet trouverait alors la page
    // exactement là où elle l'a laissée, c'est-à-dire loin de l'énigme.
    amener();

    // L'énigme est dessinée APRÈS : elle fait grandir le conteneur, et
    // la position d'il y a un instant n'est plus la bonne.
    let observateur: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && boite.current !== null) {
      observateur = new ResizeObserver(amener);
      observateur.observe(boite.current);
    }

    return () => observateur?.disconnect();
  }, [etat]);

  /* ================================================================
     LA REMISE DU JETON
     ================================================================ */

  const jetonNeuf = useCallback(async (): Promise<string | undefined> => {
    if (cle === "") return undefined;

    /** Céder le jeton ET commander le suivant, dans le même geste. */
    function ceder(valeur: string): string {
      jeton.current = null;
      const api = window.turnstile;
      if (identifiant.current !== undefined && api !== undefined) {
        api.reset(identifiant.current);
        etatCourant.current = "chargement";
        setEtat("chargement");
      }
      return valeur;
    }

    if (jeton.current !== null) return ceder(jeton.current);
    if (etatCourant.current === "indisponible") return undefined;

    // Le jeton n'est pas encore là : on l'attend, mais pas pour
    // toujours. Deux limites, parce que deux situations très
    // différentes se cachent derrière la même attente.
    const echeanceReseau = Date.now() + DELAI_JETON_MS;
    const echeanceDure = Date.now() + DELAI_DEFI_MS;

    return await new Promise<string | undefined>((resoudre) => {
      function regarder() {
        if (jeton.current !== null) {
          resoudre(ceder(jeton.current));
          return;
        }
        // LE WIDGET A DÉJÀ RENONCÉ : ON REND LA MAIN TOUT DE SUITE.
        //
        // Cette sortie manquait, et son absence produisait le pire
        // symptôme possible — un bouton « Connexion… » figé vingt
        // secondes alors que la panne était connue depuis une. Le
        // garde existait bien à l'ENTRÉE de la fonction ; il manquait
        // ici, c'est-à-dire pour tout clic tombé PENDANT le
        // chargement : les premières secondes de la page, le clic qui
        // suit « Réessayer », celui qui suit un jeton tout juste
        // consommé. Et il frappait précisément les gens que ce
        // chantier ne doit pas enfermer dehors : bloqueur de
        // publicités, réseau d'entreprise qui filtre Cloudflare, 4G
        // qui décroche entre deux tentatives.
        if (etatCourant.current === "indisponible") {
          resoudre(undefined);
          return;
        }
        const maintenant = Date.now();
        if (maintenant >= echeanceDure) {
          resoudre(undefined);
          return;
        }
        // Tant qu'une énigme est à l'écran, ce n'est plus le réseau
        // qu'on attend mais une personne en train de cliquer. Lui
        // couper la parole au bout de vingt secondes serait absurde.
        if (etatCourant.current !== "defi" && maintenant >= echeanceReseau) {
          resoudre(undefined);
          return;
        }
        window.setTimeout(regarder, INTERVALLE_ATTENTE_MS);
      }
      regarder();
    });
  }, [cle]);

  useImperativeHandle(ref, () => ({ jetonNeuf }), [jetonNeuf]);

  /* ================================================================
     L'ÉCRAN
     ================================================================ */

  const verdict = verdictCaptcha(etat);

  // Sans clé, ce composant ne rend rigoureusement rien — pas même un
  // conteneur vide. C'est ce qui rend le déploiement en trois temps
  // sûr : avant que la clé ne soit posée, cette page est identique à
  // celle d'hier, au pixel près.
  if (cle === "") return null;

  return (
    <div ref={cadre} className={className}>
      {/* LA RÉGION VIVANTE EXISTE EN PERMANENCE, MÊME VIDE — ET C'EST
          LA SEULE FAÇON QU'ELLE FONCTIONNE.

          Une région `aria-live` n'est annoncée de façon fiable que si
          elle se trouvait DÉJÀ dans le document avant que son contenu
          ne change. Le motif tentant — créer le nœud `role="status"`
          avec son texte déjà dedans — est le faux positif
          d'accessibilité le plus répandu : la région et le texte
          apparaissent dans le même battement, plusieurs lecteurs
          d'écran ne voient donc aucun changement à annoncer, et la
          personne aveugle qui vient de cliquer sur « Se connecter »
          n'entend rigoureusement rien.

          Ce conteneur-ci est donc rendu à tous les coups ; seul son
          contenu apparaît et disparaît. Vide, il n'occupe aucune place
          et ne dit rien.

          `role="status"` et non `role="alert"` : le bandeau rouge de
          l'écran est déjà une alerte, et deux annonces qui se coupent
          la parole ne s'entendent ni l'une ni l'autre. `polite` attend
          une pause du lecteur d'écran, ce qui est exactement le bon ton
          pour « une vérification s'affiche ». */}
      <div role="status" aria-live="polite">
        {/* LA PHRASE VIENT AVANT LE WIDGET, ET CE N'EST PAS UN DÉTAIL
            DE MISE EN PAGE. Elle dit « une vérification s'affiche juste
            en dessous » : il faut donc que ce soit littéralement vrai.
            Posée après, elle désignerait quelque chose qui se trouve
            au-dessus d'elle. */}
        {verdict.message !== null && (
          <div
            className={`mb-3 rounded-[var(--radius-control)] px-3 py-2 text-[var(--text-body)] leading-relaxed ${
              etat === "defi"
                ? "bg-info-wash text-ink-soft"
                : "bg-warning-wash text-ink-soft"
            }`}
          >
            <p>{verdict.message}</p>

            {verdict.reessayable && (
              <button
                type="button"
                onClick={() => setEssai((n) => n + 1)}
                className="mt-2 text-[var(--text-secondary)] font-medium text-accent transition-colors hover:text-accent-hover"
              >
                Réessayer la vérification
              </button>
            )}
          </div>
        )}
      </div>

      {/* Le conteneur du widget. De hauteur nulle tant que Cloudflare
          n'a rien à montrer — d'où l'absence de toute hauteur imposée :
          en réserver une créerait exactement le trou qu'on cherche à
          éviter. Mesuré : 0 pixel dans le cas silencieux, 69 pixels
          quand une énigme s'affiche, et rien de ce qui est au-dessus ne
          bouge. */}
      <div ref={boite} />
    </div>
  );
}
