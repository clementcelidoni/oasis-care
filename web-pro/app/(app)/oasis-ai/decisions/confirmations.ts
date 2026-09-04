import { formatCents } from "@/lib/quotes/types";
import { getBillingPreview } from "@/lib/ai/decisions";

/**
 * Le texte des boîtes de confirmation (spec p. 9).
 *
 *     « Oasis souhaite : créer 10 factures.
 *       Montant total estimé : 38 450 € HT.
 *       8 factures semblent prêtes.
 *       2 nécessitent une vérification. »
 *
 * IL EST RELU MAINTENANT, PAS REPRIS DE LA DÉCISION. Entre l'ouverture
 * de la décision — hier peut-être — et ce clic, deux chantiers ont pu
 * être facturés à la main. Le chiffre montré doit être celui sur lequel
 * on va agir, et l'exécuteur relit la même source une troisième fois
 * avant d'écrire.
 *
 * ─── POURQUOI CE FICHIER EXISTE SÉPARÉMENT ───
 *
 * §11W a fusionné le centre de décision dans l'écran « Aujourd'hui ».
 * Cette fonction vivait dans la page qui a disparu ; la laisser mourir
 * avec elle aurait rendu les boîtes de confirmation muettes sur les
 * montants — c'est-à-dire aurait retiré à la spec p. 9 sa seule
 * application. Elle est donc ici, sans `"use server"` : ce n'est pas
 * une action, c'est une lecture faite pendant le rendu.
 */
export async function buildConfirmMessages(
  organizationId: string,
  needsBilling: boolean,
): Promise<Map<string, string>> {
  const messages = new Map<string, string>();
  if (!needsBilling) return messages;

  const preview = await getBillingPreview(organizationId);
  if (preview.failed) {
    messages.set(
      "createInvoiceDraft",
      "Le décompte des dossiers à facturer n'a pas pu être relu. N'appliquez pas à l'aveugle : ouvrez d'abord les chantiers.",
    );
    return messages;
  }

  const lines = [
    `Oasis va créer ${preview.prets} brouillon(s) de facture.`,
    // Un tiret, jamais « 0,00 € » : un montant inconnu n'est pas un
    // montant nul, et cette phrase-ci précède un clic irréversible.
    preview.montantPretHtCents === null
      ? "Montant total inconnu."
      : `Montant total estimé : ${formatCents(preview.montantPretHtCents)} HT.`,
    preview.aVerifier > 0
      ? `${preview.aVerifier} dossier(s) ne seront PAS facturés : ils demandent une vérification.`
      : "",
    preview.bloques > 0 ? `${preview.bloques} dossier(s) sont bloqués et écartés.` : "",
    preview.dossiersSansMontant > 0
      ? `${preview.dossiersSansMontant} dossier(s) sans montant connu.`
      : "",
    "Aucune facture ne sera émise ni envoyée : ce sont des brouillons, relisez-les.",
  ].filter(Boolean);

  messages.set("createInvoiceDraft", lines.join(" "));
  return messages;
}
