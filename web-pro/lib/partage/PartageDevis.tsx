import { createClient } from "@/lib/supabase/server";

import { echeanceReelle } from "./echeance";
import { LienCopiable } from "./LienCopiable";
import { partagerDevis, revoquerPartageDevis } from "./actions";

/**
 * §PORTE ANONYME — LE PANNEAU DU PAYSAGISTE.
 *
 * Composant SERVEUR : il lit le lien vivant sous la RLS du paysagiste,
 * et ne descend au navigateur que le bouton « Copier », qui est le seul
 * geste qui exige du JavaScript.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUE CE PANNEAU A LE DROIT DE DIRE, ET CE QU'IL N'A PAS LE DROIT
 * DE DIRE
 * ══════════════════════════════════════════════════════════════════
 *
 * `document_share_openings` compte des OUVERTURES, pas des lectures.
 * Un lien envoyé par courriel est ouvert par les analyseurs de sécurité
 * et les pré-chargeurs de messagerie À LA LIVRAISON — donc avant que le
 * client n'ait rien vu — et rien dans la table ne permet de les
 * distinguer d'un humain : elle ne porte que (lien, date), par choix de
 * vie privée.
 *
 * Les phrases de ce fichier sont donc FACTUELLES : « Ouvert 3 fois, la
 * première le 12/03 à 14 h 02. » Jamais « votre client a lu le devis »,
 * qui serait parfois faux — et le paysagiste décide d'appeler ou non
 * son client là-dessus.
 *
 * C'est aussi pourquoi 0088 n'est pas révisé : il interdit à l'IA de
 * dire autre chose que « personne n'a marqué ce devis comme vu », et
 * remplacer cette phrase prudente et vraie par une phrase confiante et
 * parfois fausse serait un mauvais échange.
 */

type LienPartage = {
  token: string;
  expires_at: string;
  opened_count: number;
  first_opened_at: string | null;
  last_opened_at: string | null;
};

const DATE_HEURE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DATE_SEULE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export async function PartageDevis({
  quoteId,
  validUntil,
  partageable,
}: {
  quoteId: string;
  validUntil: string | null;
  /**
   * Un brouillon ou une relecture interne n'a pas été remis au client :
   * la base refuse de le partager, et proposer le bouton ferait
   * découvrir la règle par un message d'erreur.
   */
  partageable: boolean;
}) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("document_share_links")
    .select("token, expires_at, opened_count, first_opened_at, last_opened_at")
    .eq("document_kind", "quote")
    .eq("document_id", quoteId)
    .is("revoked_at", null)
    .maybeSingle();

  const lien = (data ?? null) as LienPartage | null;

  // L'INSTANT SE LIT UNE FOIS, ICI, ET IL DESCEND EN PROPRIÉTÉ.
  //
  // Le rendu de `LienPresent` redevient ainsi une pure fonction de ce
  // qu'on lui donne : deux rendus du même arbre donnent le même
  // résultat, et la règle « lien expiré / lien valable » s'éprouve sans
  // horloge. C'est le motif employé par les pages BioLab voisines.
  const maintenant = new Date();

  return (
    <div className="mb-5 rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink">Lien à envoyer au client</span>

        {lien === null ? (
          <>
            <span className="text-[11px] text-ink-faint">
              Aucun lien n&apos;est ouvert. Votre client n&apos;a pas besoin de compte : le
              lien ouvre ce devis, et rien d&apos;autre.
            </span>
            {partageable && (
              <form action={partagerDevis} className="ml-auto">
                <input type="hidden" name="quote_id" value={quoteId} />
                <button
                  type="submit"
                  className="rounded-md bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/15"
                >
                  Créer le lien
                </button>
              </form>
            )}
            {!partageable && (
              <span className="ml-auto text-[11px] text-ink-faint">
                Marquez d&apos;abord le devis comme envoyé : on ne partage pas un devis
                qu&apos;on est en train d&apos;écrire.
              </span>
            )}
          </>
        ) : (
          <LienPresent quoteId={quoteId} lien={lien} validUntil={validUntil} maintenant={maintenant} />
        )}
      </div>
    </div>
  );
}

function LienPresent({
  quoteId,
  lien,
  validUntil,
  maintenant,
}: {
  quoteId: string;
  lien: LienPartage;
  validUntil: string | null;
  maintenant: Date;
}) {
  const echeance = echeanceReelle(lien.expires_at, validUntil);
  const expire = echeance.date <= maintenant;

  return (
    <>
      <LienCopiable jeton={lien.token} />

      <form action={revoquerPartageDevis} className="ml-auto">
        <input type="hidden" name="quote_id" value={quoteId} />
        <button
          type="submit"
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-critical hover:bg-critical-wash"
        >
          Fermer le lien
        </button>
      </form>

      <p className="w-full text-[11px] text-ink-faint">
        {expire ? (
          <>
            Ce lien <strong>ne s&apos;ouvre plus</strong> : le devis n&apos;est plus valable
            depuis le {DATE_SEULE.format(echeance.date)}. Prolongez sa validité pour le
            rouvrir.
          </>
        ) : echeance.source === "devis" ? (
          <>Valable jusqu&apos;au {DATE_SEULE.format(echeance.date)}, comme le devis.</>
        ) : (
          <>
            Valable jusqu&apos;au {DATE_SEULE.format(echeance.date)}. Ce devis n&apos;a pas de
            date de validité : le lien se ferme au bout de trente jours.
          </>
        )}{" "}
        {/*
          LA PHRASE EST FACTUELLE, ET ELLE LE RESTE. « Ouvert » n'est pas
          « lu » : les analyseurs de courriel ouvrent le lien à la
          livraison, et rien ne les distingue d'un humain. Écrire « votre
          client a vu le devis » ferait décider un appel commercial sur
          une phrase parfois fausse.
        */}
        {lien.opened_count === 0 ? (
          <>Ce lien n&apos;a encore jamais été ouvert.</>
        ) : (
          <>
            Ouvert {lien.opened_count === 1 ? "une fois" : `${lien.opened_count} fois`}
            {lien.first_opened_at !== null && (
              <>, la première le {DATE_HEURE.format(new Date(lien.first_opened_at))}</>
            )}
            . Une ouverture n&apos;est pas une lecture : les messageries ouvrent parfois les
            liens toutes seules.
          </>
        )}
      </p>
    </>
  );
}
