/**
 * Change Plan Dialog
 * Admin sets or changes an organization's subscription plan.
 */

import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import type { AdminSetPlanInput, PlanName } from '../../types/organization';
import { PLAN_OPTIONS } from '../../types/organization';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: AdminSetPlanInput) => Promise<void>;
  currentPlan?: PlanName;
  isLoading?: boolean;
}

export function ChangePlanDialog({ open, onOpenChange, onSubmit, currentPlan, isLoading }: Props) {
  const { t } = useTranslation();
  const [planName, setPlanName] = useState<PlanName>(currentPlan ?? 'professional');

  useEffect(() => {
    if (open && currentPlan) {
      setPlanName(currentPlan);
    }
  }, [open, currentPlan]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await onSubmit({ plan_name: planName });
    },
    [planName, onSubmit]
  );

  const isChanged = planName !== currentPlan;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('organizations.changePlan.title')}</DialogTitle>
          <DialogDescription>{t('organizations.changePlan.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {currentPlan && (
            <div className="text-sm text-gray-500">
              {t('organizations.changePlan.currentPlan')}:{' '}
              <span className="font-medium capitalize">{currentPlan}</span>
            </div>
          )}

          <div className="space-y-2">
            {PLAN_OPTIONS.map((plan) => (
              <label
                key={plan.name}
                className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  planName === plan.name
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="plan"
                  value={plan.name}
                  checked={planName === plan.name}
                  onChange={() => setPlanName(plan.name)}
                  className="text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">{plan.label}</span>
                {plan.name === currentPlan && (
                  <span className="text-xs text-gray-400 ml-auto">
                    {t('organizations.changePlan.current')}
                  </span>
                )}
              </label>
            ))}
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
              disabled={!isChanged || isLoading}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm disabled:opacity-50 hover:bg-primary/90"
            >
              {isLoading ? t('common.loading') : t('organizations.changePlan.submit')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
