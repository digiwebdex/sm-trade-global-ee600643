import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { api } from '@/utils/api';
import { formatBDT } from '@/lib/utils';
import { generateId, generateDocNumber } from '@/utils/documentNumbers';
import { Invoice, LineItem, Customer, Payment } from '@/types';
import DocumentPreview, { printDocument, downloadDocument } from '@/components/DocumentPreview';
import { toast } from 'sonner';
import { Plus, Trash2, Eye, ArrowLeft, Search, Pencil, Printer, Share2, Download } from 'lucide-react';
import SignatureUploadField from '@/components/SignatureUploadField';

const emptyItem = (): LineItem => ({ id: generateId(), description: '', quantity: 1, unitPrice: 0, total: 0 });
const emptyPayment = (): Payment => ({ id: generateId(), date: new Date().toISOString().split('T')[0], method: 'Cash', description: '', amount: 0 });

export default function InvoicesPage() {
  const navigate = useNavigate();
  const { action } = useParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getInvoices() as Invoice[];
      setInvoices(data);
    } catch (err) {
      setLoadError(true);
      toast.error('Failed to load invoices. Please log out and log in again.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [action]);

  if (action === 'new' || action?.startsWith('edit-')) {
    return <InvoiceForm editId={action.startsWith('edit-') ? action.replace('edit-', '') : undefined} onDone={() => { load(); navigate('/invoices'); }} />;
  }

  if (action?.startsWith('view-')) {
    return <InvoiceView id={action.replace('view-', '')} onBack={() => navigate('/invoices')} />;
  }

  const filtered = invoices.filter(i =>
    (i.invoiceNumber || '').toLowerCase().includes(search.toLowerCase()) ||
    (i.customerName || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (confirm('Delete this invoice?')) {
      try {
        await api.deleteInvoice(id);
        toast.success('Invoice deleted');
        load();
      } catch (err) { toast.error('Failed to delete invoice'); }
    }
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, { className: string; label: string }> = {
      paid: { className: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Paid' },
      partial: { className: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Partial' },
      processing: { className: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'Processing' },
      complete: { className: 'bg-teal-100 text-teal-700 border-teal-200', label: 'Complete' },
      sent: { className: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Due' },
      draft: { className: 'bg-gray-100 text-gray-600 border-gray-200', label: 'Draft' },
    };
    const v = variants[status] || variants.draft;
    return <Badge variant="outline" className={`${v.className} font-semibold text-xs`}>{v.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Invoices / Bills</h1>
          <p className="text-muted-foreground">Manage bills and invoices</p>
        </div>
        <Button onClick={() => navigate('/invoices/new')} className="bg-secondary hover:bg-secondary/90">
          <Plus className="h-4 w-4 mr-2" /> New Invoice
        </Button>
      </div>
      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by invoice # or customer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount (BDT)</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-32 text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading invoices...</TableCell></TableRow>
              ) : loadError ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Could not load invoices. Log out and log in again, or contact support.</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{search ? 'No invoices match your search' : 'No invoices found'}</TableCell></TableRow>
              ) : filtered.map((inv) => (
                <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/invoices/view-${inv.id}`)}>
                  <TableCell className="font-bold text-primary">{inv.invoiceNumber}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{inv.customerName}</p>
                      <p className="text-xs text-muted-foreground">{inv.customerAddress}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{new Date(inv.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</TableCell>
                  <TableCell className="text-right font-bold">৳{formatBDT(Number(inv.totalAmount))}</TableCell>
                  <TableCell className="text-center">{statusBadge(inv.status)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" onClick={() => navigate(`/invoices/view-${inv.id}`)} title="View"><Eye className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => navigate(`/invoices/edit-${inv.id}`)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => handleDelete(inv.id)} className="text-destructive" title="Delete"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function InvoiceForm({ editId, onDone }: { editId?: string; onDone: () => void }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [existing, setExisting] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([]);

  const [form, setForm] = useState({
    customerId: '',
    customerName: '',
    customerAddress: '',
    customerPhone: '',
    customerEmail: '',
    date: new Date().toISOString().split('T')[0],
    invoiceNumber: '',
    items: [emptyItem()],
    status: 'draft' as 'draft' | 'sent' | 'paid' | 'partial',
    tax: 0,
    payments: [] as Payment[],
    notes: '',
    amountInWords: '',
    signatureReceived: '',
    signaturePrepared: '',
    signatureAuthorize: '',
  });

  useEffect(() => {
    const init = async () => {
      try {
        const [custs, invs] = await Promise.all([
          api.getCustomers() as Promise<Customer[]>,
          api.getInvoices() as Promise<Invoice[]>,
        ]);
        setCustomers(custs);
        setAllInvoices(invs);

        let editData: Invoice | null = null;
        if (editId) {
          editData = await api.getInvoice(editId) as Invoice;
          setExisting(editData);
        }

        setForm({
          customerId: editData?.customerId || '',
          customerName: editData?.customerName || '',
          customerAddress: editData?.customerAddress || '',
          customerPhone: editData?.customerPhone || '',
          customerEmail: editData?.customerEmail || '',
          date: editData?.date ? editData.date.split('T')[0] : new Date().toISOString().split('T')[0],
          invoiceNumber: editData?.invoiceNumber || generateDocNumber('INV', invs.map(i => i.invoiceNumber)),
          items: editData?.items ? editData.items.map(i => ({ ...i, quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0, total: Number(i.total) || 0 })) : [emptyItem()],
          status: editData?.status || 'draft',
          tax: Number(editData?.tax) || 0,
          payments: editData?.payments ? editData.payments.map(p => ({ ...p, amount: Number(p.amount) || 0 })) : [],
          notes: editData?.notes || '',
          amountInWords: editData?.amountInWords || '',
          signatureReceived: editData?.signatureReceived || '',
          signaturePrepared: editData?.signaturePrepared || '',
          signatureAuthorize: editData?.signatureAuthorize || '',
        });
      } catch (err) { toast.error('Failed to load data'); }
      setLoading(false);
    };
    init();
  }, [editId]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;

  const selectCustomer = (id: string) => {
    const c = customers.find(c => c.id === id);
    if (c) setForm({ ...form, customerId: c.id, customerName: c.name, customerAddress: `${c.organization}\n${c.address}`, customerPhone: c.phone, customerEmail: c.email });
  };

  const parseItems = (items: LineItem[]): LineItem[] => items.map(i => ({
    ...i,
    quantity: Number(i.quantity) || 0,
    unitPrice: Number(i.unitPrice) || 0,
    total: Number(i.total) || 0,
  }));

  const parsePayments = (payments: Payment[]): Payment[] => payments.map(p => ({
    ...p,
    amount: Number(p.amount) || 0,
  }));

  const updateItem = (index: number, field: keyof LineItem, value: any) => {
    const items = [...form.items];
    (items[index] as any)[field] = value;
    items[index].quantity = Number(items[index].quantity) || 0;
    items[index].unitPrice = Number(items[index].unitPrice) || 0;
    items[index].total = items[index].quantity * items[index].unitPrice;
    setForm({ ...form, items });
  };

  const updatePayment = (index: number, field: keyof Payment, value: any) => {
    const payments = [...form.payments];
    (payments[index] as any)[field] = value;
    if (field === 'amount') payments[index].amount = Number(payments[index].amount) || 0;
    setForm({ ...form, payments });
  };

  const subtotal = form.items.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const grandTotal = subtotal + (form.tax || 0);
  const totalPaid = form.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const autoStatus = totalPaid >= grandTotal && grandTotal > 0 ? 'paid' : totalPaid > 0 ? 'partial' : form.status;

  const handleSave = async () => {
    if (!form.customerName) { toast.error('Select a customer'); return; }
    if (form.items.every(i => !i.description)) { toast.error('Add at least one item'); return; }
    const data: Invoice = {
      ...form,
      id: editId || generateId(),
      totalAmount: subtotal,
      totalPaid,
      status: autoStatus as any,
      createdAt: existing?.createdAt || new Date().toISOString()
    };
    try {
      if (editId) await api.updateInvoice(editId, data);
      else await api.createInvoice(data);
      toast.success(editId ? 'Invoice updated' : 'Invoice created');
      onDone();
    } catch (err) { toast.error('Failed to save invoice'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onDone}><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button>
        <h1 className="text-2xl font-bold">{editId ? 'Edit Invoice' : 'New Invoice'}</h1>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Invoice Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-sm font-medium">Invoice #</label><Input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} className="font-bold" /></div>
              <div><label className="text-sm font-medium">Date</label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            </div>
            <div>
              <label className="text-sm font-medium">Select Customer (or type manually below)</label>
              <Select value={form.customerId} onValueChange={selectCustomer}>
                <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                <SelectContent>{customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name} - {c.organization}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div><label className="text-sm font-medium">Customer Name *</label><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Customer name" /></div>
              <div><label className="text-sm font-medium">Customer Email</label><Input value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} placeholder="Email" /></div>
              <div><label className="text-sm font-medium">Customer Phone</label><Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} placeholder="Phone" /></div>
              <div><label className="text-sm font-medium">Customer Address</label><Textarea value={form.customerAddress} onChange={(e) => setForm({ ...form, customerAddress: e.target.value })} placeholder="Address" rows={2} /></div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-3">
                <label className="text-sm font-semibold flex items-center gap-2" style={{ color: '#1B3A5C' }}>
                  <span className="text-lg">$</span> Line Items
                </label>
                <Button size="sm" variant="outline" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })}><Plus className="h-3 w-3 mr-1" /> Add Item</Button>
              </div>
              <div className="space-y-3">
                {form.items.map((item, i) => (
                  <div key={item.id} className="border rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-muted-foreground">{i + 1}.</span>
                      <Input className="flex-1" placeholder="Item description" value={item.description} onChange={(e) => updateItem(i, 'description', e.target.value)} />
                      <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive shrink-0" onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                        <Input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)} className="text-center" />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Unit Price</label>
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground">৳</span>
                          <Input type="number" value={item.unitPrice} onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)} />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground mb-1 block">Total</label>
                        <div className="text-right text-sm font-bold pt-2" style={{ color: '#1B3A5C' }}>৳{formatBDT(item.total)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-right mt-3 text-sm" style={{ color: '#1B3A5C' }}>
                <div>Subtotal: ৳{formatBDT(subtotal)}</div>
              </div>
            </div>

            <div><label className="text-sm font-medium">Tax Amount</label><Input type="number" value={form.tax} onChange={(e) => setForm({ ...form, tax: parseFloat(e.target.value) || 0 })} placeholder="0.00" /></div>
            <div className="text-right text-lg font-bold" style={{ color: '#1B3A5C' }}>Total: ৳{formatBDT(grandTotal)}</div>
            <div><label className="text-sm font-medium">Status</label>
              <Select value={form.status} onValueChange={(v: any) => setForm({ ...form, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="processing">Processing</SelectItem><SelectItem value="sent">Due</SelectItem><SelectItem value="partial">Partial</SelectItem><SelectItem value="complete">Complete</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent></Select></div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium">Payments</label>
                <Button size="sm" variant="outline" onClick={() => setForm({ ...form, payments: [...form.payments, emptyPayment()] })}><Plus className="h-3 w-3 mr-1" /> Add Payment</Button>
              </div>
              {form.payments.map((p, i) => (
                <div key={p.id} className="grid grid-cols-12 gap-2 items-center mb-2">
                  <Input className="col-span-3" type="date" value={p.date} onChange={(e) => updatePayment(i, 'date', e.target.value)} />
                  <Select value={p.method} onValueChange={(v: any) => updatePayment(i, 'method', v)}>
                    <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Bank">Bank</SelectItem>
                      <SelectItem value="bKash">bKash</SelectItem>
                      <SelectItem value="Nagad">Nagad</SelectItem>
                      <SelectItem value="Check">Check</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input className="col-span-3" placeholder="Description" value={p.description} onChange={(e) => updatePayment(i, 'description', e.target.value)} />
                  <Input className="col-span-3" type="number" placeholder="Amount" value={p.amount} onChange={(e) => updatePayment(i, 'amount', parseFloat(e.target.value) || 0)} />
                  <Button size="icon" variant="ghost" className="col-span-1 text-destructive" onClick={() => setForm({ ...form, payments: form.payments.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3" /></Button>
                </div>
              ))}
              {totalPaid > 0 && (
                <div className="flex justify-between text-sm mt-2">
                  <span className="text-muted-foreground">Total Paid: ৳{formatBDT(totalPaid)}</span>
                  <span className={`font-bold ${grandTotal - totalPaid > 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                    Balance: ৳{formatBDT(grandTotal - totalPaid)}
                  </span>
                </div>
              )}
            </div>

            <div><label className="text-sm font-medium">Amount in Words</label><Input value={form.amountInWords} onChange={(e) => setForm({ ...form, amountInWords: e.target.value })} placeholder="Auto-generated if empty" /></div>
            
            <div>
              <label className="text-sm font-medium mb-2 block">Signatures (optional - overrides company defaults)</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'signatureReceived' as const, label: 'Received by' },
                  { key: 'signaturePrepared' as const, label: 'Prepared by' },
                  { key: 'signatureAuthorize' as const, label: 'Authorize by' },
                ].map(({ key, label }) => (
                  <SignatureUploadField key={key} label={label} value={form[key]} onChange={(v) => setForm({ ...form, [key]: v })} />
                ))}
              </div>
            </div>

            <div><label className="text-sm font-medium">Notes</label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <Button onClick={handleSave} className="w-full bg-secondary hover:bg-secondary/90">Save Invoice</Button>
          </CardContent>
        </Card>
        <div className="print-target">
          <DocumentPreview 
            type="invoice" 
            documentNumber={form.invoiceNumber} 
            date={form.date} 
            customerName={form.customerName} 
            customerAddress={form.customerAddress} 
            customerPhone={form.customerPhone} 
            customerEmail={form.customerEmail}
            items={form.items} 
            totalAmount={subtotal} 
            tax={form.tax}
            totalPaid={totalPaid}
            payments={form.payments}
            notes={form.notes} 
            status={autoStatus} 
            amountInWords={form.amountInWords}
            signatureReceived={form.signatureReceived}
            signaturePrepared={form.signaturePrepared}
            signatureAuthorize={form.signatureAuthorize}
          />
        </div>
      </div>
    </div>
  );
}

function InvoiceView({ id, onBack }: { id: string; onBack: () => void }) {
  const navigate = useNavigate();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getInvoice(id).then((d: any) => { setInv(d); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  if (!inv) return <div>Invoice not found</div>;

   const handleDownload = () => {
     downloadDocument(inv.invoiceNumber);
   };

  const handleShare = async () => {
    const shareData = {
      title: `Invoice ${inv.invoiceNumber}`,
      text: `Invoice ${inv.invoiceNumber} - ${inv.customerName} - BDT ${formatBDT(inv.totalAmount)}`,
      url: window.location.href,
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied to clipboard!');
    }
  };

  return (
    <div className="space-y-4">
      <div className="no-print">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" /> Back</Button>
          <div>
            <h1 className="text-2xl font-bold">{inv.invoiceNumber}</h1>
            <p className="text-sm text-muted-foreground">Invoice Preview</p>
          </div>
          <Badge variant="outline" className={
            inv.status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 
            inv.status === 'partial' ? 'bg-orange-100 text-orange-700' :
            inv.status === 'sent' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
          }>
            {inv.status === 'sent' ? 'Unpaid' : inv.status === 'partial' ? 'Partial' : inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-3 mb-4">
          <Button onClick={handleDownload} variant="outline" className="gap-2"><Download className="h-4 w-4" /> Download Invoice</Button>
          <Button onClick={() => printDocument(inv.invoiceNumber)} variant="outline" className="gap-2"><Printer className="h-4 w-4" /> Print</Button>
          <Button onClick={handleShare} variant="outline" className="gap-2"><Eye className="h-4 w-4" /> Share</Button>
          <Button onClick={() => navigate(`/invoices/edit-${id}`)} variant="outline" className="gap-2"><Pencil className="h-4 w-4" /> Quick Edit</Button>
          <Button onClick={() => navigate(`/invoices/edit-${id}`)} className="bg-secondary hover:bg-secondary/90 gap-2"><Pencil className="h-4 w-4" /> Full Edit</Button>
        </div>
      </div>
      <DocumentPreview 
        type="invoice" 
        documentNumber={inv.invoiceNumber} 
        date={inv.date} 
        customerName={inv.customerName} 
        customerAddress={inv.customerAddress} 
        customerPhone={inv.customerPhone} 
        customerEmail={inv.customerEmail}
        items={inv.items} 
        totalAmount={inv.totalAmount} 
        tax={inv.tax}
        totalPaid={inv.totalPaid}
        payments={inv.payments}
        notes={inv.notes} 
        status={inv.status} 
        amountInWords={inv.amountInWords}
        signatureReceived={inv.signatureReceived}
        signaturePrepared={inv.signaturePrepared}
        signatureAuthorize={inv.signatureAuthorize}
      />
    </div>
  );
}
