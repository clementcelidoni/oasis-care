import { cookies } from "next/headers";
import { FLASH_COOKIE, type Flash, type FlashTone } from "./flashShared";

/**
 * §34 TOASTS / FEEDBACK.
 *
 *     Succès : « Client créé »
 *     Erreur : « Impossible d'enregistrer le client. / Réessayer »
 *
 * LE PROBLÈME À RÉSOUDRE. Le produit compte quatre-vingt-treize écrans
 * dont les formulaires appellent des Server Actions ordinaires. Quand
 * une action réussit, il ne se passe rien de visible : la page se
 * revalide, et l'utilisateur clique une deuxième fois pour vérifier.
 * Quand elle échoue, elle lève, et Next affiche son écran d'erreur —
 * une page rouge de développeur devant un paysagiste.
 *
 * LA SOLUTION RETENUE : un message éphémère déposé dans un COOKIE par
 * l'action, lu par la mise en page, affiché puis effacé par le
 * navigateur.
 *
 * Pourquoi un cookie plutôt que `useActionState` : ce dernier
 * demanderait de convertir chaque formulaire en composant client et de
 * réécrire la signature de chaque action. Le cookie marche avec les
 * formulaires TELS QU'ILS SONT — on ajoute une ligne dans l'action, et
 * rien ailleurs. Il traverse aussi les `redirect()`, ce qu'un état
 * React ne fait pas : « Devis créé » doit s'afficher sur la fiche du
 * devis, pas sur la page qu'on vient de quitter.
 *
 * Le cookie n'est PAS `httpOnly` : c'est le composant client qui
 * l'efface après affichage, sinon le message reviendrait à chaque
 * navigation. Il ne contient qu'un texte destiné à l'écran, jamais une
 * donnée sensible — on ne met pas un identifiant ni un jeton dans un
 * message de confirmation.
 */

export { FLASH_COOKIE } from "./flashShared";
export type { Flash, FlashTone } from "./flashShared";

/**
 * Dépose un message pour le prochain rendu.
 *
 * À appeler DANS une Server Action, avant le `redirect()` ou le
 * `revalidatePath()`. Silencieux si le contexte n'autorise pas
 * l'écriture de cookies — un message manquant ne doit jamais faire
 * échouer l'action qu'il accompagne.
 */
export async function flash(tone: FlashTone, message: string, action?: Flash["action"]) {
  try {
    const store = await cookies();
    store.set(FLASH_COOKIE, JSON.stringify({ tone, message, action } satisfies Flash), {
      path: "/",
      // Trente secondes : le temps d'un rendu. Au-delà, le message
      // porterait sur une action que l'utilisateur a oubliée.
      maxAge: 30,
      sameSite: "lax",
      httpOnly: false,
    });
  } catch {
    // Un Server Component ne peut pas écrire de cookie. C'est attendu :
    // seules les Server Actions appellent cette fonction.
  }
}

/** Lit le message en attente, sans l'effacer — c'est le client qui efface. */
export async function readFlash(): Promise<Flash | null> {
  const store = await cookies();
  const raw = store.get(FLASH_COOKIE)?.value;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Flash;
    if (typeof parsed?.message !== "string" || parsed.message.length === 0) return null;
    if (parsed.tone !== "success" && parsed.tone !== "error" && parsed.tone !== "info") {
      return null;
    }
    // Un lien de rattrapage ne peut viser que ce site : le message
    // vient de nous, mais le cookie est lisible et modifiable par le
    // navigateur, et un lien absolu en ferait une redirection ouverte.
    if (parsed.action && !parsed.action.href.startsWith("/")) {
      return { tone: parsed.tone, message: parsed.message };
    }
    return parsed;
  } catch {
    return null;
  }
}
