import type { Metadata } from "next";

import { Badge, Card, EmptyState, Notice, PageHeader, Panel } from "@/components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { lireMatriceRoles, type MatriceRoles } from "@/lib/auth/equipe";
import { PERMISSION_FAMILIES, PLATFORM_ROLES, ROLE_LABELS, ROLE_SCOPE } from "@/lib/auth/roles";

import { OngletsParametres } from "../onglets";

/**
 * ==================================================================
 * PARAMÈTRES → RÔLES ET PERMISSIONS (spec p.30, moindre privilège)
 * ==================================================================
 *
 * « Support : ne peut pas modifier les abonnements. Billing : ne peut
 * pas ouvrir les données client. Product : ne peut pas modifier les
 * paiements. »
 *
 * ------------------------------------------------------------------
 * CET ÉCRAN LIT LA BASE, IL NE RECOPIE PAS `lib/auth/roles.ts`
 * ------------------------------------------------------------------
 * Et c'est tout son intérêt. La matrice qui fait autorité est
 * `platform_admin_role_permissions`, protégée par un déclencheur qui
 * refuse littéralement d'y insérer une ligne interdite. Recopier la
 * matrice en TypeScript aurait produit un écran qui dit ce qu'on croit
 * plutôt que ce qui est — c'est-à-dire exactement l'écran qu'il ne faut
 * pas.
 *
 * LE PIÈGE DE SEMIS SE VOIT ICI, ET NULLE PART AILLEURS. Les permissions
 * du super-administrateur ont été semées PAR JOINTURE au moment où 0075
 * s'exécutait : une clé ajoutée après coup n'est portée par PERSONNE
 * tant qu'une migration ne rejoue pas la jointure. L'écran correspondant
 * disparaît alors du menu sans la moindre erreur — le pire mode de
 * défaillance qui soit, parce qu'il ressemble à un fonctionnement
 * normal. Une permission cochée pour zéro rôle est donc SIGNALÉE ici,
 * en toutes lettres.
 *
 * ------------------------------------------------------------------
 * CET ÉCRAN NE MODIFIE RIEN, ET N'EN AURA PAS LE DROIT
 * ------------------------------------------------------------------
 * La matrice est une décision de conception, pas un réglage
 * d'exploitation : la spec p.30 la fixe, et deux migrations l'écrivent
 * en double — par l'absence de la ligne, et par le refus du déclencheur.
 * Un formulaire qui permettrait de cocher une case ici contournerait la
 * moitié du dispositif, ou serait refusé par l'autre moitié. On la
 * montre, on ne la touche pas.
 */

export const metadata: Metadata = {
  title: "Rôles et permissions — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

function Matrice({ matrice }: { matrice: MatriceRoles }) {
  const porte = (role: string, permission: string) =>
    (matrice.parRole[role] ?? []).includes(permission);

  // Les rôles de la base d'abord, dans l'ordre canonique, puis ceux que
  // cette interface ne connaît pas — il peut y en avoir avant qu'elle
  // soit mise à jour, et les cacher reviendrait à montrer une matrice
  // incomplète en la présentant comme complète.
  const connus: string[] = [...PLATFORM_ROLES];
  const inconnus = Object.keys(matrice.parRole).filter((role) => !connus.includes(role));
  const roles = [...connus, ...inconnus];

  const orphelines = matrice.permissions.filter(
    (permission) => !roles.some((role) => porte(role, permission.key)),
  );

  const familles = PERMISSION_FAMILIES.map((famille) => ({
    ...famille,
    permissions: matrice.permissions.filter((permission) =>
      permission.key.startsWith(famille.prefix),
    ),
  })).filter((famille) => famille.permissions.length > 0);

  const horsFamille = matrice.permissions.filter(
    (permission) => !PERMISSION_FAMILIES.some((f) => permission.key.startsWith(f.prefix)),
  );

  return (
    <>
      {orphelines.length > 0 && (
        <Notice tone="critical" title="Des permissions ne sont portées par AUCUN rôle">
          <p>
            {orphelines.length === 1
              ? "Une permission existe au catalogue"
              : `${orphelines.length} permissions existent au catalogue`}{" "}
            sans être accordée à qui que ce soit — pas même au super-administrateur. C&apos;est la
            signature exacte du piège de semis : une migration a inséré la clé sans rejouer la
            jointure qui la donne au super-administrateur. Les écrans qui en dépendent sont
            invisibles pour tout le monde, et rien ne lève d&apos;erreur.
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {orphelines.map((permission) => (
              <li key={permission.key}>
                <Badge tone="critical">{permission.key}</Badge>
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[var(--text-body)]">
            <thead>
              <tr className="border-b border-line bg-surface-sunken">
                <th scope="col" className="eyebrow px-3 py-2 text-left">
                  Permission
                </th>
                {roles.map((role) => (
                  <th key={role} scope="col" className="eyebrow px-3 py-2 text-center">
                    {ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ...familles,
                ...(horsFamille.length > 0
                  ? [
                      {
                        prefix: "",
                        label: "Hors des familles connues de cette interface",
                        note: "La base porte des préfixes que cette interface ne décrit pas encore.",
                        permissions: horsFamille,
                      },
                    ]
                  : []),
              ].map((famille) => (
                <FamilleRows
                  key={famille.label}
                  label={famille.label}
                  note={famille.note}
                  permissions={famille.permissions}
                  roles={roles}
                  porte={porte}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function FamilleRows({
  label,
  note,
  permissions,
  roles,
  porte,
}: {
  label: string;
  note: string;
  permissions: MatriceRoles["permissions"];
  roles: string[];
  porte: (role: string, permission: string) => boolean;
}) {
  return (
    <>
      <tr className="border-b border-line bg-surface-sunken/60">
        <td colSpan={roles.length + 1} className="px-3 py-2">
          <p className="text-[var(--text-secondary)] font-semibold text-ink">{label}</p>
          <p className="mt-0.5 max-w-4xl text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            {note}
          </p>
        </td>
      </tr>
      {permissions.map((permission) => (
        <tr key={permission.key} className="border-b border-line last:border-0">
          <td className="px-3 py-2 align-top">
            <p className="text-[var(--text-body)] text-ink">
              {permission.label}
              {permission.isWrite && (
                <span className="ml-2">
                  <Badge tone="warning">écriture</Badge>
                </span>
              )}
            </p>
            <code className="mt-0.5 block font-mono text-[11px] text-ink-faint">
              {permission.key}
            </code>
          </td>
          {roles.map((role) => (
            <td key={role} className="px-3 py-2 text-center align-top">
              {porte(role, permission.key) ? (
                <span
                  className={permission.isWrite ? "text-warning" : "text-positive"}
                  title={`${role} porte ${permission.key}`}
                >
                  ●
                </span>
              ) : (
                <span className="text-ink-faint/40" aria-label="non accordée">
                  ·
                </span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default async function RolesPage() {
  // Aucune permission exigée : tout administrateur de plateforme lit la
  // matrice (c'est la politique de 0075 sur les deux tables), et savoir
  // ce que sa propre casquette ouvre n'est pas un privilège.
  await requireAdmin();
  const matrice = await lireMatriceRoles();

  return (
    <>
      <PageHeader
        eyebrow="Paramètres"
        title="Rôles et permissions"
        subtitle="Le moindre privilège de la spec p.30, tel qu'il est écrit EN BASE. Cette page ne modifie rien : la matrice est une décision de conception, protégée par un déclencheur qui refuse d'y insérer une ligne interdite."
      />

      <OngletsParametres courant="/parametres/roles" />

      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PLATFORM_ROLES.map((role) => (
          <div
            key={role}
            className="rounded-[var(--radius-card)] border border-line bg-surface p-4"
          >
            <p className="text-[length:var(--text-card)] font-semibold">{ROLE_LABELS[role]}</p>
            <p className="mt-1 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              {ROLE_SCOPE[role]}
            </p>
          </div>
        ))}
      </div>

      {matrice.etat === "ok" ? (
        <Matrice matrice={matrice.valeur} />
      ) : (
        <Panel title="La matrice n'a pas pu être lue">
          <div className="px-4 py-4">
            <EmptyState
              tone={matrice.etat === "panne" ? "neutral" : "unknown"}
              title={
                matrice.etat === "absent"
                  ? "Les tables de la matrice sont absentes"
                  : matrice.etat === "refus"
                    ? "La base a refusé cette lecture"
                    : "La lecture a échoué"
              }
              description={matrice.message}
            />
          </div>
        </Panel>
      )}
    </>
  );
}
