import type { OrigineAdresse } from "./adresse.ts";
import { VARIABLE_REPLI } from "./adresse.ts";

/**
 * L'ADRESSE IMPRIMÉE, AFFICHÉE AVANT QU'ON IMPRIME.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI CE BANDEAU N'EST PAS UN DÉTAIL DE CONFORT
 * ══════════════════════════════════════════════════════════════════
 *
 * Un QR imprimé est un engagement de plusieurs années : l'autocollant
 * reste sur l'arbre, et l'adresse qu'il porte doit continuer de
 * résoudre. Le produit vient d'apprendre ce que coûte l'inattention —
 * cinq étiquettes de production portent `oasis-care.example`, un
 * domaine que la RFC 2606 réserve et qui ne résoudra JAMAIS. Personne
 * n'avait relu la constante.
 *
 * Le remède n'est pas une meilleure constante : c'est de rendre
 * l'adresse VISIBLE au moment où elle part sur du papier, avec son
 * origine. Un bandeau qu'on lit trois secondes avant d'engager un
 * rouleau vaut mieux qu'un commentaire que personne n'ouvre.
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS ÉTATS, ET LE PLUS IMPORTANT EST LE DEUXIÈME
 * ══════════════════════════════════════════════════════════════════
 *
 *   • DÉDIÉE — la variable d'étiquette est posée. Un fait, dit sobrement.
 *   • REPLI — on se sert de l'adresse du site faute de mieux. Ce n'est
 *     PAS une erreur : l'impression marche. Mais c'est une décision
 *     prise par défaut, et une décision par défaut qui engage dix ans
 *     doit être signalée à qui peut encore la changer.
 *   • AUCUNE — on n'imprime pas. Voir `adresse.ts` : une planche de
 *     deux cents autocollants partie vers nulle part, ce sont deux
 *     cents autocollants à décoller sur des pots déjà en rayon.
 */

const CADRE: Record<OrigineAdresse, string> = {
  dediee: "border-line bg-surface",
  repli: "border-warning/30 bg-warning-wash",
  aucune: "border-critical/30 bg-critical-wash",
};

export function BandeauAdresse({
  base,
  origine,
  probleme,
  exemple,
  variable,
  ancienneAdresse,
}: {
  base: string | null;
  origine: OrigineAdresse;
  probleme: string | null;
  exemple: string | null;
  variable: string;
  /**
   * Combien d'étiquettes existaient AVANT que le produit ait une vraie
   * adresse — donc combien portent le domaine mort. Null quand le
   * comptage n'a pas pu se faire : on ne dit alors rien plutôt que de
   * dire « zéro », ce qui serait une bonne nouvelle inventée.
   */
  ancienneAdresse: number | null;
}) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border px-5 py-4 ${CADRE[origine]}`}
      aria-label="Adresse portée par les QR"
    >
      <p className="eyebrow mb-1.5">Adresse portée par les QR imprimés</p>

      {origine === "aucune" ? (
        <>
          <p className="text-[var(--text-body)] font-medium text-critical">
            Aucune adresse configurée — rien ne peut être imprimé.
          </p>
          <p className="mt-1.5 text-[var(--text-body)] text-ink-soft">{probleme}</p>
        </>
      ) : (
        <>
          {/* L'adresse en chiffres et en lettres, dans une chasse fixe :
              c'est un domaine, on le relit caractère par caractère. */}
          <p className="tabular text-[length:var(--text-card)] font-semibold break-all">
            {exemple}
          </p>
          <p className="mt-1.5 text-[var(--text-secondary)] text-ink-soft">
            Les trente-deux caractères après <code>/x/</code> sont un exemple : chaque étiquette
            reçoit son propre jeton, tiré au hasard par la base. Le QR ne contient AUCUNE donnée
            de votre entreprise — seulement ce jeton, que le serveur résout selon qui scanne.
          </p>

          {origine === "repli" ? (
            <p className="mt-3 text-[var(--text-body)] text-warning">
              <strong>Cette adresse est celle du site ({VARIABLE_REPLI}), faute de mieux.</strong>{" "}
              Elle fonctionne, mais elle lie vos étiquettes au domaine du site pour toute leur
              durée de vie. Si vous préférez un domaine dédié et stable, posez{" "}
              <code>{variable}</code> dans l&apos;environnement du serveur AVANT la première
              impression : après, il faudra réimprimer.
            </p>
          ) : (
            <p className="mt-3 text-[var(--text-secondary)] text-ink-faint">
              Fixée par <code>{variable}</code>. Elle n&apos;est écrite nulle part dans le code
              ni dans la base : changer de domaine un jour ne demandera pas de toucher aux
              jetons déjà imprimés — il suffira que l&apos;ancien domaine redirige vers le
              nouveau.
            </p>
          )}
        </>
      )}

      {/*
        LA PREMIÈRE QUESTION DU DIRIGEANT, RÉPONDUE SANS QU'IL AIT À LA
        POSER. Ces autocollants-là portent « oasis-care.example », que
        la RFC 2606 réserve : il ne résout pas et ne résoudra jamais.
        Le chiffre est LU EN BASE, pas estimé — c'est ce qui transforme
        « il faudra sans doute réimprimer » en « cela coûte N
        autocollants ».
      */}
      {ancienneAdresse !== null && ancienneAdresse > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {ancienneAdresse} étiquette{ancienneAdresse > 1 ? "s" : ""} déjà posée
            {ancienneAdresse > 1 ? "s" : ""} porte{ancienneAdresse > 1 ? "nt" : ""} l&apos;ancienne
            adresse
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
            Elles ont été imprimées avant que les étiquettes aient un vrai domaine, avec
            <code> oasis-care.example</code> — une adresse réservée qui ne mènera jamais nulle
            part. <strong>Elles se scannent encore depuis l&apos;application Oasis Care</strong>,
            dont le lecteur ne vérifie pas le domaine ; elles ne se scannent plus avec
            l&apos;appareil photo d&apos;un téléphone, ni par quelqu&apos;un qui n&apos;a pas
            l&apos;application. Réimprimer coûte {ancienneAdresse} autocollant
            {ancienneAdresse > 1 ? "s" : ""}.
          </p>
        </div>
      )}

      {base && (
        <p className="mt-3 border-t border-line pt-3 text-[var(--text-secondary)] text-ink-faint">
          Rappel de sécurité : une étiquette n&apos;a pas de session. Ce qu&apos;elle montre à un
          inconnu dépend uniquement de la case « fiche publique », décochée par défaut. Sans
          elle, un passant qui scanne n&apos;apprend même pas que l&apos;élément existe.
        </p>
      )}
    </section>
  );
}
