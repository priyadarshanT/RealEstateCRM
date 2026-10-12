import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export interface Sheet {
  headers: string[];
  rows: Record<string, string>[];
}

export const MAX_IMPORT_ROWS = 20_000;

/** Reads the first sheet of an .xlsx file, or a .csv file; the first row holds the column headers. */
export async function readSheet(body: Buffer, mimeType: string, fileName: string): Promise<Sheet> {
  const isCsv = mimeType === 'text/csv' || /\.csv$/i.test(fileName);
  return isCsv ? readCsv(body) : readXlsx(body);
}

function readCsv(body: Buffer): Sheet {
  const records: string[][] = parse(body, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  const [header = [], ...data] = records;
  const headers = header.map((h) => h.trim());
  return { headers, rows: data.slice(0, MAX_IMPORT_ROWS).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

async function readXlsx(body: Buffer): Promise<Sheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellText(cell.value).trim();
  });
  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, number) => {
    if (number === 1 || rows.length >= MAX_IMPORT_ROWS) return;
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) record[h] = cellText(row.getCell(i + 1).value).trim();
    });
    if (Object.values(record).some(Boolean)) rows.push(record);
  });
  return { headers: headers.filter(Boolean), rows };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value) return String(value.result ?? '');
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('hyperlink' in value) return String((value as { text?: string }).text ?? value.hyperlink);
  }
  // Large phone numbers typed into Excel cells become numbers: keep every digit.
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
  return String(value);
}
