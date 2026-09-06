import { redirect } from "next/navigation";

import { PageHeader, Panel, ButtonLink } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";
import { cssImpressionPlanche, plancheVersSvg } from "@/lib/etiquettes";

import { gisement } from "../../familles.ts";
import { LIBELLE_CHAMP } from "../../modeles.ts";
import { composerDepuisRequete, lienPdf, lireRequete } from "../../planche.ts";

/**
 * § 17 — LA PLANCHE, MONTRÉE AVANT D'ÊTRE IMPRIMÉE.
 *
 * ══════════════════════════════════════════════════════════════════
 * CETTE PAGE N'ÉCRIT RIEN
 * ══════════════════════════════════════════════════════════════════
 *
 * Les étiquettes ont été posées par la Server Action de l'écran
 * précédent. Ici on relit, on compose, on montre. La page est donc
 * rechargeable, partageable, et surtout REJOUABLE : garder ce lien,
 * c'est pouvoir réimprimer exactement la même feuille dans six mois,
 * avec les mêmes jetons, quand trois autocollants se seront décollés.
 *
 * ══════════════════════════════════════════════════════════════════
 * DEUX SORTIES, ET IL FAUT DIRE POURQUOI ELLES NE SE VALENT PAS
 * ══════════════════════════════════════════════════════════════════
 *
 *   • LE PDF — les cotes sont dans le fichier. Rien ne peut les
 *     changer : ni la feuille de style du produit, ni la boîte de
 *     dialogue d'impression, ni le réglage d'un poste. C'est le seul
 *     chemin où « 25 × 15 mm » veut dire 25 × 15 mm, et c'est celui
 *     qu'on met en avant.
 *   • L'APERÇU À L'ÉCRAN — pour vérifier d'un coup d'œil que la bonne
 *     chose est sur la bonne étiquette.
 *
 * ET LE Ctrl+P SUR CETTE PAGE, QUI ARRIVERA. Le `@page { margin: 14mm }`
 * de la feuille de style racine s'applique à TOUTES les routes — c'est
 * la mise en page racine qui l'importe, et Next.js n'offre aucun moyen
 * de s'y soustraire. Sous cette règle, trois des cinq formats du § 17
 * ont une surface imprimable NÉGATIVE : un Ctrl+P sortait une feuille
 * hors d'échelle, en silence, sur le seul écran qui montre une planche.
 *
 * `cssImpressionPlanche` a été écrite exactement pour ce cas et n'était
 * appelée nulle part. Elle est posée ci-dessous dans le CORPS du
 * document : `@page` ne se limite pas à un sélecteur, mais il obéit à
 * la cascade, et un `<style>` du corps est analysé après les feuilles
 * du `<head>`. Elle redéclare les cotes exactes, remet la marge à zéro
 * et masque tout ce qui n'est pas la planche. Le PDF reste la voie
 * recommandée ; le Ctrl+P n'est plus un piège.
 */

export const metadata = { title: "Planche d'étiquettes" };

export default async function PlanchePage({
  searchParams,
}: PageProps<"/etiquettes/imprimer/planche">) {
  const params = await searchParams;
  const requete = lireRequete(params);
  if (!requete) redirect("/etiquettes");

  const organization = await requireOrganization();
  const supabase = await createClient();
  const composee = await composerDepuisRequete(supabase, organization, requete);

  const g = gisement(requete.source);
  const retour = `/etiquettes/imprimer?source=${requete.source}`;

  if (!composee.planche) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <PageHeader
          title="Cette planche ne peut pas être imprimée"
          breadcrumb={{ label: g.libelle, href: retour }}
        />
        <div className="rounded-[var(--radius-card)] border border-critical/30 bg-critical-wash px-5 py-4 text-[var(--text-body)] text-critical">
          {composee.erreur}
        </div>
        <div className="mt-6">
          <ButtonLink href={retour} variant="secondary">
            Revenir à la sélection
          </ButtonLink>
        </div>
      </div>
    );
  }

  const planche = composee.planche;
  // On ne rend en SVG que la PREMIÈRE page. Cinq cents étiquettes
  // représentent des dizaines de milliers de rectangles : les poser
  // toutes dans le document ferait ramer le navigateur pour un aperçu
  // dont la deuxième page est, par construction, identique à la
  // première. Le PDF, lui, les contient toutes.
  const premiere = plancheVersSvg({ ...planche, pages: planche.pages.slice(0, 1) })[0];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        title={`${planche.nombreEtiquettes} étiquette${planche.nombreEtiquettes > 1 ? "s" : ""} à imprimer`}
        subtitle={`${composee.modeleNom} — ${planche.etiquetteLargeurMm} × ${planche.etiquetteHauteurMm} mm, ${
          planche.grille
            ? `${planche.grille.parPage} par feuille A4`
            : "une étiquette par page (rouleau)"
        }, ${planche.pages.length} page${planche.pages.length > 1 ? "s" : ""}.`}
        breadcrumb={{ label: g.libelle, href: retour }}
        eyebrow="Planche prête"
        action={
          <>
            <ButtonLink href={lienPdf(params)}>Ouvrir le PDF</ButtonLink>
            <ButtonLink href={lienPdf(params, true)} variant="secondary">
              Télécharger
            </ButtonLink>
          </>
        }
      />

      {/* ---- CE QUI N'A PAS PU ÊTRE IMPRIMÉ ---- */}
      {composee.sansJeton.length > 0 && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-critical/30 bg-critical-wash px-5 py-4">
          <p className="text-[var(--text-body)] font-medium text-critical">
            {composee.sansJeton.length} élément{composee.sansJeton.length > 1 ? "s" : ""} ne
            figure{composee.sansJeton.length > 1 ? "nt" : ""} PAS sur cette planche
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
            Ils ne portent pas d&apos;étiquette active — la création a échoué, ou quelqu&apos;un
            l&apos;a révoquée entre-temps. Mieux vaut les sauter que d&apos;imprimer un carré vide
            à la place du QR : un autocollant d&apos;apparence normale qui ne mène nulle part est
            le pire des résultats.
          </p>
          <ul className="mt-2 list-disc pl-5 text-[var(--text-secondary)] text-ink-soft">
            {composee.sansJeton.slice(0, 10).map((nom) => (
              <li key={nom}>{nom}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- LES COMPROMIS DU RENDU ---- */}
      {/*
        Les avertissements sont dédoublonnés par composerPlanche : un
        défaut du MODÈLE se répète à l'identique sur chaque étiquette,
        et deux cents lignes identiques noieraient celles qui ne
        concernent qu'une plante.
      */}
      {planche.avertissements.length > 0 && (
        <div className="mb-6 rounded-[var(--radius-card)] border border-warning/30 bg-warning-wash px-5 py-4">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {planche.avertissements.length} ajustement
            {planche.avertissements.length > 1 ? "s" : ""} ont été faits pour que tout tienne
          </p>
          <ul className="mt-2 space-y-1">
            {planche.avertissements.slice(0, 12).map((a, index) => (
              <li
                key={`${a.champ ?? "general"}-${index}`}
                className="text-[var(--text-secondary)] text-ink-soft"
              >
                {a.champ && <span className="font-medium">{LIBELLE_CHAMP[a.champ]} — </span>}
                {a.message}
              </li>
            ))}
          </ul>
          {planche.avertissements.length > 12 && (
            <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
              … et {planche.avertissements.length - 12} autre
              {planche.avertissements.length - 12 > 1 ? "s" : ""}.
            </p>
          )}
        </div>
      )}

      {/* ---- LA MARCHE À SUIVRE ---- */}
      <Panel title="Comment imprimer pour que les cotes soient justes">
        <ol className="list-decimal space-y-2 px-5 py-4 pl-9 text-[var(--text-body)] text-ink-soft">
          <li>
            <strong className="text-ink">Ouvrez le PDF</strong> — le bouton ci-dessus. La page du
            fichier fait exactement {planche.pages[0]?.largeurMm} ×{" "}
            {planche.pages[0]?.hauteurMm} mm ; ces cotes sont écrites dans le fichier et rien ne
            peut les changer.
          </li>
          <li>
            Dans la boîte de dialogue, réglez{" "}
            <strong className="text-ink">« Échelle : 100 % »</strong> (pas « Ajuster à la page ») et{" "}
            <strong className="text-ink">« Marges : aucune »</strong>. C&apos;est le seul endroit
            où les cotes peuvent encore se perdre, et notre code ne peut pas le forcer.
          </li>
          {planche.grille && (
            <li>
              Une fois la feuille sortie,{" "}
              <strong className="text-ink">mesurez la barre noire en bas de page</strong>. Elle
              doit faire 50 mm à la règle. Si elle en fait 49 ou 51, l&apos;échelle n&apos;était
              pas à 100 % : les étiquettes ne colleront pas sur leur support, réimprimez.
            </li>
          )}
          {!planche.grille && (
            <li>
              Sur une thermique, vérifiez que le{" "}
              <strong className="text-ink">format déclaré dans le pilote correspond au rouleau
              chargé</strong>. Le PDF ne peut pas deviner ce qu&apos;il y a dans la machine.
            </li>
          )}
        </ol>
      </Panel>

      {/* ---- L'APERÇU ---- */}
      {/*
        LA BATAILLE DE CASCADE CONTRE globals.css. Ce <style> est dans
        le CORPS, délibérément : c'est ce qui le fait gagner contre le
        « @page { margin: 14mm } » de la feuille racine, à spécificité
        égale. Le déplacer dans le <head> le ferait perdre en silence.
      */}
      <style dangerouslySetInnerHTML={{ __html: cssImpressionPlanche(planche) }} />

      <section className="mt-6 oasis-impression">
        <Panel
          title="Aperçu de la première page"
          description={
            planche.pages.length > 1
              ? `Les ${planche.pages.length - 1} pages suivantes sont dans le PDF.`
              : undefined
          }
        >
          <div className="overflow-x-auto bg-canvas px-5 py-6">
            <div
              className="oasis-planche mx-auto w-fit bg-white shadow-[var(--shadow-raised)] [&>svg]:block"
              // Les cotes sont dans le SVG lui-même, en millimètres :
              // l'aperçu est à la taille réelle, à la densité d'écran
              // près. C'est le PDF qui fait foi.
              dangerouslySetInnerHTML={{ __html: premiere }}
            />
          </div>
        </Panel>
      </section>

      <p className="mt-6 text-[var(--text-secondary)] text-ink-faint">
        Cette adresse décrit entièrement la planche. Gardez-la en favori : la rouvrir
        réimprimera exactement les mêmes étiquettes, avec les mêmes jetons — ce qu&apos;il faut
        quand un autocollant se décolle.
      </p>
    </div>
  );
}
