import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMIN_NAVIGATION,
  SEARCH_PERMISSION,
  navigationPermissions,
  visibleNavigation,
} from "./navigation.ts";
import { PLATFORM_PERMISSIONS } from "./auth/roles.ts";

/**
 * Ce que ces tests protègent.
 *
 * La barre latérale masque ce qu'un rôle ne peut pas ouvrir. Une erreur
 * y est SILENCIEUSE dans les deux sens : une permission mal
 * orthographiée fait disparaître un écran pour tout le monde, y compris
 * le super-administrateur, sans lever quoi que ce soit ; et un filtrage
 * trop permissif proposerait une porte qui se refermera au clic.
 *
 * Aucun de ces deux défauts ne se voit à la compilation ni au
 * chargement de la page. D'où ces tests.
 */

test("toutes les permissions de la navigation existent au catalogue", () => {
  // Une permission hors catalogue n'est portée par aucun rôle : l'écran
  // deviendrait invisible pour tout le monde, sans message.
  const catalogue: readonly string[] = PLATFORM_PERMISSIONS;
  const unknown = navigationPermissions().filter((p) => !catalogue.includes(p));
  assert.deepEqual(unknown, []);
});

test("un rôle sans aucune permission voit ses seuls Paramètres", () => {
  // Et pas « un groupe vide » : un intertitre « Clients » suivi de rien
  // ressemble à une panne.
  //
  // `/parametres` reste visible, et c'est la seule entrée dans ce cas.
  // Elle porte `permission: null` — « tout administrateur de
  // plateforme » — parce qu'elle donne accès à sa propre fiche et à son
  // propre second facteur, deux choses qui n'appartiennent à aucun rôle.
  // Un administrateur dont la matrice serait vide par accident doit
  // encore pouvoir s'enrôler et voir qui prévenir.
  const groups = visibleNavigation([]);
  assert.deepEqual(
    groups.flatMap((group) => group.items.map((item) => item.href)),
    ["/parametres"],
  );
});

test("un rôle ne voit que les entrées que sa permission ouvre", () => {
  // Le profil d'un analyste en lecture seule : les chiffres, les
  // listes, la recherche — plus ses propres paramètres.
  const groups = visibleNavigation(["platform.dashboard.read"]);

  const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
  assert.deepEqual(hrefs, ["/", "/activite", "/parametres"]);

  // Le groupe « Clients » a disparu entièrement, faute d'entrée visible.
  assert.deepEqual(
    groups.map((group) => group.label),
    ["Vue d'ensemble", "Paramètres"],
  );
});

test("l'entrée Équipe exige la permission de lecture, pas celle d'écriture", () => {
  // Un responsable sécurité LIT la liste des administrateurs
  // (`platform.admins.read`) sans pouvoir nommer personne : depuis 0081,
  // `platform.admins.manage` n'est accordable qu'au super-administrateur,
  // et le garde-fou de la matrice refuse littéralement de l'insérer pour
  // un autre rôle. Exiger la permission d'écriture dans le menu aurait
  // caché la liste à celui dont c'est précisément le travail de la
  // surveiller.
  const groups = visibleNavigation(["platform.admins.read"]);
  assert.deepEqual(
    groups.flatMap((group) => group.items.map((item) => item.href)),
    ["/parametres", "/equipe"],
  );
});

test("le super-administrateur voit toutes les entrées livrées", () => {
  const groups = visibleNavigation(PLATFORM_PERMISSIONS);
  const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));

  assert.deepEqual(hrefs, [
    "/",
    "/activite",
    "/utilisateurs",
    "/utilisateurs/mobile",
    "/utilisateurs/pro",
    "/organisations",
    "/plans",
    "/abonnements",
    "/abonnements/factures",
    "/support",
    "/support/sessions",
    "/securite",
    "/securite/journal",
    "/ia",
    "/ia/couts",
    "/ia/plafonds",
    "/parametres",
    "/equipe",
  ]);
});

/**
 * LE TEST QUI AURAIT ATTRAPÉ L'OUBLI DU LOT 0081.
 *
 * Six écrans avaient été livrés, testés et rendus fonctionnels — et
 * n'étaient atteignables qu'en tapant leur URL, parce que personne
 * n'avait pensé au menu. Le journal des actions administratives (spec
 * p.31) et la surveillance des sessions d'assistance (spec p.19-21)
 * étaient dans le lot.
 *
 * Ce test ne peut pas lire le disque — il tourne sous `node --test`,
 * sans résolution de l'alias `@/`. Il fige donc la liste des écrans de
 * PREMIER NIVEAU que la navigation doit nommer. Un écran ajouté sous
 * `app/(control)/` sans entrée ici passera encore inaperçu ; un écran
 * RETIRÉ du menu, non.
 */
test("chaque écran de premier niveau a sa porte dans le menu", () => {
  const hrefs = new Set(ADMIN_NAVIGATION.flatMap((g) => g.items).map((i) => i.href));
  for (const attendu of [
    "/",
    "/activite",
    "/utilisateurs",
    "/organisations",
    "/plans",
    "/abonnements",
    "/abonnements/factures",
    "/support",
    "/support/sessions",
    "/securite",
    "/securite/journal",
    "/parametres",
    "/equipe",
    "/ia",
  ]) {
    assert.ok(hrefs.has(attendu), `${attendu} n'est atteignable qu'en tapant son URL`);
  }
});

test("aucune section sans écran n'est déclarée", () => {
  // La spec p.5-6 propose neuf sections. Six sont livrées, et une
  // entrée qui mène à une page vide est pire qu'une entrée absente. Ce
  // test échoue le jour où quelqu'un ajoute « Conformité » ou
  // « Feature Flags » avant que l'écran n'existe.
  assert.deepEqual(
    ADMIN_NAVIGATION.map((group) => group.label),
    ["Vue d'ensemble", "Clients", "Commercial", "Assistance", "Sécurité", "IA", "Paramètres"],
  );
});

/**
 * `permission: null` est une valeur rare, et une valeur rare finit par
 * être recopiée sans qu'on sache pourquoi. Ce test la borne : une seule
 * entrée de toute la navigation a le droit d'être ouverte à tous, et
 * c'est celle qui ne montre que la fiche de l'appelant.
 */
test("une seule entrée est ouverte à tout administrateur, et c'est /parametres", () => {
  const ouvertes = ADMIN_NAVIGATION.flatMap((group) => group.items).filter(
    (item) => item.permission === null,
  );
  assert.deepEqual(
    ouvertes.map((item) => item.href),
    ["/parametres"],
  );
});

/**
 * LE PIÈGE DE SEMIS, transformé en test.
 *
 * `ai.config.read` a été ajoutée au catalogue APRÈS 0075, et les
 * permissions du super-administrateur y avaient été semées par jointure
 * au moment où 0075 s'exécutait. Une migration qui se contenterait
 * d'insérer la permission livrerait trois écrans que PERSONNE ne
 * pourrait ouvrir — et sans erreur : les liens disparaîtraient
 * simplement du menu.
 *
 * Ce test ne peut pas vérifier la base. Il vérifie l'autre moitié : que
 * les trois entrées IA dépendent bien d'une clé du catalogue, et que
 * `visibleNavigation` les fait apparaître dès qu'on la porte. Si un
 * jour la section disparaît du Control Center sans que ce test tombe,
 * la cause est en base, pas ici — et c'est une information.
 */
test("la section IA apparaît avec la seule permission ai.config.read", () => {
  const groups = visibleNavigation(["ai.config.read"]);
  // « Paramètres » suit toujours : son entrée ne dépend d'aucune
  // permission. Ce qui est vérifié ici est que la section IA apparaît, et
  // avec ses trois écrans.
  const ia = groups.find((group) => group.label === "IA");
  assert.ok(ia, "la section IA doit apparaître");
  assert.deepEqual(
    ia.items.map((item) => item.href),
    ["/ia", "/ia/couts", "/ia/plafonds"],
  );
  assert.deepEqual(
    groups.map((group) => group.label),
    ["IA", "Paramètres"],
  );
});

/**
 * Les entrées IA portent la permission de LECTURE, pas une permission
 * d'écriture. Un menu qui exigerait `ai.models.write` cacherait
 * l'aiguillage à la facturation, et les plafonds au produit — alors que
 * les deux doivent voir l'ensemble et n'écrire que leur moitié.
 */
test("le menu IA n'exige aucun droit d'écriture", () => {
  const permissionsIa = ADMIN_NAVIGATION.filter((group) => group.label === "IA")
    .flatMap((group) => group.items)
    .map((item) => item.permission);

  assert.deepEqual([...new Set(permissionsIa)], ["ai.config.read"]);
});

test("la recherche globale a sa propre permission, distincte de la lecture des listes", () => {
  // Sinon un rôle qui peut lister les utilisateurs pourrait aussi
  // fouiller toute la plateforme par identifiant, ce qui n'est pas la
  // même autorisation.
  assert.equal(SEARCH_PERMISSION, "platform.search");
  assert.ok(PLATFORM_PERMISSIONS.includes(SEARCH_PERMISSION));
});
