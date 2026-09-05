import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ReadFailure } from "@/components/customers/read-failure";
import {
  Badge,
  ButtonLink,
  Card,
  Notice,
  PageHeader,
  Panel,
  StatusBadge,
  UnknownValue,
} from "@/components/ui";
import { EcranCommercialFerme } from "@/lib/billing/ecran-ferme";
import {
  EXPLICATIONS_STATUT_FACTURE,
  LIBELLES_MOYEN,
  LIBELLES_MOYEN_ENCAISSEMENT,
  LIBELLES_NATURE_LIGNE,
  LIBELLES_REGIME_TVA,
  LIBELLES_STATUT_FACTURE,
  MENTIONS_REGIME,
  TONS_STATUT_FACTURE,
} from "@/lib/billing/facture";
import { peut, requireCommercial } from "@/lib/billing/guard";
import { diagnostiquerSocleCommercial } from "@/lib/billing/socle";
import {
  LIBELLES_CHAMPS_EMETTEUR,
  lireChampsManquantsEmetteur,
  lireFacture,
  lireLignesCalculees,
  trouverEntreprise,
} from "@/lib/billing/source";
import { formatCents, formatDate, formatDateTime } from "@/lib/format";

import { ActionsFacture } from "./actions-facture";

/**
 * ==================================================================
 * LA FICHE D'UNE FACTURE SaaS
 * ==================================================================
 *
 * ------------------------------------------------------------------
 * LE TOTAL VIENT DE LA BASE, ET SEULEMENT D'ELLE
 * ------------------------------------------------------------------
 * `saas_invoice_totals` groupe la TVA PAR TAUX avant d'arrondir. Le
 * correctif 0064 en donne la raison chiffrée : quarante lignes à 1,67 €
 * font 13,20 € de TVA arrondie ligne à ligne et 13,36 € par taux. Ce ne
 * sont pas seize centimes qui sont graves, c'est qu'un document affiche
 * alors une ventilation au-dessus d'un total calculé autrement : la
 * facture ne fait plus son propre total.
 *
 * Cette page n'additionne donc RIEN. Elle affiche ce que la vue rend, y
 * compris son `null` quand un taux manque.
 *
 * ------------------------------------------------------------------
 * LES MENTIONS SONT FIGÉES, ET C'EST LE POINT
 * ------------------------------------------------------------------
 * Nom, SIRET, adresse, IBAN : tout est RECOPIÉ sur le document au
 * moment de l'émission, pas joint à la lecture. Un client qui déménage,
 * un émetteur qui change de RIB, une entreprise renommée — et une
 * facture reconstituée par jointure afficherait rétroactivement des
 * mentions que le client n'a jamais reçues.
 *
 * D'où l'ordre d'affichage : sur une facture ÉMISE, on montre les
 * champs figés. Sur un brouillon, ils sont vides, et on le dit.
 */

export const metadata: Metadata = {
  title: "Facture SaaS — Oasis Care Control Center",
};

export const dynamic = "force-dynamic";

export default async function FicheFacturePage({
  params,
}: PageProps<"/abonnements/factures/[invoiceId]">) {
  const { invoiceId } = await params;

  const admin = await requireCommercial("billing.invoices.read");
  const socle = await diagnostiquerSocleCommercial(admin.permissions, "billing.invoices.read");

  if (socle.etat !== "ok") {
    return (
      <EcranCommercialFerme etat={socle.etat} requise="billing.invoices.read" titre="Facture" />
    );
  }

  let dossier: Awaited<ReturnType<typeof lireFacture>>;
  let manquants: string[];
  try {
    [dossier, manquants] = await Promise.all([
      lireFacture(invoiceId),
      lireChampsManquantsEmetteur(),
    ]);
  } catch (error) {
    return (
      <>
        <PageHeader
          eyebrow="Commercial"
          title="Facture"
          breadcrumb={{ label: "Factures SaaS", href: "/abonnements/factures" }}
        />
        <ReadFailure error={error} />
      </>
    );
  }

  if (dossier === null) notFound();

  const { facture, etat, lignes, encaissements, avoirs } = dossier;
  const entreprise = await trouverEntreprise(facture.organization_id);

  const emise = facture.issued_at !== null;
  const annulee = facture.status === "cancelled";
  const creditee = facture.status === "credited";

  // CE QUI EMPÊCHERA L'ÉMISSION, dit AVANT le clic. On reproduit les
  // contrôles de `saas_issue_invoice` dans le seul but de les ANNONCER ;
  // c'est la base qui refuse, et son message reste celui qui fait foi.
  const bloquants: string[] = [];
  if (manquants.length > 0) {
    bloquants.push(
      `Identité de l'émetteur incomplète : ${manquants.map((nom) => LIBELLES_CHAMPS_EMETTEUR[nom] ?? nom).join(", ")}.`,
    );
  }
  if (facture.vat_regime === "unknown") {
    bloquants.push(
      facture.vat_note ??
        "Régime de TVA inconnu pour cette entreprise : on n'invente pas un taux.",
    );
  }
  if (lignes.length === 0) {
    bloquants.push("Aucune ligne : une facture vide ne s'émet pas.");
  }
  const sansTaux = lignes.filter((ligne) => ligne.vat_rate === null).length;
  if (sansTaux > 0) {
    bloquants.push(
      `${sansTaux} ligne(s) sans taux de TVA : le total serait inconnu, et un document dont on ne sait pas faire le total ne s'émet pas.`,
    );
  }

  // LE MOTIF ÉCRIT SUR LA LIGNE FAUTIVE, et le prix qui manque.
  //
  // C'est le contrôle qui manquait des deux côtés à la fois : la base
  // coalesçait un prix inconnu à zéro et n'enregistrait pas le motif,
  // l'écran reproduisait les quatre autres contrôles et pas celui-là.
  // Le bouton « Émettre » était donc actif, sans un mot, au-dessus
  // d'une ligne affichée « 0,00 € » — et le document qui partait était
  // une facture française numérotée, opposable et immuable, à zéro
  // euro.
  const sansPrix = lignes.filter((ligne) => ligne.unit_price_cents === null).length;
  if (sansPrix > 0) {
    bloquants.push(
      `${sansPrix} ligne(s) sans prix : un montant inconnu ne devient pas zéro parce qu'on l'a imprimé.`,
    );
  }
  for (const motif of new Set(
    lignes.map((ligne) => ligne.blocking_reason).filter((m): m is string => m !== null),
  )) {
    bloquants.push(motif);
  }

  /* ------------------------------------------------------------------
     LE BROUILLON EST-IL ENCORE À JOUR ?
     ------------------------------------------------------------------
     Un brouillon fige les prix du jour où il a été produit. La
     génération les REFAIT désormais quand on la relance — mais on peut
     très bien ouvrir cette fiche sans repasser par elle, et émettre un
     document calculé avant un changement d'offre.

     On rejoue donc le calcul courant et on le compare, ligne à ligne,
     à ce qui est enregistré. En cas d'écart : bandeau critique, et le
     bouton « Émettre » se ferme. Ce n'est pas de la défiance envers la
     base — c'est que la base, elle, ne sait pas qu'on la regarde à un
     autre moment.

     Une facture ÉMISE n'est jamais comparée : elle DOIT différer du
     calcul d'aujourd'hui, c'est même le sens d'un document figé.
  ------------------------------------------------------------------ */
  let ecart: string | null = null;
  if (!emise && !annulee) {
    try {
      const courant = await lireLignesCalculees(
        facture.organization_id,
        facture.period_start,
        facture.period_end,
      );
      const empreinte = (
        entrees: { kind: string; description: string; unit_price_cents: number | null }[],
      ) =>
        entrees
          .filter((l) => l.kind !== "credit")
          .map((l) => `${l.kind}|${l.description}|${l.unit_price_cents ?? "?"}`)
          .sort()
          .join("\n");

      if (courant.length === 0) {
        ecart =
          "Le calcul courant ne rend aucune ligne pour cette entreprise : son abonnement a " +
          "disparu, ou il ne vous est pas lisible. Ce brouillon ne peut donc pas être vérifié, " +
          "et un document qu'on ne sait pas vérifier ne s'émet pas.";
        bloquants.push(ecart);
      } else if (empreinte(courant) !== empreinte(lignes)) {
        ecart =
          "Ce brouillon ne correspond plus à l'abonnement d'aujourd'hui : l'offre, un module, " +
          "une remise ou les sièges ont changé depuis qu'il a été produit. Relancez la " +
          "génération sur cette période — elle le refera — avant d'émettre quoi que ce soit.";
        bloquants.push(ecart);
      }
    } catch {
      // Ne pas pouvoir rejouer le calcul n'est pas une raison de bloquer
      // l'émission : la base refera ses propres contrôles, et ils font
      // foi. On se tait plutôt que d'inventer un écart.
    }
  }

  const mention = MENTIONS_REGIME[facture.vat_regime];

  return (
    <>
      <PageHeader
        eyebrow="Facture SaaS"
        title={facture.number ?? "Brouillon"}
        subtitle={
          entreprise === null
            ? undefined
            : `${entreprise.nom} — période du ${formatDate(facture.period_start)} au ${formatDate(facture.period_end)} (exclu)`
        }
        breadcrumb={{ label: "Factures SaaS", href: "/abonnements/factures" }}
        action={
          entreprise === null ? undefined : (
            <ButtonLink href={`/abonnements/${facture.organization_id}`} variant="secondary">
              Abonnement
            </ButtonLink>
          )
        }
      />

      {ecart !== null && (
        <Notice tone="critical" title="Ce brouillon est périmé — ne l'émettez pas">
          {ecart}
        </Notice>
      )}

      {!emise && !annulee && (
        <Notice tone="info" title="Brouillon — aucun numéro attribué">
          Un brouillon n&apos;a aucune valeur légale et n&apos;est pas visible du client. Le numéro
          n&apos;est consommé qu&apos;à l&apos;émission, et seulement si tout le reste réussit :
          c&apos;est ce qui garantit une séquence sans trou.
        </Notice>
      )}

      {creditee && (
        <Notice tone="warning" title="Neutralisée par un avoir">
          Cette facture garde son numéro et reste au dossier. C&apos;est l&apos;avoir qui la
          corrige — une facture émise ne se modifie ni ne disparaît.
        </Notice>
      )}

      {/* ------------------------------------------------------------
          L'ESSENTIEL
          ------------------------------------------------------------ */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <p className="eyebrow">Statut</p>
          <div className="mt-2">
            {etat === null ? (
              <UnknownValue reason="L'état effectif n'a pas pu être lu." />
            ) : (
              <StatusBadge tone={TONS_STATUT_FACTURE[etat.effective_status]}>
                {LIBELLES_STATUT_FACTURE[etat.effective_status]}
              </StatusBadge>
            )}
          </div>
          {etat !== null && (
            <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
              {EXPLICATIONS_STATUT_FACTURE[etat.effective_status]}
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="eyebrow">Total TTC</p>
          <div className="mt-2">
            {etat === null || etat.total_including_vat_cents === null ? (
              <UnknownValue reason="Au moins une ligne n'a pas de taux de TVA. La base rend le total inconnu plutôt qu'un montant faux, et l'émission est refusée." />
            ) : (
              <p className="tabular text-[length:var(--text-kpi-small)] font-semibold leading-none text-ink">
                {formatCents(etat.total_including_vat_cents, { decimals: true })}
              </p>
            )}
          </div>
          <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
            Calculé par la base, TVA groupée par taux. Jamais recalculé ici.
          </p>
        </Card>

        <Card className="p-4">
          <p className="eyebrow">Restant dû</p>
          <div className="mt-2">
            {etat === null || etat.outstanding_cents === null ? (
              <UnknownValue reason="Total inconnu : le solde l'est aussi." />
            ) : (
              <p className="tabular text-[length:var(--text-kpi-small)] font-semibold leading-none text-ink">
                {formatCents(etat.outstanding_cents, { decimals: true })}
              </p>
            )}
          </div>
          {etat !== null && (
            <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
              Encaissé {formatCents(etat.paid_cents, { decimals: true })} · avoirs{" "}
              {formatCents(etat.credited_cents, { decimals: true })}.
            </p>
          )}
        </Card>

        <Card className="p-4">
          <p className="eyebrow">Échéance</p>
          <p className="mt-2 text-[length:var(--text-card)] font-medium text-ink">
            {facture.due_on === null ? "Fixée à l'émission" : formatDate(facture.due_on)}
          </p>
          {etat !== null && etat.days_late !== null && etat.days_late > 0 && (
            <p className="mt-1 text-[var(--text-secondary)] text-critical">
              {etat.days_late} jour(s) de retard — déduit, jamais saisi.
            </p>
          )}
          <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
            Règlement par {LIBELLES_MOYEN[facture.payment_method].toLowerCase()}.
          </p>
        </Card>
      </div>

      {/* ------------------------------------------------------------
          LA TVA
          ------------------------------------------------------------ */}
      <Card className="mb-6 p-4">
        <p className="eyebrow">Régime de TVA</p>
        {facture.vat_regime === "unknown" ? (
          <div className="mt-2">
            <UnknownValue
              label="Inconnu — l'émission est bloquée"
              reason={
                facture.vat_note ??
                "Aucun motif enregistré. Tranchez le régime avant d'émettre : supposer 20 % ou 0 % serait faux dans un sens ou dans l'autre."
              }
            />
          </div>
        ) : (
          <>
            <p className="mt-2 text-[length:var(--text-card)] font-medium text-ink">
              {LIBELLES_REGIME_TVA[facture.vat_regime]}
              <span className="tabular ml-2 text-[var(--text-secondary)] font-normal text-ink-soft">
                {facture.vat_rate === null ? "taux inconnu" : `${facture.vat_rate} %`}
              </span>
            </p>
            {mention !== null && (
              <p className="mt-1 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
                Mention portée sur le document : « {mention} »
              </p>
            )}
          </>
        )}
        <p className="mt-2 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Le régime est FIGÉ sur la facture au moment de sa création, comme le reste : il dit ce qui
          était vrai ce jour-là.
        </p>
      </Card>

      {/* ------------------------------------------------------------
          LES LIGNES
          ------------------------------------------------------------ */}
      <Panel className="mb-6" title="Lignes" count={lignes.length}>
        {lignes.length === 0 ? (
          <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
            Aucune ligne. Une facture vide ne s&apos;émet pas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[var(--text-body)]">
              <thead>
                <tr className="border-b border-line bg-surface-sunken">
                  <th scope="col" className="eyebrow px-3 py-2 text-left">
                    Nature
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-left">
                    Description
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-right">
                    Quantité
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-right">
                    Prix unitaire
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-right">
                    TVA
                  </th>
                  <th scope="col" className="eyebrow px-3 py-2 text-right">
                    Total HT
                  </th>
                </tr>
              </thead>
              <tbody>
                {lignes.map((ligne) => (
                  <tr key={ligne.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 align-top">
                      <Badge
                        tone={
                          ligne.unit_price_cents !== null && ligne.unit_price_cents < 0
                            ? "positive"
                            : "neutral"
                        }
                      >
                        {LIBELLES_NATURE_LIGNE[ligne.kind] ?? ligne.kind}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 align-top">
                      {ligne.description}
                      {/* LE MOTIF EST SUR LA LIGNE, pas seulement en tête
                          de page : c'est ici qu'on regarde quand on
                          cherche pourquoi un montant manque. */}
                      {ligne.blocking_reason !== null && (
                        <p className="mt-1 text-[var(--text-secondary)] leading-relaxed text-critical">
                          {ligne.blocking_reason}
                        </p>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right align-top">{ligne.quantity}</td>
                    <td className="tabular px-3 py-2 text-right align-top">
                      {ligne.unit_price_cents === null ? (
                        <UnknownValue
                          compact
                          reason="Prix inconnu. Il n'est pas affiché à zéro : le total de la facture devient inconnu et l'émission est refusée."
                        />
                      ) : (
                        formatCents(ligne.unit_price_cents, { decimals: true })
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right align-top">
                      {ligne.vat_rate === null ? (
                        <UnknownValue
                          compact
                          reason="Taux inconnu : cette ligne rend le total de la facture inconnu et bloque l'émission."
                        />
                      ) : (
                        `${ligne.vat_rate} %`
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-right align-top">
                      {ligne.total_cents === null ? (
                        <UnknownValue compact reason="Le prix unitaire manque." />
                      ) : (
                        formatCents(ligne.total_cents, { decimals: true })
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
          Une remise et un crédit sont des LIGNES, en négatif, et non des champs à part : les mettre
          à côté obligerait à les rejouer dans chaque calcul, et l&apos;un des deux finirait par
          être oublié.
        </p>
      </Panel>

      {/* ------------------------------------------------------------
          LES MENTIONS FIGÉES
          ------------------------------------------------------------ */}
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Panel title="Émetteur, tel que le document le porte">
          {emise ? (
            <dl className="divide-y divide-line">
              <Mention terme="Raison sociale" valeur={facture.issuer_legal_name} />
              <Mention terme="Forme" valeur={facture.issuer_legal_form} />
              <Mention terme="SIRET" valeur={facture.issuer_siret} />
              <Mention terme="TVA intracommunautaire" valeur={facture.issuer_vat_number} />
              <Mention terme="RCS" valeur={facture.issuer_rcs_city} />
              <Mention
                terme="Capital social"
                valeur={formatCents(facture.issuer_share_capital_cents, { decimals: true })}
              />
              <Mention terme="Adresse" valeur={facture.issuer_address} />
              <Mention terme="IBAN" valeur={facture.issuer_iban} />
              <Mention terme="BIC" valeur={facture.issuer_bic} />
              <Mention terme="Pénalités de retard" valeur={facture.issuer_late_penalty_terms} />
              <Mention
                terme="Indemnité de recouvrement"
                valeur={formatCents(facture.issuer_recovery_indemnity_cents, { decimals: true })}
              />
              <Mention terme="Référence de paiement" valeur={facture.payment_reference} />
            </dl>
          ) : (
            <p className="px-4 py-3 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              Les mentions sont recopiées sur le document AU MOMENT DE L&apos;ÉMISSION, et elles
              sont donc vides ici. Ce n&apos;est pas un manque : une facture dit ce qui était vrai
              le jour où elle est partie, et une jointure afficherait rétroactivement une adresse
              que le client n&apos;a jamais reçue.
            </p>
          )}
        </Panel>

        <Panel title="Client, tel que le document le porte">
          {emise ? (
            <dl className="divide-y divide-line">
              <Mention terme="Nom" valeur={facture.customer_name} />
              <Mention terme="Raison sociale" valeur={facture.customer_legal_name} />
              <Mention terme="Forme" valeur={facture.customer_legal_form} />
              <Mention terme="SIRET" valeur={facture.customer_siret} />
              <Mention terme="TVA intracommunautaire" valeur={facture.customer_vat_number} />
              <Mention terme="Adresse" valeur={facture.customer_address} />
              <Mention terme="Pays" valeur={facture.customer_country} />
              <Mention terme="Courriel" valeur={facture.customer_email} />
            </dl>
          ) : (
            <p className="px-4 py-3 text-[var(--text-secondary)] leading-relaxed text-ink-soft">
              Idem : figées à l&apos;émission. En attendant, l&apos;identité courante du client se
              lit sur sa fiche.
            </p>
          )}
        </Panel>
      </div>

      {/* ------------------------------------------------------------
          ENCAISSEMENTS ET AVOIRS
          ------------------------------------------------------------ */}
      <div className="mb-6 grid gap-3 lg:grid-cols-2">
        <Panel title="Encaissements" count={encaissements.length}>
          {encaissements.length === 0 ? (
            <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
              Aucun encaissement enregistré.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {encaissements.map((encaissement) => (
                <li
                  key={encaissement.id}
                  className="flex flex-wrap items-baseline gap-2 px-4 py-2.5"
                >
                  <span className="tabular font-medium text-ink">
                    {formatCents(encaissement.amount_cents, { decimals: true })}
                  </span>
                  <span className="text-[var(--text-secondary)] text-ink-soft">
                    {LIBELLES_MOYEN_ENCAISSEMENT[encaissement.method]}
                  </span>
                  <span className="text-[var(--text-secondary)] text-ink-soft">
                    reçu le {formatDate(encaissement.received_on)}
                  </span>
                  {encaissement.external_reference && (
                    <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
                      {encaissement.external_reference}
                    </code>
                  )}
                  {encaissement.note && (
                    <span className="w-full text-[var(--text-secondary)] text-ink-faint">
                      {encaissement.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Saisie manuelle : aucune importation bancaire ni rapprochement automatique dans ce
            jalon. Le statut de la facture suit ce qui est encaissé, il ne se saisit pas.
          </p>
        </Panel>

        <Panel title="Avoirs" count={avoirs.length}>
          {avoirs.length === 0 ? (
            <p className="px-4 py-3 text-[var(--text-secondary)] text-ink-soft">
              Aucun avoir. Une facture émise ne se modifie pas : c&apos;est par ici qu&apos;elle se
              corrige.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {avoirs.map((avoir) => (
                <li key={avoir.id} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-ink">{avoir.number ?? "Sans numéro"}</span>
                    <span className="text-[var(--text-secondary)] text-ink-soft">
                      {formatDate(avoir.issued_on)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[var(--text-secondary)] text-ink-faint">
                    {avoir.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[var(--text-secondary)] leading-relaxed text-ink-faint">
            Les avoirs ont leur PROPRE séquence, elle aussi sans trou. Les mélanger aux factures
            rendrait les deux illisibles.
          </p>
        </Panel>
      </div>

      {/* ------------------------------------------------------------
          LES GESTES
          ------------------------------------------------------------ */}
      <Panel
        className="mb-6"
        title="Actions"
        description="Chacune exige un motif et laisse une ligne dans le journal administratif, dans la même transaction que l'écriture."
      >
        <ActionsFacture
          invoiceId={facture.id}
          emise={emise}
          annulee={annulee}
          creditee={creditee}
          bloquants={bloquants}
          peutEcrire={peut(admin, "billing.invoices.write")}
          role={admin.role}
        />
      </Panel>

      <p className="text-[var(--text-secondary)] text-ink-faint">
        Créée le {formatDateTime(facture.created_at)}
        {facture.issued_at !== null && ` · émise le ${formatDateTime(facture.issued_at)}`}
        {facture.cancelled_at !== null && ` · annulée le ${formatDateTime(facture.cancelled_at)}`}
        {facture.external_payment_reference !== null &&
          ` · référence du prestataire : ${facture.external_payment_reference}`}
      </p>
    </>
  );
}

function Mention({ terme, valeur }: { terme: string; valeur: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-2">
      <dt className="text-[var(--text-secondary)] text-ink-faint">{terme}</dt>
      <dd className="text-[var(--text-body)] text-ink">
        {valeur === null || valeur === "" ? (
          <UnknownValue compact reason="Champ vide sur le document." />
        ) : (
          valeur
        )}
      </dd>
    </div>
  );
}
