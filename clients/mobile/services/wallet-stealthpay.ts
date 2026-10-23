/**
 * Pure helpers for LinqaStealthPay one-time invoices: the code format, what a scanned QR may contain, how a code is
 * shown, and the QR matrix. A code is an opaque, single-use reference to an invoice. It is not an account number, and it
 * carries no amount or identity of its own: the server resolves it.
 */
import qrcode from "qrcode-generator";

export const INVOICE_CODE = /^inv_[A-Za-z0-9]{6,64}$/;
const SCHEME = "linqa-invoice:";

export type WalletInvoice = {
  id: string;
  code: string;
  merchantName: string;
  baseAmountMinor: string;
  currency: string;
  expiresAt: string;
};

/** The text encoded in an invoice QR. */
export const invoicePayload = (code: string): string => `${SCHEME}${code}`;

/** A scanned or typed value to an invoice code, or null if it isn't one. Anything else a QR may hold is rejected. */
export function parseInvoiceInput(raw: string): string | null {
  const text = raw.trim();
  const code = text.startsWith(SCHEME) ? text.slice(SCHEME.length) : text;
  return INVOICE_CODE.test(code) ? code : null;
}

/** "inv_st1...9x3p": enough to recognise a code without displaying all of it. */
export function maskInvoiceCode(code: string): string {
  return code.length <= 12 ? code : `${code.slice(0, 7)}...${code.slice(-4)}`;
}

/** QR modules (true = dark). High error correction so a logo can sit in the middle. */
export function qrMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, "H");
  qr.addData(payload);
  qr.make();
  const size = qr.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => qr.isDark(row, col)));
}

/** One SVG path covering every dark module, so a QR is a single element rather than hundreds. */
export function qrPath(matrix: boolean[][]): string {
  let d = "";
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
  return d;
}
