/**
 * Organization Invoice Detail Page
 * Shows invoice details, line items, and act with PDF download buttons.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Download, FileText, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import { invoiceService } from '../../services/invoice-service';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  canceled: 'bg-gray-100 text-gray-400',
};

const STATUS_ICONS: Record<string, typeof CheckCircle> = {
  draft: FileText,
  sent: Clock,
  paid: CheckCircle,
  overdue: AlertTriangle,
  canceled: FileText,
};

async function downloadFile(fetchFn: () => Promise<Blob>, filename: string) {
  const blob = await fetchFn();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatMoney(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

export default function OrgInvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const { t, i18n } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: ['invoice-detail', invoiceId],
    queryFn: () => invoiceService.getInvoice(invoiceId!),
    enabled: !!invoiceId,
  });

  if (isLoading) {
    return <div className="text-center py-12 text-gray-400">{t('common.loading')}</div>;
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-red-500">{t('invoiceBilling.detail.loadError')}</div>
    );
  }

  const { invoice, lines, act } = data;
  const StatusIcon = STATUS_ICONS[invoice.status] ?? FileText;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/my-organization/invoices"
          className="text-gray-400 hover:text-gray-600"
          aria-label={t('invoiceBilling.detail.backToInvoices', 'Back to invoices')}
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">
            {t('invoiceBilling.detail.title', { number: invoice.invoice_number })}
          </h1>
          <p className="text-sm text-gray-500">
            {invoice.issued_at && new Date(invoice.issued_at).toLocaleDateString(i18n.language)}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[invoice.status] ?? 'bg-gray-100 text-gray-700'}`}
        >
          <StatusIcon className="h-4 w-4" aria-hidden="true" />
          {t(`invoiceBilling.status.${invoice.status}`)}
        </span>
      </div>

      {/* Summary */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <dt className="text-xs text-gray-400">{t('invoiceBilling.columns.amount')}</dt>
            <dd className="text-lg font-semibold">
              {formatMoney(Number(invoice.amount), invoice.currency, i18n.language)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">{t('invoiceBilling.columns.issued')}</dt>
            <dd className="text-sm">
              {invoice.issued_at
                ? new Date(invoice.issued_at).toLocaleDateString(i18n.language)
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">{t('invoiceBilling.columns.due')}</dt>
            <dd className="text-sm">
              {invoice.due_at ? new Date(invoice.due_at).toLocaleDateString(i18n.language) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">{t('invoiceBilling.detail.paidAt')}</dt>
            <dd className="text-sm">
              {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString(i18n.language) : '—'}
            </dd>
          </div>
        </dl>
      </div>

      {/* Line Items */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-medium text-gray-700">
            {t('invoiceBilling.detail.lineItems')}
          </h2>
        </div>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('invoiceBilling.detail.lineItems')}</caption>
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-2 font-medium text-gray-500">
                {t('invoiceBilling.detail.description')}
              </th>
              <th className="text-left px-4 py-2 font-medium text-gray-500">
                {t('invoiceBilling.detail.period')}
              </th>
              <th className="text-right px-4 py-2 font-medium text-gray-500">
                {t('invoiceBilling.detail.qty')}
              </th>
              <th className="text-right px-4 py-2 font-medium text-gray-500">
                {t('invoiceBilling.detail.unitPrice')}
              </th>
              <th className="text-right px-6 py-2 font-medium text-gray-500">
                {t('invoiceBilling.columns.amount')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-6 py-3">{line.description}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {line.period_start && line.period_end
                    ? `${new Date(line.period_start).toLocaleDateString(i18n.language)} – ${new Date(line.period_end).toLocaleDateString(i18n.language)}`
                    : '—'}
                </td>
                <td className="px-4 py-3 text-right">{line.quantity}</td>
                <td className="px-4 py-3 text-right">
                  {formatMoney(Number(line.unit_price), invoice.currency, i18n.language)}
                </td>
                <td className="px-6 py-3 text-right font-medium">
                  {formatMoney(Number(line.amount), invoice.currency, i18n.language)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200">
            <tr>
              <td colSpan={4} className="px-6 py-3 text-right font-medium text-gray-700">
                {t('invoiceBilling.detail.total')}
              </td>
              <td className="px-6 py-3 text-right font-semibold">
                {formatMoney(Number(invoice.amount), invoice.currency, i18n.language)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Downloads */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-700 mb-4">
          {t('invoiceBilling.detail.documents')}
        </h2>
        <div className="flex gap-3">
          <button
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            onClick={async () => {
              try {
                await downloadFile(
                  () => invoiceService.downloadInvoicePdf(invoice.id),
                  `${invoice.invoice_number}.pdf`
                );
              } catch (error) {
                console.error('PDF download failed:', error);
                toast.error(t('invoiceBilling.downloadError'));
              }
            }}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('invoiceBilling.detail.downloadInvoice')}
          </button>

          {act && (
            <button
              className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
              onClick={async () => {
                try {
                  await downloadFile(
                    () => invoiceService.downloadActPdf(act.id),
                    `${act.act_number}.pdf`
                  );
                } catch (error) {
                  console.error('PDF download failed:', error);
                  toast.error(t('invoiceBilling.downloadError'));
                }
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('invoiceBilling.detail.downloadAct')}
            </button>
          )}
        </div>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-medium text-gray-700 mb-2">
            {t('invoiceBilling.detail.notes')}
          </h2>
          <p className="text-sm text-gray-500">{invoice.notes}</p>
        </div>
      )}
    </div>
  );
}
