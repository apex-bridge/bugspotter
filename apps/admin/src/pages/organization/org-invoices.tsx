/**
 * Organization Invoices Page
 * Lists invoices with status, amount, and download PDF links.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileText, Download, CheckCircle, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { useOrganization } from '../../contexts/organization-context';
import { invoiceService } from '../../services/invoice-service';
import type { Invoice } from '../../services/invoice-service';

const STATUS_CONFIG: Record<Invoice['status'], { icon: typeof CheckCircle; color: string }> = {
  draft: { icon: FileText, color: 'text-gray-400' },
  sent: { icon: Clock, color: 'text-blue-500' },
  paid: { icon: CheckCircle, color: 'text-green-500' },
  overdue: { icon: AlertTriangle, color: 'text-red-500' },
  canceled: { icon: XCircle, color: 'text-gray-400' },
};

function InvoiceStatusBadge({ status }: { status: Invoice['status'] }) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${config.color}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {t(`invoiceBilling.status.${status}`)}
    </span>
  );
}

export default function OrgInvoicesPage() {
  const { t, i18n } = useTranslation();
  const { currentOrganization } = useOrganization();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', currentOrganization?.id, page],
    queryFn: () => invoiceService.listInvoices(page),
    enabled: !!currentOrganization,
  });

  if (!currentOrganization) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('invoiceBilling.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('invoiceBilling.subtitle')}
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">{t('common.loading')}</div>
      ) : !data?.data?.length ? (
        <div className="text-center py-12">
          <FileText className="mx-auto h-12 w-12 text-gray-300" aria-hidden="true" />
          <p className="mt-2 text-sm text-gray-500">{t('invoiceBilling.noInvoices')}</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <caption className="sr-only">{t('invoiceBilling.title')}</caption>
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t('invoiceBilling.columns.number')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t('invoiceBilling.columns.amount')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t('invoiceBilling.columns.status')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t('invoiceBilling.columns.issued')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    {t('invoiceBilling.columns.due')}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                    {t('invoiceBilling.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
                {data.data.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-4 py-3 text-sm font-mono">
                      <Link
                        to={`/my-organization/invoices/${invoice.id}`}
                        className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                      >
                        {invoice.invoice_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {new Intl.NumberFormat(i18n.language, {
                        style: 'currency',
                        currency: invoice.currency,
                      }).format(invoice.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <InvoiceStatusBadge status={invoice.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {invoice.issued_at
                        ? new Date(invoice.issued_at).toLocaleDateString(i18n.language)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {invoice.due_at
                        ? new Date(invoice.due_at).toLocaleDateString(i18n.language)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        aria-label={t('invoiceBilling.downloadPdf')}
                        onClick={async () => {
                          try {
                            const blob = await invoiceService.downloadInvoicePdf(invoice.id);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${invoice.invoice_number}.pdf`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                          } catch (error) {
                            console.error('Failed to download PDF:', error);
                            toast.error(t('invoiceBilling.downloadError'));
                          }
                        }}
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.pagination && data.pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded px-3 py-1 text-sm border disabled:opacity-50"
              >
                {t('common.previous')}
              </button>
              <span className="px-3 py-1 text-sm text-gray-500">
                {page} / {data.pagination.totalPages}
              </span>
              <button
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded px-3 py-1 text-sm border disabled:opacity-50"
              >
                {t('common.next')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
