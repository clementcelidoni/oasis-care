import Link from "next/link";

import { PageHeader, Panel, EmptyState, ButtonLink, Badge } from "@/components/ui";
import { Icon } from "@/components/shell/Icon";
import { requireOrganization } from "@/lib/auth/organization";
import { createClient } from "@/lib/supabase/server";

import { adresseEtiquettes, urlEtiquette, JETON_EXEMPLE, VARIABLE_ADRESSE } from "./adresse.ts";
import { FAMILLES, LIBELLE_FAMILLE, gisementsDeFamille } from "./familles.ts";
import {
  compterAncienneAdresse,
  compterObjets,
  lireModeles,
  SocleManquant,
} from "./lecture.ts";
import { droitsEtiquettes } from "./droits.ts";
import { BandeauAdresse } from "./BandeauAdresse";
import { SocleAbsent } from "./SocleAbsent";

/**
 * L'ACCUEIL DES ÉTIQUETTES — la carte du § 13, ramenée à ce qui existe.
 *
 * ══════════════════════════════════════════════════════════════════
 * CET ÉCRAN COMPTE AVANT DE PROPOSER
 * ══════════════════════════════════════════════════════════════════
 *
 * Le § 13 énumère trente-six choses à étiqueter. Vingt et une
 * seulement ont une table derrière, et sur ces vingt et une, plusieurs
 * sont vides dans une entreprise donnée : un paysagiste n'a pas de lot
 * de culture, un laboratoire n'a pas de bassin. Un menu qui les
 * afficherait toutes également enverrait sur des listes vides — et une
 * liste vide ne dit jamais si c'est parce qu'il n'y a rien, ou parce
 * que le module n'est pas pour vous.
 *
 * On compte donc AVANT d'afficher, et un gisement à zéro le dit
 * lui-même au lieu d'offrir un bouton qui ne mène nulle part.
 *
 * ══════════════════════════════════════════════════════════════════
 * ET IL MONTRE L'ADRESSE, PARCE QU'ELLE ENGAGE DIX ANS
 * ══════════════════════════════════════════════════════════════════
 *
 * Le premier bloc de la page n'est pas décoratif. Une étiquette collée
 * sur un arbre y reste des années : l'adresse qu'elle porte est la
 * décision la plus lourde de ce module, et elle doit être VUE avant
 * qu'un rouleau ne s'engage, pas découverte sur un autocollant. Le
 * produit vient d'y perdre cinq étiquettes, parties avec un domaine
 * réservé par la RFC 2606 que personne n'avait relu.
 */

export const metadata = { title: "Étiquettes" };

export default async function EtiquettesPage() {
  const organization = await requireOrganization();
  const droits = droitsEtiquettes(organization);
  const supabase = await createClient();
  const adresse = adresseEtiquettes();

  // Quinze comptages en parallèle. Chacun est un `count: exact, head:
  // true` : Postgres ne renvoie aucune ligne, seulement le nombre.
  const gisementsParFamille = FAMILLES.map((famille) => ({
    famille,
    gisements: gisementsDeFamille(famille),
  }));
  const tous = gisementsParFamille.flatMap((f) => f.gisements);

  // `lireModeles` est la seule lecture de cet écran qui touche une
  // table posée par 0090 : c'est donc elle qui révèle un socle absent.
  // Les comptages, eux, portent sur des tables antérieures à 0090 et
  // rendent zéro sans bruit — d'où le besoin de ce signal séparé, sans
  // quoi l'écran dirait « rien à étiqueter » alors que la vraie raison
  // est que la migration manque.
  //
  // Le résultat est RENDU par la promesse plutôt qu'affecté à une
  // variable de portée supérieure : réaffecter depuis un rappel
  // asynchrone pendant un rendu est précisément ce que le compilateur
  // React refuse, et il a raison — rien ne garantit l'ordre.
  const [comptes, ancienneAdresse, lecture] = await Promise.all([
    Promise.all(tous.map((g) => compterObjets(supabase, organization, g.cle))),
    // Sur une base où 0090 n'est pas appliquée, la colonne n'existe pas
    // : le comptage rend null, et le bandeau se tait.
    compterAncienneAdresse(supabase, organization),
    lireModeles(supabase).then(
      (m) => ({ modeles: m, socleAbsent: null as string | null }),
      (erreur: unknown) => {
        // On n'avale QUE l'absence de socle. Une vraie panne de lecture
        // doit rester une panne : afficher une liste vide à sa place
        // ferait croire que l'entreprise n'a aucun modèle.
        if (erreur instanceof SocleManquant) {
          return { modeles: [], socleAbsent: erreur.detail };
        }
        throw erreur;
      },
    ),
  ]);
  const { modeles, socleAbsent } = lecture;
  const compteParCle = new Map(tous.map((g, index) => [g.cle, comptes[index]]));

  // TROIS ÉTATS, PAS DEUX. `compterObjets` rend null quand il n'a PAS PU
  // compter — table absente, droit refusé, panne. Confondre ce null
  // avec un zéro faisait afficher « Aucune plante enregistrée » et un
  // badge « vide » à quelqu'un dont on n'avait rien lu, et c'est lui
  // qui décide de ne pas imprimer.
  const mesures = comptes.filter((n): n is number => n !== null);
  const nonComptes = comptes.length - mesures.length;
  const totalEtiquetable = mesures.reduce((somme, n) => somme + n, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PageHeader
        title="Étiquettes"
        subtitle="Composer un modèle, générer les QR d'un lot, d'un jardin ou d'une sélection, et sortir une planche aux bonnes cotes."
        action={
          droits.peutGerer ? (
            <ButtonLink href="/etiquettes/modeles" variant="secondary">
              Modèles ({modeles.length})
            </ButtonLink>
          ) : null
        }
      />

      <BandeauAdresse
        base={adresse.base}
        origine={adresse.origine}
        probleme={adresse.probleme}
        exemple={adresse.base ? urlEtiquette(adresse.base, JETON_EXEMPLE) : null}
        variable={VARIABLE_ADRESSE}
        ancienneAdresse={ancienneAdresse}
      />

      {socleAbsent !== null && (
        <div className="mt-6">
          <SocleAbsent detail={socleAbsent} />
        </div>
      )}

      {!droits.peutLire && (
        <div className="mt-6">
          <EmptyState
            title="Les étiquettes ne font pas partie de votre rôle"
            description="Consulter et imprimer des étiquettes demande le droit « étiquettes ». Demandez-le à un responsable de votre entreprise."
          />
        </div>
      )}

      {droits.peutLire && totalEtiquetable === 0 && (
        <div className="mt-6">
          <EmptyState
            icon={<Icon name="lots" className="h-6 w-6" />}
            title="Rien à étiqueter pour l'instant"
            description="Une étiquette se pose sur quelque chose : un jardin, une plante, un lot, un emplacement. Créez d'abord l'élément, puis revenez ici lui donner son QR."
            // Pas de raccourci vers la pépinière : un paysagiste sans
            // pépinière n'y a rien à faire. Ce qu'on peut proposer
            // sans rien supposer, c'est de préparer ses modèles en
            // attendant d'avoir quelque chose à étiqueter.
            action={<ButtonLink href="/etiquettes/modeles" variant="secondary">Préparer mes modèles</ButtonLink>}
          />
        </div>
      )}

      {droits.peutLire && nonComptes > 0 && (
        <div className="mt-6 rounded-[var(--radius-card)] border border-warning/30 bg-warning-wash px-5 py-4">
          <p className="text-[var(--text-body)] font-medium text-warning">
            {nonComptes} inventaire{nonComptes > 1 ? "s" : ""} n&apos;{nonComptes > 1 ? "ont" : "a"}{" "}
            pas pu être compté{nonComptes > 1 ? "s" : ""}
          </p>
          <p className="mt-1 text-[var(--text-secondary)] text-ink-soft">
            Ce n&apos;est pas la même chose que « rien à étiqueter » : la lecture a échoué. Les
            lignes concernées sont marquées ci-dessous. Rechargez la page ; si cela dure,
            prévenez la personne qui administre la base.
          </p>
        </div>
      )}

      {droits.peutLire &&
        (totalEtiquetable > 0 || nonComptes > 0) &&
        gisementsParFamille.map(({ famille, gisements }) => {
          const totalFamille = gisements.reduce(
            (somme, g) => somme + (compteParCle.get(g.cle) ?? 0),
            0,
          );
          // Une famille dont un gisement n'a pas pu être lu n'est pas
          // une famille vide : on ne dit pas « rien à imprimer ici ».
          const familleIncomplete = gisements.some(
            (g) => compteParCle.get(g.cle) === null,
          );

          return (
            <section key={famille} className="mt-6">
              <Panel
                title={LIBELLE_FAMILLE[famille]}
                description={
                  totalFamille === 0
                    ? "Aucun élément de ce monde dans cette entreprise."
                    : `${totalFamille} élément${totalFamille > 1 ? "s" : ""} peuvent porter une étiquette.`
                }
                count={totalFamille}
              >
                {/* § « Si une famille n'a aucun objet, l'écran le dit et
                    n'offre pas d'imprimer du vide. » Le panneau reste
                    visible — le cacher laisserait croire que le module
                    n'existe pas — mais il ne propose rien. */}
                {totalFamille === 0 && !familleIncomplete ? (
                  <p className="px-5 py-6 text-[var(--text-body)] text-ink-soft">
                    Rien à imprimer ici. Ce monde s&apos;allumera de lui-même dès qu&apos;un
                    élément y sera créé.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {gisements.map((g) => {
                      const compte = compteParCle.get(g.cle) ?? null;
                      const illisible = compte === null;
                      const vide = compte === 0;
                      return (
                        <li
                          key={g.cle}
                          className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                        >
                          <div className="min-w-0">
                            <p
                              className={`text-[var(--text-body)] font-medium ${vide && !illisible ? "text-ink-faint" : ""}`}
                            >
                              {g.libelle}
                            </p>
                            <p className="text-[var(--text-secondary)] text-ink-faint">
                              {illisible
                                ? "Comptage indisponible : la lecture a échoué."
                                : vide
                                  ? `Aucun ${g.singulier} enregistré.`
                                  : `${compte} à étiqueter`}
                            </p>
                          </div>
                          {illisible ? (
                            <Badge tone="warning">non compté</Badge>
                          ) : vide ? (
                            <Badge>vide</Badge>
                          ) : (
                            <Link
                              href={`/etiquettes/imprimer?source=${g.cle}`}
                              className="shrink-0 text-[var(--text-body)] font-medium text-accent hover:underline"
                            >
                              Choisir et imprimer →
                            </Link>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
            </section>
          );
        })}

      {/* CE QUE LE NAVIGATEUR SAIT FAIRE, DIT UNE FOIS ET SANS PROMESSE.
          Le § 17 cite « Zebra, Brother, Dymo » ; il faut être net sur ce
          qui est livré et sur ce qui ne l'est pas, ici plutôt que dans
          une note de version que personne ne lit. */}
      <section className="mt-8">
        <Panel title="Ce qui sort de cet écran, et ce qui n'en sortira pas">
          <div className="space-y-3 px-5 py-4 text-[var(--text-body)] text-ink-soft">
            <p>
              <strong className="text-ink">Un PDF aux cotes exactes.</strong> La page du fichier
              fait très précisément la taille de l&apos;étiquette — 25 × 15, 40 × 20, 50 × 30,
              60 × 40, 100 × 50 mm, une planche A4 ou un format que vous saisissez. Une
              thermique installée comme imprimante du système l&apos;avale par son pilote, comme
              n&apos;importe quel document, à condition que le format déclaré corresponde au
              rouleau chargé.
            </p>
            <p>
              <strong className="text-ink">Pas de pilote d&apos;imprimante.</strong> Produire du
              ZPL pour une Zebra, du b-PAC pour une Brother ou piloter une Dymo par son SDK
              demande un logiciel installé sur chaque poste. Une page web ne peut pas le faire,
              et nous ne le promettons pas. Le PDF couvre le même besoin par le chemin normal.
            </p>
            <p>
              <strong className="text-ink">Une règle de contrôle sur chaque planche A4.</strong>{" "}
              Une barre de 50 mm, à mesurer avec une vraie règle. Si elle ne fait pas 50 mm,
              votre boîte de dialogue d&apos;impression a redimensionné la page et les étiquettes
              ne colleront pas sur leur support : réimprimez avec « Échelle : 100 % » et
              « Marges : aucune ».
            </p>
          </div>
        </Panel>
      </section>
    </div>
  );
}
