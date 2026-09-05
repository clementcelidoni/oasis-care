"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { journaliserGesteMfa } from "@/lib/auth/actions";

/**
 * ==================================================================
 * L'ENRÔLEMENT D'UN SECOND FACTEUR — spec p.32 : « ADMIN MFA »
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * POURQUOI CE COMPOSANT EST CÔTÉ NAVIGATEUR, ET NE PEUT PAS NE PAS L'ÊTRE
 * ------------------------------------------------------------------
 * Trois raisons, dans l'ordre où elles mordent :
 *
 *   1. `verify()` RENOUVELLE LA SESSION et la promeut en `aal2`. Ce
 *      renouvellement doit atterrir dans un cookie. Or
 *      `lib/supabase/server.ts` avale l'exception de `setAll()` dans un
 *      `try/catch` — un Server Component ne peut pas poser de cookie —
 *      et la promotion serait donc perdue EN SILENCE. Le client de
 *      navigateur, lui, écrit le cookie lui-même.
 *   2. Le secret et le QR code n'ont aucune raison de traverser nos
 *      journaux serveur. Le SDK dit explicitement, pour les trois
 *      valeurs (`qr_code`, `secret`, `uri`) : « Avoid logging this value
 *      to the console. » Les faire naître et mourir dans l'onglet est le
 *      plus court chemin.
 *   3. Il n'existe pas d'équivalent SQL. Aucune ligne de Postgres ne
 *      peut créer un facteur : l'enrôlement appartient au service Auth.
 *
 * C'est la seule exception à la règle de `lib/supabase/client.ts` —
 * « aucun écran du Control Center ne lit de données depuis le
 * navigateur ». Et ce n'en est pas vraiment une : ce composant ne lit
 * AUCUNE donnée de la plateforme. Il ne parle que du compte de
 * l'appelant, à propos de son propre facteur.
 *
 * ------------------------------------------------------------------
 * CE QUE L'ÉCRAN DIT AVANT DE LE FAIRE
 * ------------------------------------------------------------------
 *   • Vérifier un facteur DÉCONNECTE LES AUTRES SESSIONS de la personne.
 *     C'est écrit dans la documentation du SDK, et c'est surprenant : on
 *     l'annonce avant, pas après.
 *   • Un facteur commencé et jamais vérifié RESTE en base et gêne le
 *     suivant. D'où la liste des facteurs, et le bouton pour retirer un
 *     brouillon abandonné.
 *   • L'enrôlement TOTP peut être DÉSACTIVÉ au niveau du projet
 *     Supabase, ce qui n'est lisible nulle part en SQL : la seule preuve
 *     possible est un appel réel. L'échec est donc affiché comme un
 *     ÉTAT NOMMÉ, avec ce qu'il faut faire, et non comme une panne.
 */

type Facteur = {
  id: string;
  friendlyName: string | null;
  status: "verified" | "unverified";
  createdAt: string;
};

type Brouillon = {
  factorId: string;
  qrCode: string;
  secret: string;
  friendlyName: string;
};

const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-60";

const BOUTON =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-3 py-1.5 text-[var(--text-secondary)] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Un nom par défaut qui aide vraiment le jour où il faut choisir lequel
 * retirer. « Authenticator » sur trois lignes n'aide personne.
 */
function nomParDefaut(): string {
  return `Application d'authentification — ${new Date().toLocaleDateString("fr-FR")}`;
}

export function EnrolementTotp({
  /** Vrai quand la session est déjà de niveau `aal2`. */
  satisfait,
  /**
   * Affiché sous le titre. La page d'enrôlement forcé et l'onglet des
   * paramètres n'ont pas la même urgence à annoncer.
   */
  contexte,
}: {
  satisfait: boolean;
  contexte?: string;
}) {
  const router = useRouter();
  const [facteurs, setFacteurs] = useState<Facteur[] | null>(null);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [code, setCode] = useState("");
  const [nom, setNom] = useState(nomParDefaut);
  const [secretVisible, setSecretVisible] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [, demarrerTransition] = useTransition();

  /**
   * La liste des facteurs vient du service Auth, pas de la base.
   *
   * `platform_admin_mfa_state()` sait COMBIEN de facteurs existent, mais
   * pas leurs identifiants — et il en faut un pour retirer le bon.
   * Cette lecture-ci est donc irremplaçable, et elle ne peut pas venir
   * du serveur : `auth.mfa_factors` est fermée à `authenticated`, et le
   * SDK ne l'expose que pour la session en cours.
   */
  const relire = useCallback(async (): Promise<{ facteurs: Facteur[] | null; erreur: string | null }> => {
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      return { facteurs: [], erreur: `Impossible de lire vos facteurs : ${error.message}` };
    }
    return {
      facteurs: (data?.all ?? [])
        .filter((facteur) => facteur.factor_type === "totp")
        .map((facteur) => ({
          id: facteur.id,
          friendlyName: facteur.friendly_name ?? null,
          status: facteur.status,
          createdAt: facteur.created_at,
        })),
      erreur: null,
    };
  }, []);

  const rafraichir = useCallback(async () => {
    const resultat = await relire();
    setFacteurs(resultat.facteurs);
    if (resultat.erreur) setErreur(resultat.erreur);
  }, [relire]);

  // La lecture initiale. Le `setState` est volontairement APRÈS un
  // `await` et derrière un drapeau d'annulation : un composant démonté
  // entre la requête et sa réponse ne doit rien écrire.
  useEffect(() => {
    let annule = false;
    void (async () => {
      const resultat = await relire();
      if (annule) return;
      setFacteurs(resultat.facteurs);
      if (resultat.erreur) setErreur(resultat.erreur);
    })();
    return () => {
      annule = true;
    };
  }, [relire]);

  async function commencer() {
    setErreur(null);
    setSucces(null);
    setOccupe(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: nom.trim() || nomParDefaut(),
        issuer: "Oasis Care Control Center",
      });

      if (error) {
        // L'ÉTAT NOMMÉ, pas la panne. On ne sait pas lire en SQL si
        // l'enrôlement TOTP est activé sur le projet : cet appel EST la
        // seule preuve possible, et son échec doit donc expliquer ce
        // qu'il faut aller changer.
        setErreur(
          `L'enrôlement a été refusé par le service d'authentification : ${error.message}. ` +
            "Si le message parle d'un facteur désactivé, l'enrôlement TOTP est éteint au niveau " +
            "du projet Supabase (Authentication → Multi-Factor). Aucune requête SQL ne peut le " +
            "dire à votre place : cet appel est la seule preuve possible.",
        );
        return;
      }

      setBrouillon({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
        friendlyName: data.friendly_name ?? nom,
      });
      setSecretVisible(false);
      setCode("");
    } finally {
      setOccupe(false);
    }
  }

  async function verifier() {
    if (!brouillon) return;
    setErreur(null);
    setOccupe(true);
    try {
      const supabase = createClient();
      // `challengeAndVerify` fait les deux en un appel : c'est la forme
      // recommandée pour TOTP, et elle évite de garder un identifiant de
      // défi dans l'état du composant.
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: brouillon.factorId,
        code: code.replace(/\s+/g, ""),
      });

      if (error) {
        setErreur(
          `Code refusé : ${error.message}. Vérifiez l'heure de votre téléphone — un code TOTP se calcule sur l'horloge, et quelques minutes de décalage suffisent à le faire échouer.`,
        );
        return;
      }

      // Le secret ne survit pas à la vérification : il n'a plus aucun
      // usage, et le laisser en mémoire d'un composant monté est un
      // risque gratuit.
      setBrouillon(null);
      setCode("");
      setSecretVisible(false);

      const trace = await journaliserGesteMfa("mfa.enrolled", {
        friendlyName: brouillon.friendlyName,
      });
      setSucces(
        "Second facteur vérifié. Votre session est maintenant de niveau aal2." +
          (trace.tracee ? "" : ` ${trace.message}`),
      );

      await rafraichir();
      // La coquille, la bannière et l'état serveur doivent être
      // redessinés : sans cela, l'écran continuerait d'annoncer « aucun
      // facteur » à quelqu'un qui vient d'en poser un.
      demarrerTransition(() => router.refresh());
    } finally {
      setOccupe(false);
    }
  }

  async function abandonner(factorId: string, etaitVerifie: boolean) {
    setErreur(null);
    setSucces(null);
    setOccupe(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) {
        setErreur(`Retrait refusé : ${error.message}`);
        return;
      }

      if (brouillon?.factorId === factorId) setBrouillon(null);

      // Seul le retrait d'un facteur VÉRIFIÉ mérite une ligne de
      // journal : il fait retomber le compte sous l'exigence, et c'est
      // exactement le geste qu'un compte compromis tenterait. Un
      // brouillon abandonné n'a jamais rien protégé.
      let complement = "";
      if (etaitVerifie) {
        const trace = await journaliserGesteMfa("mfa.unenrolled", { friendlyName: null });
        complement = trace.tracee ? "" : ` ${trace.message}`;
      }

      setSucces(
        etaitVerifie
          ? `Facteur retiré et journalisé.${complement} Ce compte n'est plus protégé par un second facteur : si la politique l'exige, il sera renvoyé vers cet écran à la prochaine visite.`
          : "Brouillon d'enrôlement retiré. Il ne protégeait rien et gênait le suivant.",
      );

      await rafraichir();
      demarrerTransition(() => router.refresh());
    } finally {
      setOccupe(false);
    }
  }

  const verifies = (facteurs ?? []).filter((facteur) => facteur.status === "verified");
  const brouillons = (facteurs ?? []).filter((facteur) => facteur.status === "unverified");

  return (
    <div className="flex flex-col gap-4">
      {contexte && (
        <p className="max-w-3xl text-[var(--text-body)] leading-relaxed text-ink-soft">
          {contexte}
        </p>
      )}

      {/* ---- Ce qui existe déjà ------------------------------------ */}
      {facteurs === null ? (
        <p className="text-[var(--text-secondary)] text-ink-faint">Lecture de vos facteurs…</p>
      ) : facteurs.length === 0 ? (
        <p className="text-[var(--text-secondary)] leading-relaxed text-ink-soft">
          Aucune application d&apos;authentification n&apos;est enregistrée sur ce compte.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {facteurs.map((facteur) => (
            <li
              key={facteur.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-[var(--text-body)] font-medium text-ink">
                  {facteur.friendlyName ?? "Application d'authentification"}
                </p>
                <p className="text-[var(--text-secondary)] text-ink-faint">
                  {facteur.status === "verified" ? "Vérifiée" : "Enrôlement non terminé"} ·
                  ajoutée le{" "}
                  {new Date(facteur.createdAt).toLocaleDateString("fr-FR", {
                    timeZone: "Europe/Paris",
                  })}
                </p>
              </div>
              <button
                type="button"
                disabled={occupe}
                onClick={() => abandonner(facteur.id, facteur.status === "verified")}
                className={`${BOUTON} border border-critical/40 bg-critical-wash text-critical hover:border-critical`}
              >
                {facteur.status === "verified" ? "Retirer" : "Abandonner ce brouillon"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {brouillons.length > 0 && brouillon === null && (
        <p className="text-[var(--text-secondary)] leading-relaxed text-warning">
          Un enrôlement a été commencé sans être terminé. Il ne protège rien, et il portera le
          même nom que le prochain : abandonnez-le avant d&apos;en recommencer un.
        </p>
      )}

      {/* ---- L'enrôlement en cours --------------------------------- */}
      {brouillon !== null ? (
        <div className="rounded-[var(--radius-card)] border border-accent/40 bg-surface p-4">
          <p className="text-[length:var(--text-card)] font-semibold">
            Scannez ce code avec votre application d&apos;authentification
          </p>
          <p className="mt-1 max-w-2xl text-[var(--text-secondary)] leading-relaxed text-ink-soft">
            Google Authenticator, 1Password, Bitwarden, Aegis — n&apos;importe laquelle : le TOTP
            est un standard. Puis recopiez le code à six chiffres qu&apos;elle affiche.
          </p>

          <div className="mt-4 flex flex-wrap items-start gap-5">
            <div className="rounded-[var(--radius-control)] bg-white p-3">
              {/*
                Un `<img>` et non `next/image` : la source est une donnée
                fabriquée dans cet onglet, sans URL ni optimisation
                possible, et elle ne doit surtout pas partir chez un
                optimiseur d'images distant.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/svg+xml;utf-8,${encodeURIComponent(brouillon.qrCode)}`}
                alt="Code QR d'enrôlement du second facteur"
                width={172}
                height={172}
              />
            </div>

            <div className="min-w-[16rem] flex-1">
              <p className="text-[var(--text-secondary)] font-medium text-ink-soft">
                Impossible de scanner ? Saisissez la clé à la main
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-surface-sunken px-2 py-1 font-mono text-[12px] text-ink">
                  {secretVisible ? brouillon.secret : "•".repeat(32)}
                </code>
                <button
                  type="button"
                  onClick={() => setSecretVisible((visible) => !visible)}
                  className={`${BOUTON} text-ink-soft hover:bg-surface-raised hover:text-ink`}
                >
                  {secretVisible ? "Masquer" : "Révéler"}
                </button>
              </div>
              <p className="mt-1.5 max-w-md text-[var(--text-secondary)] leading-relaxed text-ink-faint">
                Cette clé vaut le second facteur lui-même. Ne la collez nulle part ailleurs que
                dans votre application, et ne la photographiez pas : elle ne sera plus jamais
                affichée après la vérification.
              </p>

              <label className="mt-4 flex max-w-xs flex-col gap-1.5">
                <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
                  Code à six chiffres <span className="text-critical">*</span>
                </span>
                <input
                  value={code}
                  onChange={(evenement) => setCode(evenement.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={9}
                  placeholder="000000"
                  className={`${CHAMP} tabular tracking-[0.3em]`}
                />
              </label>

              <p className="mt-2 max-w-md text-[var(--text-secondary)] leading-relaxed text-warning">
                À la validation, TOUTES VOS AUTRES SESSIONS SERONT DÉCONNECTÉES — c&apos;est le
                comportement du service d&apos;authentification, et il vaut mieux le savoir avant
                qu&apos;après.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={occupe || code.replace(/\s+/g, "").length < 6}
                  onClick={verifier}
                  className={`${BOUTON} bg-accent text-accent-ink hover:bg-accent-hover`}
                >
                  {occupe ? "Vérification…" : "Vérifier et activer"}
                </button>
                <button
                  type="button"
                  disabled={occupe}
                  onClick={() => abandonner(brouillon.factorId, false)}
                  className={`${BOUTON} text-ink-soft hover:bg-surface-raised hover:text-ink`}
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[18rem] flex-1 flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
              Nom de l&apos;appareil
            </span>
            <input
              value={nom}
              onChange={(evenement) => setNom(evenement.target.value)}
              className={CHAMP}
            />
            <span className="text-[var(--text-secondary)] text-ink-faint">
              Sert le jour où il faut retirer le bon des deux.
            </span>
          </label>
          <button
            type="button"
            disabled={occupe}
            onClick={commencer}
            className={`${BOUTON} bg-accent text-accent-ink hover:bg-accent-hover`}
          >
            {occupe
              ? "Préparation…"
              : verifies.length > 0
                ? "Ajouter une autre application"
                : "Ajouter une application d'authentification"}
          </button>
        </div>
      )}

      {erreur && (
        <p role="alert" className="max-w-3xl text-[var(--text-secondary)] leading-relaxed text-critical">
          {erreur}
        </p>
      )}
      {succes && (
        <p role="status" className="max-w-3xl text-[var(--text-secondary)] leading-relaxed text-positive">
          {succes}
        </p>
      )}

      {satisfait && verifies.length > 0 && !brouillon && !succes && (
        <p className="text-[var(--text-secondary)] leading-relaxed text-positive">
          Cette session a présenté votre second facteur : elle est de niveau aal2, et les
          écritures administratives lui sont ouvertes.
        </p>
      )}
    </div>
  );
}
