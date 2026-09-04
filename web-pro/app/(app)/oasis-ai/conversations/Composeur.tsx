"use client";

import { useActionState, useId, useRef } from "react";
import Link from "next/link";
import { poserQuestion, type EtatQuestion } from "@/lib/ai/conversations/actions";
import { LONGUEUR_QUESTION_MAX } from "@/lib/ai/conversations/types";

/**
 * §11W — LE CHAMP OÙ L'ON PARLE À OASIS.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN SEUL COMPOSANT, DEUX PLACEMENTS — ET C'EST LE SUJET
 * ══════════════════════════════════════════════════════════════════
 *
 * En bas de l'accueil, il ouvre un fil NEUF. En bas d'un fil, il le
 * poursuit. La différence tient à un champ caché, et c'est tout : la
 * même Server Action, les mêmes bornes, les mêmes messages d'erreur.
 * Deux composants auraient fini par diverger sur la seule chose qui
 * compte — ce qui est envoyé au modèle.
 *
 * ─── POURQUOI L'ACCUEIL OUVRE TOUJOURS UN FIL NEUF ───
 *
 * Parce qu'il n'y a AUCUNE mémoire entre deux conversations, et qu'un
 * champ posé sous le briefing du matin ne doit pas laisser croire le
 * contraire. Poser une question depuis l'accueil, c'est repartir de
 * zéro ; l'URL change, et c'est le signal le plus fort dont on dispose
 * pour dire « autre objet ».
 *
 * ══════════════════════════════════════════════════════════════════
 * TROIS AVERTISSEMENTS SONT DEVENUS UNE LIGNE
 * ══════════════════════════════════════════════════════════════════
 *
 * L'écran d'avant en empilait trois autour d'un champ vide : les droits
 * et le niveau 4 sous le champ, deux cartes de cent vingt mots sur ce
 * qu'il peut et ne peut pas préparer, puis un troisième rappel. Chacun
 * était vrai. Les trois ensemble, à chaque visite, coûtaient plus
 * d'attention qu'ils n'en protégeaient — et le plus important, celui du
 * niveau 4, se noyait dans les deux autres.
 *
 * Il en reste UNE phrase, et la liste des onze gestes interdits est
 * descendue dans les réglages, c'est-à-dire à l'endroit où l'on va
 * justement pour régler ce qu'Oasis a le droit de faire.
 */
export function Composeur({
  conversationId,
  questionInitiale,
  /** L'accueil dit « ouvrir une conversation » ; un fil dit « envoyer ». */
  variante,
  /** Un fil arrivé à son plafond de messages n'accepte plus rien. */
  ferme,
  /** Les amorces d'un fil neuf. Absentes dès qu'il a commencé à parler. */
  suggestions,
}: {
  conversationId?: string;
  questionInitiale?: string;
  variante: "accueil" | "fil";
  ferme?: { raison: string };
  suggestions?: readonly string[];
}) {
  const [etat, action, enCours] = useActionState<EtatQuestion, FormData>(poserQuestion, {
    statut: "repos",
  });
  const champId = useId();
  const erreurId = useId();
  const formulaire = useRef<HTMLFormElement>(null);
  const champ = useRef<HTMLTextAreaElement>(null);

  if (ferme) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface-sunken px-4 py-3">
        <p className="text-[var(--text-body)] text-ink-soft">{ferme.raison}</p>
      </div>
    );
  }

  const enErreur = etat.statut === "erreur";
  // Une question refusée revient dans le champ : la retaper serait la
  // punition la plus bête qui soit. React réinitialise le formulaire
  // après une action ; la `key` reconstruit le champ avec la valeur
  // qu'on veut y remettre.
  const valeur = enErreur ? etat.question : (questionInitiale ?? "");

  return (
    <div>
      {/* LES AMORCES, AU-DESSUS DU CHAMP ET SEULEMENT SUR UN FIL NEUF.
          Elles remplissent le champ puis envoient : un clic, comme
          avant la refonte. Passer par le champ plutôt que par un
          formulaire caché a une raison — la question reste visible une
          fraction de seconde à l'endroit où elle a été posée, et elle
          revient dans le champ si le serveur la refuse. */}
      {suggestions && suggestions.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={enCours}
              onClick={() => {
                const zone = champ.current;
                if (!zone) return;
                zone.value = suggestion;
                formulaire.current?.requestSubmit();
              }}
              className="rounded-[var(--radius-pill)] border border-line-strong bg-surface px-3 py-1.5 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink disabled:opacity-60"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <form ref={formulaire} action={action} className="flex flex-col gap-2">
        {conversationId && <input type="hidden" name="conversationId" value={conversationId} />}

        <label htmlFor={champId} className="sr-only">
          {variante === "accueil"
            ? "Poser une question à Oasis, dans une nouvelle conversation"
            : "Poursuivre cette conversation"}
        </label>

        <div className="flex items-end gap-2 rounded-[var(--radius-card)] border border-line-strong bg-surface px-3 py-2 focus-within:border-accent">
          <textarea
            key={`${etat.statut}-${valeur.length}`}
            ref={champ}
            id={champId}
            name="question"
            required
            rows={variante === "accueil" ? 1 : 2}
            maxLength={LONGUEUR_QUESTION_MAX}
            defaultValue={valeur}
            aria-invalid={enErreur || undefined}
            aria-describedby={enErreur ? erreurId : undefined}
            placeholder={
              variante === "accueil"
                ? "Posez une question à Oasis…"
                : "Poursuivre — Oasis relit cette conversation…"
            }
            className="min-h-[2.5rem] w-full resize-y bg-transparent py-1 text-[var(--text-body)] outline-none placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={enCours}
            className="shrink-0 rounded-[var(--radius-control)] bg-accent px-3.5 py-2 text-[var(--text-body)] font-medium text-accent-ink disabled:opacity-60"
          >
            {enCours
              ? "Oasis cherche…"
              : variante === "accueil"
                ? "Demander"
                : "Envoyer"}
          </button>
        </div>
      </form>

      {enErreur && (
        <div
          id={erreurId}
          // `alert` : l'erreur arrive après un aller-retour serveur, donc
          // hors du flux de lecture. Sans ce rôle, un lecteur d'écran ne
          // l'annonce jamais et l'utilisateur attend une réponse qui ne
          // viendra pas.
          role="alert"
          className="mt-2"
        >
          <p className="whitespace-pre-line text-[var(--text-secondary)] text-critical">
            {etat.message}
          </p>
          {/* CE QUE LE RUNTIME AVAIT SIGNALÉ AVANT D'ÉCHOUER. Il y met
              le droit qui manque, le repli sur un modèle dégradé, le
              plafond atteint — c'est-à-dire, très souvent, la RAISON de
              l'échec. Le Route Handler frère les renvoie déjà ; les
              taire ici faisait diverger deux surfaces qui appellent le
              même runtime. */}
          {etat.avertissements && etat.avertissements.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {etat.avertissements.map((avertissement, index) => (
                <li key={index} className="text-[var(--text-secondary)] text-ink-soft">
                  {avertissement}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* LA SEULE PHRASE QUI RESTE, et elle doit rester vraie. « Rien
          sans votre clic » l'est tant qu'aucun agent n'est au niveau 4 :
          au-delà, les automatisations autorisent nommément certaines
          actions, sous leur plafond. Le lien mène à l'écran où cela se
          règle et se lit. */}
      <p className="mt-2 text-[11px] text-ink-faint">
        Oasis lit avec{" "}
        <Link href="/oasis-ai/reglages" className="text-accent hover:underline">
          vos droits
        </Link>{" "}
        et n&apos;écrit rien sans votre clic.
        {variante === "accueil" && " Cette question ouvrira une nouvelle conversation."}
      </p>
    </div>
  );
}
