"use client";

import { useEffect } from "react";
import { announceWebPresence } from "./browser.ts";
import { declareWebPresence } from "./actions.ts";

/**
 * LE DÉCLENCHEUR — un composant qui n'affiche rien.
 *
 * Posé une fois dans la coquille de l'application (`app/(app)/layout.tsx`),
 * il annonce la présence de cette installation web au premier montage,
 * puis se tait. Il rend `null` : ce n'est pas de l'interface, c'est un
 * effet de bord qui avait besoin d'un endroit où vivre.
 *
 * POURQUOI DANS LA COQUILLE ET PAS DANS CHAQUE PAGE. Dans l'App Router,
 * une mise en page n'est PAS remontée d'une page à l'autre : l'effet ne
 * repart donc pas à chaque navigation. Il repart en revanche à chaque
 * rechargement complet, et c'est le drapeau de session d'`install.ts`
 * qui rattrape ces cas-là. Deux verrous, un par échelle.
 *
 * POURQUOI DANS LA COQUILLE `(app)` ET NULLE PART AILLEURS. Cette
 * mise en page a déjà refusé l'accès aux visiteurs (`redirect("/login")`)
 * et à ceux qui n'ont pas d'entreprise. Ce qui est compté est donc bien
 * « un compte qui utilise Oasis Care Pro », et pas un passage sur la
 * page de connexion ou sur le portail client.
 *
 * `void` devant l'appel : la promesse est délibérément abandonnée, et
 * `announceWebPresence` garantit qu'elle ne rejette jamais. Rien
 * n'attend ce résultat, surtout pas le rendu.
 */
export function PresenceReporter() {
  useEffect(() => {
    void announceWebPresence(declareWebPresence);
  }, []);

  return null;
}
