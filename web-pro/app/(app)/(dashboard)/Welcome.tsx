import { ActionCard } from "@/components/ui";
import { Icon, type IconName } from "@/components/shell/Icon";
import type { OrganizationContext } from "@/lib/auth/organization";
import type { Permission } from "@/lib/auth/permissions";
import type { Dashboard } from "./queries";

/**
 * §44 PREMIÈRE PAGE — « Bienvenue sur Oasis Care Pro / Votre espace est
 * prêt ».
 *
 * Ce que voit quelqu'un dont l'entreprise n'a encore ni client, ni
 * devis, ni chantier, ni plante. Le tableau de bord normal lui
 * montrerait quatre cartes à zéro, une journée vide et aucune alerte —
 * techniquement exact, et parfaitement décourageant : rien n'y indique
 * PAR OÙ commencer.
 *
 * Les cartes suivent les mêmes filtres que la navigation : on ne
 * propose pas de configurer une pépinière à un paysagiste, ni de créer
 * un devis à un compte qui n'en a pas le droit — la porte s'ouvrirait
 * sur un refus.
 */

type Action = {
  key: string;
  icon: IconName;
  title: string;
  description: string;
  href: string;
};

export function Welcome({
  organization,
  visible,
}: {
  organization: OrganizationContext;
  visible: Dashboard["visible"];
}) {
  const can = (permission: Permission) => organization.permissions.includes(permission);

  const actions: Action[] = [];

  if (can("clients.write")) {
    actions.push({
      key: "client",
      icon: "clients",
      title: "Ajouter un client",
      description: "Le point de départ : tout devis et tout chantier part d'un client.",
      href: "/crm/clients",
    });
  }
  if (visible.projects && can("projects.manage")) {
    actions.push({
      key: "projet",
      icon: "projects",
      title: "Créer un projet",
      description: "Un chantier, ses phases et son planning.",
      href: "/projets",
    });
  }
  if (visible.quotes && can("quotes.create")) {
    actions.push({
      key: "devis",
      icon: "quote",
      title: "Créer un devis",
      description: "À partir de votre bibliothèque de prix, ou ligne par ligne.",
      href: "/devis",
    });
  }
  if (can("digitalTwin.edit")) {
    actions.push({
      key: "jardin",
      icon: "twin",
      title: "Modéliser un jardin",
      description: "Le plan du terrain, dont sortent les métrés du devis.",
      href: "/digital-twin",
    });
  }
  if (visible.nursery) {
    actions.push({
      key: "nursery",
      icon: "nursery",
      title: "Configurer Nursery",
      description: "Vos emplacements, vos stades de production, vos premiers lots.",
      href: "/pepiniere",
    });
  }

  return (
    <div>
      <div className="mb-8 rounded-[var(--radius-card)] border border-line bg-accent-wash/40 px-6 py-8">
        <h2 className="text-[length:var(--text-section)] font-semibold tracking-tight">
          Bienvenue sur Oasis Care Pro
        </h2>
        <p className="mt-2 max-w-xl text-[var(--text-body)] text-ink-soft">
          Votre espace est prêt. Il est encore vide, et c&apos;est normal : les
          chiffres, la journée et les alertes apparaîtront ici dès que{" "}
          {organization.name} aura ses premières données.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {actions.map((action) => (
          <ActionCard
            key={action.key}
            title={action.title}
            description={action.description}
            href={action.href}
            icon={<Icon name={action.icon} className="h-5 w-5" />}
          />
        ))}
      </div>
    </div>
  );
}
