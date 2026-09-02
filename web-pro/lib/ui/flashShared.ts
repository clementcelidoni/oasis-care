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

/**
 * Valider ce qu'on relit du cookie.
 *
 * Cette fonction vit ICI, séparée de la lecture, pour une raison : c'est
 * le seul endroit du mécanisme qui peut AVALER un message. Elle rend
 * `null` sur cinq chemins différents, et chacun se traduit à l'écran par
 * la même chose — rien du tout. Un message perdu ne laisse aucune trace,
 * et l'utilisateur reclique en croyant que l'enregistrement a échoué.
 *
 * En la sortant de `readFlash`, qui dépend de `next/headers` et n'est
 * donc testable dans aucun harnais, elle devient une fonction pure que
 * les tests peuvent malmener.
 */
export function parseFlash(raw: string | undefined | null): Flash | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as Partial<Flash>;

  if (typeof candidate.message !== "string" || candidate.message.length === 0) return null;
  if (
    candidate.tone !== "success" &&
    candidate.tone !== "error" &&
    candidate.tone !== "info"
  ) {
    return null;
  }

  const flash: Flash = { tone: candidate.tone, message: candidate.message };

  // Un lien de rattrapage ne peut viser que ce site. Le message vient de
  // nous, mais le cookie est lisible ET MODIFIABLE par le navigateur :
  // un lien absolu en ferait une redirection ouverte, à un clic.
  const action = candidate.action;
  if (
    action &&
    typeof action.label === "string" &&
    typeof action.href === "string" &&
    action.href.startsWith("/") &&
    !action.href.startsWith("//")
  ) {
    flash.action = { label: action.label, href: action.href };
  }

  return flash;
}
