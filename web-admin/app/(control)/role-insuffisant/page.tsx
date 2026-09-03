import { requireAdmin } from "@/lib/auth/guard";
import { permissionLabel, roleLabel } from "@/lib/auth/roles";
import { PageHeader, Panel } from "@/components/ui";

/**
 * ==================================================================
 * MOINDRE PRIVILÈGE — l'écran qu'on voit quand son rôle ne suffit pas
 * ==================================================================
 *
 * Spec p.30 : « Support : ne peut pas modifier les abonnements.
 * Billing : ne peut pas ouvrir les données client. Product : ne peut
 * pas modifier les paiements. »
 *
 * POURQUOI CETTE PAGE EXISTE, alors qu'un non-administrateur reçoit un
 * 404. Parce que les deux situations n'ont rien à voir.
 *
 * Un compte qui n'est pas dans `platform_admins` ne doit pas apprendre
 * que ces pages existent : il reçoit un 404, indiscernable d'une
 * adresse mal tapée.
 *
 * Un administrateur LÉGITIME au rôle trop étroit, lui, sait déjà que le
 * Control Center existe — il y est, la barre latérale est à sa gauche.
 * Lui répondre 404 le ferait douter de l'application au lieu de sa
 * permission, et il ouvrirait un ticket pour un bug qui n'en est pas
 * un. On lui dit donc exactement ce qui manque, avec le nom de la
 * permission : c'est ce qu'il faudra demander pour l'obtenir.
 *
 * La page reste DANS la coquille : le rôle est affiché à gauche, la
 * navigation reste utilisable, et il repart d'un clic vers un écran
 * qui lui est ouvert.
 */
export default async function RoleInsuffisantPage({ searchParams }: PageProps<"/role-insuffisant">) {
  // La garde SANS permission : on est ici justement parce qu'une
  // permission manquait. Exiger quoi que ce soit de plus créerait une
  // boucle de redirection.
  const admin = await requireAdmin();

  // `searchParams` est asynchrone dans cette version de Next.
  const params = await searchParams;
  const raw = params.permission;
  const permission = Array.isArray(raw) ? raw[0] : raw;

  return (
    <>
      <PageHeader
        eyebrow="Moindre privilège"
        title="Cette section n'est pas ouverte à votre rôle"
        subtitle="Ce n'est pas une panne. Chaque rôle du Control Center ne porte que les permissions dont il a besoin, et la matrice qui en décide est appliquée par la base de données, pas par cette interface."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Votre rôle">
          <div className="px-4 py-3">
            <p className="text-[length:var(--text-card)] font-medium text-ink">
              {roleLabel(admin.role)}
            </p>
            <p className="mt-2 text-[var(--text-body)] leading-relaxed text-ink-soft">
              {admin.permissions.length} permission
              {admin.permissions.length > 1 ? "s" : ""} accordée
              {admin.permissions.length > 1 ? "s" : ""}.
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {[...admin.permissions].sort().map((held) => (
                <li key={held} className="text-[var(--text-secondary)] text-ink-soft">
                  · {permissionLabel(held)}
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Ce qui manque">
          <div className="px-4 py-3">
            {permission ? (
              <>
                <p className="text-[length:var(--text-card)] font-medium text-ink">
                  {permissionLabel(permission)}
                </p>
                <p className="mt-1">
                  <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
                    {permission}
                  </code>
                </p>
              </>
            ) : (
              <p className="text-[length:var(--text-card)] font-medium text-ink">
                Une permission que votre rôle ne porte pas.
              </p>
            )}
            <p className="mt-3 text-[var(--text-body)] leading-relaxed text-ink-soft">
              Un super-administrateur peut modifier votre rôle. Il ne peut pas ajouter cette
              permission au vôtre : la matrice est fixée en base, et un déclencheur refuse les
              combinaisons que la spec interdit — le support n&apos;écrit pas dans la
              facturation, la facturation n&apos;ouvre pas les données client, et un analyste en
              lecture seule n&apos;écrit rien.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
