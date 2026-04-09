/**
 * Share Token Manager Component
 * Manages public sharing for bug report session replays
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Share2, Copy, Eye, Calendar, Lock, Unlock, Trash2, ExternalLink } from 'lucide-react';
import {
  MIN_SHARE_TOKEN_EXPIRATION_HOURS,
  MAX_SHARE_TOKEN_EXPIRATION_HOURS,
  DEFAULT_SHARE_TOKEN_EXPIRATION_HOURS,
  MIN_SHARE_TOKEN_PASSWORD_LENGTH,
} from '@bugspotter/types';
import { shareTokenService } from '../../services/api';
import { formatDateShort } from '../../utils/format';
import { handleApiError } from '../../lib/api-client';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface ShareTokenManagerProps {
  bugReportId: string;
  hasReplay: boolean;
}

export function ShareTokenManager({ bugReportId, hasReplay }: ShareTokenManagerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [expiresIn, setExpiresIn] = useState(String(DEFAULT_SHARE_TOKEN_EXPIRATION_HOURS));
  const [password, setPassword] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Fetch active share token
  const {
    data: shareToken,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['shareToken', bugReportId],
    queryFn: () => shareTokenService.getActive(bugReportId),
    enabled: hasReplay,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () =>
      shareTokenService.create(bugReportId, {
        expires_in_hours: parseInt(expiresIn, 10),
        password: password || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shareToken', bugReportId] });
      toast.success('Share link created successfully');
      setPassword('');
      setShowPasswordField(false);
    },
    onError: (apiError) => {
      toast.error(handleApiError(apiError));
    },
  });

  // Revoke mutation
  const revokeMutation = useMutation({
    mutationFn: (token: string) => shareTokenService.revoke(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shareToken', bugReportId] });
      toast.success('Share link revoked successfully');
    },
    onError: (apiError) => {
      toast.error(handleApiError(apiError));
    },
  });

  const handleCopyLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error(t('errors.failedToCopyLink'));
    }
  }, []);

  const handleCreateShare = useCallback(() => {
    // Clear any previous validation errors
    setValidationError(null);

    // Validate expiration hours
    const hours = parseInt(expiresIn, 10);
    if (!expiresIn || expiresIn.trim() === '' || isNaN(hours)) {
      const errorMsg = 'Please enter a valid number of hours';
      setValidationError(errorMsg);
      toast.error(errorMsg);
      return;
    }
    if (hours < MIN_SHARE_TOKEN_EXPIRATION_HOURS || hours > MAX_SHARE_TOKEN_EXPIRATION_HOURS) {
      const errorMsg = t('errors.expirationRange', {
        min: MIN_SHARE_TOKEN_EXPIRATION_HOURS,
        max: MAX_SHARE_TOKEN_EXPIRATION_HOURS,
      });
      setValidationError(errorMsg);
      toast.error(errorMsg);
      return;
    }

    // Validate password if enabled
    if (showPasswordField) {
      if (!password || password.trim() === '') {
        const errorMsg = 'Please enter a password or disable password protection';
        setValidationError(errorMsg);
        toast.error(errorMsg);
        return;
      }
      if (password.length < MIN_SHARE_TOKEN_PASSWORD_LENGTH) {
        const errorMsg = t('errors.passwordMinLength', {
          minLength: MIN_SHARE_TOKEN_PASSWORD_LENGTH,
        });
        setValidationError(errorMsg);
        toast.error(errorMsg);
        return;
      }
    }

    createMutation.mutate();
  }, [expiresIn, password, showPasswordField, createMutation]);

  const handleRevoke = useCallback(() => {
    if (!shareToken) {
      return;
    }
    setShowRevokeDialog(true);
  }, [shareToken]);

  const confirmRevoke = useCallback(() => {
    if (shareToken) {
      revokeMutation.mutate(shareToken.token);
      setShowRevokeDialog(false);
    }
  }, [shareToken, revokeMutation]);

  if (!hasReplay) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5" aria-hidden="true" />
            Public Replay Sharing
          </CardTitle>
          <CardDescription>No session replay available for this bug report</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5" aria-hidden="true" />
            Public Replay Sharing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            <p className="text-sm">{handleApiError(error)}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Share2 className="w-5 h-5" aria-hidden="true" />
          Public Replay Sharing
        </CardTitle>
        <CardDescription>
          Share session replay publicly with an optional password and expiration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500" role="status" aria-live="polite">
            Loading...
          </div>
        ) : shareToken ? (
          /* Active Share Token Display */
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2 text-green-800">
                    <ExternalLink className="w-4 h-4" aria-hidden="true" />
                    <span className="font-semibold">Active Share Link</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Input value={shareToken.share_url} readOnly className="font-mono text-sm" />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyLink(shareToken.share_url)}
                      aria-label="Copy share link"
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <Eye className="w-4 h-4" aria-hidden="true" />
                      <span>{shareToken.view_count} views</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      {shareToken.password_protected ? (
                        <Lock className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Unlock className="w-4 h-4" aria-hidden="true" />
                      )}
                      <span>{shareToken.password_protected ? 'Protected' : 'Public'}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Calendar className="w-4 h-4" aria-hidden="true" />
                      <span>Expires {formatDateShort(shareToken.expires_at)}</span>
                    </div>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRevoke}
                  disabled={revokeMutation.isPending}
                  aria-label="Revoke share link"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              Creating a new share link will automatically revoke the current one
            </p>
          </div>
        ) : (
          /* Create New Share Form */
          <div className="space-y-4">
            {validationError && (
              <div
                className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-800"
                role="alert"
              >
                <p className="text-sm">{validationError}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="expires-in">
                Expires In (hours)
                <span className="text-gray-500 font-normal ml-2">
                  {MIN_SHARE_TOKEN_EXPIRATION_HOURS}-{MAX_SHARE_TOKEN_EXPIRATION_HOURS} hours (30
                  days max)
                </span>
              </Label>
              <Input
                id="expires-in"
                type="number"
                min={MIN_SHARE_TOKEN_EXPIRATION_HOURS}
                max={MAX_SHARE_TOKEN_EXPIRATION_HOURS}
                value={expiresIn}
                onChange={(e) => {
                  setExpiresIn(e.target.value);
                  setValidationError(null); // Clear error on input change
                }}
                placeholder={String(DEFAULT_SHARE_TOKEN_EXPIRATION_HOURS)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="password-toggle"
                checked={showPasswordField}
                onCheckedChange={(checked) => setShowPasswordField(checked === true)}
              />
              <label
                htmlFor="password-toggle"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Password protect this share link
              </label>
            </div>

            {showPasswordField && (
              <div className="space-y-2">
                <Label htmlFor="password">
                  Password
                  <span className="text-gray-500 font-normal ml-2">
                    Min {MIN_SHARE_TOKEN_PASSWORD_LENGTH} characters
                  </span>
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setValidationError(null); // Clear error on input change
                  }}
                  placeholder="Enter password"
                  minLength={MIN_SHARE_TOKEN_PASSWORD_LENGTH}
                />
              </div>
            )}

            <Button
              onClick={handleCreateShare}
              disabled={createMutation.isPending}
              className="w-full"
            >
              <Share2 className="w-4 h-4 mr-2" aria-hidden="true" />
              {createMutation.isPending ? 'Creating...' : 'Create Share Link'}
            </Button>
          </div>
        )}

        {/* Revoke Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showRevokeDialog}
          onClose={() => setShowRevokeDialog(false)}
          onConfirm={confirmRevoke}
          title="Revoke Share Link"
          message="Are you sure you want to revoke this share link? It will no longer be accessible to anyone with the URL."
          confirmText="Revoke"
          cancelText="Cancel"
          variant="danger"
          isLoading={revokeMutation.isPending}
        />
      </CardContent>
    </Card>
  );
}
