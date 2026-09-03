import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toLocalInput, fromLocalInput, scheduledHours, keepScheduleOrdered,
} from "./types.ts";

/**
 * Deux bogues signalés à l'usage vivent ici, et aucun des deux ne se
 * voyait à l'écran : un décalage de fuseau qui déplaçait les
 * interventions de deux heures à chaque enregistrement, et une fin
 * antérieure au début qui renvoyait un nom de contrainte SQL.
 */

// --- Fuseau horaire ---------------------------------------------

test("aller-retour heure locale : rien ne bouge", () => {
  // Le piège d'origine : le champ affichait l'heure locale, on
  // renvoyait la chaîne telle quelle, Postgres la lisait en UTC, et
  // l'intervention se décalait. Puis encore, à chaque ouverture.
  const instant = new Date(2026, 7, 29, 8, 30, 0, 0).toISOString();
  assert.equal(fromLocalInput(toLocalInput(instant)), instant);
});

test("réenregistrer dix fois ne déplace pas l'intervention", () => {
  // C'est la forme réelle du bogue : la dérive s'accumulait.
  let value = new Date(2026, 7, 29, 8, 0, 0, 0).toISOString();
  const origin = value;
  for (let i = 0; i < 10; i++) {
    value = fromLocalInput(toLocalInput(value))!;
  }
  assert.equal(value, origin);
});

test("le champ vide reste vide dans les deux sens", () => {
  assert.equal(toLocalInput(null), "");
  assert.equal(fromLocalInput(""), null);
});

test("une valeur illisible ne devient pas une date au hasard", () => {
  assert.equal(toLocalInput("pas une date"), "");
  assert.equal(fromLocalInput("pas une date"), null);
});

// --- Bornes cohérentes ------------------------------------------

const eightToFour = {
  scheduled_start: new Date(2026, 7, 29, 8, 0).toISOString(),
  scheduled_end: new Date(2026, 7, 29, 16, 0).toISOString(),
};

test("des bornes déjà dans l'ordre ne sont pas touchées", () => {
  const patch: Record<string, unknown> = { ...eightToFour };
  keepScheduleOrdered(patch, eightToFour);
  assert.equal(patch.scheduled_end, eightToFour.scheduled_end);
});

test("déplacer le début à l'intérieur de la plage ne change rien", () => {
  // 14 h–16 h reste un intervalle valide : aucune correction à faire.
  const patch: Record<string, unknown> = {
    scheduled_start: new Date(2026, 7, 29, 14, 0).toISOString(),
    scheduled_end: eightToFour.scheduled_end,
  };
  keepScheduleOrdered(patch, eightToFour);
  assert.equal(patch.scheduled_end, eightToFour.scheduled_end);
});

test("un début repoussé APRÈS la fin conserve la durée", () => {
  // Le geste qui plantait : « finalement on y va en fin de journée ».
  // 18 h contre une fin à 16 h — la base refusait, l'écran affichait le
  // nom de la contrainte.
  const patch: Record<string, unknown> = {
    scheduled_start: new Date(2026, 7, 29, 18, 0).toISOString(),
    scheduled_end: eightToFour.scheduled_end,
  };
  keepScheduleOrdered(patch, eightToFour);

  const start = new Date(patch.scheduled_start as string);
  const end = new Date(patch.scheduled_end as string);
  assert.ok(end > start, "la fin doit avoir été repoussée");
  // 18 h + les 8 h d'origine = 2 h le lendemain.
  assert.equal(end.getHours(), 2);
  assert.equal(end.getDate(), 30);
});

test("sans durée connue, on retombe sur une heure plutôt que zéro", () => {
  const patch: Record<string, unknown> = {
    scheduled_start: new Date(2026, 7, 29, 14, 0).toISOString(),
    scheduled_end: new Date(2026, 7, 29, 9, 0).toISOString(),
  };
  keepScheduleOrdered(patch, { scheduled_start: null, scheduled_end: null });
  const ms = new Date(patch.scheduled_end as string).getTime()
    - new Date(patch.scheduled_start as string).getTime();
  assert.equal(ms, 3_600_000);
});

test("une borne absente ne déclenche aucune correction", () => {
  const patch: Record<string, unknown> = { scheduled_start: null };
  keepScheduleOrdered(patch, eightToFour);
  assert.equal("scheduled_end" in patch, false);
});

test("une fin envoyée seule est jugée face au début enregistré", () => {
  // Le formulaire n'envoie parfois qu'un champ : comparer à rien
  // laisserait passer un couple invalide jusqu'à la base.
  const patch: Record<string, unknown> = {
    scheduled_end: new Date(2026, 7, 29, 6, 0).toISOString(),
  };
  keepScheduleOrdered(patch, eightToFour);
  const end = new Date(patch.scheduled_end as string);
  assert.ok(end > new Date(eightToFour.scheduled_start));
});

// --- Durées ---------------------------------------------------

test("scheduledHours arrondit au quart d'heure et ignore l'absurde", () => {
  const start = new Date(2026, 7, 29, 8, 0).toISOString();
  assert.equal(scheduledHours(start, new Date(2026, 7, 29, 15, 50).toISOString()), 7.75);
  assert.equal(scheduledHours(start, null), 0);
  // Une fin avant le début rend zéro, pas un nombre négatif d'heures.
  assert.equal(scheduledHours(start, new Date(2026, 7, 29, 6, 0).toISOString()), 0);
});
