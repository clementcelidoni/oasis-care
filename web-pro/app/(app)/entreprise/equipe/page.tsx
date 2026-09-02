import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getActiveOrganization } from "@/lib/auth/organization";
import {
  PageHeader,
  Panel,
  Card,
  Badge,
  StatusBadge,
  EmptyState,
  MetricCard,
  UserAvatar,
  ButtonLink,
  SubmitButton,
} from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/crm/types";
import { employeeName, SKILL_LEVEL_LABELS } from "@/lib/field/types";
import { LinkEmployeeSelect } from "./LinkEmployeeSelect";
import { updateMemberRole, setMemberAccess, revokeInvitation } from "@/lib/company/teamActions";
import { CompanyTabs } from "../CompanyTabs";
import { InviteMemberForm } from "./InviteMemberForm";
import { TeamInvitationLink } from "./TeamInvitationLink";

/**
 * §14 ÉQUIPE.
 *
 * LA CHOSE À COMPRENDRE AVANT DE LIRE LE RESTE : « membre » et
 * « salarié » ne sont pas la même liste, et cet écran refuse de faire
 * semblant.
 *
 *  • `organization_members` (0043) = les COMPTES. Qui peut ouvrir Oasis
 *    Care Pro, et avec quels droits.
 *  • `employees` (0051) = les PERSONNES du terrain. Qui est pointé sur
 *    un chantier, à quel coût horaire, dans quelle équipe.
 *
 * Elles se recouvrent partiellement — `employees.user_id` fait le lien
 * quand il est renseigné — mais chacune a des lignes que l'autre n'a
 * pas : un intérimaire de trois jours est pointé sans compte, et le
 * comptable a un compte sans jamais mettre les pieds sur un chantier.
 * Les fondre en une seule liste obligerait à inventer, pour chaque
 * ligne, la moitié qui manque. D'où deux panneaux distincts, et un
 * compteur qui dit lequel est lequel.
 *
 * LES COMPTEURS PAR RÔLE sont dérivés des rôles RÉELLEMENT présents.
 * L'exemple de la spec (« Administrateurs 2 · Terrain 7 · Commercial 1
 * · Nursery 2 ») décrit une entreprise particulière, pas une
 * nomenclature : afficher « Nursery 0 » à un paysagiste qui n'a pas de
 * pépinière serait du remplissage.
 *
 * CE QUE LA BASE NE SAIT PAS, l'écran ne l'invente pas. Il n'y a nulle
 * part de photo de membre ni de date d'embauche — les notes en bas de
 * panneau le disent, plutôt qu'un cadre vide ou une date approchante.
 */

/** Le retour des Server Actions, qui voyage dans l'URL faute de PII à y mettre. */
const MESSAGES: Record<string, { tone: "positive" | "warning" | "critical"; text: string }> = {
  "role-modifie": {
    tone: "positive",
    text: "Rôle modifié. Le menu et les droits de cette personne changent immédiatement.",
  },
  "acces-desactive": {
    tone: "positive",
    text: "Accès désactivé. La personne reste visible dans l'historique des chantiers, des devis et des pointages — on coupe la porte, on n'efface pas le passé.",
  },
  "acces-retabli": { tone: "positive", text: "Accès rétabli." },
  "invitation-revoquee": {
    tone: "positive",
    text: "Invitation révoquée : son lien n'ouvre plus rien.",
  },
  "soi-meme": {
    tone: "warning",
    text: "Vous ne pouvez pas modifier votre propre accès depuis cet écran. Demandez-le à un autre administrateur : c'est ce qui évite de se fermer la porte au nez.",
  },
  "dernier-proprietaire": {
    tone: "warning",
    text: "C'est le dernier propriétaire actif. Nommez d'abord quelqu'un d'autre propriétaire — une entreprise sans propriétaire est une entreprise dont plus personne ne peut confier les clés.",
  },
  "proprietaire-reserve": {
    tone: "warning",
    text: "Seul un propriétaire peut nommer un autre propriétaire.",
  },
  "aucun-changement": { tone: "warning", text: "C'était déjà le rôle de cette personne." },
  "role-invalide": { tone: "critical", text: "Ce rôle n'existe pas." },
  "membre-introuvable": { tone: "critical", text: "Ce membre n'existe plus." },
  "invitation-introuvable": { tone: "critical", text: "Cette invitation n'existe plus." },
};

const ASSIGNABLE_ROLES = ROLES.filter((role): role is Role => role !== "custom");

type MemberRow = {
  id: string;
  user_id: string;
  role: Role;
  custom_permissions: string[] | null;
  archived_at: string | null;
  created_at: string;
};

type EmployeeRow = {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};

type InvitationRow = {
  id: string;
  email: string;
  role: Role;
  token: string;
  expires_at: string;
  created_at: string;
};

export default async function TeamPage({ searchParams }: PageProps<"/entreprise/equipe">) {
  const organization = await getActiveOrganization();
  if (!organization) return null;

  const params = await searchParams;
  const feedback =
    typeof params.message === "string" ? MESSAGES[params.message] : undefined;

  const canManage = organization.permissions.includes("organization.manageUsers");
  // Les fiches salariés, les équipes et les compétences vivent derrière
  // `projects.read` (RLS de 0051). Sans ce droit, les requêtes
  // ci-dessous ne renvoient pas une erreur mais une liste vide — d'où
  // ce booléen, qui permet de dire « vous n'y avez pas accès » plutôt
  // que de laisser croire « il n'y a personne ».
  const canSeeEmployees = organization.permissions.includes("projects.read");

  const user = await getCurrentUser();
  const supabase = await createClient();
  const organizationId = organization.organizationId;

  const [
    { data: memberData },
    { data: employeeData },
    { data: teamData },
    { data: teamMemberData },
    { data: skillData },
    { data: employeeSkillData },
  ] = await Promise.all([
    supabase
      .from("organization_members")
      .select("id, user_id, role, custom_permissions, archived_at, created_at")
      .eq("organization_id", organizationId)
      .order("created_at"),
    supabase
      .from("employees")
      .select("id, user_id, first_name, last_name, job_title, email, phone, created_at")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("last_name"),
    supabase
      .from("teams")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("archived_at", null),
    supabase.from("team_members").select("team_id, employee_id").eq("organization_id", organizationId),
    supabase.from("skills").select("id, name").eq("organization_id", organizationId),
    supabase
      .from("employee_skills")
      .select("employee_id, skill_id, level")
      .eq("organization_id", organizationId),
  ]);

  // Les invitations ne se lisent qu'avec `organization.manageUsers`
  // (RLS de 0043) : inutile de poser la question au nom de quelqu'un
  // d'autre, la réponse serait vide et l'écran mentirait en affichant
  // « aucune invitation ».
  const invitations: InvitationRow[] = canManage
    ? (((
        await supabase
          .from("organization_invitations")
          .select("id, email, role, token, expires_at, created_at")
          .eq("organization_id", organizationId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
      ).data ?? []) as InvitationRow[])
    : [];

  const employees = (employeeData ?? []) as EmployeeRow[];
  const teamNameById = new Map<string, string>(
    ((teamData ?? []) as { id: string; name: string }[]).map((team) => [team.id, team.name]),
  );
  const skillNameById = new Map<string, string>(
    ((skillData ?? []) as { id: string; name: string }[]).map((skill) => [skill.id, skill.name]),
  );

  const teamsByEmployee = new Map<string, string[]>();
  for (const link of (teamMemberData ?? []) as { team_id: string; employee_id: string }[]) {
    const name = teamNameById.get(link.team_id);
    if (!name) continue;
    teamsByEmployee.set(link.employee_id, [...(teamsByEmployee.get(link.employee_id) ?? []), name]);
  }

  const skillsByEmployee = new Map<string, { name: string; level: number }[]>();
  for (const link of (employeeSkillData ?? []) as {
    employee_id: string;
    skill_id: string;
    level: number;
  }[]) {
    const name = skillNameById.get(link.skill_id);
    if (!name) continue;
    skillsByEmployee.set(link.employee_id, [
      ...(skillsByEmployee.get(link.employee_id) ?? []),
      { name, level: link.level },
    ]);
  }

  const employeeByUserId = new Map<string, EmployeeRow>();
  for (const employee of employees) {
    if (employee.user_id) employeeByUserId.set(employee.user_id, employee);
  }

  const members = ((memberData ?? []) as MemberRow[])
    .map((member) => {
      const employee = employeeByUserId.get(member.user_id) ?? null;
      const isSelf = member.user_id === user?.id;
      return {
        ...member,
        employee,
        isSelf,
        // Le nom vient de la fiche salarié quand elle existe. Sinon, la
        // seule identité que le web puisse lire est celle du visiteur
        // lui-même : `auth.users` n'est pas exposé, et RLS ne donne
        // accès à aucune table qui porterait le nom des autres comptes.
        name: employee ? employeeName(employee) : isSelf ? (user?.email ?? null) : null,
      };
    })
    .sort((a, b) => {
      if (!!a.archived_at !== !!b.archived_at) return a.archived_at ? 1 : -1;
      return (a.name ?? "￿").localeCompare(b.name ?? "￿", "fr");
    });

  // Les fiches déjà prises par un autre compte. Les proposer quand même
  // laisserait choisir un rattachement qui en défait un autre en
  // silence — la liste ne montre donc que les fiches libres, plus celle
  // du compte qu'on est en train de regarder.
  const claimedEmployeeIds = new Set(
    members.map((member) => member.employee?.id).filter(Boolean) as string[],
  );

  const activeMembers = members.filter((member) => !member.archived_at);
  const memberUserIds = new Set(members.map((member) => member.user_id));

  // Sur le terrain sans accès au logiciel : soit aucun compte n'est
  // rattaché à la fiche, soit celui qui l'était n'est plus membre.
  const employeesWithoutAccount = employees.filter(
    (employee) => !employee.user_id || !memberUserIds.has(employee.user_id),
  );

  const roleBreakdown = [...ROLES]
    .map((role) => ({
      role,
      count: activeMembers.filter((member) => member.role === role).length,
    }))
    .filter((entry) => entry.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count || ROLE_LABELS[a.role].localeCompare(ROLE_LABELS[b.role], "fr"),
    );

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Équipe"
        subtitle="Qui peut ouvrir Oasis Care Pro, avec quels droits — et qui travaille sur les chantiers sans avoir besoin d'un compte."
        action={
          canManage ? (
            <ButtonLink href="#inviter">
              <Icon name="plus" className="h-4 w-4" />
              Inviter un membre
            </ButtonLink>
          ) : (
            <Badge tone="neutral">Lecture seule</Badge>
          )
        }
      />

      <CompanyTabs current="/entreprise/equipe" />

      {feedback && (
        <p
          className={`mb-6 rounded-[var(--radius-card)] border px-4 py-3 text-[var(--text-body)] ${
            feedback.tone === "positive"
              ? "border-positive/30 bg-positive-wash text-positive"
              : feedback.tone === "warning"
                ? "border-warning/30 bg-warning-wash text-warning"
                : "border-critical/30 bg-critical-wash text-critical"
          }`}
        >
          {feedback.text}
        </p>
      )}

      {/* §14 « 12 membres · Administrateurs 2 · … » — le tableau de bord.
          Quatre chiffres, et chacun répond à une question qu'on se pose
          vraiment : qui entre, qui travaille, qui travaille sans entrer,
          et qu'est-ce qui est en attente. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Comptes actifs"
          value={String(activeMembers.length)}
          hint="Peuvent ouvrir le logiciel"
          tone="accent"
        />
        <MetricCard
          label="Salariés"
          value={canSeeEmployees ? String(employees.length) : null}
          hint={canSeeEmployees ? "Fiches du terrain" : "Droit de lecture des chantiers requis"}
        />
        <MetricCard
          label="Sans compte"
          value={canSeeEmployees ? String(employeesWithoutAccount.length) : null}
          hint="Pointés sur les chantiers, sans accès"
        />
        <MetricCard
          label="Invitations"
          value={canManage ? String(invitations.length) : null}
          hint={canManage ? "En attente d'acceptation" : "Réservé aux administrateurs"}
        />
      </div>

      {/* La répartition par rôle, dérivée des rôles réellement présents. */}
      {roleBreakdown.length > 0 && (
        <Card className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          {roleBreakdown.map((entry) => (
            <span key={entry.role} className="flex items-baseline gap-2">
              <span className="tabular text-[length:var(--text-card)] font-semibold">
                {entry.count}
              </span>
              <span className="text-[var(--text-secondary)] text-ink-soft">
                {ROLE_LABELS[entry.role]}
              </span>
            </span>
          ))}
        </Card>
      )}

      {/* §14 FICHE MEMBRE — une carte par personne, pas une ligne de
          tableau. §1 : « moins d'informations à la fois, de l'air ».
          Douze personnes tiennent dans une page qu'on lit ; douze lignes
          de neuf colonnes tiennent dans une page qu'on parcourt. */}
      <section className="mb-8">
        <Panel
          title="Accès au logiciel"
          description="Les comptes rattachés à votre entreprise."
          count={members.length}
        >
          {members.length === 0 ? (
            <div className="px-5 py-5">
              <EmptyState
                icon={<Icon name="team" />}
                title="Aucun compte pour le moment"
                description="Invitez votre premier collègue pour qu'il accède aux chantiers, aux devis et au planning."
                action={canManage ? <ButtonLink href="#inviter">Inviter un membre</ButtonLink> : undefined}
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {members.map((member) => {
                const skills = member.employee
                  ? (skillsByEmployee.get(member.employee.id) ?? [])
                  : [];
                const teams = member.employee
                  ? (teamsByEmployee.get(member.employee.id) ?? [])
                  : [];

                return (
                  <li key={member.id} className="px-5 py-5">
                    <div className="flex flex-wrap items-start gap-3">
                      <UserAvatar name={member.name ?? "?"} size="lg" />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[length:var(--text-card)] font-semibold">
                            {member.name ?? "Compte sans fiche salarié"}
                          </h3>
                          {member.isSelf && <Badge tone="accent">Vous</Badge>}
                        </div>
                        <p className="mt-0.5 text-[var(--text-secondary)] text-ink-soft">
                          {member.employee?.job_title ?? "Poste non renseigné"}
                          {teams.length > 0 && ` · ${teams.join(", ")}`}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Badge tone={member.role === "owner" ? "accent" : "neutral"}>
                          {ROLE_LABELS[member.role]}
                        </Badge>
                        {member.archived_at ? (
                          <StatusBadge tone="critical">Accès désactivé</StatusBadge>
                        ) : (
                          <StatusBadge tone="positive">Actif</StatusBadge>
                        )}
                      </div>
                    </div>

                    <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                      <Detail
                        label="E-mail"
                        value={member.employee?.email ?? (member.isSelf ? user?.email : null)}
                      />
                      <Detail label="Téléphone" value={member.employee?.phone} />
                      <Detail label="Compte créé le" value={formatDate(member.created_at)} />
                    </dl>

                    <LinkEmployeeSelect
                      memberUserId={member.user_id}
                      currentEmployeeId={member.employee?.id ?? null}
                      options={employees.filter(
                        (employee) =>
                          !claimedEmployeeIds.has(employee.id) ||
                          employee.id === member.employee?.id,
                      )}
                    />

                    {skills.length > 0 && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="eyebrow mr-1">Compétences</span>
                        {skills.map((skill) => (
                          <Badge key={skill.name} tone="info">
                            {skill.name} · {SKILL_LEVEL_LABELS[skill.level] ?? skill.level}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {!member.employee && (
                      <p className="mt-3 text-[var(--text-secondary)] text-ink-faint">
                        Ce compte n&apos;est relié à aucune fiche salarié : ni poste, ni
                        téléphone, ni équipe, ni compétences.{" "}
                        {canSeeEmployees ? (
                          <>
                            Reliez-le depuis <em>Équipes</em> en renseignant son compte sur
                            la fiche de la personne.
                          </>
                        ) : (
                          <>Les fiches salariés demandent le droit de lecture des chantiers.</>
                        )}
                      </p>
                    )}

                    {canManage && (
                      <MemberControls
                        member={member}
                        canAssignOwner={organization.role === "owner"}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <p className="mt-3 px-1 text-[var(--text-secondary)] text-ink-faint">
          Oasis n&apos;héberge aucune photo de membre : l&apos;initiale colorée en
          tient lieu. Et la date affichée est celle de la <strong>création du
          compte</strong>, pas la date d&apos;embauche — Oasis ne la connaît pas et
          préfère le dire plutôt que d&apos;afficher une date qui ressemble à la
          bonne.
        </p>
      </section>

      {/* §14 — l'autre moitié de l'équipe : celle qui n'a pas de compte. */}
      <section className="mb-8">
        <Panel
          title="Sur le terrain, sans compte"
          description="Ces personnes sont planifiées et pointées sur les chantiers, mais n'ouvrent pas le logiciel."
          count={canSeeEmployees ? employeesWithoutAccount.length : undefined}
          action={<ButtonLink href="/equipes" variant="secondary">Gérer les salariés</ButtonLink>}
        >
          {!canSeeEmployees ? (
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Les fiches salariés demandent le droit de lecture des chantiers. Votre
              rôle ne l&apos;a pas — cette liste n&apos;est donc pas affichée, plutôt
              que présentée comme vide.
            </p>
          ) : employees.length === 0 ? (
            <div className="px-5 py-5">
              <EmptyState
                icon={<Icon name="team" />}
                title="Aucun salarié pour le moment"
                description="Ajoutez vos salariés pour les planifier sur les chantiers, suivre leurs heures et connaître le coût réel de la main-d'œuvre."
                action={<ButtonLink href="/equipes">Ajouter un salarié</ButtonLink>}
              />
            </div>
          ) : employeesWithoutAccount.length === 0 ? (
            <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
              Tous vos salariés ont un compte. Rien à faire ici.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {employeesWithoutAccount.map((employee) => {
                const teams = teamsByEmployee.get(employee.id) ?? [];
                return (
                  <li key={employee.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <UserAvatar name={employeeName(employee)} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{employeeName(employee)}</p>
                      <p className="text-[var(--text-secondary)] text-ink-soft">
                        {employee.job_title ?? "Poste non renseigné"}
                        {teams.length > 0 && ` · ${teams.join(", ")}`}
                        {employee.email && ` · ${employee.email}`}
                      </p>
                    </div>
                    <StatusBadge tone="neutral" dot={false}>
                      Pas d&apos;accès
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {canManage && employeesWithoutAccount.some((employee) => employee.email) && (
          <p className="mt-3 px-1 text-[var(--text-secondary)] text-ink-faint">
            Pour donner un accès à l&apos;une de ces personnes, invitez-la avec
            l&apos;adresse e-mail de sa fiche : le compte qu&apos;elle créera se
            reliera à sa fiche salarié dès que vous l&apos;y aurez renseigné.
          </p>
        )}
      </section>

      {/* §14 « Inviter un membre » — et le lien qui en sort. */}
      {canManage && (
        <section id="inviter" className="scroll-mt-8">
          <Panel
            title="Inviter un membre"
            description="Oasis n'envoie pas de courriel : vous obtenez un lien, vous le transmettez."
            className="mb-4"
          >
            <InviteMemberForm canInviteOwner={organization.role === "owner"} />
          </Panel>

          <Panel
            title="Invitations en attente"
            count={invitations.length}
            description="Chaque lien est nominatif et expire au bout de quatorze jours."
          >
            {invitations.length === 0 ? (
              <p className="px-5 py-5 text-[var(--text-body)] text-ink-soft">
                Aucune invitation en attente.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {invitations.map((invitation) => {
                  const expired = new Date(invitation.expires_at) < new Date();
                  return (
                    <li key={invitation.id} className="flex flex-col gap-3 px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {invitation.email}
                        </span>
                        <Badge tone="neutral">{ROLE_LABELS[invitation.role]}</Badge>
                        {expired ? (
                          <StatusBadge tone="warning">
                            Expirée le {formatDate(invitation.expires_at)}
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="info">
                            Valable jusqu&apos;au {formatDate(invitation.expires_at)}
                          </StatusBadge>
                        )}
                      </div>

                      {!expired && <TeamInvitationLink token={invitation.token} />}

                      <form action={revokeInvitation}>
                        <input type="hidden" name="invitation_id" value={invitation.id} />
                        <SubmitButton variant="ghost">Révoquer l&apos;invitation</SubmitButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </section>
      )}

      {!canManage && (
        <p className="text-[var(--text-body)] text-ink-soft">
          Seul un administrateur peut inviter quelqu&apos;un, changer un rôle ou
          couper un accès. Vous pouvez consulter l&apos;équipe.
        </p>
      )}
    </div>
  );
}

/** Une ligne de la fiche membre. Un tiret vaut mieux qu'un champ inventé. */
function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className={`mt-0.5 truncate text-[var(--text-body)] ${value ? "" : "text-ink-faint"}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

/**
 * §14 ACTIONS — « Modifier rôle », « Désactiver accès ».
 *
 * Repliées derrière un `<details>` : ce sont des gestes rares et
 * lourds de conséquences, et douze listes déroulantes dépliées
 * transformeraient la page en console d'administration. Un `<details>`
 * plutôt qu'un état React parce qu'il n'y a rien à synchroniser — le
 * navigateur sait ouvrir et fermer un bloc sans notre aide.
 */
function MemberControls({
  member,
  canAssignOwner,
}: {
  member: { id: string; role: Role; archived_at: string | null; isSelf: boolean };
  /** Seul un propriétaire nomme un propriétaire — autant ne pas proposer
      un choix que la Server Action refusera. */
  canAssignOwner: boolean;
}) {
  if (member.isSelf) {
    return (
      <p className="mt-4 text-[var(--text-secondary)] text-ink-faint">
        C&apos;est votre propre compte. Un autre administrateur peut en changer le
        rôle ; vous, non — c&apos;est ce qui évite de se retirer ses droits par
        mégarde et de ne plus pouvoir les reprendre.
      </p>
    );
  }

  return (
    <details className="group mt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[var(--text-secondary)] font-medium text-ink-soft transition-colors hover:text-ink">
        <Icon
          name="chevron"
          className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
        />
        Gérer l&apos;accès
      </summary>

      <div className="mt-3 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] bg-surface-sunken px-4 py-3.5">
        <form action={updateMemberRole} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="member_id" value={member.id} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[var(--text-secondary)] font-medium text-ink-soft">Rôle</span>
            <select
              name="role"
              defaultValue={member.role}
              className="rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] outline-none focus:border-accent"
            >
              {ASSIGNABLE_ROLES.filter(
                (role) => canAssignOwner || role !== "owner" || member.role === "owner",
              ).map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
              {/* Un rôle `custom` existant reste lisible dans la liste,
                  mais ne peut pas être choisi : il ne veut rien dire
                  sans ses permissions sur-mesure. */}
              {member.role === "custom" && (
                <option value="custom" disabled>
                  {ROLE_LABELS.custom}
                </option>
              )}
            </select>
          </label>
          <SubmitButton variant="secondary">Modifier le rôle</SubmitButton>
        </form>

        <form action={setMemberAccess}>
          <input type="hidden" name="member_id" value={member.id} />
          <input type="hidden" name="active" value={member.archived_at ? "true" : "false"} />
          <SubmitButton variant={member.archived_at ? "secondary" : "danger"}>
            {member.archived_at ? "Rétablir l'accès" : "Désactiver l'accès"}
          </SubmitButton>
        </form>
      </div>
    </details>
  );
}
