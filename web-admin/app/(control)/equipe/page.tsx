import type { Metadata } from "next";

import {
  Badge,
  ButtonLink,
  EmptyState,
  MetricCard,
  Notice,
  PageHeader,
  Panel,
} from "@/components/ui";
import { can, requireAdmin } from "@/lib/auth/guard";
import { lireEquipe, lireInvitations, type Invitation, type MembreEquipe } from "@/lib/auth/equipe";

import { FormulaireInvitation, FormulaireNomination, ListeInvitations } from "./formulaires";
import { TableEquipe } from "./table-equipe";

/**
 * ==================================================================
 * ÉQUIPE OASIS CARE — spec p.6 (SECURITY → « Admins »), p.30, p.32
 * ==================================================================
 *
 * « Les utilisateurs Admin Oasis Care doivent eux-mêmes avoir des
 * rôles » (p.30), et « créer une séparation forte entre normal user et
 * platform admin » (p.32).
 *
 * ------------------------------------------------------------------
 * CE QUE CET ÉCRAN A REFERMÉ EN ARRIVANT
 * ------------------------------------------------------------------
 * Jusqu'à la migration 0081, la permission `platform.admins.manage` —
 * celle qui permet de CRÉER ET DE RÉVOQUER DES ADMINISTRATEURS — pouvait
 * être accordée à n'importe quel rôle : le garde-fou de la matrice ne
 * connaissait que les préfixes `billing.`, `customer.` et `ai.`, et
 * laissait donc passer `platform.%` pour tout le monde. Sondé sur la
 * vraie fonction en transaction annulée : ('support',
 * 'platform.admins.manage') était ACCEPTÉ. 0081 l'a réservée au seul
 * super-administrateur, et le garde-fou refuse maintenant de l'insérer
 * pour un autre rôle.
 *
 * C'est exactement la permission qui commande cet écran. Il n'y a donc
 * qu'un rôle capable d'y écrire, et les autres — le responsable sécurité
 * en tête — le LISENT : surveiller et faire ne sont pas le même rôle.
 *
 * ------------------------------------------------------------------
 * LA LISTE MONTRE LE SECOND FACTEUR, ET CE N'EST PAS DÉCORATIF
 * ------------------------------------------------------------------
 * Sans cette colonne, on bascule l'exigence de second facteur à
 * l'aveugle. Avec elle, on sait combien de personnes on va arrêter
 * demain matin. Le compte vient d'`auth.mfa_factors`, jamais d'un
 * cookie : c'est la seule mesure qui ne puisse pas être périmée.
 */

export const metadata: Metadata = {
  title: "Équipe Oasis Care — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

function EchecLecture({
  etat,
  message,
}: {
  etat: "absent" | "refus" | "panne";
  message: string;
}) {
  return (
    <EmptyState
      tone={etat === "panne" ? "neutral" : "unknown"}
      title={
        etat === "absent"
          ? "Cette lecture n'existe pas encore dans la base"
          : etat === "refus"
            ? "La base a refusé cette lecture"
            : "La lecture a échoué"
      }
      description={
        etat === "refus"
          ? `Ce refus ne devrait pas arriver jusqu'ici — la garde de la page l'aurait déjà détourné : il signale que la garde et la barrière SQL ne sont pas d'accord entre elles. Le message de la base : ${message}`
          : message
      }
    />
  );
}

export default async function EquipePage() {
  // La LECTURE de la liste. Nommer, changer de rôle et révoquer exigent
  // `platform.admins.manage` — vérifiée séparément, plus bas, et une
  // troisième fois par chaque fonction SQL.
  const admin = await requireAdmin("platform.admins.read");
  const peutGerer = can(admin, "platform.admins.manage");

  const [equipe, invitations] = await Promise.all([lireEquipe(), lireInvitations()]);

  const membres: MembreEquipe[] = equipe.etat === "ok" ? equipe.valeur : [];
  const actifs = membres.filter((membre) => membre.isActive);
  const sansFacteur = actifs.filter((membre) => !membre.hasVerifiedMfa);
  const superAdmins = actifs.filter((membre) => membre.role === "super_admin");

  const listeInvitations: Invitation[] = invitations.etat === "ok" ? invitations.valeur : [];
  const enAttente = listeInvitations.filter((invitation) => invitation.etat === "enAttente");

  return (
    <>
      <PageHeader
        eyebrow="Paramètres"
        title="Équipe Oasis Care"
        subtitle="Qui administre la plateforme, avec quel rôle, depuis quand, et qui est protégé par un second facteur. Un propriétaire d'entreprise Pro n'est PAS un administrateur Oasis Care (spec p.32) : cette liste et celle des utilisateurs n'ont aucun chemin de l'une vers l'autre."
        action={
          peutGerer ? undefined : <Badge tone="unknown">Lecture seule pour votre rôle</Badge>
        }
      />

      {equipe.etat === "ok" && superAdmins.length === 1 && (
        <Notice tone="warning" title="Un seul super-administrateur actif">
          C&apos;est un point de défaillance unique : lui seul peut nommer ou révoquer un
          administrateur, et la base refuse de le révoquer ou de le rétrograder tant qu&apos;il
          est seul — c&apos;est la protection, pas le problème. Le problème serait qu&apos;il
          perde l&apos;accès à son compte. Nommez un second super-administrateur.
        </Notice>
      )}

      {equipe.etat === "ok" && superAdmins.length === 0 && actifs.length > 0 && (
        <Notice tone="critical" title="Aucun super-administrateur actif">
          Plus personne ne peut nommer ni révoquer d&apos;administrateur :{" "}
          <code className="font-mono text-[11px]">platform.admins.manage</code> n&apos;appartient
          qu&apos;à ce rôle. La réparation passe par l&apos;éditeur SQL du projet Supabase.
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Administrateurs actifs"
          value={equipe.etat === "ok" ? String(actifs.length) : null}
          unknownReason={equipe.etat === "ok" ? undefined : equipe.message}
          size="small"
        />
        <MetricCard
          label="Super-administrateurs"
          value={equipe.etat === "ok" ? String(superAdmins.length) : null}
          unknownReason={equipe.etat === "ok" ? undefined : equipe.message}
          tone={equipe.etat === "ok" && superAdmins.length < 2 ? "warning" : "neutral"}
          hint="Les seuls à pouvoir nommer un administrateur."
          size="small"
        />
        <MetricCard
          label="Sans second facteur"
          value={equipe.etat === "ok" ? String(sansFacteur.length) : null}
          unknownReason={equipe.etat === "ok" ? undefined : equipe.message}
          tone={equipe.etat === "ok" && sansFacteur.length > 0 ? "critical" : "positive"}
          hint="Comptés dans auth.mfa_factors, pas dans un cookie."
          href="/parametres/securite"
          size="small"
        />
        <MetricCard
          label="Invitations en attente"
          value={invitations.etat === "ok" ? String(enAttente.length) : null}
          unknownReason={invitations.etat === "ok" ? undefined : invitations.message}
          hint="Elles expirent : une invitation sans fin est une porte entrouverte."
          size="small"
        />
      </div>

      {/* ---- La liste ------------------------------------------------ */}
      <div className="mt-5">
        <Panel
          title="Administrateurs de plateforme"
          description={
            peutGerer
              ? "« Gérer » ouvre le changement de rôle et la révocation. Chaque geste exige un motif, et la trace est écrite dans la même transaction que l'acte."
              : "Votre rôle lit cette liste sans pouvoir la modifier : depuis 0081, nommer et révoquer un administrateur n'appartient qu'au super-administrateur."
          }
          count={equipe.etat === "ok" ? membres.length : undefined}
        >
          {equipe.etat !== "ok" ? (
            <div className="px-4 py-4">
              <EchecLecture etat={equipe.etat} message={equipe.message} />
            </div>
          ) : membres.length === 0 ? (
            <div className="px-4 py-4">
              <EmptyState
                tone="unknown"
                title="Aucun administrateur de plateforme"
                description="Ce résultat est impossible depuis un compte administrateur — vous en êtes un, vous devriez figurer dans cette liste. Si elle est vide, c'est que la lecture n'a pas rendu ce qu'elle aurait dû."
              />
            </div>
          ) : (
            <TableEquipe membres={membres} peutGerer={peutGerer} moi={admin.userId} />
          )}
        </Panel>
      </div>

      {/* ---- Les invitations ----------------------------------------- */}
      <div className="mt-5">
        <Panel
          title="Invitations"
          description="Une intention enregistrée : cette adresse, ce rôle, ce motif, jusqu'à cette date. Elle devient un vrai rôle à la première connexion de la personne."
          count={invitations.etat === "ok" ? listeInvitations.length : undefined}
        >
          {invitations.etat !== "ok" ? (
            <div className="px-4 py-4">
              <EchecLecture etat={invitations.etat} message={invitations.message} />
            </div>
          ) : listeInvitations.length === 0 ? (
            <div className="px-4 py-4">
              <EmptyState
                title="Aucune invitation"
                description="Personne n'a été invité à rejoindre l'équipe Oasis Care. Ce zéro est vrai : la table existe et elle est vide."
              />
            </div>
          ) : (
            <ListeInvitations invitations={listeInvitations} peutGerer={peutGerer} />
          )}
        </Panel>
      </div>

      {/* ---- Ajouter ------------------------------------------------- */}
      {peutGerer && (
        <>
          <div className="mt-5">
            <Panel title="Inviter un nouveau salarié">
              <FormulaireInvitation />
            </Panel>
          </div>

          <div className="mt-5">
            <Panel title="Nommer quelqu'un qui a déjà un compte">
              <FormulaireNomination />
            </Panel>
          </div>
        </>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href="/parametres/roles" variant="secondary">
          Ce que chaque rôle ouvre
        </ButtonLink>
        <ButtonLink href="/parametres/securite" variant="secondary">
          Politique de second facteur
        </ButtonLink>
      </div>
    </>
  );
}
