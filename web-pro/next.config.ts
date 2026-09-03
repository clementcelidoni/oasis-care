import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * §11V — LE RUNTIME DES AGENTS TOURNE DANS CE SERVEUR, PAS EN EDGE.
   *
   * `@openai/agents` et `openai` sont chargés par `require` depuis
   * `node_modules` au lieu d'être tracés et empaquetés avec le code des
   * Server Components. Aucun des deux ne figure dans la liste que
   * Next.js externalise d'office — voir
   * `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md` —
   * donc sans cette ligne, ils sont empaquetés.
   *
   * POURQUOI. `openai` charge `net`, `tls` et `worker_threads`, et
   * choisit ses points d'entrée par « conditional exports » selon
   * l'environnement. Un paquet réécrit par un bundler peut se retrouver
   * à l'exécution avec une variante qui n'est pas celle prévue pour
   * Node — et l'erreur, quand elle arrive, arrive au premier appel réel
   * d'un agent, pas au build. C'est aussi ce que l'éditeur signale par
   * son emballage : `@openai/agents-core` livre des shims pour
   * « workerd » et « browser », et AUCUN pour Deno. Il vise Node. C'est
   * la mesure sur laquelle repose la décision de faire tourner ce
   * runtime ici plutôt que dans une fonction Edge Supabase.
   *
   * MESURÉ, POUR ÊTRE HONNÊTE : avec Next 16 et Turbopack, le build
   * passe dans les deux cas, et en 14 s dans les deux cas, sur une page
   * qui importe `@/lib/ai/model`. Cette ligne n'est donc PAS ce qui
   * répare un build cassé aujourd'hui — c'est ce qui évite qu'un paquet
   * conçu pour être chargé par Node soit réécrit par un outil qui n'a
   * aucune raison de le faire.
   *
   * CONSÉQUENCE AU DÉPLOIEMENT : `node_modules` doit être présent à
   * l'exécution pour ces deux paquets ; ils ne sont plus copiés dans la
   * sortie du build.
   *
   * Les fonctions Edge Supabase (`oasis-pro-ai`, `plant-ai-assistant`,
   * `garden-ai-assistant`, `biolab-ai-assistant`…) restent en place et
   * ne sont pas concernées : elles appellent l'API OpenAI en HTTP, sans
   * ces paquets.
   */
  serverExternalPackages: ["@openai/agents", "openai"],
};

export default nextConfig;
