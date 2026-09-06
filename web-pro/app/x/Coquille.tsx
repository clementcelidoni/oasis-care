/**
 * LA PAGE D'ÉTIQUETTE QUI N'OUVRE RIEN, ET CELLE QUI OUVRE.
 *
 * ══════════════════════════════════════════════════════════════════
 * UNE SEULE COQUILLE POUR TOUTES LES ISSUES, ET C'EST LA RÈGLE
 * ══════════════════════════════════════════════════════════════════
 *
 * Une étiquette peut être INCONNUE, RÉVOQUÉE, ORPHELINE (son objet a
 * été effacé) ou INTERDITE au porteur. Les quatre affichent strictement
 * la même chose : même titre, même phrase, même mise en page, même code
 * de réponse.
 *
 * Ce n'est pas une économie de moyens. Dire « cette étiquette a été
 * révoquée » plutôt que « cette étiquette n'existe pas », c'est
 * confirmer à qui tape au hasard qu'il vient de tomber sur une vraie.
 * Ce oui-ou-non est exactement ce qui rend une énumération
 * intéressante — et un jeton d'étiquette N'EXPIRE PAS : ce qu'un
 * balayeur apprend de lui, il l'apprend pour la durée de vie de
 * l'autocollant.
 *
 * `etiquette_resoudre` (0090 § 6) applique déjà cette règle en base et
 * rend la même phrase dans tous les cas. Cette coquille ne cherche pas
 * à en savoir davantage — il n'y a rien à savoir, et c'est le but.
 *
 * ══════════════════════════════════════════════════════════════════
 * PAS DE BARRE DE NAVIGATION, PAS DE LOGO CLIQUABLE, PAS DE LIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Le porteur le plus fréquent d'un scan n'est ni l'employé ni le
 * client : c'est le passant devant une plante. Il n'a pas de compte, et
 * il ne doit pas se voir proposer d'en créer un. Un bouton « Se
 * connecter » l'enverrait buter sur une page dont il n'a pas la clé et
 * lui ferait croire qu'il a mal fait.
 *
 * ET IL Y A UNE RAISON PLUS DURE : LE JETON EST DANS L'URL. Un seul
 * lien sortant enverrait l'adresse complète — donc le jeton — au site
 * visité par l'en-tête `Referer`. Aucune balise `<a>` ne doit exister
 * sur cette route, et `page.test.ts` échoue si l'une y apparaît.
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
