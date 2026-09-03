import { Panel, SubmitButton } from "@/components/ui";
import { centsToInput } from "@/lib/quotes/types";
import type { Plafonds as PlafondsLus } from "@/lib/ai/admin/lecture";
import { enregistrerPlafondsIA } from "@/lib/ai/admin/actions";

/**
 * §11V — LES TROIS PLAFONDS (spec p. 19).
 *
 *     dailyOrganizationLimit · monthlyOrganizationLimit · agentLimit
 *
 * ══════════════════════════════════════════════════════════════════
 * VIDE, ZÉRO, ET LA DIFFÉRENCE ENTRE LES DEUX
 * ══════════════════════════════════════════════════════════════════
 *
 * C'est le seul formulaire du produit où le champ vide et le zéro
 * conduisent à des états opposés : vide retire le plafond, zéro coupe
 * l'IA. La migration 0076 l'a décidé — « NULL = pas de plafond, zéro =
 * IA coupée, un réglage légitime mais qui doit être écrit à la main par
 * quelqu'un » — et l'écran doit le dire avant qu'on tape, pas après.
 *
 * D'où l'indication sous chaque champ, et le message de confirmation
 * qui change de ton quand un zéro a été posé.
 *
 * ══════════════════════════════════════════════════════════════════
 * UN PLAFOND QUI NE PROTÈGE DE RIEN DOIT LE DIRE
 * ══════════════════════════════════════════════════════════════════
 *
 * Un plafond se compare à une dépense estimée ; sans grille tarifaire
 * renseignée, la dépense estimée vaut `null` pour chaque appel, la somme
 * reste à zéro, et le plafond ne se déclenche jamais. Le panneau porte
 * donc un avertissement quand c'est le cas — un plafond qu'on croit
 * actif est pire qu'un plafond absent.
 */
export function Plafonds({
  plafonds,
  tarifsManquants,
  peutModifier,
}: {
  plafonds: PlafondsLus;
  /** Les niveaux dont le tarif n'est pas renseigné. */
  tarifsManquants: readonly string[];
  peutModifier: boolean;
}) {
  return (
    <form action={enregistrerPlafondsIA}>
      <Panel
        title="Plafonds de dépense"
        description="Ils sont comparés à la dépense ESTIMÉE du jour et du mois, en heure de Paris — la même frontière que celle utilisée par la base."
        className="mb-6"
        footer={peutModifier ? <SubmitButton variant="secondary">Enregistrer</SubmitButton> : undefined}
      >
        <fieldset disabled={!peutModifier} className="grid gap-4 px-5 py-5 sm:grid-cols-3">
          <ChampPlafond
            nom="jour"
            label="Par jour, pour l'entreprise"
            cents={plafonds.jourCents}
          />
          <ChampPlafond
            nom="mois"
            label="Par mois, pour l'entreprise"
            cents={plafonds.moisCents}
          />
          <ChampPlafond
            nom="agent"
            label="Par mois et par agent"
            cents={plafonds.agentCents}
            aide="Le mois, et pas le jour : la Direction tourne une fois par matin sur le modèle le plus cher, et un brief un peu long lui ferait sauter un plafond quotidien alors que son mois est sage."
          />
        </fieldset>

        {tarifsManquants.length > 0 && (
          <p className="border-t border-line bg-warning-wash px-5 py-3.5 text-[var(--text-body)] text-warning">
            <span className="font-medium">
              Aucun tarif n&apos;est renseigné pour {tarifsManquants.join(", ")}.
            </span>{" "}
            Les appels de ces niveaux sont enregistrés SANS montant — jamais à zéro, mais sans
            montant — donc ils ne consomment aucun plafond. Un plafond posé ici ne les
            arrêtera pas. Renseignez les variables{" "}
            <code className="rounded bg-warning/10 px-1 py-0.5 text-[11px]">
              OASIS_AI_TARIF_&lt;NIVEAU&gt;_ENTREE|SORTIE_CENTS_PAR_MILLION
            </code>{" "}
            côté serveur.
          </p>
        )}

        <p className="border-t border-line px-5 py-3.5 text-[var(--text-secondary)] text-ink-soft">
          Un champ <strong>vide</strong> retire le plafond : la dépense n&apos;est plus limitée.
          Un <strong>zéro</strong> est un plafond à zéro, c&apos;est-à-dire une IA coupée pour
          cette entreprise — c&apos;est un réglage valide, et il ne s&apos;obtient qu&apos;en
          écrivant 0. Une saisie que le formulaire ne comprend pas n&apos;enregistre rien du
          tout, ni sur ce champ ni sur les deux autres.
          {plafonds.modifieLe &&
            ` Dernière modification le ${new Date(plafonds.modifieLe).toLocaleDateString("fr-FR")}.`}
        </p>
      </Panel>
    </form>
  );
}

function ChampPlafond({
  nom,
  label,
  cents,
  aide,
}: {
  nom: string;
  label: string;
  cents: number | null;
  aide?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[var(--text-secondary)] font-medium text-ink-soft">{label}</span>
      <div className="flex items-center gap-2">
        {/* `type="text"` et non `type="number"` : un champ numérique
            refuse la virgule dans certains navigateurs français, et
            surtout il avale silencieusement une saisie qu'il juge
            invalide — c'est-à-dire qu'il produit exactement le zéro
            fantôme que `lireMontantEuros` existe pour empêcher. */}
        <input
          type="text"
          inputMode="decimal"
          name={nom}
          defaultValue={centsToInput(cents)}
          placeholder="aucun plafond"
          className="w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 py-2 text-[var(--text-body)] tabular outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <span className="shrink-0 text-[var(--text-body)] text-ink-faint">€</span>
      </div>
      {/* Un plafond à ZÉRO se nomme, et il se nomme en teinte d'alerte.
          Tout ce fichier existe pour que le vide et le zéro ne se
          confondent pas ; les ranger tous les deux sous « plafond en
          vigueur » aurait remis la confusion à l'endroit exact où on
          l'avait chassée. Un état posé en septembre et relu en mars doit
          se lire sans revenir au formulaire qui l'a écrit. */}
      <span
        className={`text-[var(--text-secondary)] ${cents === 0 ? "text-critical" : "text-ink-faint"}`}
      >
        {cents === null
          ? "Aucun plafond aujourd'hui."
          : cents === 0
            ? "Plafond à zéro : les appels concernés sont refusés."
            : aide
              ? ""
              : "Plafond en vigueur."}
        {aide ? ` ${aide}` : ""}
      </span>
    </label>
  );
}
