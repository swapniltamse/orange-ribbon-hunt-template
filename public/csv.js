// Every cell is quoted, and a leading formula character is neutralized,
// so nothing a resident typed can run when the file opens in a spreadsheet.
const cell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

export const toCsv = (rows) => rows.map((row) => row.map(cell).join(',')).join('\r\n');
