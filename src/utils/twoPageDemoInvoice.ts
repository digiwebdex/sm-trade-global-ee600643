/**
 * Demo data for a 2-page invoice PDF (reproduces INV-2026-0010 total-clip case).
 * Used by unit tests and manual QA: create an invoice with these line items,
 * download PDF, confirm "Total Amount" appears on the last page.
 */
export function buildTwoPageDemoInvoiceItems(extraBlankRows = 35) {
  const real = [
    { description: 'FILE FOLDER', quantity: 1000, unitPrice: 424.83, total: 424830 },
    { description: 'BAG', quantity: 2000, unitPrice: 425, total: 850000 },
    { description: 'BAG', quantity: 1500, unitPrice: 435, total: 652500 },
    { description: 'BAG', quantity: 1500, unitPrice: 450, total: 675000 },
    { description: 'BAG', quantity: 1500, unitPrice: 455, total: 682500 },
    { description: 'BAG', quantity: 1500, unitPrice: 460, total: 690000 },
    { description: 'BAG', quantity: 1500, unitPrice: 465, total: 697500 },
    { description: 'BAG', quantity: 1500, unitPrice: 470, total: 705000 },
    { description: 'BAG', quantity: 500, unitPrice: 475, total: 237500 },
    { description: 'BAG', quantity: 1000, unitPrice: 480, total: 480000 },
    { description: 'TIE', quantity: 1000, unitPrice: 310, total: 310000 },
    { description: 'TIE', quantity: 1000, unitPrice: 312, total: 312000 },
  ];

  const blanks = Array.from({ length: extraBlankRows }, (_, i) => ({
    description: ` `,
    quantity: 1,
    unitPrice: 0,
    total: 0,
    id: `blank-${i}`,
  }));

  const items = [
    ...real.map((r, i) => ({ ...r, id: `item-${i}` })),
    ...blanks,
  ];

  const totalAmount = real.reduce((s, r) => s + r.total, 0);
  return {
    invoiceNumber: 'INV-2026-0010-DEMO',
    customerName: 'Md Saddam Hossain',
    date: '2026-04-09',
    items,
    totalAmount,
    tax: 0,
    totalPaid: 0,
    status: 'partial' as const,
  };
}
