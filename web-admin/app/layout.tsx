import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Le titre de l'onglet dit « Control Center », pas « Oasis Care ».
 *
 * Un administrateur travaille avec les trois applications ouvertes en
 * même temps ; c'est souvent l'onglet, réduit à quinze caractères, qui
 * lui sert à retrouver la bonne.
 *
 * `robots: noindex` double l'en-tête `X-Robots-Tag` posé dans
 * `next.config.ts`. Deux protections pour la même chose, parce qu'un
 * en-tête peut se perdre derrière un reverse-proxy mal configuré, et
 * que la balise, elle, part avec la page.
 */
export const metadata: Metadata = {
  title: "Oasis Care — Control Center",
  description: "Administration de la plateforme Oasis Care. Usage interne.",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
