/**
 * Create Organization Dialog
 * Admin creates org with designated owner, plan, and region.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { userService } from '../../services/user-service';
import { useDebounce } from '../../hooks/use-debounce';
import type {
  AdminCreateOrganizationInput,
  PlanName,
  DataResidencyRegion,
  EmailLocale,
} from '../../types/organization';
import { PLAN_NAMES, DATA_RESIDENCY_REGIONS } from '../../types/organization';
import { slugify } from '../../lib/string-utils';
import { getEmailLocale } from '../../lib/locale';
import isEmail from 'validator/lib/isEmail';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: AdminCreateOrganizationInput) => Promise<void>;
  isLoading?: boolean;
}

export function CreateOrganizationDialog({ open, onOpenChange, onSubmit, isLoading }: Props) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [subdomainManual, setSubdomainManual] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);
  const [planName, setPlanName] = useState<PlanName>('professional');
  const [region, setRegion] = useState<DataResidencyRegion>('kz');
  const [locale, setLocale] = useState<EmailLocale>(getEmailLocale(i18n.language));
  const dropdownRef = useRef<HTMLDivElement>(null);

  const debouncedOwnerSearch = useDebounce(ownerSearch, 300);

  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ['users-search', debouncedOwnerSearch],
    queryFn: async () => {
      const response = await userService.getAll({
        page: 1,
        limit: 10,
        email: debouncedOwnerSearch,
      });
      return response.users;
    },
    enabled: open && debouncedOwnerSearch.length >= 2,
  });

  // Auto-slugify name -> subdomain
  useEffect(() => {
    if (!subdomainManual && name) {
      setSubdomain(slugify(name));
    }
  }, [name, subdomainManual]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setName('');
      setSubdomain('');
      setSubdomainManual(false);
      setOwnerUserId('');
      setOwnerSearch('');
      setPlanName('professional');
      setRegion('kz');
      setLocale(getEmailLocale(i18n.language));
    }
  }, [open, i18n.language]);

  // Click-outside for dropdown — only listen while dropdown is visible
  useEffect(() => {
    if (!showOwnerDropdown) {
      return;
    }
    const handle = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowOwnerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showOwnerDropdown]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await onSubmit({
        name,
        subdomain,
        ...(ownerUserId ? { owner_user_id: ownerUserId } : { owner_email: ownerSearch }),
        plan_name: planName,
        data_residency_region: region,
        locale,
      });
    },
    [name, subdomain, ownerUserId, ownerSearch, planName, region, locale, onSubmit]
  );

  const isValid = name.trim() && subdomain.trim() && (ownerUserId || isEmail(ownerSearch));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('organizations.createOrg.title')}</DialogTitle>
          <DialogDescription>{t('organizations.createOrg.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="org-name" className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizations.name')}
            </label>
            <input
              id="org-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Demo Inc"
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Subdomain */}
          <div>
            <label htmlFor="org-subdomain" className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizations.subdomain')}
            </label>
            <input
              id="org-subdomain"
              type="text"
              value={subdomain}
              onChange={(e) => {
                setSubdomain(e.target.value);
                setSubdomainManual(true);
              }}
              placeholder="demo-inc"
              required
              pattern="^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">
              {subdomain && `${subdomain}.bugspotter.io`}
            </p>
          </div>

          {/* Owner (user search) */}
          <div className="relative" ref={dropdownRef}>
            <label htmlFor="org-owner" className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizations.createOrg.owner')}
            </label>
            <input
              id="org-owner"
              type="text"
              value={ownerSearch}
              onChange={(e) => {
                setOwnerSearch(e.target.value);
                setOwnerUserId('');
                setShowOwnerDropdown(true);
              }}
              onFocus={() => setShowOwnerDropdown(true)}
              placeholder={t('organizations.createOrg.searchOwner')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {showOwnerDropdown && ownerSearch.length >= 2 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {isSearching || debouncedOwnerSearch !== ownerSearch ? (
                  <div className="px-3 py-2 text-sm text-gray-400">{t('common.loading')}</div>
                ) : !searchResults?.length ? (
                  <div>
                    <div className="px-3 py-2 text-sm text-gray-400">
                      {t('organization.noUsersFound')}
                    </div>
                    {isEmail(ownerSearch) && (
                      <button
                        type="button"
                        onClick={() => {
                          setOwnerUserId('');
                          setShowOwnerDropdown(false);
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 border-t border-gray-100"
                      >
                        {t('organizations.createOrg.inviteAsOwner', { email: ownerSearch })}
                      </button>
                    )}
                  </div>
                ) : (
                  searchResults.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onClick={() => {
                        setOwnerUserId(user.id);
                        setOwnerSearch(user.email);
                        setShowOwnerDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                    >
                      {user.email} {user.name ? `(${user.name})` : ''}
                    </button>
                  ))
                )}
              </div>
            )}
            {/* Hint below owner input */}
            {!ownerUserId && isEmail(ownerSearch) && (
              <p className="text-xs text-amber-600 mt-1">
                {t('organizations.createOrg.pendingOwnerHint', { email: ownerSearch })}
              </p>
            )}
            {ownerUserId && (
              <p className="text-xs text-green-600 mt-1">
                {t('organizations.createOrg.existingOwnerHint')}
              </p>
            )}
          </div>

          {/* Plan */}
          <div>
            <label htmlFor="org-plan" className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizations.plan')}
            </label>
            <select
              id="org-plan"
              value={planName}
              onChange={(e) => setPlanName(e.target.value as PlanName)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary capitalize"
            >
              {PLAN_NAMES.map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Email language for invitation */}
          {!ownerUserId && isEmail(ownerSearch) && (
            <div>
              <label htmlFor="org-locale" className="block text-sm font-medium text-gray-700 mb-1">
                {t('organizations.invitations.emailLanguage')}
              </label>
              <select
                id="org-locale"
                value={locale}
                onChange={(e) => setLocale(e.target.value as EmailLocale)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="en">English</option>
                <option value="ru">Русский</option>
                <option value="kk">Қазақша</option>
              </select>
            </div>
          )}

          {/* Region */}
          <div>
            <label htmlFor="org-region" className="block text-sm font-medium text-gray-700 mb-1">
              {t('organizations.region')}
            </label>
            <select
              id="org-region"
              value={region}
              onChange={(e) => setRegion(e.target.value as DataResidencyRegion)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary uppercase"
            >
              {DATA_RESIDENCY_REGIONS.map((r) => (
                <option key={r} value={r} className="uppercase">
                  {r}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!isValid || isLoading}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50 hover:bg-primary/90"
            >
              {isLoading ? t('common.loading') : t('organizations.createOrg.submit')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
