import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { CompanySettings, LineItem, ChallanItem, Payment } from '@/types';
import { numberToWords } from '@/utils/numberToWords';
import { api } from '@/utils/api';
import { computeBodyPageSlices } from '@/utils/pdfPageSlices';
import logoImg from '@/assets/logo.png';

interface DocumentPreviewProps {
  type: 'invoice' | 'quotation' | 'challan' | 'purchaseOrder';
  documentNumber: string;
  date: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  customerEmail?: string;
  items?: LineItem[];
  challanItems?: ChallanItem[];
  totalAmount?: number;
  totalQuantity?: number;
  orderNo?: string;
  notes?: string;
  amountInWords?: string;
  tax?: number;
  totalPaid?: number;
  payments?: Payment[];
  supplierName?: string;
  supplierAddress?: string;
  status?: string;
  signatureReceived?: string;
  signaturePrepared?: string;
  signatureAuthorize?: string;
}

const formatNumber = (num: number | string) => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0.00';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatQuantity = (num: number | string) => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0';
  return n.toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 20 });
};

const formatPlain = (num: number | string) => {
  const n = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(n)) return '0.00';
  return n.toFixed(2);
};

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return dateStr; }
};

const NAVY = '#1B3A5C';
const ORANGE = '#E8792B';
const GREEN = '#16a34a';

const defaultSettings: CompanySettings = {
  name: 'S. M. Trade International',
  tagline: '1st Class Govt. Contractor, Supplier & Importer',
  address: 'House # 7, Road # 19/A, Sector # 4, Uttara, Dhaka-1230',
  phone: '+8801886766688',
  email: 'info@smtradeint.com',
  website: 'www.smtradeint.com',
  logo: '',
};

export function printDocument(docNumber: string) {
  document.title = docNumber;
  window.print();
  document.title = 'S. M. Trade International';
}

export async function downloadDocument(docNumber: string) {
  const wrapper = document.querySelector('.document-preview-wrapper') as HTMLElement;
  if (!wrapper) return;
  const previousWrapperOverflow = wrapper.style.overflow;
  try {
    wrapper.style.overflow = 'visible';
    const headerEl = wrapper.querySelector('.doc-header-section') as HTMLElement | null;
    const footerEl = wrapper.querySelector('.doc-footer-section') as HTMLElement | null;
    const bodyEl = wrapper.querySelector('.doc-body-section') as HTMLElement | null;

    // Fallback: original single-shot approach if structure not found
    if (!headerEl || !footerEl || !bodyEl) {
      const canvas = await html2canvas(wrapper, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff', height: wrapper.scrollHeight, windowHeight: wrapper.scrollHeight });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= 297;
      while (heightLeft > 5) {
        position -= 297;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= 297;
      }
      pdf.save(`${docNumber}.pdf`);
      return;
    }

    const scale = 2;
    const [headerCanvas, footerCanvas, bodyCanvas] = await Promise.all([
      html2canvas(headerEl, { scale, useCORS: true, logging: false, backgroundColor: '#ffffff', height: headerEl.scrollHeight, windowHeight: headerEl.scrollHeight }),
      html2canvas(footerEl, { scale, useCORS: true, logging: false, backgroundColor: '#ffffff', height: footerEl.scrollHeight, windowHeight: footerEl.scrollHeight }),
      html2canvas(bodyEl, { scale, useCORS: true, logging: false, backgroundColor: '#ffffff', height: bodyEl.scrollHeight, windowHeight: bodyEl.scrollHeight }),
    ]);

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pdfWidth = 210;
    const pdfHeight = 297;
    // 0.5 inch = 12.7mm margin on top, bottom and sides for repeated content
    const sideMargin = 0; // keep edges flush like the on-screen design
    const topMargin = 0;
    const bottomMargin = 12.7; // 0.5 inch bottom margin (footer sits above this)

    const contentWidth = pdfWidth - sideMargin * 2;
    const headerHeightMm = (headerCanvas.height * contentWidth) / headerCanvas.width;
    const footerHeightMm = (footerCanvas.height * contentWidth) / footerCanvas.width;
    const bodyTotalHeightMm = (bodyCanvas.height * contentWidth) / bodyCanvas.width;

    // Available vertical space for body on non-last pages (header repeats, footer reserved only at bottom margin)
    const bodyAvailMm = pdfHeight - topMargin - headerHeightMm - bottomMargin;
    // Last page must also fit the footer
    const bodyAvailLastMm = pdfHeight - topMargin - headerHeightMm - footerHeightMm - bottomMargin;
    if (bodyAvailMm <= 20) {
      // Header+footer too tall, fall back to single-shot
      const canvas = await html2canvas(wrapper, { scale, useCORS: true, logging: false, backgroundColor: '#ffffff', height: wrapper.scrollHeight, windowHeight: wrapper.scrollHeight });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeight);
      pdf.save(`${docNumber}.pdf`);
      return;
    }

    // Convert per-page mm slice into source-pixel slice on bodyCanvas
    const pxPerMm = bodyCanvas.width / contentWidth;
    const sliceHeightPx = Math.floor(bodyAvailMm * pxPerMm);
    const sliceHeightLastPx = Math.floor(bodyAvailLastMm * pxPerMm);

    const headerImg = headerCanvas.toDataURL('image/jpeg', 0.95);
    const footerImg = footerCanvas.toDataURL('image/jpeg', 0.95);

    // ---------- Row-aware safe split points ----------
    // To avoid cutting a table row in the middle, we collect the bottom-edge
    // pixel position (within bodyCanvas) of every <tr> / [data-pdf-section].
    const bodyRect = bodyEl.getBoundingClientRect();
    const cssBodyHeight = Math.max(bodyRect.height, bodyEl.scrollHeight);
    const cssToCanvasY = bodyCanvas.height / cssBodyHeight; // px(canvas) per px(css)
    const safeCutsPx: number[] = [];
    const safeSections = bodyEl.querySelectorAll('tr, [data-pdf-section]');
    safeSections.forEach((section) => {
      const r = (section as HTMLElement).getBoundingClientRect();
      const bottomCssRelative = r.bottom - bodyRect.top;
      const bottomCanvasPx = Math.round(bottomCssRelative * cssToCanvasY);
      if (bottomCanvasPx > 0 && bottomCanvasPx <= bodyCanvas.height) {
        safeCutsPx.push(bottomCanvasPx);
      }
    });
    safeCutsPx.push(bodyCanvas.height);

    // Build page slices so last page always reserves footer space (keeps Total Amount visible)
    const pageSlices = computeBodyPageSlices(
      bodyCanvas.height,
      sliceHeightPx,
      sliceHeightLastPx,
      safeCutsPx,
    );

    let renderedPx = 0;
    for (let pageIndex = 0; pageIndex < pageSlices.length; pageIndex++) {
      if (pageIndex > 0) pdf.addPage();

      // Header on every page
      pdf.addImage(headerImg, 'JPEG', sideMargin, topMargin, contentWidth, headerHeightMm);

      const thisSlicePx = pageSlices[pageIndex];
      const isLastPage = pageIndex === pageSlices.length - 1;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = bodyCanvas.width;
      sliceCanvas.height = Math.max(1, thisSlicePx);
      const ctx = sliceCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(bodyCanvas, 0, renderedPx, bodyCanvas.width, thisSlicePx, 0, 0, bodyCanvas.width, thisSlicePx);
      }
      const sliceImg = sliceCanvas.toDataURL('image/jpeg', 0.95);
      const thisSliceMm = (thisSlicePx * contentWidth) / bodyCanvas.width;
      pdf.addImage(sliceImg, 'JPEG', sideMargin, topMargin + headerHeightMm, contentWidth, thisSliceMm);

      renderedPx += thisSlicePx;

      // Footer ONLY on the last page (space was reserved via bodyAvailLastMm)
      if (isLastPage) {
        const footerY = pdfHeight - bottomMargin - footerHeightMm;
        pdf.addImage(footerImg, 'JPEG', sideMargin, footerY, contentWidth, footerHeightMm);
      }
    }

    pdf.save(`${docNumber}.pdf`);
  } catch (err) {
    console.error('PDF download failed:', err);
  } finally {
    wrapper.style.overflow = previousWrapperOverflow;
  }
}

export default function DocumentPreview(props: DocumentPreviewProps) {
  const [settings, setSettings] = useState<CompanySettings>(defaultSettings);

  useEffect(() => {
    api.getSettings().then((d: any) => {
      if (d && d.name) setSettings(d);
    }).catch(() => {});
  }, []);

  const { type, documentNumber, date, customerName, customerAddress, customerPhone, customerEmail, items, challanItems, totalAmount, totalQuantity, orderNo, notes, tax, totalPaid, payments } = props;

  const typeConfig: Record<string, { label: string; toLabel: string; dateLabel: string }> = {
    invoice: { label: 'BILL', toLabel: 'BILL TO', dateLabel: 'BILL DATE :' },
    quotation: { label: 'QUOTATION', toLabel: 'TO', dateLabel: 'QUOTATION DATE :' },
    challan: { label: 'CHALLAN', toLabel: 'DELIVERY TO', dateLabel: 'CHALLAN DATE :' },
    purchaseOrder: { label: 'PURCHASE ORDER', toLabel: 'TO', dateLabel: 'PO DATE :' },
  };

  const config = typeConfig[type];

  const [qrDataUrl, setQrDataUrl] = useState('');
  useEffect(() => {
    const routeMap: Record<string, string> = {
      invoice: 'invoice', quotation: 'quotation', challan: 'challan', purchaseOrder: 'purchase-order',
    };
    const baseUrl = window.location.origin;
    const docId = documentNumber.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const viewUrl = `${baseUrl}/verify/${routeMap[type]}/${docId}`;
    QRCode.toDataURL(viewUrl, { width: 120, margin: 1, color: { dark: '#1B3A5C', light: '#ffffff' } })
      .then(url => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [documentNumber, type]);

  const isChallan = type === 'challan';
  const isInvoice = type === 'invoice';

  const subtotal = Number(totalAmount) || 0;
  const taxAmount = Number(tax) || 0;
  const grandTotal = subtotal + taxAmount;
  const paidAmount = Number(totalPaid) || 0;
  const balance = grandTotal - paidAmount;

  const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
    paid: { color: GREEN, bg: '#dcfce7', label: 'Paid' },
    partial: { color: ORANGE, bg: '#fff7ed', label: 'Partial' },
    sent: { color: '#dc2626', bg: '#fef2f2', label: 'Unpaid' },
    draft: { color: '#6b7280', bg: '#f3f4f6', label: 'Draft' },
    accepted: { color: GREEN, bg: '#dcfce7', label: 'Accepted' },
    rejected: { color: '#dc2626', bg: '#fef2f2', label: 'Rejected' },
    delivered: { color: GREEN, bg: '#dcfce7', label: 'Delivered' },
    received: { color: GREEN, bg: '#dcfce7', label: 'Received' },
  };

  const statusInfo = statusConfig[props.status || 'draft'] || statusConfig.draft;

  return (
    <div className="bg-white mx-auto shadow-lg document-preview-wrapper" id="document-preview" style={{ fontFamily: "'Segoe UI', Arial, sans-serif", color: '#333', fontSize: '13px', width: '794px', minHeight: '1123px', overflow: 'hidden' }}>
      <div style={{ border: '2px solid #d0d0d0', minHeight: '1119px', display: 'flex', flexDirection: 'column' }} className="document-border">
        
        {/* ===== HEADER (repeats on every page) ===== */}
        <div className="doc-header-section">
        <div style={{ padding: '18px 35px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{ 
                width: '72px', height: '72px', borderRadius: '50%', 
                border: '2.5px solid #2B5797', 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, overflow: 'hidden', backgroundColor: '#fff'
              }}>
                <img src={logoImg} alt="Logo" style={{ width: '95px', height: '95px', objectFit: 'cover' }} />
              </div>
              <div>
                <h1 style={{ fontSize: '23px', fontWeight: '900', color: '#1f3b8a', margin: 0, letterSpacing: '0px', fontFamily: "'MoolBoran', Arial, Helvetica, sans-serif", textTransform: 'uppercase' }}>
                  S. M. TRADE INTERNATIONAL
                </h1>
                <p style={{ fontSize: '13px', color: '#000000', margin: '0', fontWeight: 'normal', fontStyle: 'normal', fontFamily: "Arial, Helvetica, sans-serif", letterSpacing: '0.2px' }}>
                  1st Class Govt. Contractor, Supplier &amp; Importer
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <h2 style={{
                  fontSize: type === 'invoice' ? '32px' : type === 'quotation' ? '16px' : '18px',
                  fontWeight: '900',
                  color: NAVY,
                  margin: 0,
                  fontFamily: "Arial, Helvetica, sans-serif",
                  letterSpacing: type === 'invoice' ? '4px' : '0px',
                  lineHeight: 1.05,
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}>
                  {config.label}
                </h2>
                <p style={{
                  color: ORANGE,
                  fontSize: '13px',
                  fontWeight: 'bold',
                  margin: '1px 0 0',
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                  width: '100%',
                }}>
                  {documentNumber}
                </p>
                {isChallan && orderNo && (
                  <p style={{ fontSize: '11px', color: '#666', margin: '2px 0 0', textAlign: 'right' }}>Order No. {orderNo}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div style={{ height: '2px', backgroundColor: '#999', margin: '0 35px' }} />
        </div>
        {/* ===== END HEADER ===== */}

        {/* ===== BODY (slices across pages) ===== */}
        <div className="doc-body-section" style={{ flex: 1 }}>
        <div style={{ padding: '14px 35px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <div style={{ width: '6px', backgroundColor: '#1f3b8a', borderRadius: '0px', marginRight: '12px', flexShrink: 0 }}></div>
            <div>
            <p style={{ fontSize: '10px', color: '#888', fontWeight: 'bold', marginBottom: '1px', letterSpacing: '0.5px' }}>{config.toLabel}</p>
            <p style={{ fontSize: '14px', fontWeight: 'bold', color: '#111', margin: '0 0 1px' }}>
              {props.supplierName || customerName}
            </p>
            {customerEmail && (
              <p style={{ fontSize: '11px', color: ORANGE, margin: '1px 0', lineHeight: '1.4' }}>{customerEmail}</p>
            )}
            {customerPhone && (
              <p style={{ fontSize: '11px', color: '#111', margin: '1px 0', lineHeight: '1.4' }}>{customerPhone}</p>
            )}
            <p style={{ fontSize: '11px', color: '#555', margin: '1px 0', lineHeight: '1.4' }}>
              {props.supplierAddress || customerAddress}
            </p>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', whiteSpace: 'nowrap' }}>
            <span style={{ color: '#888', fontSize: '11px' }}>{config.dateLabel}</span>{' '}
            <strong style={{ color: '#222' }}>{formatDate(date)}</strong>
          </div>
        </div>

        <div style={{ padding: '6px 35px 0', position: 'relative' }}>
          
          <div style={{
            position: 'absolute', top: '45%', left: '50%',
            transform: 'translate(-50%, -50%)', opacity: 0.06, zIndex: 0, pointerEvents: 'none',
          }}>
            <img src={logoImg} alt="" style={{ width: '320px', height: '320px' }} />
          </div>

          {isChallan && challanItems ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 1 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #999' }}>
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: NAVY, whiteSpace: 'nowrap' }}>SL.</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: NAVY }}>ITEM NAME & DETAILS</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: NAVY, whiteSpace: 'nowrap' }}>SIZE</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: NAVY, whiteSpace: 'nowrap' }}>UNIT</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: NAVY, whiteSpace: 'nowrap' }}>DELIVERY QTY</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: NAVY, whiteSpace: 'nowrap' }}>BALANCE QTY</th>
                </tr>
              </thead>
              <tbody>
                {challanItems.map((item, i) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '12px' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px', fontSize: '12px' }}>{item.itemName}{item.details && <><br/><span style={{ fontSize: '10px', color: '#666' }}>{item.details}</span></>}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '12px' }}>{item.size}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '12px' }}>{item.unit}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '12px' }}>{formatQuantity(item.deliveryQty)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontSize: '12px' }}>{formatQuantity(item.balanceQty)}</td>
                  </tr>
                ))}
                {(() => {
                  const totalBalance = challanItems.reduce((sum, item) => sum + (Number(item.balanceQty) || 0), 0);
                  return (
                    <tr style={{ backgroundColor: NAVY }}>
                      <td colSpan={4} style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: 'white', fontSize: '12px' }}>Total Quantity</td>
                      <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', color: 'white', fontSize: '12px' }}>{formatQuantity(totalQuantity || 0)} Pcs</td>
                      <td style={{ padding: '8px', textAlign: 'center', fontWeight: 'bold', color: 'white', fontSize: '12px' }}>{formatQuantity(totalBalance)} Pcs</td>
                    </tr>
                  );
                })()}
              </tbody>
            </table>
          ) : items ? (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse', position: 'relative', zIndex: 1 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #999' }}>
                    <th style={{ padding: '8px 8px', textAlign: 'left', fontSize: '11px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', width: '40%' }}>DESCRIPTION</th>
                    <th style={{ padding: '8px 8px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', width: '18%' }}>QTY</th>
                    <th style={{ padding: '8px 8px', textAlign: 'center', fontSize: '11px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', width: '22%' }}>UNIT PRICE</th>
                    <th style={{ padding: '8px 8px', textAlign: 'right', fontSize: '11px', fontWeight: 'bold', color: '#888', textTransform: 'uppercase', width: '20%' }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} style={{ borderBottom: '1px solid #e8e8e8' }}>
                      <td style={{ padding: '7px 8px', fontSize: '12px' }}>{item.description}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: '12px' }}>{formatQuantity(item.quantity)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontSize: '12px' }}>{formatPlain(item.unitPrice)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontSize: '12px', fontWeight: 'bold' }}>{formatNumber(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div data-pdf-section style={{ 
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginTop: '12px', padding: '10px 16px',
                backgroundColor: NAVY, borderRadius: '4px',
                position: 'relative', zIndex: 1,
                breakInside: 'avoid', pageBreakInside: 'avoid',
              }}>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>Total Amount</span>
                <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#fff' }}>BDT {formatNumber(isInvoice ? grandTotal : subtotal)}</span>
              </div>
            </>
          ) : null}

          {totalAmount !== undefined && totalAmount > 0 && !isChallan && (
            <div data-pdf-section style={{ textAlign: 'right', padding: '0', fontSize: '11px', color: NAVY, marginTop: '4px' }}>
              <strong>In Word :</strong> {props.amountInWords || numberToWords(isInvoice ? balance : subtotal)}.
            </div>
          )}

          {isInvoice && payments && payments.length > 0 && (
            <div data-pdf-section style={{ marginTop: '16px', position: 'relative', zIndex: 1 }}>
              <div style={{ border: '1px solid #e0e0e0', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ padding: '8px 14px', backgroundColor: '#f9fafb', borderBottom: '1px solid #e0e0e0' }}>
                  <strong style={{ fontSize: '12px', color: NAVY }}>PAYMENT HISTORY</strong>
                </div>
                {payments.map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '11px', color: '#666' }}>{formatDate(p.date)}</span>
                      <span style={{ 
                        backgroundColor: NAVY, color: 'white', padding: '2px 8px', borderRadius: '3px',
                        fontSize: '10px', fontWeight: 'bold',
                      }}>{p.method}</span>
                      <span style={{ fontSize: '11px', color: '#555' }}>{p.description}</span>
                    </div>
                    <span style={{ fontWeight: 'bold', fontSize: '12px', color: GREEN }}>{formatNumber(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {notes && (
          <div data-pdf-section style={{ padding: '8px 35px', fontSize: '11px', color: '#666' }}>
            <strong>Notes:</strong> {notes}
          </div>
        )}

        </div>
        {/* ===== END BODY ===== */}

        {/* ===== FOOTER (repeats on every page) ===== */}
        <div className="doc-footer-section" style={{ marginTop: 'auto', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
          <div style={{ padding: '10px 35px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            {[
              { label: 'Received by', sig: props.signatureReceived || settings.signatureReceived },
              { label: 'Prepared by', sig: props.signaturePrepared || settings.signaturePrepared },
              { label: 'Authorize by', sig: props.signatureAuthorize || settings.signatureAuthorize },
            ].map((item) => (
              <div key={item.label} style={{ textAlign: 'center', width: '160px' }}>
                <div style={{
                  width: '160px', height: '50px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '4px',
                }}>
                  {item.sig ? (
                    <img src={item.sig} alt={item.label} style={{ maxWidth: '140px', maxHeight: '45px', objectFit: 'contain' }} />
                  ) : null}
                </div>
                <div style={{ borderTop: '1.5px solid #333', paddingTop: '4px', fontSize: '11px', color: '#555' }}>{item.label}</div>
              </div>
            ))}
          </div>

          <div style={{ 
            borderTop: '2px solid #aaa', padding: '10px 25px 40px', fontSize: '10px', color: '#555', overflow: 'visible',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', position: 'relative' }}>
              <div style={{ textAlign: 'center', lineHeight: '1.6', flex: 1, paddingRight: '100px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginBottom: '2px' }}>
                  <span style={{ color: '#1a73e8' }}>✉ info@smtradeint.com</span>
                  <span style={{ color: '#1a73e8', display: 'inline-flex', alignItems: 'center', gap: '4px', lineHeight: 1 }}><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0, marginTop: '6px' }}><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg><span>smtradeint.com</span></span>
                </div>
                <div style={{ marginBottom: '2px' }}>
                  ◉ Address : House # 7, Road # 19/A, Sector # 4, Uttara, Dhaka-1230
                </div>
                <div style={{ marginBottom: '2px' }}>
                  ◉ B-25/4, Al-Baraka Super Market, Office # 9-10, Mojidpur Road, Savar, Dhaka-1340
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
                  <span>☎ +8801876666888</span>
                  <span>☎ +8802244466664</span>
                </div>
              </div>
              {qrDataUrl && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'absolute', right: '0px', top: '-8px' }}>
                  <img src={qrDataUrl} alt="QR" style={{ width: '80px', height: '80px' }} />
                  <span style={{ fontSize: '9px', color: '#1B3A5C', marginTop: '4px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    Scan to view {type === 'challan' ? 'challan' : type === 'quotation' ? 'quotation' : 'invoice'}
                  </span>
                  <span style={{ fontSize: '8px', color: '#555', marginTop: '2px', whiteSpace: 'nowrap' }}>for details</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
