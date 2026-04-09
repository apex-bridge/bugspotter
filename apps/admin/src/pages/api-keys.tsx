import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Key, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { apiKeyService } from '../services/api-key-service';
import { projectService } from '../services/api';
import { useAuth } from '../contexts/auth-context';
import { handleApiError } from '../lib/api-client';
import { Button } from '../components/ui/button';
import { ApiKeyTable } from '../components/api-keys/api-key-table';
import { CreateApiKeyDialog } from '../components/api-keys/create-api-key-dialog';
import { ShowApiKeyDialog } from '../components/api-keys/show-api-key-dialog';
import { ApiKeyUsageDialog } from '../components/api-keys/api-key-usage-dialog';
import { formatNumber } from '../utils/format';
import type { ApiKeyResponse } from '../types/api-keys';

const PAGE_LIMIT = 20;
const API_KEYS_QUERY_KEY = ['apiKeys'] as const;

export default function ApiKeysPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [usageDialogId, setUsageDialogId] = useState<string | null>(null);
  const [showInactiveKeys, setShowInactiveKeys] = useState(false);
  const [showKey, setShowKey] = useState<{
    key: ApiKeyResponse;
    operation: 'created' | 'rotated';
  } | null>(null);

  // Fetch projects for dropdown
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: projectService.getAll,
  });

  // Fetch API keys with pagination and status filter
  // Show active keys by default, or all keys (including revoked/expired) when toggled
  const status = showInactiveKeys ? undefined : 'active';
  const {
    data: apiKeyData,
    isLoading,
    error,
  } = useQuery({
    queryKey: [...API_KEYS_QUERY_KEY, page, PAGE_LIMIT, status],
    queryFn: () => apiKeyService.getAll(page, PAGE_LIMIT, status as 'active' | undefined),
  });

  // Fetch usage data for selected API key
  const { data: usageData, isLoading: isLoadingUsage } = useQuery({
    queryKey: ['apiKeyUsage', usageDialogId],
    queryFn: () => apiKeyService.getUsage(usageDialogId!),
    enabled: usageDialogId !== null,
  });

  // Shared error handler for mutations
  const handleMutationError = useCallback((apiError: unknown) => {
    toast.error(handleApiError(apiError));
  }, []);

  // Shared query invalidation
  const invalidateApiKeys = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: API_KEYS_QUERY_KEY });
  }, [queryClient]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: apiKeyService.create,
    onSuccess: (newKey) => {
      invalidateApiKeys();
      setShowKey({ key: newKey, operation: 'created' });
      toast.success(t('pages.apiKeyCreatedSuccessfully'));
    },
    onError: handleMutationError,
  });

  // Revoke mutation
  const revokeMutation = useMutation({
    mutationFn: apiKeyService.revoke,
    onSuccess: () => {
      invalidateApiKeys();
      toast.success(t('pages.apiKeyRevokedSuccessfully'));
    },
    onError: handleMutationError,
  });

  // Rotate mutation
  const rotateMutation = useMutation({
    mutationFn: apiKeyService.rotate,
    onSuccess: (newKey) => {
      invalidateApiKeys();
      setShowKey({ key: newKey, operation: 'rotated' });
      toast.success(t('pages.apiKeyRotatedSuccessfully'));
    },
    onError: handleMutationError,
  });

  const handlePreviousPage = useCallback((): void => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const handleNextPage = useCallback((): void => {
    if (apiKeyData?.pagination) {
      setPage((prev) => Math.min(apiKeyData.pagination.totalPages, prev + 1));
    }
  }, [apiKeyData]);

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">{t('apiKeys.title')}</h1>
            <p className="text-gray-500 mt-1">{t('apiKeys.description')}</p>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="font-semibold">{t('apiKeys.errorLoadingKeys')}</p>
          <p className="text-sm mt-1">{handleApiError(error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Key className="w-8 h-8" aria-hidden="true" />
            {t('apiKeys.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('apiKeys.description')}</p>
        </div>
        <Button
          onClick={() => setShowCreateDialog(true)}
          disabled={isViewer}
          className="whitespace-nowrap"
        >
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
          {t('apiKeys.createApiKey')}
        </Button>
      </div>

      {/* Filter Controls */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <input
              id="show-inactive-keys"
              type="checkbox"
              checked={showInactiveKeys}
              onChange={(e) => setShowInactiveKeys(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              aria-label={t('apiKeys.showInactiveKeys')}
            />
            <label htmlFor="show-inactive-keys" className="text-sm text-gray-700 cursor-pointer">
              {t('apiKeys.showInactiveKeys')}
            </label>
          </div>
          {apiKeyData?.pagination && (
            <div>
              <p className="text-sm text-gray-500">{t('apiKeys.totalApiKeys')}</p>
              <p className="text-2xl font-bold">{formatNumber(apiKeyData.pagination.total)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12">
          <div className="flex items-center justify-center" role="status" aria-live="polite">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
          <span className="sr-only">{t('apiKeys.loadingKeys')}</span>
        </div>
      ) : (
        <>
          {/* API Keys Table */}
          <ApiKeyTable
            apiKeys={apiKeyData?.data || []}
            projects={projects}
            onRevoke={(id) => revokeMutation.mutate(id)}
            onRotate={(id) => rotateMutation.mutate(id)}
            onViewUsage={setUsageDialogId}
            isLoading={revokeMutation.isPending || rotateMutation.isPending}
            readOnly={isViewer}
          />

          {/* Pagination */}
          {apiKeyData?.pagination && apiKeyData.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">
                {t('apiKeys.showingPage', {
                  page: apiKeyData.pagination.page,
                  totalPages: apiKeyData.pagination.totalPages,
                  total: formatNumber(apiKeyData.pagination.total),
                })}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handlePreviousPage}
                  disabled={apiKeyData.pagination.page === 1}
                  aria-label={t('apiKeys.previousPage')}
                >
                  <ChevronLeft className="w-4 h-4 mr-2" aria-hidden="true" />
                  {t('apiKeys.previous')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleNextPage}
                  disabled={apiKeyData.pagination.page === apiKeyData.pagination.totalPages}
                  aria-label={t('apiKeys.nextPage')}
                >
                  {t('apiKeys.next')}
                  <ChevronRight className="w-4 h-4 ml-2" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Dialog */}
      <CreateApiKeyDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSubmit={createMutation.mutateAsync}
        projects={projects}
        isLoading={createMutation.isPending}
      />

      {/* Usage Dialog */}
      <ApiKeyUsageDialog
        open={usageDialogId !== null}
        onOpenChange={(open) => !open && setUsageDialogId(null)}
        usage={usageData || null}
        isLoading={isLoadingUsage}
      />

      {/* Show API Key Dialog (for created/rotated keys) */}
      <ShowApiKeyDialog
        open={showKey !== null}
        onOpenChange={(open) => !open && setShowKey(null)}
        apiKey={showKey?.key || null}
        title={
          showKey?.operation === 'created'
            ? t('apiKeys.apiKeyCreated')
            : showKey?.operation === 'rotated'
              ? t('apiKeys.apiKeyRotated')
              : t('apiKeys.title')
        }
      />
    </div>
  );
}
