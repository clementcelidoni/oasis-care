import { Auteur } from "@/components/ia/affichage";
import { Badge, Panel, UnknownValue } from "@/components/ui";
import { roleLabel } from "@/lib/auth/roles";
import { LIBELLES_ACTION_JOURNAL, type LigneJournal } from "@/lib/ia/types";

/**
 * ==================================================================
 * LA TRACE — « voir qui l'a fait et quand »
 * ==================================================================
 *
 * Avant la migration 0080, ces changements ne laissaient AUCUNE trace :
 * ni déclencheur, ni ligne de journal, ni événement métier. Seules
 * `updated_at` et `updated_by` étaient écrasées, donc l'avant-dernier
 * état était perdu. Quelqu'un pouvait relever un plafond, le remettre,
 * et rien n'en gardait mémoire.
 *
 * Depuis 0080, chacune des quatre fonctions relève l'ancienne valeur
 * AVANT, écrit la nouvelle APRÈS, et rend l'identifiant de la ligne de
 * journal. La trace n'est pas un effet de bord : c'est la valeur de
 * retour, et si la journalisation échoue, l'écriture est annulée avec
 * elle. Dans une transaction, il n'existe pas d'état « changé mais non
 * tracé ».
 *
 * ------------------------------------------------------------------
 * TOUT LE MONDE NE LE LIT PAS, ET CE N'EST PAS UN OUBLI
 * ------------------------------------------------------------------
 * `admin_audit_events` exige `platform.audit.read` (0075), que seuls le
 * super-administrateur et le responsable sécurité portent. Le produit
 * et la facturation — ceux-là mêmes qui ÉCRIVENT ces lignes — ne les
 * relisent pas. C'est le principe : le journal des actions
 * administratives n'est pas relu par celui qui agit.
 *
 * `lignes === null` veut donc dire « fermé », et le composant le
 * distingue d'une liste vide. Une liste vide affirmerait qu'il ne s'est
 * rien passé.
 */
export function JournalIa({
  lignes,
  noms,
  titre = "Ce qui a été changé, par qui, et pourquoi",
}: {
  lignes: LigneJournal[] | null;
  noms: Map<string, string>;
  titre?: string;
}) {
  if (lignes === null) {
    return (
      <Panel title={titre}>
        <div className="px-4 py-4">
          <UnknownValue
            label="Journal fermé à votre rôle"
            reason="La lecture d'admin_audit_events exige platform.audit.read (migration 0075), que seuls le super-administrateur et le responsable sécurité portent. Ce n'est pas une liste vide : c'est une liste que vous ne voyez pas. Les changements que vous faites depuis cet écran y sont bien inscrits."
          />
        </div>
      </Panel>
    );
  }

  if (lignes.length === 0) {
    return (
      <Panel title={titre}>
        <div className="px-4 py-4 text-[var(--text-body)] leading-relaxed text-ink-soft">
          Aucun acte enregistré. Attention à ce que cela veut dire exactement : le journal ne
          contient que ce qui est passé par les fonctions de la migration 0080. Les réglages posés
          AVANT elle — depuis Oasis Care Pro, par un gestionnaire d&apos;entreprise cliente — n&apos;y
          figurent pas, et n&apos;y figureront jamais : rien ne les enregistrait.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={titre} count={lignes.length}>
      <ul className="divide-y divide-line">
        {lignes.map((ligne) => (
          <li key={ligne.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ligne.action.endsWith("Cleared") ? "warning" : "accent"}>
                {LIBELLES_ACTION_JOURNAL[ligne.action] ?? ligne.action}
              </Badge>
              {ligne.target_label !== null && (
                <span className="font-medium text-ink">{ligne.target_label}</span>
              )}
              <span className="text-[var(--text-secondary)] text-ink-faint">
                {roleLabel(ligne.admin_role)}
              </span>
            </div>

            <p className="mt-1 max-w-4xl text-[var(--text-body)] leading-relaxed text-ink-soft">
              {ligne.reason}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <Auteur
                identifiant={ligne.admin_user_id}
                quand={ligne.occurred_at}
                noms={noms}
              />
            </div>

            {/* L'avant et l'après en JSON brut : c'est ce que la base a
                enregistré, mot pour mot. Le reformater risquerait de
                faire dire à une trace autre chose que ce qu'elle dit —
                et une trace vaut par son exactitude, pas par sa mise en
                page. Repliés par défaut (spec p.35). */}
            {(ligne.old_value !== null || ligne.new_value !== null) && (
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[var(--text-secondary)] text-ink-faint">
                  Avant / après, tels qu&apos;enregistrés
                </summary>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  <pre className="overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-ink-soft">
                    {ligne.old_value === null
                      ? "avant : aucun (rien n'existait)"
                      : `avant : ${JSON.stringify(ligne.old_value)}`}
                  </pre>
                  <pre className="overflow-x-auto rounded bg-surface-sunken px-2 py-1.5 font-mono text-[11px] text-ink-soft">
                    {ligne.new_value === null
                      ? "après : aucun (retiré)"
                      : `après : ${JSON.stringify(ligne.new_value)}`}
                  </pre>
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
