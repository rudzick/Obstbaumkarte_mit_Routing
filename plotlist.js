// Parzellenliste als CSV für Excel: eine Spalte, das BOM sorgt für die richtigen Umlaute.
function csvCell(value) {
    // Excel läse 12/3 oder 3-4 als Datum, 012 als Zahl und führte =… als Formel aus;
    // ="…" erzwingt in allen diesen Fällen Text
    const text = /^\d+[\/.\-]\d/.test(value) || /^0\d/.test(value) || /^[=+\-@\t\r]/.test(value)
	? '="' + value.replace(/"/g, '""') + '"'
	: value;
    return '"' + text.replace(/"/g, '""') + '"';
}

export function plotListCsv(refs) {
    return '﻿' + ['Parzelle', ...refs].map(csvCell).join('\r\n') + '\r\n';
}
