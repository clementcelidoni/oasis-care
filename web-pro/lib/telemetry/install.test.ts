import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INSTALL_ID_KEY,
  LAST_DECLARED_KEY,
  MIN_INTERVAL_MS,
  SESSION_FLAG_KEY,
  markDeclared,
  readInstallId,
  shouldDeclare,
  type WebStorage,
} from "./install.ts";

/**
 * DEUX PROPRIÉTÉS, ET LE PRODUIT REPOSE SUR LES DEUX.
 *
 *   • L'IDENTIFIANT EST STABLE. S'il changeait à chaque chargement, le
 *     Control Center compterait des visites en croyant compter des
 *     installations, et le chiffre serait faux DANS LE SENS QUI NE SE
 *     VOIT PAS : trop grand, donc rassurant.
 *   • LA FRÉQUENCE EST BORNÉE. Une déclaration par navigation, c'est un
 *     appel réseau par clic pour une information qui ne change jamais.
 *
 * Aucun navigateur ici : les deux stockages sont des objets ordinaires,
 * ce qui permet aussi de rejouer les pannes réelles (Safari privé,
 * stockage bloqué) qu'on ne peut pas provoquer autrement.
 */

/** Un stockage de test. `failOn` rejoue les pannes du monde réel. */
function fakeStorage(
  initial: Record<string, string> = {},
  failOn: { get?: boolean; set?: boolean } = {},
): WebStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      if (failOn.get) throw new Error("stockage bloqué");
      return key in data ? data[key] : null;
    },
    setItem(key, value) {
      if (failOn.set) throw new Error("quota dépassé");
      data[key] = value;
    },
  };
}

const UUID = "3f6a1b2c-8d4e-4f10-9a7b-5c2e1d0f8a93";

test("l'identifiant est tiré une fois, puis relu à l'identique", () => {
  const local = fakeStorage();
  let tirages = 0;
  const newId = () => {
    tirages += 1;
    return UUID;
  };

  const premier = readInstallId(local, newId);
  const second = readInstallId(local, newId);
  const troisieme = readInstallId(local, newId);

  assert.equal(premier, UUID);
  assert.equal(second, UUID);
  assert.equal(troisieme, UUID);
  // Le point de tout l'exercice : UN tirage, trois lectures.
  assert.equal(tirages, 1, "l'identifiant a été retiré au sort alors qu'il existait déjà");
  assert.equal(local.data[INSTALL_ID_KEY], UUID);
});

test("un identifiant abîmé est remplacé, jamais réutilisé", () => {
  // Ce que la base refuserait de toute façon (0077 : 8 à 64 signes,
  // aucune espace). Le cas n'est pas théorique : c'est ce qu'on trouve
  // après une modification à la main dans les outils de développement,
  // ou après un changement de format.
  for (const abime of ["", "court", "Chrome de Clément", "x".repeat(65)]) {
    const local = fakeStorage({ [INSTALL_ID_KEY]: abime });
    assert.equal(readInstallId(local, () => UUID), UUID);
    assert.equal(local.data[INSTALL_ID_KEY], UUID);
  }
});

test("sans stockage, aucun identifiant — et surtout pas un identifiant volatile", () => {
  // Le comportement le plus important du fichier. Rendre un identifiant
  // neuf ici « pour ne pas perdre l'utilisateur » fabriquerait une
  // installation par chargement de page.
  assert.equal(readInstallId(null, () => UUID), null);

  const bloque = fakeStorage({}, { set: true });
  assert.equal(readInstallId(bloque, () => UUID), null);

  const illisible = fakeStorage({}, { get: true });
  // Une lecture qui lève ne doit pas empêcher d'écrire un identifiant
  // neuf : c'est le cas d'un stockage à demi disponible.
  assert.equal(readInstallId(illisible, () => UUID), UUID);
});

test("sans aléa sûr, aucun identifiant", () => {
  // `randomInstallId` rend `null` hors contexte sécurisé plutôt que de
  // se rabattre sur `Math.random()`.
  assert.equal(readInstallId(fakeStorage(), () => null), null);
});

test("une seule déclaration par session d'onglet", () => {
  const session = fakeStorage();
  const local = fakeStorage();

  assert.equal(shouldDeclare(session, local, 1_000), true);
  markDeclared(session, local, 1_000);

  // Les navigations suivantes, même une heure plus tard : rien.
  assert.equal(shouldDeclare(session, local, 1_000), false);
  assert.equal(shouldDeclare(session, local, 1_000 + MIN_INTERVAL_MS * 5), false);
  assert.equal(session.data[SESSION_FLAG_KEY], "1");
});

test("un nouvel onglet reste bloqué par le délai partagé", () => {
  const local = fakeStorage();
  markDeclared(fakeStorage(), local, 1_000);

  // Onglet neuf : son `sessionStorage` est vierge, mais `localStorage`
  // est commun. Sans ce second verrou, six onglets ouverts au réveil
  // feraient six déclarations pour la même installation.
  const nouvelOnglet = fakeStorage();
  assert.equal(shouldDeclare(nouvelOnglet, local, 1_000 + MIN_INTERVAL_MS - 1), false);
  assert.equal(shouldDeclare(nouvelOnglet, local, 1_000 + MIN_INTERVAL_MS), true);
});

test("une dernière déclaration illisible ne bloque pas", () => {
  // « je ne sais pas » n'est pas « c'était il y a une minute ». Un
  // stockage abîmé doit laisser passer, sinon une valeur parasite
  // ferait taire l'installation pour toujours.
  for (const parasite of ["", "bavardage", "NaN"]) {
    const local = fakeStorage({ [LAST_DECLARED_KEY]: parasite });
    assert.equal(shouldDeclare(fakeStorage(), local, 42_000), true);
  }
});

test("une horloge qui recule ne fait pas taire l'installation", () => {
  const local = fakeStorage();
  markDeclared(fakeStorage(), local, 10 * MIN_INTERVAL_MS);

  // Remise à l'heure du poste, changement de fuseau : `now` passe avant
  // la dernière déclaration. Bloquer ici ferait taire l'installation
  // jusqu'à ce que l'horloge rattrape son retard.
  assert.equal(shouldDeclare(fakeStorage(), local, 1_000), true);
});

test("aucun stockage : on déclare, et rien n'est mémorisé", () => {
  // Sans mémoire, le seul garde-fou restant est celui de la base
  // (0077 : une réécriture par heure au plus). C'est voulu : le client
  // ne doit pas décider seul de se taire.
  assert.equal(shouldDeclare(null, null, 1_000), true);
  assert.doesNotThrow(() => markDeclared(null, null, 1_000));
});

test("un stockage qui lève ne fait échouer ni la décision ni la marque", () => {
  const session = fakeStorage({}, { get: true, set: true });
  const local = fakeStorage({}, { get: true, set: true });

  assert.equal(shouldDeclare(session, local, 1_000), true);
  assert.doesNotThrow(() => markDeclared(session, local, 1_000));
});
