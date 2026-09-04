import { requireOrganization } from "@/lib/auth/organization";
import { PageHeader, Drawer } from "@/components/ui";
import { parisDay } from "@/lib/field/types";
import { countOpenDecisions } from "@/lib/ai/decisions";
import { listerFils } from "@/lib/ai/conversations/lecture";
import { veilleDe } from "@/lib/ai/conversations/types";
import { OasisTabs, LienReglages } from "../OasisTabs";
import { Rail } from "./Rail";

/**
 * §11W — LES CONVERSATIONS : DEUX COLONNES, ET SEULEMENT ICI.
 *
 * ══════════════════════════════════════════════════════════════════
 * POURQUOI LE RAIL VIT DANS UN LAYOUT
 * ══════════════════════════════════════════════════════════════════
 *
 * Pour qu'il ne se recharge pas quand on passe d'un fil à l'autre : le
 * layout est partagé par `/conversations` et
 * `/conversations/<id>`, donc la liste reste en place, sa position de
 * défilement avec elle. Changer de conversation redessine la colonne de
 * droite, rien d'autre.
 *
 * ─── ET POURQUOI IL N'EXISTE QUE SUR CETTE ROUTE ───
 *
 * Un rail permanent dans tout l'espace Oasis serait une TROISIÈME
 * navigation, à côté de la barre latérale du produit et des onglets.
 * Il ne gagne sa largeur que là où les fils sont le sujet.
 *
 * ─── SOUS 1024 px ───
 *
 * Le rail devient un tiroir. Le composant `Drawer` existe déjà et le
 * planning s'en sert (`DayDrawer`) : `<dialog>` natif, donc Échap,
 * piégeage du focus et retour du focus au déclencheur sans une ligne à
 * écrire. Le contenu est rendu DEUX FOIS, montré par média-requête
 * plutôt que par un branchement JavaScript : pas d'hydratation qui
 * hésite, pas de saut de mise en page au premier rendu.
 */
export default async function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const organization = await requireOrganization();
  const liste = await listerFils(organization.organizationId);

  // `countOpenDecisions` et non une requête recopiée : la liste des
  // statuts ouverts vit dans `OPEN_DECISION_STATUSES`, et deux copies
  // d'une même liste finissent par afficher deux nombres différents sur
  // deux onglets voisins — le jour où un statut s'ajoute.
  const openDecisions = await countOpenDecisions(organization.organizationId);

  // LE JOUR EST DÉCIDÉ ICI, une fois, à l'heure de Paris — et transmis.
  // Le calculer dans le rail ferait lire l'horloge pendant le rendu
  // d'un composant client, ce que le compilateur React refuse, et
  // ferait diverger le serveur du navigateur autour de minuit.
  const aujourdhui = parisDay(new Date());
  const hier = veilleDe(aujourdhui);

  const rail = (
    <Rail
      fils={liste.fils}
      aujourdhui={aujourdhui}
      hier={hier}
      failed={liste.failed}
      migrationManquante={liste.migrationManquante}
    />
  );

  return (
    <div className="mx-auto max-w-6xl px-8 py-10">
      <PageHeader
        eyebrow="Oasis Executive AI"
        title="Conversations"
        subtitle={`Une question sur les données de ${organization.name} — devis, chantiers, stock, factures. Oasis répond à partir d'elles, et prépare ce que vous lui demandez.`}
        action={<LienReglages />}
      />

      <OasisTabs current="/oasis-ai/conversations" openDecisions={openDecisions} />

      {/* ---- Le tiroir, sous 1024 px ---- */}
      <div className="mb-4 lg:hidden">
        <Drawer
          triggerLabel="Vos conversations"
          triggerVariant="secondary"
          title="Vos conversations"
          description="Chaque conversation est indépendante : Oasis ne relit jamais l'une en répondant dans l'autre."
          width="20rem"
        >
          {rail}
        </Drawer>
      </div>

      <div className="flex gap-8">
        {/* `sticky` plutôt qu'une hauteur fixe : le rail suit le
            défilement d'un long fil sans jamais dépasser la fenêtre. */}
        <aside className="sticky top-8 hidden h-[calc(100dvh-8rem)] w-[260px] shrink-0 lg:block">
          {rail}
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
