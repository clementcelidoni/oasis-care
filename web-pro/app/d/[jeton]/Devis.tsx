import { Badge } from "@/components/ui";
import { formatDate } from "@/lib/crm/types";
import { formatCents, formatQuantity } from "@/lib/quotes/types";
import {
  clientQuoteTotals,
  CLIENT_QUOTE_STATUS_LABELS,
  CLIENT_QUOTE_STATUS_TONE,
  type ClientQuoteLine,
  type ClientQuoteSection,
} from "@/lib/portal/types";
import { Impression } from "../Impression";
import type { DevisPublic, EntreprisePublique } from "../lecture";

/**
 * LE DEVIS, TEL QUE SON DESTINATAIRE LE VOIT SANS COMPTE.
 *
 * ══════════════════════════════════════════════════════════════════
 * C'EST LA PAGE D'UN DOCUMENT, PAS UNE PAGE DU LOGICIEL
 * ══════════════════════════════════════════════════════════════════
 *
 * Ni barre de navigation, ni menu, ni lien de retour, ni invitation à
 * créer un compte. La personne devant cet écran n'est pas un
 * utilisateur du produit et ne le deviendra pas : le dirigeant a
 * tranché, le client du paysagiste ne s'inscrit pas. Tout ce qui
 * ressemblerait à une entrée dans l'application serait au mieux inutile,
 * au pire un mur de connexion présenté à quelqu'un qui n'a pas de clé.
 *
 * ══════════════════════════════════════════════════════════════════
 * LES TOTAUX SONT RECALCULÉS, ET IL FAUT SAVOIR POURQUOI
 * ══════════════════════════════════════════════════════════════════
 *
 * `quote_totals` porte `total_cost_cents` et `margin_percent` dans les
 * mêmes lignes que le total à payer : l'ouvrir au client reviendrait à
 * lui montrer la marge de son paysagiste pour lui épargner une addition.
 * `clientQuoteTotals` refait donc le calcul à partir des seules colonnes
 * que la porte anonyme laisse passer — les mêmes que le portail — en
 * suivant la formule de la vue au détail près : regroupement par taux,
 * remise globale au prorata sur chaque tranche, TVA tranche par tranche.
 *
 * L'ordre n'est pas décoratif : une TVA appliquée au total, à un taux
 * moyen, donne un centime d'écart dès qu'un devis mélange 20 % et 10 %.
 * Et un client qui lit un montant différent de celui du PDF appelle son
 * artisan.
 *
 * ══════════════════════════════════════════════════════════════════
 * CE QUI MANQUE ICI, ET QUI EST UNE DÉCISION DE LA MIGRATION
 * ══════════════════════════════════════════════════════════════════
 *
 * L'en-tête est PLUS PAUVRE que celui du portail : `devis_par_jeton`
 * (0089 § 8.d) ne rend de l'entreprise que trois colonnes — identifiant,
 * nom, type d'activité. Ni SIRET, ni adresse, ni assurance décennale.
 * Cette page ne peut donc pas tenir lieu de devis papier, et l'adresse
 * où renvoyer un accord signé n'y figure pas. C'est assumé : élargir la
 * porte est une décision de la base, pas d'un composant d'affichage. On
 * ne la prend pas ici, on la signale.
 */
export function Devis({
  entreprise,
  devis,
  sections,
  lignes,
}: {
  entreprise: EntreprisePublique;
  devis: DevisPublic;
  sections: ClientQuoteSection[];
  lignes: ClientQuoteLine[];
}) {
  const totaux = clientQuoteTotals(lignes, devis.global_discount_percent);
  const avantRemiseGlobale = lignes.reduce((somme, l) => somme + l.sale_total_cents, 0);
  const sansSection = lignes.filter((l) => l.section_id === null);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 print:max-w-none print:px-0 print:py-0">
      <Impression />

      <header className="mb-8 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-lg font-semibold tracking-tight">{entreprise.name}</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            Ce devis vous est adressé par cette entreprise.
          </p>
        </div>
        <div className="text-right">
          <h1 className="text-2xl font-semibold tracking-tight">Devis</h1>
          <p className="tabular mt-1 text-sm">{devis.number}</p>
          {devis.issued_on && (
            <p className="mt-1 text-sm text-ink-soft">Émis le {formatDate(devis.issued_on)}</p>
          )}
          {devis.valid_until && (
            <p className="text-sm text-ink-soft">
              Valable jusqu&apos;au {formatDate(devis.valid_until)}
            </p>
          )}
          <div className="mt-2 flex justify-end print:hidden">
            <Badge tone={CLIENT_QUOTE_STATUS_TONE[devis.status] ?? "neutral"}>
              {CLIENT_QUOTE_STATUS_LABELS[devis.status] ?? devis.status}
            </Badge>
          </div>
        </div>
      </header>

      {devis.title && <h2 className="mb-3 text-lg font-medium">{devis.title}</h2>}
      {devis.introduction && (
        <p className="mb-6 whitespace-pre-line text-sm leading-relaxed">{devis.introduction}</p>
      )}

      {sansSection.length > 0 && <Tableau titre={null} lignes={sansSection} />}
      {sections.map((section) => {
        const lignesDeSection = lignes.filter((l) => l.section_id === section.id);
        if (lignesDeSection.length === 0) return null;
        return <Tableau key={section.id} titre={section.title} lignes={lignesDeSection} />;
      })}

      <section className="mt-6 flex justify-end">
        <table className="min-w-72 text-sm">
          <tbody>
            {devis.global_discount_percent > 0 && (
              <tr>
                <td className="py-1 pr-6 text-ink-soft">
                  Remise commerciale {devis.global_discount_percent} %
                </td>
                <td className="tabular py-1 text-right">
                  −{formatCents(avantRemiseGlobale - totaux.totalExcludingVatCents)}
                </td>
              </tr>
            )}
            <tr className="border-t border-line">
              <td className="py-1.5 pr-6 font-medium">Total HT</td>
              <td className="tabular py-1.5 text-right font-medium">
                {formatCents(totaux.totalExcludingVatCents)}
              </td>
            </tr>
            {totaux.byRate.map((tranche) => (
              <tr key={tranche.rate}>
                <td className="py-1 pr-6 text-ink-soft">
                  TVA {tranche.rate} % sur {formatCents(tranche.baseCents)}
                </td>
                <td className="tabular py-1 text-right text-ink-soft">
                  {formatCents(tranche.vatCents)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-line-strong">
              <td className="py-2 pr-6 text-base font-semibold">Total TTC</td>
              <td className="tabular py-2 text-right text-base font-semibold">
                {formatCents(totaux.totalIncludingVatCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {devis.terms && (
        <section className="mt-8 border-t border-line pt-4">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Conditions
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-soft">
            {devis.terms}
          </p>
        </section>
      )}

      {/*
        ACCEPTER UN DEVIS NE SE FAIT PAS DEPUIS CETTE PAGE, ET LE DIRE
        FAIT PARTIE DU TRAVAIL.

        Un bouton « J'accepte » ici serait la faute la plus coûteuse de
        tout le chantier. Le jeton de cette page N'AUTHENTIFIE PERSONNE :
        il prouve seulement que quelqu'un détient un lien — lien qui se
        transfère, se recopie dans un fil de messages, s'ouvre depuis un
        téléphone prêté. Attacher un engagement contractuel à cette
        preuve-là reviendrait à faire signer le premier venu, et le
        paysagiste croirait tenir un accord.

        0089 § 8 dit la même chose côté base : « un jeton qui laisse
        accepter le devis est une décision distincte », et elle n'a pas
        été prise.
      */}
      <section className="mt-8 rounded-lg border border-line bg-canvas px-4 py-3 print:hidden">
        <p className="text-sm font-medium">Pour accepter ce devis</p>
        <p className="mt-1 text-sm text-ink-soft">
          Imprimez-le, portez la mention « Bon pour accord » suivie de la date et de votre
          signature, puis renvoyez-le à {entreprise.name} — en répondant simplement au
          message qui vous a transmis ce lien. Un devis accepté doit rester un document
          signé : ce lien ne permet que de le lire.
        </p>
      </section>

      {/* Le cartouche de signature, uniquement à l'impression. */}
      <section className="mt-10 hidden justify-between gap-10 text-sm print:flex">
        <div>
          <p className="text-ink-soft">Date et signature du client</p>
          <p className="mt-1 text-xs text-ink-faint">
            Précédées de la mention « Bon pour accord »
          </p>
          <div className="mt-2 h-24 w-64 rounded border border-line" />
        </div>
      </section>
    </main>
  );
}

function Tableau({ titre, lignes }: { titre: string | null; lignes: ClientQuoteLine[] }) {
  const sousTotal = lignes.reduce((somme, l) => somme + l.sale_total_cents, 0);

  return (
    <section className="mb-5 break-inside-avoid">
      {titre && <h3 className="mb-1 text-sm font-semibold">{titre}</h3>}
      {/* Une table de devis déborde sur un téléphone : elle défile dans
          son propre cadre plutôt que de faire défiler la page entière. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
              <th className="py-1 pr-2 font-medium">Désignation</th>
              <th className="w-20 px-2 py-1 text-right font-medium">Qté</th>
              <th className="w-14 px-2 py-1 font-medium">Unité</th>
              <th className="w-24 px-2 py-1 text-right font-medium">P.U. HT</th>
              <th className="w-14 px-2 py-1 text-right font-medium">TVA</th>
              <th className="w-28 py-1 pl-2 text-right font-medium">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((ligne) => (
              <tr key={ligne.id} className="border-b border-line last:border-0">
                <td className="py-1.5 pr-2">
                  {ligne.description}
                  {ligne.discount_percent > 0 && (
                    <span className="ml-1 text-xs text-ink-faint">
                      (remise {ligne.discount_percent} %)
                    </span>
                  )}
                </td>
                <td className="tabular px-2 py-1.5 text-right">
                  {formatQuantity(ligne.quantity)}
                </td>
                <td className="px-2 py-1.5 text-ink-soft">{ligne.unit}</td>
                <td className="tabular px-2 py-1.5 text-right">
                  {formatCents(ligne.unit_sale_price_cents)}
                </td>
                <td className="tabular px-2 py-1.5 text-right text-ink-soft">
                  {ligne.vat_rate} %
                </td>
                <td className="tabular py-1.5 pl-2 text-right">
                  {formatCents(ligne.sale_total_cents)}
                </td>
              </tr>
            ))}
          </tbody>
          {titre && lignes.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={5} className="py-1 pr-2 text-right text-xs text-ink-soft">
                  Sous-total {titre.toLowerCase()}
                </td>
                <td className="tabular py-1 pl-2 text-right text-xs font-medium">
                  {formatCents(sousTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
