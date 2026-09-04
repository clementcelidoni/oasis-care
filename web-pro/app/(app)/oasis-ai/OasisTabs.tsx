import Link from "next/link";
import { Tabs } from "@/components/ui";

/**
 * §11W — DEUX ONGLETS. IL Y EN AVAIT SIX.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI A ÉTÉ FUSIONNÉ, ET SUR QUELLE PREUVE
 * ══════════════════════════════════════════════════════════════════
 *
 * « Daily » ET « Décisions » lisaient LA MÊME SOURCE : `ai_oasis_daily`
 * appelle `ai_executive_brief` (0073), et `runExecutiveScan` appelle
 * cette même fonction. Les deux écrans affichaient les mêmes constats,
 * avec le même composant `Explanation`. La seule différence visible
 * était que l'un avait des boutons et l'autre non — au point que le
 * premier disait d'aller cliquer dans le second. Un détail
 * d'implémentation (lire d'un côté, écrire de l'autre) avait été promu
 * au rang de navigation. Ils n'en font plus qu'un : « Aujourd'hui ».
 *
 * « Agents » et « Automatisations » sont un seul réglage coupé en deux :
 * une règle d'automatisme ne part QUE si l'agent est au niveau 4. Le
 * couplage est structurel, donc l'écran est unique — et il sort de la
 * barre d'onglets, parce qu'un réglage d'entreprise qu'on ouvre trois
 * fois par an ne mérite pas un tiers de la navigation d'un assistant
 * qu'on ouvre tous les matins. Il se rejoint par un lien dans
 * l'en-tête. (Sa vraie place est Paramètres › IA, à côté de
 * « Configuration IA » et « Coûts IA » ; le regroupement est fait, le
 * déplacement ne coûtera plus qu'un `mv`.)
 *
 * « Historique » disparaît comme onglet : ses quatre lignes en
 * production sont toutes des changements d'autonomie, c'est-à-dire un
 * journal de réglages. Il devient la dernière section des réglages, et
 * il rend son nom à ce que l'utilisateur a demandé.
 *
 * ─── POURQUOI LE COMPTEUR RESTE SUR LE PREMIER ───
 *
 * Des deux onglets, « Aujourd'hui » est le seul qui ACCUMULE du travail
 * non fait. « Conversations » décrit ce qu'on a déjà demandé ; rien n'y
 * attend de réponse.
 */
export function OasisTabs({
  current,
  openDecisions,
}: {
  current: string;
  openDecisions?: number;
}) {
  return (
    <Tabs
      current={current}
      items={[
        {
          label: "Aujourd'hui",
          href: "/oasis-ai",
          // `undefined` et non `0` : un zéro à côté d'un onglet se lit
          // comme un compteur cassé plutôt que comme une bonne nouvelle.
          count: openDecisions && openDecisions > 0 ? openDecisions : undefined,
        },
        { label: "Conversations", href: "/oasis-ai/conversations" },
      ]}
    />
  );
}

/**
 * Le lien vers les réglages, discret, dans l'en-tête de page.
 *
 * Il n'est pas caché — il est simplement à sa taille. Ce qu'il ouvre
 * (le niveau d'autonomie, les plafonds d'automatisme, le journal des
 * gestes d'Oasis) se règle rarement et se lit lentement ; l'assistant,
 * lui, s'ouvre tous les jours.
 */
export function LienReglages() {
  return (
    <Link
      href="/oasis-ai/reglages"
      className="text-[var(--text-secondary)] text-ink-soft transition-colors hover:text-ink"
    >
      Réglages de l&apos;IA
    </Link>
  );
}
