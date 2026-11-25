import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character] || character));
}

export async function shareSpreadsheet(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) throw new Error('There is no report data to export.');
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Attendance');
  const data = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
  const uri = `${FileSystem.cacheDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, data, { encoding: FileSystem.EncodingType.Base64 });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
  else throw new Error('File sharing is not available on this device.');
}

export async function sharePdf(title: string, headings: string[], rows: unknown[][]) {
  if (!rows.length) throw new Error('There is no report data to export.');
  const tableHead = headings.map((heading) => `<th>${escapeHtml(heading)}</th>`).join('');
  const tableRows = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>
    body{font-family:Arial,sans-serif;color:#111827;padding:22px}header{text-align:center;border-bottom:2px solid #1e3a8a;padding-bottom:12px}
    h1{font-size:18px;color:#1e3a8a;margin:5px}p{margin:4px;font-size:10px;color:#4b5563}
    table{width:100%;border-collapse:collapse;margin-top:18px;font-size:10px}th,td{border:1px solid #64748b;padding:6px;text-align:center}
    th{background:#dbeafe}tr{page-break-inside:avoid}
    </style></head><body><header><p>THANTHAI HANS ROEVER COLLEGE (AUTONOMOUS)</p><p>ELAMBALUR (P.O), PERAMBALUR – 621 220</p><h1>${escapeHtml(title)}</h1></header>
    <table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
  const file = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title });
  else throw new Error('File sharing is not available on this device.');
}
