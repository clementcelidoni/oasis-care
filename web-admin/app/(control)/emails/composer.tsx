"use client";

import { useActionState, useState } from "react";

import { StatusBadge, SubmitButton } from "@/components/ui";
import { creerAnnonce, ETAT_VIERGE } from "@/lib/email/actions";
import { rendreApercu, verifierBrouillon, estEnvoyable } from "@/lib/email/apercu";

/**
 * ==================================================================
 * COMPOSER UNE ANNONCE — et ne rien envoyer
 * ==================================================================
 *
 * CE FORMULAIRE N'ENVOIE RIEN. Il crée un brouillon, et rien d'autre.
 * L'envoi est un second geste, sur un second écran, après avoir vu
 * l'audience exacte et le rendu.
 *
 * Fusionner les deux aurait supprimé le seul moment où l'on peut encore
 * voir « Bonjour {{prenom}} » — et ce moment ne vaut que s'il est
 * imposé. Un bouton « composer et envoyer » finit toujours par être
 * cliqué d'un trait.
 *
 * ------------------------------------------------------------------
 * L'APERÇU EST VIVANT, ET IL EST RENDU SUR UN VRAI NOM
 * ------------------------------------------------------------------
 * Le nom qui s'affiche dans l'accroche vient d'un destinataire réel de
 * l'audience, passé par la page. Un aperçu rendu sur « Entreprise
 * exemple » ne prouve rien : c'est justement sur une vraie valeur qu'on
 * voit qu'une variable n'a pas été remplacée.
 *
 * Et les vérifications s'affichent PENDANT la frappe plutôt qu'après
 * l'envoi du formulaire. Elles sont refaites côté serveur — un contrôle
 * qui n'existe que dans le navigateur n'existe pas — mais un message
 * qui arrive après avoir perdu sa saisie n'apprend rien.
 */

const CHAMP =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-surface-sunken px-3 py-1.5 text-[var(--text-body)] text-ink outline-none placeholder:text-ink-faint focus:border-accent";

export function ComposerAnnonce({
  nomExemple,
  consentantes,
}: {
  /**
   * Le nom d'une entreprise RÉELLE qui a consenti. `null` s'il n'y en a
   * aucune.
   */
  nomExemple: string | null;
  /**
   * Le nombre d'entreprises dont le registre porte un consentement en
   * cours. CE N'EST PAS L'AUDIENCE : la porte regarde aussi la liste de
   * suppression et la suspension, et elle n'est interrogée qu'à
   * l'écran suivant, sur le brouillon. Un chiffre approché affiché sous
   * le mot « destinataires » serait pris pour la réponse.
   */
  consentantes: number;
}) {
  const [etat, action, enCours] = useActionState(creerAnnonce, ETAT_VIERGE);
  const [titre, setTitre] = useState("");
  const [objet, setObjet] = useState("");
  const [corps, setCorps] = useState("");
  const [motif, setMotif] = useState("");

  const problemes = verifierBrouillon({ titre, objet, corps, motif });
  const bloquants = problemes.filter((probleme) => probleme.gravite === "bloquant");
  const reserves = problemes.filter((probleme) => probleme.gravite === "reserve");
  const commence = titre !== "" || objet !== "" || corps !== "" || motif !== "";

  const nom = nomExemple ?? "votre entreprise";
  const lignes = corps.trim() === "" ? [] : rendreApercu(nom, corps);

  return (
    <form action={action} className="grid gap-5 px-4 py-4 lg:grid-cols-2">
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Titre interne <span className="text-critical">*</span>
          </span>
          <input
            name="titre"
            value={titre}
            onChange={(evenement) => setTitre(evenement.target.value)}
            placeholder="Annonce de la signature en ligne — septembre"
            className={CHAMP}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Personne d&apos;autre que l&apos;équipe ne le lit. C&apos;est ainsi qu&apos;on
            retrouvera cette annonce dans l&apos;historique, six mois plus tard.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Objet du message <span className="text-critical">*</span>
          </span>
          <input
            name="objet"
            value={objet}
            onChange={(evenement) => setObjet(evenement.target.value)}
            placeholder="Vos devis se signent maintenant en ligne"
            className={CHAMP}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            {objet.length} caractère{objet.length > 1 ? "s" : ""} — la plupart des boîtes de
            réception en montrent une soixantaine et coupent le reste.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Message <span className="text-critical">*</span>
          </span>
          <textarea
            name="corps"
            rows={10}
            value={corps}
            onChange={(evenement) => setCorps(evenement.target.value)}
            placeholder={
              "Vos clients peuvent désormais accepter un devis d'un clic, depuis leur téléphone.\n\nRien à activer : c'est déjà en place sur votre compte."
            }
            className={`${CHAMP} resize-y`}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Du texte, pas du HTML : une ligne vide sépare deux paragraphes. L&apos;habillage, le
            pied de message avec vos mentions et le lien de désabonnement sont ajoutés à
            l&apos;envoi — n&apos;essayez pas de les écrire ici.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[var(--text-secondary)] font-medium text-ink-soft">
            Motif <span className="text-critical">*</span>
          </span>
          <textarea
            name="motif"
            rows={2}
            value={motif}
            onChange={(evenement) => setMotif(evenement.target.value)}
            placeholder="« Annonce de la signature en ligne, décidée au comité produit du 2 septembre. »"
            className={CHAMP}
          />
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Il s&apos;inscrit au journal des actions administratives, et la base le refusera
            s&apos;il est vide. Écrire à tout le parc se justifie au moment où on le fait, pas six
            mois plus tard devant quelqu&apos;un qui n&apos;était pas là.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>{enCours ? "Création…" : "Créer le brouillon"}</SubmitButton>
          <span className="text-[var(--text-secondary)] text-ink-faint">
            Rien ne part à cette étape.
          </span>
        </div>

        {etat.statut !== "vierge" && etat.message !== null && (
          <p
            role="status"
            className={`max-w-2xl text-[var(--text-secondary)] leading-snug ${
              etat.statut === "erreur" ? "text-critical" : "text-positive"
            }`}
          >
            {etat.message}
          </p>
        )}
      </div>

      {/* ---- L'APERÇU ------------------------------------------- */}
      <div className="flex flex-col gap-3">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface-sunken">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
            <p className="eyebrow">Aperçu, rendu sur un vrai destinataire</p>
            {nomExemple === null ? (
              <StatusBadge tone="unknown">Aucune entreprise consentante</StatusBadge>
            ) : (
              <StatusBadge tone="neutral" dot={false}>
                {consentantes} entreprise{consentantes > 1 ? "s" : ""} ont consenti
              </StatusBadge>
            )}
          </div>

          <div className="px-3 py-3">
            <p className="text-[var(--text-secondary)] text-ink-faint">Objet</p>
            <p className="mt-0.5 text-[var(--text-body)] font-medium text-ink">
              {objet.trim() === "" ? "—" : objet}
            </p>

            <div className="mt-3 border-t border-line pt-3">
              {lignes.length === 0 ? (
                <p className="text-[var(--text-body)] text-ink-faint">
                  Le message est vide.
                </p>
              ) : (
                lignes.map((ligne, index) => (
                  <p
                    key={index}
                    className="mb-2 text-[var(--text-body)] leading-relaxed text-ink last:mb-0"
                  >
                    {ligne}
                  </p>
                ))
              )}
            </div>

            <p className="mt-3 border-t border-line pt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
              Ce qui n&apos;est PAS montré ici, et qui sera pourtant dans le message : l&apos;
              habillage, le pied avec les mentions légales, le logo, et le lien de
              désabonnement — obligatoire dans chaque publicité, ajouté par la couche
              d&apos;envoi. Cet aperçu reproduit le texte, pas la mise en forme.
            </p>
          </div>
        </div>

        {/* ---- CE QUI EMPÊCHE, ET CE QUI INQUIÈTE ---------------- */}
        {commence && bloquants.length > 0 && (
          <div className="rounded-[var(--radius-card)] border border-critical/40 bg-critical-wash px-3 py-2.5">
            <p className="text-[var(--text-secondary)] font-semibold text-critical">
              {bloquants.length} chose{bloquants.length > 1 ? "s" : ""} empêche
              {bloquants.length > 1 ? "nt" : ""} la création
            </p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {bloquants.map((probleme, index) => (
                <li
                  key={index}
                  className="text-[var(--text-secondary)] leading-relaxed text-ink-soft"
                >
                  · {probleme.phrase}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reserves.length > 0 && (
          <div className="rounded-[var(--radius-card)] border border-warning/35 bg-warning-wash px-3 py-2.5">
            <p className="text-[var(--text-secondary)] font-semibold text-warning">À vérifier</p>
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {reserves.map((probleme, index) => (
                <li
                  key={index}
                  className="text-[var(--text-secondary)] leading-relaxed text-ink-soft"
                >
                  · {probleme.phrase}
                </li>
              ))}
            </ul>
          </div>
        )}

        {commence && estEnvoyable(problemes) && (
          <p className="text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Rien ne bloque. Le brouillon créé, l&apos;écran suivant interrogera la base entreprise
            par entreprise et montrera qui recevra exactement, qui est écarté et pourquoi —
            c&apos;est là, et seulement là, que le nombre de destinataires est établi.
          </p>
        )}
      </div>
    </form>
  );
}
