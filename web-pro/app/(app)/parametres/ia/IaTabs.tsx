import { Tabs } from "@/components/ui";

/**
 * §11V — LES DEUX FACES DE L'ADMINISTRATION IA.
 *
 * « AI Configuration » (spec p. 26) et « Dashboard coût IA » (p. 18-19)
 * sont deux écrans et non un seul, parce qu'on ne vient pas les voir
 * pour la même raison : on règle l'aiguillage une fois par trimestre, on
 * regarde la dépense toutes les semaines. Empilés sur une même page, le
 * second aurait poussé le premier sous la ligne de flottaison.
 *
 * Des liens, pas un état React : chaque face est une URL, donc
 * partageable et rechargeable.
 */
export function IaTabs({ current }: { current: string }) {
  return (
    <Tabs
      current={current}
      items={[
        { label: "Configuration", href: "/parametres/ia" },
        { label: "Coûts et plafonds", href: "/parametres/ia/couts" },
      ]}
    />
  );
}
