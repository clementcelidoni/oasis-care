import { Panel, SubmitButton, Badge } from "@/components/ui";
import { updateModules } from "@/lib/company/actions";
import {
  MODULE_LABELS,
  TOGGLEABLE_MODULES,
  allNavItems,
  visibleNavigation,
  type ModuleKey,
} from "@/lib/navigation";
import type { BusinessType, Permission } from "@/lib/auth/permissions";

/**
 * §43 MODULES — « Permettre masquage modules inutiles. Cela ne remplace
 * pas les entitlements. »
 *
 * C'est le seul réglage de §42 qui n'a d'écran nulle part ailleurs :
 * tout le reste de la page renvoie vers la page qui le règle. Il vit
 * donc ici, en entier.
 *
 * DEUX PRÉCAUTIONS, et elles sont tout l'intérêt du composant.
 *
 * 1. On dit ce que ça FAIT et ce que ça ne fait pas. « Éteindre un
 *    module » ressemble à « couper un accès » ; ce n'en est pas un.
 *    Rien ici n'est vérifié par une politique RLS — un collègue qui
 *    connaît l'URL de /factures y arrive toujours, et l'abonnement ne
 *    bouge pas d'un centime. La note en bas de panneau le dit en
 *    français plutôt que de laisser l'utilisateur le déduire.
 *
 * 2. On montre ce que CHAQUE interrupteur va réellement retirer du
 *    menu, en lisant la navigation au lieu de le décrire à la main.
 *    Une description figée mentirait au premier écran ajouté ; et
 *    surtout, elle cacherait le cas d'un module que rien ne rattache
 *    encore à une entrée — l'éteindre ne changerait alors rien, et
 *    l'écran vaut mieux que le dire.
 */
export function ModulesPanel({
  businessType,
  permissions,
  disabledModules,
  canManage,
}: {
  businessType: BusinessType;
  permissions: Permission[];
  disabledModules: ModuleKey[];
  canManage: boolean;
}) {
  // Ce que ce compte verrait si RIEN n'était masqué : les deux autres
  // filtres (rôle, type d'entreprise) s'appliquent quand même, parce
  // qu'annoncer « Emplacements » à un paysagiste sans pépinière serait
  // promettre un lien qui n'apparaîtra jamais.
  const entries = allNavItems(visibleNavigation(businessType, permissions, []));

  const labelsByModule = new Map<ModuleKey, string[]>();
  for (const item of entries) {
    if (!item.module) continue;
    labelsByModule.set(item.module, [...(labelsByModule.get(item.module) ?? []), item.label]);
  }

  return (
    <form action={updateModules}>
      <Panel
        title="Modules"
        description="Ce que votre menu affiche. Du rangement, pas un droit."
        className="mb-4"
        action={
          disabledModules.length > 0 ? (
            <Badge tone="info">
              {disabledModules.length} masqué{disabledModules.length > 1 ? "s" : ""}
            </Badge>
          ) : undefined
        }
        footer={canManage ? <SubmitButton variant="secondary">Enregistrer</SubmitButton> : undefined}
      >
        <fieldset disabled={!canManage} className="divide-y divide-line">
          {TOGGLEABLE_MODULES.map((key) => {
            const labels = labelsByModule.get(key) ?? [];
            return (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-3.5 px-5 py-4 transition-colors hover:bg-canvas"
              >
                {/* La case cochée vaut « module affiché ». `updateModules`
                    enregistre l'inverse — les DÉSACTIVÉS — parce qu'une
                    case décochée n'envoie rien en HTML : sans ce
                    renversement, éteindre un module serait indiscernable
                    d'un formulaire qui n'a pas été soumis. */}
                <input
                  type="checkbox"
                  name="module"
                  value={key}
                  defaultChecked={!disabledModules.includes(key)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className="mt-0.5 flex h-6 w-10 shrink-0 items-center rounded-[var(--radius-pill)] border border-line-strong bg-surface-sunken p-[3px] transition-colors after:h-4 after:w-4 after:rounded-[var(--radius-pill)] after:bg-ink-faint after:transition-transform peer-checked:border-accent peer-checked:bg-accent-wash peer-checked:after:translate-x-4 peer-checked:after:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 peer-disabled:opacity-50"
                />
                <span className="min-w-0">
                  <span className="block text-[var(--text-body)] font-medium">
                    {MODULE_LABELS[key]}
                  </span>
                  <span className="mt-0.5 block text-[var(--text-secondary)] text-ink-soft">
                    {labels.length > 0
                      ? `Dans le menu : ${labels.join(" · ")}.`
                      : "Aucune entrée de menu ne dépend de ce module pour votre compte : l'éteindre ne changera rien de visible."}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
          Éteindre « Facturation » retire les factures du menu, et rien de
          plus : aucune facture n&apos;est supprimée, personne ne perd un
          accès — un collègue qui ouvre le lien direct voit la page comme
          avant — et votre abonnement reste le même. Les droits se donnent
          par les rôles, dans l&apos;équipe ; ce que votre offre inclut se lit
          dans l&apos;abonnement.
        </p>
      </Panel>
    </form>
  );
}
