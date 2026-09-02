"use client";

/**
 * Le téléchargement des trois fichiers.
 *
 * Le CSV est fabriqué dans le navigateur à partir de données déjà
 * chargées : aucun aller-retour de plus, et surtout aucune route
 * publique qui rendrait des chiffres comptables sur simple URL.
 *
 * Séparateur POINT-VIRGULE et BOM UTF-8, tous deux nécessaires : Excel
 * en français lit la virgule comme un séparateur décimal, et ouvre un
 * fichier sans BOM en mangeant les accents. Deux détails qui font la
 * différence entre un export utilisable et un export qu'on renvoie.
 */

type Row = Record<string, string | number>;

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);

  const cell = (value: string | number) => {
    if (typeof value === "number") {
      // Virgule décimale : c'est ce qu'attend un tableur français.
      return value.toFixed(2).replace(".", ",");
    }
    const text = String(value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [
    headers.join(";"),
    ...rows.map((row) => headers.map((h) => cell(row[h])).join(";")),
  ].join("\r\n");
}

function download(filename: string, rows: Row[]) {
  // Le BOM en tête, sinon Excel affiche « FacturÃ© ».
  const blob = new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportButtons({
  from, to, invoices, payments, expenses,
}: {
  from: string;
  to: string;
  invoices: Row[];
  payments: Row[];
  expenses: Row[];
}) {
  const period = `${from}_${to}`;

  const files = [
    { label: "Factures", rows: invoices, name: `factures_${period}.csv` },
    { label: "Encaissements", rows: payments, name: `encaissements_${period}.csv` },
    { label: "Dépenses", rows: expenses, name: `depenses_${period}.csv` },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {files.map((file) => (
        <button
          key={file.label}
          onClick={() => download(file.name, file.rows)}
          disabled={file.rows.length === 0}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink disabled:opacity-40"
        >
          {file.label} ({file.rows.length})
        </button>
      ))}
    </div>
  );
}
