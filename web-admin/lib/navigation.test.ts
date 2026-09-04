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

test("un rôle sans aucune permission ne voit aucun groupe", () => {
  // Et pas « un groupe vide » : un intertitre « Clients » suivi de rien
  // ressemble à une panne.
  assert.deepEqual(visibleNavigation([]), []);
});

test("un rôle ne voit que les entrées que sa permission ouvre", () => {
  // Le profil d'un analyste en lecture seule : les chiffres, les
  // listes, la recherche — et rien d'autre à masquer dans ce jalon.
  const groups = visibleNavigation(["platform.dashboard.read"]);

  const hrefs = groups.flatMap((group) => group.items.map((item) => item.href));
  assert.deepEqual(hrefs, ["/", "/activite"]);

  // Le groupe « Clients » a disparu entièrement, faute d'entrée visible.
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "Vue d'ensemble");
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
    "/ia",
    "/ia/couts",
    "/ia/plafonds",
  ]);
});

test("aucune section sans écran n'est déclarée", () => {
  // La spec p.5-6 propose neuf sections. Trois sont livrées, et une
  // entrée qui mène à une page vide est pire qu'une entrée absente. Ce
  // test échoue le jour où quelqu'un ajoute « Abonnements » ou
  // « Feature Flags » avant que l'écran n'existe.
  assert.deepEqual(
    ADMIN_NAVIGATION.map((group) => group.label),
    ["Vue d'ensemble", "Clients", "IA"],
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
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "IA");
  assert.deepEqual(
    groups[0].items.map((item) => item.href),
    ["/ia", "/ia/couts", "/ia/plafonds"],
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
