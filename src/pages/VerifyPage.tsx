import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from '@/utils/api';
import { Invoice, Quotation, Challan, PurchaseOrder } from '@/types';
import DocumentPreview from '@/components/DocumentPreview';
import { CheckCircle, XCircle, FileText } from 'lucide-react';

const NAVY = '#1B3A5C';
const GREEN = '#16a34a';

export default function VerifyPage() {
  const { type, docId } = useParams<{ type: string; docId: string }>();
  const [document, setDocument] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [found, setFound] = useState(false);

  useEffect(() => {
    if (!type || !docId) { setLoading(false); return; }

    api.verifyDocument(type, docId)
      .then((doc: any) => { setDocument(doc); setFound(true); setLoading(false); })
      .catch(() => setLoading(false));
  }, [type, docId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f7fa' }}>
        <p style={{ fontSize: '16px', color: '#666' }}>Loading...</p>
      </div>
    );
  }

  const typeLabel: Record<string, string> = {
    invoice: 'Invoice (Bill)',
    quotation: 'Quotation',
    challan: 'Challan',
    'purchase-order': 'Purchase Order',
  };

  const docType: Record<string, string> = {
    invoice: 'invoice',
    quotation: 'quotation',
    challan: 'challan',
    'purchase-order': 'purchaseOrder',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', paddingBottom: '40px' }}>
      <div style={{
        background: found ? GREEN : '#dc2626',
        padding: '16px 24px',
        textAlign: 'center',
        color: 'white',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          {found ? <CheckCircle size={28} strokeWidth={2.5} /> : <XCircle size={28} strokeWidth={2.5} />}
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0 }}>
              {found ? '✅ Document Verified' : '❌ Document Not Found'}
            </h1>
            <p style={{ fontSize: '13px', margin: '4px 0 0', opacity: 0.9 }}>
              {found
                ? `This ${typeLabel[type || ''] || 'document'} is authentic and issued by S. M. Trade International`
                : 'This document could not be verified. It may not exist or the link is invalid.'
              }
            </p>
          </div>
        </div>
      </div>

      {found && document && (
        <>
          <div style={{
            maxWidth: '794px', margin: '20px auto 16px', padding: '12px 24px',
            background: 'white', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            display: 'flex', alignItems: 'center', gap: '12px',
          }}>
            <FileText size={20} color={NAVY} />
            <div>
              <span style={{ fontSize: '14px', fontWeight: 'bold', color: NAVY }}>
                {document.invoiceNumber || document.quotationNumber || document.challanNumber || document.poNumber}
              </span>
              <span style={{ fontSize: '12px', color: '#888', marginLeft: '12px' }}>
                {typeLabel[type || '']} • {document.date}
              </span>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: GREEN }} />
              <span style={{ fontSize: '12px', color: GREEN, fontWeight: 'bold' }}>Verified</span>
            </div>
          </div>

          <div style={{ maxWidth: '840px', margin: '0 auto', padding: '0 20px' }}>
            <DocumentPreview
              type={docType[type || ''] as any}
              documentNumber={document.invoiceNumber || document.quotationNumber || document.challanNumber || document.poNumber}
              date={document.date}
              customerName={document.customerName || document.supplierName}
              customerAddress={document.customerAddress || document.supplierAddress}
              customerPhone={document.customerPhone || document.supplierPhone}
              customerEmail={document.customerEmail || document.supplierEmail}
              items={document.items}
              challanItems={type === 'challan' ? document.items : undefined}
              totalAmount={document.totalAmount}
              totalQuantity={document.totalQuantity}
              orderNo={document.orderNo}
              status={document.status}
              notes={document.notes}
              tax={document.tax}
              totalPaid={document.totalPaid}
              payments={document.payments}
              amountInWords={document.amountInWords}
              signatureReceived={document.signatureReceived}
              signaturePrepared={document.signaturePrepared}
              signatureAuthorize={document.signatureAuthorize}
              supplierName={document.supplierName}
              supplierAddress={document.supplierAddress}
            />
          </div>
        </>
      )}

      <div style={{ textAlign: 'center', padding: '24px', fontSize: '12px', color: '#999' }}>
        © {new Date().getFullYear()} S. M. Trade International. All rights reserved.
      </div>
    </div>
  );
}
