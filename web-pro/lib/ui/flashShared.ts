/**
 * §34 TOASTS — ce que le SERVEUR et le NAVIGATEUR partagent.
 *
 * Ce fichier existe pour une raison précise : `lib/ui/flash.ts` importe
 * `next/headers`, qui n'existe que côté serveur. Le composant `Toast`
 * est un composant client et n'a besoin que du NOM du cookie et de la
 * FORME du message — mais importer ces deux-là depuis le module serveur
 * entraînait tout le module dans le paquet du navigateur, et la
 * compilation refusait : « You're importing a module that depends on
 * next/headers ».
 *
 * D'où la coupure. Ici, rien qui touche à une API de plateforme : un
 * nom, un type. Les deux côtés peuvent les lire.
 */

export const FLASH_COOKIE = "oasis_flash";

export type FlashTone = "success" | "error" | "info";

export type Flash = {
  tone: FlashTone;
  message: string;
  /** Une action de rattrapage — §34 « Réessayer ». */
  action?: { label: string; href: string };
};
