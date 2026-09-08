import { createClient } from "@supabase/supabase-js";

/**
 * §EMAILS — LE DÉSABONNEMENT, SANS COMPTE ET SANS DÉLAI.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI MANQUAIT, ET POURQUOI C'ÉTAIT GRAVE
 * ══════════════════════════════════════════════════════════════════
 *
 * Chaque message commercial fabriquait un lien vers `/desabonnement`,
 * le posait dans son corps ET dans l'en-tête `List-Unsubscribe` — et
 * cette page n'existait pas. `public.email_unsubscribe(jeton)` était
 * ouverte à `anon` exprès pour elle, et n'avait aucun appelant dans
 * tout le produit.
 *
 * Un lien de désabonnement qui rend 404 est PIRE qu'une absence : il a
 * l'air de marcher, la personne croit s'être désabonnée, et le message
 * suivant arrive quand même. Le geste qui reste, alors, est « signaler
 * comme indésirable » — c'est-à-dire la plainte qui remplit la liste de
 * blocage TRANSACTIONNELLE du transporteur, celle qui bloquera ensuite
 * la FACTURE de la même adresse. Le défaut catastrophique du chantier,
 * atteint par la porte du désabonnement.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI UN CLIENT SUPABASE FABRIQUÉ ICI, ET PAS CELUI DU DOSSIER
 * ══════════════════════════════════════════════════════════════════
 *
 * `lib/supabase/server.ts` lit les cookies pour porter la session. Ici
 * il n'y a PAS de session, et il ne doit pas y en avoir : cette page
 * s'ouvre depuis une boîte mail, souvent sur un autre appareil. On
 * emploie donc la clé publique seule — celle qui est faite pour partir
 * dans un navigateur — et la seule chose qu'elle permet est d'appeler
 * `email_unsubscribe`, qui n'ouvre aucune session, ne rend l'adresse que
 * MASQUÉE, et ne donne accès à rien d'autre.
 *
 * ══════════════════════════════════════════════════════════════════
 * LA PHRASE QUI COMPTE EST CELLE DE LA BASE
 * ══════════════════════════════════════════════════════════════════
 *
 * On l'affiche telle quelle. Elle dit déjà « vos documents — devis,
 * factures — continueront de vous parvenir », qui est la peur numéro un
 * de quiconque clique sur ce lien. La réécrire ici la ferait diverger
 * un jour.
 */

export const dynamic = "force-dynamic";

type Verdict = { done: boolean; masked_email: string | null; message: string };

async function desabonner(jeton: string): Promise<Verdict | { panne: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !cle) {
    return {
      panne:
        "Ce service n'est pas configuré sur ce serveur. Répondez à notre message : nous vous retirerons de nos listes à la main.",
    };
  }

  const supabase = createClient(url, cle, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.rpc("email_unsubscribe", { p_token: jeton });
  if (error) {
    // ON NE LAISSE PAS UNE PAGE D'ERREUR TENIR LIEU DE RÉPONSE. Une
    // panne ne doit pas ressembler à un refus de désabonnement : on
    // donne une autre voie, tout de suite.
    return {
      panne:
        "Nous n'avons pas pu enregistrer votre demande à l'instant. Réessayez dans quelques minutes, ou répondez simplement à notre message : nous vous retirerons de nos listes à la main.",
    };
  }

  const ligne = (Array.isArray(data) ? data[0] : data) as Verdict | undefined;
  if (!ligne) {
    return { panne: "Nous n'avons pas pu enregistrer votre demande à l'instant." };
  }
  return ligne;
}

/**
 * Le type est écrit à la main plutôt que pris de `PageProps<"…">` : les
 * types de routes de Next sont GÉNÉRÉS au premier `build`, donc absents
 * tant que cette route neuve n'a pas été compilée une fois. Une
 * vérification de types qui échouerait sur une route qui existe n'aide
 * personne.
 */
export default async function DesabonnementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const brut = params?.jeton;
  const jeton = (Array.isArray(brut) ? brut[0] : brut) ?? "";

  if (jeton.trim() === "") {
    return (
      <Coquille titre="Ce lien est incomplet">
        <p className="text-sm text-ink-soft">
          Ce lien de désabonnement n&apos;est pas valide. Ouvrez-le depuis le message que vous
          avez reçu, ou répondez simplement à ce message : nous vous retirerons de nos listes.
        </p>
      </Coquille>
    );
  }

  const verdict = await desabonner(jeton);

  if ("panne" in verdict) {
    return (
      <Coquille titre="Nous n&apos;avons pas pu enregistrer votre demande">
        <p className="text-sm text-ink-soft">{verdict.panne}</p>
      </Coquille>
    );
  }

  return (
    <Coquille titre={verdict.done ? "C'est fait" : "Ce lien n'est pas valide"}>
      <p className="text-sm text-ink-soft">{verdict.message}</p>
      {verdict.masked_email && (
        <p className="mt-3 text-sm text-ink-soft">
          Adresse concernée : <strong className="text-ink">{verdict.masked_email}</strong>
        </p>
      )}
      {verdict.done && (
        <p className="mt-6 rounded-lg bg-canvas px-3.5 py-3 text-xs text-ink-faint">
          Vous n&apos;avez rien d&apos;autre à faire. Ce désabonnement ne concerne que nos
          communications commerciales : vos devis, vos factures et les messages de votre
          compte continueront de vous parvenir normalement.
        </p>
      )}
    </Coquille>
  );
}

function Coquille({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="mb-6 h-10 w-10 rounded-lg bg-accent" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{titre}</h1>
        <div className="mt-3">{children}</div>
      </div>
    </main>
  );
}
