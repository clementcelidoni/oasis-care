import Link from "next/link";
import { requireOrganization } from "@/lib/auth/organization";
import {
  Card,
  Badge,
  StatusBadge,
  Panel,
  PageHeader,
  SubmitButton,
  ConfirmDialog,
} from "@/components/ui";
import { getAgentsView, type AgentPanel } from "@/lib/ai/agents";
import { setAgentAutonomy, setAgentEnabled } from "@/lib/ai/agentActions";
import { countOpenDecisions } from "@/lib/ai/decisions";
import {
  AGENT_LABELS,
  AGENT_MISSIONS,
  AUTONOMY_LEVELS,
  autonomyLabel,
} from "@/lib/ai/types";
import { OasisTabs } from "../OasisTabs";

/**
 * §11V — LA PAGE AGENTS (spec p. 40) : « Status · Last analysis ·
 * Decisions open · Autonomy · Permissions », pour chacun.
 *
 * ─── LE NIVEAU 4 EST LE SUJET DE CETTE PAGE ───
 *
 * Les niveaux 0 à 3 se règlent d'un bouton : ils décrivent jusqu'où
 * l'agent va dans la préparation, et un humain reste au bout de chaque
 * chaîne. Le niveau 4 est d'une autre nature — c'est le SEUL réglage de
 * toute l'application où plus personne ne regarde.
 *
 * Il passe donc par une boîte de dialogue qui dit ce qu'elle engage, et
 * la Server Action refuse le niveau 4 sans le jeton que cette boîte
 * ajoute. Le jeton n'est pas une sécurité — un formulaire se forge —
 * c'est un verrou de conception : on ne peut pas ajouter par
 * distraction un second chemin vers l'autopilote qui sauterait la
 * confirmation.
 *
 * Et même à 4, l'agent ne fait rien de plus que ce que les
 * automatisations autorisent nommément, sous leur plafond, et pour les
 * seules actions que le catalogue déclare éligibles. Trois d'entre
 * elles ne le sont pas, et ne peuvent pas le devenir sans migration.
 *
 * ─── LES PERMISSIONS AFFICHÉES SONT LES VÔTRES ───
 *
 * Un agent n'a aucun droit propre (spec p. 30). La colonne
 * « Permissions » répond à « que pourra-t-il faire EN MON NOM », pas à
 * « qu'a-t-on accordé à la machine ». Un droit manquant y est affiché
 * comme manquant, avec ce que ça coûte : l'agent se taira sur ce
 * sujet-là.
 */
export default async function AgentsPage() {
  const organization = await requireOrganization();

  const [view, openDecisions] = await Promise.all([
    getAgentsView(organization.organizationId, organization.permissions),
    countOpenDecisions(organization.organizationId),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Agents"
        subtitle="Quatre agents pour cette première itération. Chacun dit ce qu'il surveille, ce qu'il a produit, et jusqu'où vous l'autorisez à aller."
      />

      <OasisTabs current="/oasis-ai/agents" openDecisions={openDecisions} />

      {view.failed && (
        <Card className="mb-6 border-warning/30 bg-warning-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {view.failureReason}
          </p>
        </Card>
      )}

      {!view.canConfigure && !view.failed && (
        <Card className="mb-6 border-info/30 bg-info-wash px-4 py-3.5">
          <p className="text-[var(--text-body)] text-info">
            Vous consultez ces réglages sans pouvoir les changer. C&apos;est voulu :
            décider de ce qu&apos;une machine a le droit de faire en votre nom est un
            réglage d&apos;entreprise, pas une conduite de chantier. Un salarié a le
            droit de SAVOIR ce qu&apos;Oasis peut faire ; seul un administrateur le
            règle.
          </p>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {view.panels.map((panel) => (
          <AgentBlock key={panel.agent} panel={panel} canConfigure={view.canConfigure} />
        ))}
      </div>

      {/* ─── Les neuf agents hors périmètre ───
          Les nommer, plutôt que laisser croire à un produit à quatre
          agents. La spec en décrit treize et impose de ne construire
          que ceux-ci d'abord (p. 49) ; `ai_is_supported_agent` (0072)
          refuse les autres noms en base, y compris par erreur. */}
      <Card className="mt-6 px-5 py-4">
        <p className="text-[var(--text-body)] font-medium">Ce qui n&apos;existe pas encore</p>
        <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
          Ventes, Opérations, Planning, Achats, Pépinière, Flotte, Client, Marché et
          Risque sont décrits par la spécification mais ne sont pas construits. Ce ne
          sont pas des agents éteints : la base refuse leur nom, et aucune décision ne
          peut être ouverte à leur compte. Ils viendront quand ces quatre-là auront
          fait leurs preuves.
        </p>
      </Card>
    </div>
  );
}

function AgentBlock({ panel, canConfigure }: { panel: AgentPanel; canConfigure: boolean }) {
  const label = AGENT_LABELS[panel.agent];

  return (
    <Panel
      title={label}
      description={AGENT_MISSIONS[panel.agent]}
      action={
        <>
          <StatusBadge tone={panel.enabled ? "positive" : "neutral"}>
            {panel.enabled ? "Actif" : "En veille"}
          </StatusBadge>
          <Badge tone={panel.autonomy === 4 ? "critical" : "accent"}>
            {autonomyLabel(panel.autonomy)}
          </Badge>
        </>
      }
    >
      <div className="grid gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-3">
        <Metric
          label="Dernière analyse"
          value={
            panel.lastAnalysis
              ? new Date(panel.lastAnalysis).toLocaleString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : null
          }
          /* « Jamais » et « pas encore mesuré » sont la même chose ici,
             et la phrase le dit sans prétendre à une date. */
          fallback="Aucune trace au journal."
        />
        <Metric
          label="Décisions ouvertes"
          value={
            panel.openDecisions > 0 ? (
              <Link href="/oasis-ai/decisions" className="text-accent hover:underline">
                {panel.openDecisions}
              </Link>
            ) : (
              "0"
            )
          }
        />
        <div>
          <p className="eyebrow">Permissions exigées</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {panel.permissions.map((row) => (
              <Badge key={row.permission} tone={row.granted ? "positive" : "critical"}>
                {row.permission}
                {row.granted ? "" : " manquant"}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {panel.blocked && (
        <div className="border-t border-line bg-warning-wash px-5 py-3">
          <p className="text-[var(--text-body)] text-warning">
            Il manque à votre rôle un droit que cet agent exige. Il ne se taira pas :
            il rendra une réponse amputée qui NOMME ce qu&apos;il n&apos;a pas pu lire.
            Une réponse partielle qui se dénonce vaut mieux qu&apos;un zéro qui a
            l&apos;air d&apos;un fait.
          </p>
        </div>
      )}

      {/* ---- Le réglage d'autonomie ---- */}
      <div className="border-t border-line px-5 py-4">
        <p className="eyebrow mb-2">Autonomie</p>
        <div className="flex flex-col gap-2">
          {AUTONOMY_LEVELS.map((level) => {
            const current = level.level === panel.autonomy;
            return (
              <div
                key={level.level}
                className={`flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] border px-3.5 py-2.5 ${
                  current
                    ? "border-accent bg-accent-wash/40"
                    : "border-line bg-surface"
                } ${level.level === 4 && !current ? "border-critical/25" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[var(--text-body)] font-medium">
                    Niveau {level.level} — {level.label}
                    {current && (
                      <span className="ml-2 text-[var(--text-secondary)] font-normal text-accent">
                        réglage actuel
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                    {level.description}
                  </p>
                </div>

                {!current && canConfigure && (
                  <div className="shrink-0">
                    {level.level === 4 ? (
                      /* LE SEUL RÉGLAGE DE L'APPLICATION QUI LAISSE LA
                         MACHINE AGIR SEULE. Une boîte de dialogue, et un
                         jeton que la Server Action exige. */
                      <ConfirmDialog
                        triggerLabel="Activer l'autopilote"
                        triggerVariant="danger"
                        title="Laisser cet agent agir seul ?"
                        message={
                          "Au niveau 4, l'agent exécute sans que personne valide. Il ne pourra le faire " +
                          "que pour les actions explicitement autorisées dans les automatisations, sous leur " +
                          "plafond, et jamais pour envoyer une facture, passer une commande ou modifier un " +
                          "tarif : ces trois-là sont verrouillées en base. Vous pourrez revenir en arrière à " +
                          "tout moment, mais pas défaire ce qui sera parti. " +
                          // LA MÊME VÉRITÉ QUE SUR L'ÉCRAN DES AUTOMATISATIONS, et
                          // elle a déjà été fausse ici : cette phrase présentait le
                          // niveau 4 comme une simple autorisation dormante, alors
                          // que la fonction Edge exécute sans confirmation dès ce
                          // niveau. Le seul frein restant est le plafond, à zéro tant
                          // que personne ne l'a levé.
                          // `lib/ai/coherence.test.ts` empêche les deux écrans de
                          // rediverger de la fonction en silence.
                          "Aucune analyse ne tourne en arrière-plan, mais dès que quelqu'un sollicitera " +
                          "cet agent depuis l'assistant, il agira sans vous demander. Le plafond des " +
                          "automatisations reste le dernier frein : à 0 €, rien ne passe."
                        }
                        confirmLabel="J'active l'autopilote"
                        confirmVariant="danger"
                        action={setAgentAutonomy}
                        hidden={{
                          agent: panel.agent,
                          level: "4",
                          confirmAutopilot: "oui",
                        }}
                      />
                    ) : (
                      <form action={setAgentAutonomy}>
                        <input type="hidden" name="agent" value={panel.agent} />
                        <input type="hidden" name="level" value={String(level.level)} />
                        <SubmitButton variant="secondary">Choisir</SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {canConfigure && (
          <form action={setAgentEnabled} className="mt-3">
            <input type="hidden" name="agent" value={panel.agent} />
            <input type="hidden" name="enabled" value={panel.enabled ? "0" : "1"} />
            <SubmitButton variant="ghost">
              {panel.enabled ? "Mettre cet agent en veille" : "Réactiver cet agent"}
            </SubmitButton>
          </form>
        )}
      </div>
    </Panel>
  );
}

function Metric({
  label,
  value,
  fallback = "—",
}: {
  label: string;
  value: React.ReactNode;
  fallback?: string;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1 text-[var(--text-body)] ${empty ? "text-ink-faint" : "font-medium"}`}
      >
        {empty ? fallback : value}
      </p>
    </div>
  );
}

export const dynamic = "force-dynamic";
