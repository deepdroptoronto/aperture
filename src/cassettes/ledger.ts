import type { Cassette } from '../copper/types';

export interface LedgerItem {
  description?: string;
  quantity?: number;
  unitPrice?: number;
}

export interface LedgerPayload {
  invoiceId?: string;
  currency?: string;
  taxRate?: number;
  items?: LedgerItem[];
}

export interface LedgerLine {
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
}

export interface LedgerInvoice {
  invoiceId: string;
  currency: string;
  lines: LedgerLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export const cassette = 'ledger';

function money(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
  return Math.round(value * 100);
}

export function create(): Cassette<LedgerPayload, LedgerInvoice> {
  let invoices = 0;

  return {
    handle(payload) {
      if (!Array.isArray(payload.items) || payload.items.length === 0) {
        throw new Error('items must be a non-empty array');
      }

      const taxRate = payload.taxRate ?? 0;
      if (typeof taxRate !== 'number' || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
        throw new Error('taxRate must be a fraction between 0 and 1');
      }

      const lines: LedgerLine[] = payload.items.map((item, index) => {
        const quantity = item.quantity ?? 1;
        if (!Number.isInteger(quantity) || quantity < 1) {
          throw new Error(`items[${index}].quantity must be a positive integer`);
        }
        const unitPriceCents = money(item.unitPrice, `items[${index}].unitPrice`);
        return {
          description: item.description ?? `Line ${index + 1}`,
          quantity,
          unitPriceCents,
          totalCents: quantity * unitPriceCents,
        };
      });

      const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
      const taxCents = Math.round(subtotalCents * taxRate);
      invoices += 1;

      return {
        invoiceId: payload.invoiceId ?? `inv_${invoices.toString().padStart(4, '0')}`,
        currency: payload.currency ?? 'USD',
        lines,
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
      };
    },
  };
}
