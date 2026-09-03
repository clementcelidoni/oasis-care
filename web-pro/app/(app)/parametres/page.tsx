import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import {
  PageHeader,
  SectionHeader,
  Panel,
  Card,
  ActionCard,
  Badge,
  ButtonLink,
  EmptyState,
  UserAvatar,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import {
  PERMISSIONS,
  ROLE_LABELS,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";
import { TOGGLEABLE_MODULES, type ModuleKey } from "@/lib/navigation";
import { employeeName } from "@/lib/field/types";
import { ModulesPanel } from "./ModulesPanel";
import { AuditLog, type AuditEvent } from "./AuditLog";

/**
 * §42 PARAMÈTRES — « Paramètres · Entreprise · Utilisateurs ·
 * Permissions · Abonnement · Notifications · Apparence · Modules ·
 * Sécurité · Intégrations · Données ».
 *
 * CETTE PAGE EST UN SOMMAIRE, et c'est un choix.
 *
 * L'ancienne version portait la fiche d'identité de la société : deux
 * formulaires de vingt champs sous un titre « Paramètres ». Ils ont
 * déménagé vers §11 « Ma société », où ils sont chez eux, avec le logo,
 * les documents, l'équipe et l'abonnement. Les rapatrier ici en
 * donnerait deux exemplaires, dont un finirait par mentir.
 *
 * Reste donc ce qu'un sommaire doit faire : dire où chaque réglage se
 * règle, et régler sur place le seul qui n'a d'écran nulle part
 * ailleurs — §43 MODULES.
 *
 * §1 : chaque rubrique est une carte qui dit ce qu'elle ouvre. « Équipe »
 * tout seul laisse deviner ; « qui a un compte, avec quel rôle » ne
 * laisse rien deviner.
 *
 * CE QUI N'EXISTE PAS EST ÉCRIT COMME TEL. §42 liste « Apparence » et
 * « Intégrations » ; ni l'un ni l'autre n'a de réglage en base
 * aujourd'hui. Une carte qui mènerait à un écran vide, ou un sélecteur
 * de thème qui ne changerait rien, coûterait plus cher qu'un paragraphe
 * honnête.
 */

/**
 * Les permissions, en français.
 *
 * `PERMISSIONS` porte des identifiants techniques — ils voyagent dans
 * les politiques RLS et dans les journaux, pas sous les yeux d'un
 * paysagiste. « clients.write » ne dit pas s'il s'agit de créer, de
 * modifier ou de supprimer ; la phrase, si.
 */
const PERMISSION_LABELS: Record<Permission, string> = {
  "clients.read": "Consulter les clients et les prospects",
  "clients.write": "Créer et modifier les clients",
  "quotes.read": "Consulter les devis et la bibliothèque de prix",
  "quotes.create": "Créer des devis",
  "quotes.edit": "Modifier des devis",
  "quotes.approve": "Valider un devis avant envoi",
  "projects.read": "Consulter les chantiers et le planning",
  "projects.manage": "Gérer les chantiers, les interventions et les équipes",
  "digitalTwin.edit": "Dessiner et modifier les plans du Digital Twin",
  "nursery.stock.manage": "Gérer la pépinière, la production et les stocks",
  "invoice.create": "Émettre des factures et enregistrer des règlements",
  "organization.manageUsers": "Administrer l'entreprise, ses comptes et ses droits",
};

type MemberRow = {
  id: string;
  user_id: string;
  role: Role;
  created_at: string;
};

type EmployeeRow = {
  user_id: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
};

export default async function SettingsPage() {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const user = await getCurrentUser();
  const supabase = await createClient();
  const organizationId = organization.organizationId;

  const [{ data: company }, { data: memberData }, { data: employeeData }, { data: auditData }] =
    await Promise.all([
      supabase
        .from("business_organizations")
        .select("disabled_modules")
        .eq("id", organizationId)
        .maybeSingle(),
      supabase
        .from("organization_members")
        .select("id, user_id, role, created_at")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("created_at"),
      // Le nom d'une personne vit dans `employees`, pas dans
      // `organization_members` qui ne connaît qu'un identifiant de
      // compte. Sans cette jointure, la liste afficherait des UUID —
      // c'est ce qu'elle faisait, et personne ne s'y reconnaissait.
      supabase
        .from("employees")
        .select("user_id, first_name, last_name, job_title")
        .eq("organization_id", organizationId)
        .is("archived_at", null),
      supabase
        .from("audit_events")
        .select("id, action, entity_type, entity_id, new_value, source, occurred_at")
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false })
        .limit(25),
    ]);

  // §42 « Réservé admin » : comme sur §11, on n'escamote pas les
  // rubriques — les écrans derrière se CONSULTENT sans ce droit — on
  // retire de quoi écrire, et on dit pourquoi.
  const canManage = organization.permissions.includes("organization.manageUsers");

  const members = (memberData ?? []) as MemberRow[];
  const employees = (employeeData ?? []) as EmployeeRow[];
  const nameByUserId = new Map<string, EmployeeRow>(
    employees.filter((e) => e.user_id).map((e) => [e.user_id as string, e]),
  );

  // La colonne est un `text[]` : la base ne garantit pas que son
  // contenu soit encore un module connu. Un module retiré du produit y
  // resterait écrit, et `MODULE_LABELS[cléInconnue]` afficherait un
  // trou. On ne garde que ce qui existe aujourd'hui.
  const disabledModules = (((company?.disabled_modules ?? []) as string[]).filter((key) =>
    (TOGGLEABLE_MODULES as readonly string[]).includes(key),
  ) as ModuleKey[]);

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Paramètres"
        subtitle="Le sommaire de vos réglages. Chaque rubrique mène à l'écran qui la règle vraiment ; les modules, eux, se règlent ici."
        action={
          <Badge tone={canManage ? "accent" : "neutral"}>
            {canManage ? "Administrateur" : "Lecture seule"}
          </Badge>
        }
      />

      {!canManage && (
        <p className="mb-8 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-[var(--text-body)] text-ink-soft">
          Seul un administrateur modifie les réglages de l&apos;entreprise. Vous
          pouvez tout consulter, et régler ce qui vous concerne depuis votre
          profil.
        </p>
      )}

      {/* §42 ENTREPRISE, UTILISATEURS, PERMISSIONS, ABONNEMENT.
          « Utilisateurs » et « Permissions » sont deux lignes de la spec
          et un seul écran : un droit se donne en changeant le rôle
          d'une personne, sur la ligne de cette personne. Deux cartes
          vers la même page feraient croire à deux endroits à tenir. */}
      <SectionHeader
        title="Entreprise"
        description="Ce que vos clients voient de vous, et qui travaille avec vous."
      />
      <div className="mb-10 grid gap-3 sm:grid-cols-2">
        <ActionCard
          href="/entreprise"
          icon={<Icon name="company" />}
          title="Ma société"
          description="Raison sociale, SIRET, adresse, logo, assurances — l'en-tête de vos devis et de vos factures."
        />
        <ActionCard
          href="/entreprise/documents"
          icon={<Icon name="document" />}
          title="Documents de la société"
          description="Kbis, attestations d'assurance, certifications : ce qu'un donneur d'ordre réclame."
        />
        <ActionCard
          href="/entreprise/equipe"
          icon={<Icon name="team" />}
          title="Équipe et droits"
          description="Qui a un compte, avec quel rôle. Les permissions se donnent en changeant le rôle d'une personne."
        />
        <ActionCard
          href="/entreprise/abonnement"
          icon={<Icon name="subscription" />}
          title="Abonnement"
          description="Votre forfait, ce qu'il inclut, et ce que vous consommez."
        />
      </div>

      {/* §42 NOTIFICATIONS, et le compte de la personne — §17. */}
      <SectionHeader
        title="Votre compte"
        description="Ce qui ne concerne que vous, et suit votre personne d'une entreprise à l'autre."
      />
      <div className="mb-10 grid gap-3 sm:grid-cols-2">
        <ActionCard
          href="/profil"
          icon={<Icon name="clients" />}
          title="Mon profil"
          description="Votre nom, votre façon de vous connecter, et les entreprises auxquelles vous appartenez."
        />
        <ActionCard
          href="/notifications"
          icon={<Icon name="bell" />}
          title="Notifications"
          description="Devis acceptés, stocks bas, factures échues : le centre où ils arrivent."
        />
      </div>

      {/* §11V p. 26 « Créer dans administration technique : AI
          Configuration ». La carte n'apparaît qu'aux administrateurs :
          l'écran derrière affiche les identifiants de modèle, et la
          page 27 interdit que l'utilisateur métier les voie. Une carte
          menant à un refus serait de toute façon une porte fermée
          annoncée comme une porte. */}
      {canManage && (
        <>
          <SectionHeader
            title="Intelligence artificielle"
            description="Le réglage interne d'Oasis AI : quel modèle, à quel coût, dans quelles limites."
          />
          <div className="mb-10 grid gap-3 sm:grid-cols-2">
            <ActionCard
              href="/parametres/ia"
              icon={<Icon name="ai" />}
              title="Configuration IA"
              description="Quel niveau de modèle chaque agent demande, et si ces modèles existent vraiment."
            />
            <ActionCard
              href="/parametres/ia/couts"
              icon={<Icon name="analytics" />}
              title="Coûts et plafonds IA"
              description="Ce qu'Oasis AI consomme, sa répartition entre les trois niveaux, et jusqu'où il peut aller."
            />
          </div>
        </>
      )}

      {/* §43 — le seul réglage qui vit sur cette page. */}
      <ModulesPanel
        businessType={organization.businessType}
        permissions={organization.permissions}
        disabledModules={disabledModules}
        canManage={canManage}
      />

      {/* §42 PERMISSIONS — vues depuis le compte connecté, ce qui répond
          à la question qu'on se pose vraiment ici : « pourquoi je ne
          vois pas cet écran ? ». */}
      <Panel
        title="Vos droits"
        description={`Votre rôle dans ${organization.name} : ${ROLE_LABELS[organization.role]}.`}
        className="mb-4"
      >
        <ul className="grid gap-x-6 gap-y-2 px-5 py-5 sm:grid-cols-2">
          {PERMISSIONS.map((permission) => {
            const granted = organization.permissions.includes(permission);
            return (
              <li key={permission} className="flex items-start gap-2.5">
                <Icon
                  name={granted ? "check" : "close"}
                  className={`mt-[3px] h-4 w-4 shrink-0 ${
                    granted ? "text-positive" : "text-ink-faint"
                  }`}
                />
                <span
                  className={`text-[var(--text-body)] ${granted ? "text-ink" : "text-ink-faint"}`}
                >
                  {PERMISSION_LABELS[permission]}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
          Ces droits sont vérifiés en base à chaque requête, pas seulement dans
          l&apos;interface : masquer un bouton ne protège rien. Changer de rôle
          les change tous d&apos;un coup — c&apos;est pour ça qu&apos;ils se
          donnent par rôle et non case par case.
        </p>
      </Panel>

      {/* §42 UTILISATEURS — la liste, pas sa gestion : elle est à côté.
          On la garde ici parce qu'un sommaire qui dit « quatre comptes »
          répond déjà à la moitié des questions qu'on venait poser. */}
      <Panel
        title="Comptes de l'entreprise"
        count={members.length}
        className="mb-4"
        action={
          <ButtonLink href="/entreprise/equipe" variant="ghost">
            Gérer
          </ButtonLink>
        }
      >
        {members.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="Aucun compte pour le moment"
              description="Invitez vos collègues pour qu'ils accèdent aux chantiers, aux devis et à la pépinière depuis leur propre session."
              icon={<Icon name="team" className="h-5 w-5" />}
              action={<ButtonLink href="/entreprise/equipe">Inviter un collègue</ButtonLink>}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {members.map((member) => {
              const employee = nameByUserId.get(member.user_id);
              const name = employee ? employeeName(employee) : null;
              const isSelf = member.user_id === user?.id;
              return (
                <li key={member.id} className="flex items-center gap-3 px-5 py-3">
                  <UserAvatar name={name ?? "?"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[var(--text-body)] font-medium">
                      {name ?? "Compte sans fiche salarié"}
                      {isSelf && <span className="text-ink-faint"> — vous</span>}
                    </p>
                    {employee?.job_title && (
                      <p className="truncate text-[var(--text-secondary)] text-ink-soft">
                        {employee.job_title}
                      </p>
                    )}
                  </div>
                  <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                    {ROLE_LABELS[member.role]}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
          Un compte n&apos;est pas un salarié : l&apos;intérimaire de trois jours
          est pointé sans compte, et le comptable a un compte sans jamais aller
          sur un chantier. Les deux listes se tiennent côte à côte dans
          l&apos;équipe.
        </p>
      </Panel>

      {/* §42 SÉCURITÉ — un journal, pas des réglages : il n'y a ni mot
          de passe ni session à révoquer dans ce produit (la connexion
          se fait par lien magique ou par Apple/Google, cf. §17). Ce
          qu'on peut offrir, c'est la trace de ce qui a été fait. */}
      <div className="mb-4">
        <AuditLog events={(auditData ?? []) as AuditEvent[]} />
      </div>

      {/* §42 DONNÉES */}
      <SectionHeader
        title="Vos données"
        description="Elles vous appartiennent, et elles doivent pouvoir sortir."
      />
      <div className="mb-10 grid gap-3 sm:grid-cols-2">
        <ActionCard
          href="/factures/export"
          icon={<Icon name="purchase" />}
          title="Export comptable"
          description="Vos factures et vos règlements en CSV, sur la période de votre choix, pour votre expert-comptable."
        />
      </div>

      {/* §42 APPARENCE et INTÉGRATIONS — annoncés par la spec, sans
          aucun réglage en base. Un sélecteur de thème qui ne changerait
          rien, ou une carte vers un écran vide, se paierait au premier
          clic ; ce paragraphe, non. */}
      <Card className="p-5">
        <h2 className="text-[length:var(--text-card)] font-semibold">
          Ce qui n&apos;est pas encore réglable
        </h2>
        <dl className="mt-4 flex flex-col gap-4">
          <div>
            <dt className="text-[var(--text-body)] font-medium">Apparence</dt>
            <dd className="mt-0.5 text-[var(--text-body)] text-ink-soft">
              Oasis Care Pro n&apos;a qu&apos;un seul thème, clair. Il n&apos;y a
              donc rien à choisir — la taille du texte, elle, suit le zoom de
              votre navigateur, qui emporte toute l&apos;interface avec lui.
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-body)] font-medium">Intégrations</dt>
            <dd className="mt-0.5 text-[var(--text-body)] text-ink-soft">
              Aucun logiciel tiers ne se connecte encore à Oasis Care Pro.
              L&apos;export comptable ci-dessus est la seule passerelle, et
              c&apos;est volontairement un CSV : tout logiciel de comptabilité
              sait le lire, et il n&apos;engage à aucun fournisseur.
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
