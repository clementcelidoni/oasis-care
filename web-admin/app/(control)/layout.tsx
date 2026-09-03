import { requireAdmin } from "@/lib/auth/guard";
import { signOut } from "@/lib/auth/session";
import { mfaNotice } from "@/lib/auth/mfa";
import { roleLabel, ROLE_DESCRIPTIONS, isPlatformRole } from "@/lib/auth/roles";
import { visibleNavigation, SEARCH_PERMISSION } from "@/lib/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";

/**
 * ==================================================================
 * LA COQUILLE — et la porte qu'elle referme
 * ==================================================================
 *
 * `requireAdmin()` en PREMIÈRE instruction. C'est ici que se joue la
 * séparation forte de la spec p.32 : être connecté ne suffit pas, il
 * faut une ligne active dans `platform_admins`.
 *
 * ------------------------------------------------------------------
 * POURQUOI LA GARDE EST AUSSI DANS CHAQUE PAGE
 * ------------------------------------------------------------------
 * Ce layout protège ce qu'il ENVELOPPE. Il ne protège pas une Server
 * Action, qui s'exécute sans passer par lui ; il ne protège pas une
 * route handler ; et il cesserait de protéger le jour où quelqu'un
 * déplace une page hors du groupe `(control)` — un dossier renommé
 * suffit, et rien ne le signalerait.
 *
 * Chaque page appelle donc `requireAdmin(permission)` pour son propre
 * compte. Ce n'est pas redondant : `cache()` de React déduplique
 * l'aller-retour vers la base à l'intérieur d'un même rendu, donc la
 * seconde vérification est gratuite. Et derrière encore, chaque
 * fonction de la migration 0075 recommence le contrôle en SQL.
 *
 * Trois barrières, dont aucune ne suppose que les autres ont fait leur
 * travail. C'est ce que l'audit a retenu des incidents 0057 et 0062 :
 * les deux fois, une seule vérification avait paru suffire.
 */
export default async function ControlLayout({ children }: LayoutProps<"/">) {
  const admin = await requireAdmin();

  // La barre latérale ne reçoit QUE ce que ce rôle peut ouvrir. Le
  // filtrage se fait ici, côté serveur : la liste complète des écrans
  // ne part pas dans le navigateur d'un rôle qui n'y a pas droit.
  //
  // Masquer n'est pas protéger — chaque page revérifie. Mais proposer
  // une porte fermée n'est pas non plus une information utile.
  const groups = visibleNavigation(admin.permissions);
  const notice = mfaNotice(admin.mfa);

  return (
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* Sans ce lien, atteindre le contenu au clavier demande de
          traverser toute la navigation, à chaque page. */}
      <a href="#contenu" className="skip-link">
        Aller au contenu
      </a>

      <Sidebar
        groups={groups}
        roleLabel={roleLabel(admin.role)}
        roleDescription={
          isPlatformRole(admin.role)
            ? ROLE_DESCRIPTIONS[admin.role]
            : "Rôle inconnu de cette interface — la base fait foi."
        }
        email={admin.email}
        mfaWarning={notice?.message ?? null}
        signOut={signOut}
      />

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <Header canSearch={admin.permissions.includes(SEARCH_PERMISSION)} />

        <main
          id="contenu"
          className="flex-1 overflow-y-auto px-6 py-6 print:overflow-visible"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
