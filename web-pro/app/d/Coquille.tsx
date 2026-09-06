/**
 * LA PAGE QUI N'OUVRE RIEN.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE SEULE COQUILLE POUR TROIS ÉTATS, ET C'EST LA RÈGLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un lien peut être EXPIRÉ, RÉVOQUÉ ou INCONNU. Les trois affichent
 * strictement la même chose : même titre, même phrase, même mise en
 * page, même code de réponse.
 *
 * Ce n'est pas une économie de moyens. Dire « ce lien a expiré » plutôt
 * que « ce lien n'existe pas », c'est confirmer à qui tape au hasard
 * qu'il vient de tomber sur un vrai devis. Ce oui-ou-non est exactement
 * ce qui rend une énumération intéressante : sans lui, un balayeur
 * n'apprend jamais rien, quoi qu'il essaie.
 *
 * `devis_par_jeton` (0089 § 8.d) applique déjà cette règle en base et
 * rend la même phrase dans les trois cas. Cette page ne cherche pas à
 * en savoir davantage — il n'y a rien à savoir, et c'est le but.
 *
 * ══════════════════════════════════════════════════════════════════
 * PAS DE LIEN VERS L'APPLICATION, PAS MÊME UN LOGO CLIQUABLE
 * ══════════════════════════════════════════════════════════════════
 *
 * La personne devant cet écran n'a pas de compte et ne doit pas se voir
 * proposer d'en créer un : le dirigeant a tranché, le client du
 * paysagiste ne s'inscrit pas. Un bouton « Se connecter » l'enverrait
 * buter sur une page dont elle n'a pas la clé, et lui ferait croire
 * qu'elle a mal fait. La seule voie utile est celle qu'on lui donne :
 * son paysagiste.
 */
export function Coquille({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        {/* Une marque, pas une navigation : rien ici n'est cliquable. */}
        <div className="mb-6 h-10 w-10 rounded-lg bg-accent" aria-hidden />
        <h1 className="text-2xl font-semibold tracking-tight">{titre}</h1>
        <div className="mt-3 text-sm leading-relaxed text-ink-soft">{children}</div>
      </div>
    </main>
  );
}
