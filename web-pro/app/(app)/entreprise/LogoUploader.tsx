"use client";

import { useRef, useState, useTransition } from "react";
import { CompanyAvatar } from "@/components/ui";
import { uploadCompanyLogo, removeCompanyLogo } from "@/lib/company/actions";

/**
 * §12 LOGO SOCIÉTÉ — « Support PNG, JPEG, WEBP. Compression. Crop si
 * nécessaire. »
 *
 * LA COMPRESSION SE FAIT ICI, AVANT L'ENVOI. Un logo est presque
 * toujours un fichier de plusieurs mégaoctets exporté d'un logiciel de
 * dessin, alors qu'il s'affiche à trente-deux pixels dans la barre
 * latérale. Le redimensionner dans le navigateur épargne l'envoi, le
 * stockage, et surtout le téléchargement — l'image part ensuite sur
 * chaque devis et dans le portail de chaque client.
 *
 * Le CADRAGE est « contain » sur un carré, pas « cover » : un logo
 * rectangulaire recadré au carré perdrait ses bords, et le nom de
 * l'entreprise avec. Mieux vaut de l'espace autour que la moitié du
 * mot.
 */
const SIZE = 512;

async function shrink(file: File): Promise<File> {
  // Un navigateur sans `createImageBitmap` ou sans canvas exploitable
  // renvoie le fichier d'origine : mieux vaut un envoi lourd qu'un
  // bouton qui ne fait rien.
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height, 1);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);

    // WebP pour la taille ; PNG si l'image a de la transparence à
    // préserver — un logo posé sur fond blanc dans une barre latérale
    // blanche ne doit pas hériter d'un rectangle gris.
    const type = file.type === "image/png" ? "image/png" : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.92),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name, { type });
  } catch {
    return file;
  }
}

export function LogoUploader({
  organizationName,
  logoUrl,
}: {
  organizationName: string;
  logoUrl: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);

    const prepared = await shrink(file);
    const payload = new FormData();
    payload.set("logo", prepared);

    startTransition(async () => {
      const result = await uploadCompanyLogo(payload);
      if (!result.ok) setError(result.error ?? "L'envoi a échoué.");
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <CompanyAvatar name={organizationName} logoUrl={logoUrl} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={pending}
            className="inline-flex items-center rounded-[var(--radius-control)] border border-line-strong bg-surface px-3.5 py-2 text-[var(--text-secondary)] font-medium transition-colors hover:bg-canvas disabled:opacity-50"
          >
            {pending ? "Envoi…" : logoUrl ? "Changer le logo" : "Ajouter mon logo"}
          </button>

          {logoUrl && (
            <form action={removeCompanyLogo}>
              <button
                type="submit"
                className="inline-flex items-center rounded-[var(--radius-control)] px-3 py-2 text-[var(--text-secondary)] text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
              >
                Retirer
              </button>
            </form>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onPick}
            className="hidden"
          />
        </div>

        <p className="mt-2 text-[var(--text-secondary)] text-ink-faint">
          PNG, JPEG ou WebP. L&apos;image est réduite à {SIZE} px dans votre
          navigateur avant l&apos;envoi — elle apparaîtra sur vos devis, vos
          factures et dans le portail de vos clients.
        </p>

        {!logoUrl && (
          <p className="mt-1 text-[var(--text-secondary)] text-ink-faint">
            Sans logo, Oasis Care Pro affiche vos initiales dans une pastille de
            couleur. C&apos;est déjà lisible ; un logo, c&apos;est reconnaissable.
          </p>
        )}

        {error && (
          <p className="mt-2 rounded-[var(--radius-control)] bg-critical-wash px-3 py-2 text-[var(--text-secondary)] text-critical">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
