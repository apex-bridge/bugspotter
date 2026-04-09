import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Clock, Eye, Lock, Shield } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { SessionReplayPlayer } from '../components/bug-reports/session-replay-player';
import { ConsoleLogsTable } from '../components/bug-reports/console-logs-table';
import { NetworkLogsTable } from '../components/bug-reports/network-logs-table';
import { formatDateLong } from '../utils/format';
import { getStatusColor, getPriorityColor } from '../utils/bug-report-styles';
import { ConsoleLogEntry, NetworkLogEntry } from '../types/log-types';
import axios from 'axios';

// Interfaces for shared replay data
interface SharedReplayData {
  bug_report: {
    id: string;
    title: string;
    description: string;
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    priority: 'low' | 'medium' | 'high' | 'critical';
    created_at: string;
    screenshot_url: string | null;
    thumbnail_url: string | null;
  };
  session: {
    id: string;
    viewport?: { width: number; height: number };
    events: {
      type: 'rrweb' | 'metadata';
      recordedEvents?: unknown[];
      console?: ConsoleLogEntry[];
      network?: NetworkLogEntry[];
      metadata?: unknown;
    };
  } | null;
  share_info: {
    expires_at: string;
    view_count: number;
    password_protected: boolean;
  };
}

// API service for public shared replay access (no authentication required)
const getSharedReplay = async (token: string, password?: string): Promise<SharedReplayData> => {
  const apiUrl = import.meta.env.VITE_API_URL || '';
  const url = `${apiUrl}/api/v1/replays/shared/${token}${password ? `?password=${encodeURIComponent(password)}` : ''}`;

  const response = await axios.get<{ success: boolean; data: SharedReplayData }>(url);
  return response.data.data;
};

export default function SharedReplayViewer() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  // State management
  const [data, setData] = useState<SharedReplayData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Load shared replay data
  const loadReplay = useCallback(
    async (pwd?: string) => {
      if (!token) {
        setError(t('pages.sharedReplay.errorNoToken'));
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        setPasswordError(null);

        const replayData = await getSharedReplay(token, pwd);
        setData(replayData);
        setRequiresPassword(false);
      } catch (err) {
        console.error('Failed to load shared replay:', err);

        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          const message = err.response?.data?.error || err.message;

          if (status === 401) {
            // Password required or incorrect
            setRequiresPassword(true);
            if (pwd) {
              setPasswordError(t('pages.sharedReplay.passwordIncorrect'));
            } else {
              // Clear any previous errors to show password prompt
              setError(null);
            }
          } else if (status === 404) {
            setError(t('pages.sharedReplay.errorExpired'));
          } else if (status === 403) {
            setError(t('pages.sharedReplay.errorRevoked'));
          } else {
            setError(message || t('pages.sharedReplay.errorFailed'));
          }
        } else {
          setError(err instanceof Error ? err.message : t('pages.sharedReplay.errorUnknown'));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [token, t]
  );

  // Initial load - check for password in URL query params
  useEffect(() => {
    const urlPassword = searchParams.get('password');
    if (urlPassword) {
      setPassword(urlPassword);
      loadReplay(urlPassword);
    } else {
      loadReplay();
    }
  }, [loadReplay, searchParams]);

  // Handle password submission
  const handlePasswordSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!password.trim()) {
        setPasswordError(t('pages.sharedReplay.passwordRequired'));
        return;
      }
      loadReplay(password);
    },
    [password, loadReplay]
  );

  // Calculate time until expiration
  const getExpirationStatus = (expiresAt: string): { text: string; color: string } => {
    const now = new Date();
    const expiry = new Date(expiresAt);
    const hoursRemaining = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60));

    if (hoursRemaining < 0) {
      return { text: t('pages.sharedReplay.expired'), color: 'text-red-600' };
    } else if (hoursRemaining < 24) {
      return {
        text: t('pages.sharedReplay.expiresInHours', { count: hoursRemaining }),
        color: 'text-orange-600',
      };
    } else {
      const daysRemaining = Math.floor(hoursRemaining / 24);
      return {
        text: t('pages.sharedReplay.expiresInDays', { count: daysRemaining }),
        color: 'text-green-600',
      };
    }
  };

  // Render loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
              <p className="text-gray-600">{t('pages.sharedReplay.loading')}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render password prompt
  if (requiresPassword && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
              <CardTitle data-testid="password-protected-heading">
                {t('pages.sharedReplay.passwordProtectedTitle')}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  {t('pages.sharedReplay.passwordProtectedDescription')}
                </p>
                <label htmlFor="password-input" className="sr-only">
                  {t('pages.sharedReplay.passwordLabel')}
                </label>
                <Input
                  id="password-input"
                  type="password"
                  placeholder={t('pages.sharedReplay.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  className={passwordError ? 'border-red-500' : ''}
                  autoFocus
                />
                {passwordError && (
                  <p className="text-sm text-red-600 mt-2" role="alert">
                    {passwordError}
                  </p>
                )}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!password.trim()}
                data-testid="unlock-replay-button"
              >
                <Lock className="w-4 h-4 mr-2" aria-hidden="true" />
                {t('pages.sharedReplay.unlockReplay')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render error state
  if (error && !requiresPassword) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center">
              <AlertCircle className="w-12 h-12 text-red-500 mb-4" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-gray-900 mb-2" data-testid="error-heading">
                {t('pages.sharedReplay.unableToLoad')}
              </h2>
              <p className="text-gray-600 mb-4">{error}</p>
              <div className="text-sm text-gray-500">
                <p>{t('pages.sharedReplay.possibleReasons')}</p>
                <ul className="list-disc list-inside mt-2 text-left">
                  <li>{t('pages.sharedReplay.linkExpired')}</li>
                  <li>{t('pages.sharedReplay.linkInvalid')}</li>
                  <li>{t('pages.sharedReplay.replayDeleted')}</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render main content
  if (!data) {
    return null;
  }

  const expirationStatus = getExpirationStatus(data.share_info.expires_at);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2" data-testid="shared-replay-heading">
            {t('pages.sharedReplay.title')}
          </h1>
          <p className="text-gray-600">{t('pages.sharedReplay.subtitle')}</p>
        </div>

        {/* Share Info Banner */}
        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-gray-500" aria-hidden="true" />
                <span className="text-gray-700" data-testid="share-view-count">
                  <span className="font-medium">{data.share_info.view_count}</span>{' '}
                  {t('pages.sharedReplay.views', { count: data.share_info.view_count })}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-500" aria-hidden="true" />
                <span
                  className={`font-medium ${expirationStatus.color}`}
                  data-testid="share-expiration-status"
                >
                  {expirationStatus.text}
                </span>
              </div>
              {data.share_info.password_protected && (
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-gray-500" aria-hidden="true" />
                  <span className="text-gray-700">{t('pages.sharedReplay.passwordProtected')}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bug Report Metadata */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-xl mb-2">{data.bug_report.title}</CardTitle>
                {data.bug_report.description && (
                  <p className="text-gray-600 text-sm">{data.bug_report.description}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge className={getStatusColor(data.bug_report.status)}>
                  {data.bug_report.status.replace('_', ' ')}
                </Badge>
                <Badge className={getPriorityColor(data.bug_report.priority)}>
                  {data.bug_report.priority}
                </Badge>
              </div>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              {t('pages.sharedReplay.reportedOn')} {formatDateLong(data.bug_report.created_at)}
            </div>
          </CardHeader>
          {data.bug_report.screenshot_url && (
            <CardContent>
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-gray-700">
                  {t('pages.sharedReplay.screenshot')}
                </h3>
                <a
                  href={data.bug_report.screenshot_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <img
                    src={data.bug_report.thumbnail_url || data.bug_report.screenshot_url}
                    alt={`Screenshot of: ${data.bug_report.title}`}
                    className="max-w-full h-auto rounded-lg border border-gray-200 hover:border-primary transition-colors cursor-pointer"
                    loading="lazy"
                  />
                </a>
                <p className="text-xs text-gray-500">{t('pages.sharedReplay.clickToViewFullSize')}</p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Tabbed Content: Replay, Console Logs, Network Logs */}
        <Card>
          <Tabs defaultValue="replay" className="w-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle>{t('pages.sharedReplay.sessionData')}</CardTitle>
                <TabsList data-testid="session-tabs">
                  <TabsTrigger value="replay" data-testid="replay-tab">
                    {t('pages.sharedReplay.replayTab')}
                  </TabsTrigger>
                  <TabsTrigger value="console" data-testid="console-tab">
                    {t('pages.sharedReplay.consoleTab')}
                    <span className="sr-only"> logs,</span> (
                    {data.session?.events?.console?.length || 0}
                    <span className="sr-only"> {t('pages.sharedReplay.entries')}</span>)
                  </TabsTrigger>
                  <TabsTrigger value="network" data-testid="network-tab">
                    {t('pages.sharedReplay.networkTab')}
                    <span className="sr-only"> logs,</span> (
                    {data.session?.events?.network?.length || 0}
                    <span className="sr-only"> {t('pages.sharedReplay.entries')}</span>)
                  </TabsTrigger>
                </TabsList>
              </div>
            </CardHeader>
            <CardContent>
              {/* Replay Tab */}
              <TabsContent value="replay" className="mt-0">
                {data.session ? (
                  <SessionReplayPlayer
                    bugReportId={data.bug_report.id}
                    hasReplay={true}
                    viewport={data.session.viewport}
                    className="w-full"
                    shareToken={token}
                    shareTokenPassword={password || undefined}
                  />
                ) : (
                  <div className="flex items-center justify-center bg-gray-100 rounded-lg py-12">
                    <div className="text-center text-gray-500">
                      <p className="mb-2">{t('pages.sharedReplay.sessionDataNotAvailable')}</p>
                      <p className="text-sm">
                        {t('pages.sharedReplay.sessionDataNotAvailableDescription')}
                      </p>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Console Logs Tab */}
              <TabsContent value="console" className="mt-0">
                {data.session?.events?.console?.length ? (
                  <ConsoleLogsTable logs={data.session.events.console} />
                ) : (
                  <div className="flex items-center justify-center bg-gray-100 rounded-lg py-12">
                    <div className="text-center text-gray-500">
                      <p className="mb-2">{t('pages.sharedReplay.noConsoleLogs')}</p>
                      <p className="text-sm">{t('pages.sharedReplay.noConsoleLogsDescription')}</p>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Network Logs Tab */}
              <TabsContent value="network" className="mt-0">
                {data.session?.events?.network?.length ? (
                  <NetworkLogsTable logs={data.session.events.network} />
                ) : (
                  <div className="flex items-center justify-center bg-gray-100 rounded-lg py-12">
                    <div className="text-center text-gray-500">
                      <p className="mb-2">{t('pages.sharedReplay.noNetworkLogs')}</p>
                      <p className="text-sm">{t('pages.sharedReplay.noNetworkLogsDescription')}</p>
                    </div>
                  </div>
                )}
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        {/* Footer */}
        <div className="text-center text-sm text-gray-500 py-4">
          <p>{t('pages.sharedReplay.poweredBy')}</p>
          <p className="mt-1">
            {t('pages.sharedReplay.expiresOn')} {formatDateLong(data.share_info.expires_at)}
          </p>
        </div>
      </div>
    </div>
  );
}

