import { requireOrganization } from "@/lib/auth/organization";
import {
  Card,
  StatusBadge,
  Panel,
  PageHeader,
  SubmitButton,
  ConfirmDialog,
} from "@/components/ui";
import { centsToInput, formatCents } from "@/lib/quotes/types";
import { getAutomationsView, type AutopilotRuleView } from "@/lib/ai/agents";
import { saveAutopilotRule } from "@/lib/ai/agentActions";
import { countOpenDecisions } from "@/lib/ai/decisions";
import { AGENT_LABELS, isAgentKey } from "@/lib/ai/types";
import { OasisTabs } from "../OasisTabs";

/**
 * §11V — AUTOMATIONS (spec p. 35-36) : les règles d'autopilote et leurs
 * limites — plafond, types autorisés, fournisseurs, clients, horaires.
 *
 * ─── « CELLES QUE LA SPEC VEUT À OFF S'AFFICHENT À OFF » ───
 *
 * Trois d'entre elles — envoyer une facture, passer une commande
 * fournisseur, modifier une grille tarifaire — ne sont pas « à OFF pour
 * l'instant ». Ce sont trois des interdits de la page 2, et
 * l'autopilote est par définition l'absence de validation. Le catalogue
 * (0072) ne les déclare pas éligibles, et un déclencheur refuse de les
 * activer — pas seulement de les créer activées. Aucun écran, aucune
 * Server Action, aucun `update` dans la console ne peut les allumer.
 *
 * Elles s'affichent donc VERROUILLÉES, avec la raison, et sans
 * interrupteur. Un interrupteur qui lève une exception au clic serait
 * une promesse mensongère ; l'absence d'interrupteur est la vérité.
 *
 * ─── LE PLAFOND PAR DÉFAUT EST ZÉRO, ET C'EST UN CHOIX ───
 *
 * Zéro ne veut pas dire « oubli » : il veut dire « aucun engagement
 * financier automatique ». Un plafond hérité serait un plafond que
 * personne n'a choisi. L'entreprise le relève elle-même, ici, sciemment.
 */
export default async function AutomationsPage() {
  const organization = await requireOrganization();

  const [view, openDecisions] = await Promise.all([
    getAutomationsView(organization.organizationId, organization.permissions),
    countOpenDecisions(organization.organizationId),
  ]);

  const eligible = view.rules.filter((rule) => rule.eligible);
  const locked = view.rules.filter((rule) => !rule.eligible);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Automatisations"
        subtitle="Ce qu'Oasis a le droit de faire sans vous — et surtout ce qu'il n'aura jamais le droit de faire sans vous."
        action={
          <StatusBadge tone={view.activeCount > 0 ? "warning" : "neutral"}>
            {view.activeCount === 0
              ? "Aucun automatisme actif"
              : `${view.activeCount} automatisme(s) actif(s)`}
          </StatusBadge>
        }
      />

      <OasisTabs current="/oasis-ai/automatisations" openDecisions={openDecisions} />

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
            Vous consultez ces règles sans pouvoir les changer. Chacun a le droit de
            savoir ce que la machine peut faire en son nom ; seul un administrateur le
            règle.
          </p>
        </Card>
      )}

      <Card className="mb-6 px-5 py-4">
        <p className="text-[var(--text-body)] font-medium">
          Un automatisme actif exécute sans que personne valide.
        </p>
        <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
          Il ne partira que si TOUTES les conditions sont réunies : l&apos;agent est
          réglé au niveau 4, la règle est allumée, le montant tient sous le plafond, et
          l&apos;utilisateur au nom de qui il agit détient le droit correspondant. Une
          seule condition inconnue suffit à refuser — le doute vaut refus, y compris
          quand le montant de l&apos;action n&apos;est pas connu.
        </p>
        {/* CE PARAGRAPHE EST LE PLUS IMPORTANT DE L'ÉCRAN, ET IL A DÉJÀ
            ÉTÉ FAUX UNE FOIS. Il promettait que toute action passait par
            une validation humaine enregistrée : vrai du balayage de
            fond, qui n'existe pas ; faux de l'assistant, qui exécute
            sans rien demander dès qu'un agent est au niveau 4 (voir
            `supabase/functions/oasis-pro-ai/index.ts`, branche
            « autopilote »). Un patron qui relève un plafond après avoir
            lu qu'il n'arme rien a été trompé par cet écran.

            `lib/ai/coherence.test.ts` lie désormais les deux surfaces :
            tant que cette branche existe dans la fonction Edge, ce
            paragraphe ne peut plus nier qu'elle existe. */}
        <p className="mt-3 rounded-[var(--radius-control)] bg-surface-sunken px-3.5 py-2.5 text-[var(--text-secondary)] text-ink-soft">
          <strong className="font-medium">Ce qu&apos;allumer une règle déclenche,
          exactement.</strong>{" "}
          Aucune analyse planifiée ne tourne en arrière-plan : Oasis ne se réveille
          pas la nuit pour facturer. Mais un agent réglé au niveau 4 exécutera sans
          confirmation dès qu&apos;on le sollicitera — depuis l&apos;assistant, en lui
          demandant par exemple de préparer les factures. Tant que le plafond
          ci-dessous vaut 0 €, rien ne passe : le relever est le geste qui arme
          réellement l&apos;automatisme.
        </p>
      </Card>

      {eligible.length > 0 && (
        <Panel title="Ce qui peut être automatisé" count={eligible.length}>
          <ul className="divide-y divide-line">
            {eligible.map((rule) => (
              <RuleRow key={rule.actionType} rule={rule} canConfigure={view.canConfigure} />
            ))}
          </ul>
        </Panel>
      )}

      {locked.length > 0 && (
        <div className="mt-6">
          <Panel
            title="Ce qui ne peut pas l'être"
            description="Verrouillé en base, pas éteint par réglage. Ouvrir l'un de ces automatismes demande une migration — délibérément la voie la plus lente."
            count={locked.length}
          >
            <ul className="divide-y divide-line">
              {locked.map((rule) => (
                <li key={rule.actionType} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--text-body)] font-medium">
                      {rule.label}
                      <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-faint">
                        {agentName(rule.agent)}
                      </span>
                    </p>
                    {rule.description && (
                      <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                        {rule.description}
                      </p>
                    )}
                  </div>
                  <StatusBadge tone="neutral">Verrouillé</StatusBadge>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      {/* Les trois limites que cette itération n'expose pas encore.
          Les taire laisserait croire qu'elles n'existent pas, et
          quelqu'un les chercherait longtemps. */}
      <Card className="mt-6 px-5 py-4">
        <p className="text-[var(--text-body)] font-medium">
          Les limites qui ne se règlent pas encore ici
        </p>
        <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
          Les listes de fournisseurs et de clients autorisés, et la plage horaire,
          existent en base et sont respectées par le moteur — mais elles ne se
          modifient pas depuis cet écran dans cette version. Tant qu&apos;elles sont
          vides, elles ne restreignent rien ; une fois renseignées, elles refusent tout
          ce qu&apos;elles ne savent pas rattacher explicitement, y compris une action
          sans cible. Une liste blanche qu&apos;on ne sait pas vérifier doit fermer, pas
          s&apos;effacer.
        </p>
      </Card>
    </div>
  );
}

function RuleRow({ rule, canConfigure }: { rule: AutopilotRuleView; canConfigure: boolean }) {
  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[var(--text-body)] font-medium">
            {rule.label}
            <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-faint">
              {agentName(rule.agent)}
            </span>
          </p>
          {rule.description && (
            <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
              {rule.description}
            </p>
          )}
          <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
            Droit exigé de l&apos;utilisateur : <code>{rule.requiredPermission}</code>
            {rule.carriesAmount
              ? " · engage de l'argent : un montant inconnu fait refuser l'exécution."
              : " · n'engage aucun montant."}
          </p>
        </div>

        <StatusBadge tone={rule.enabled ? "warning" : "neutral"}>
          {rule.enabled ? "Actif" : "Éteint"}
        </StatusBadge>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        {rule.carriesAmount && (
          <div>
            <p className="eyebrow">Plafond par action</p>
            {/* Un plafond à zéro et un plafond inconnu s'affichent tous
                deux en gris, mais pas avec le même texte : le premier
                dit « rien ne passe », le second « aucune règle posée ». */}
            <p
              className={`tabular mt-0.5 text-[var(--text-body)] ${
                rule.maximumAmountCents !== null && rule.maximumAmountCents > 0
                  ? "font-medium"
                  : "text-ink-faint"
              }`}
            >
              {formatCents(rule.maximumAmountCents)}
              {rule.maximumAmountCents === 0 && (
                <span className="ml-2 text-[var(--text-secondary)] font-normal text-ink-faint">
                  aucun engagement financier automatique
                </span>
              )}
            </p>
          </div>
        )}

        {canConfigure && (
          <div className="ml-auto flex flex-wrap items-end gap-2">
            {rule.carriesAmount && (
              <form action={saveAutopilotRule} className="flex items-end gap-2">
                <input type="hidden" name="actionType" value={rule.actionType} />
                <input type="hidden" name="enabled" value={rule.enabled ? "1" : "0"} />
                {/* Le jeton n'accompagne le formulaire de plafond que si
                    la règle est DÉJÀ active : changer un plafond n'est
                    pas une activation, mais l'enregistrement repasse par
                    la même fonction, et celle-ci exige le jeton dès que
                    `enabled` vaut 1. */}
                {rule.enabled && <input type="hidden" name="confirmAutopilot" value="oui" />}
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">Nouveau plafond (€)</span>
                  <input
                    name="maximumAmount"
                    inputMode="decimal"
                    defaultValue={centsToInput(rule.maximumAmountCents)}
                    placeholder="0,00"
                    className="w-32 rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
                  />
                </label>
                <SubmitButton variant="secondary">Enregistrer</SubmitButton>
              </form>
            )}

            {rule.enabled ? (
              <form action={saveAutopilotRule}>
                <input type="hidden" name="actionType" value={rule.actionType} />
                <input type="hidden" name="enabled" value="0" />
                <SubmitButton variant="secondary">Éteindre</SubmitButton>
              </form>
            ) : (
              <ConfirmDialog
                triggerLabel="Activer"
                triggerVariant="danger"
                title={`Laisser Oasis « ${rule.label.toLowerCase()} » sans validation ?`}
                message={
                  `Une fois actif, cet automatisme s'exécute sans que personne le valide, ` +
                  (rule.carriesAmount
                    ? `dans la limite du plafond enregistré (${formatCents(rule.maximumAmountCents)}). Un plafond à zéro bloque tout : relevez-le d'abord si vous voulez qu'il serve. `
                    : "") +
                  `Il ne partira que si l'agent correspondant est réglé au niveau 4 et si l'utilisateur au nom de qui il agit détient le droit ${rule.requiredPermission}.`
                }
                confirmLabel="J'active cet automatisme"
                confirmVariant="danger"
                action={saveAutopilotRule}
                hidden={{
                  actionType: rule.actionType,
                  enabled: "1",
                  confirmAutopilot: "oui",
                  maximumAmount: "",
                }}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Le nom de l'agent propriétaire.
 *
 * Le catalogue peut nommer un agent HORS PÉRIMÈTRE — « procurement »
 * y figure pour déclarer que l'envoi d'une commande existe et qu'il est
 * interdit d'autopilote. Déclarer un interdit n'est pas construire ce
 * qu'il interdit : on affiche le nom brut plutôt que d'inventer un
 * libellé pour un agent qui n'existe pas.
 */
function agentName(agent: string): string {
  return isAgentKey(agent) ? AGENT_LABELS[agent] : agent;
}

export const dynamic = "force-dynamic";
