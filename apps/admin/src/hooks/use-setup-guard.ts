import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupService } from '../services/api';

/**
 * Checks whether the system has been initialized.
 * Redirects to /setup if not, otherwise resolves with `isChecking: false`.
 *
 * @returns `isChecking` — true while the check is in flight.
 *          `isInitialized` — true once the system is confirmed initialized
 *          (also true on error, as a safe fallback).
 */
export function useSetupGuard() {
  const [isChecking, setIsChecking] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const navigate = useNavigate();

  const check = useCallback(async () => {
    try {
      const status = await setupService.getStatus();
      if (!status.initialized) {
        navigate('/setup');
        return;
      }
      setIsInitialized(true);
    } catch {
      // Non-critical — treat as initialized so the page renders
      setIsInitialized(true);
    } finally {
      setIsChecking(false);
    }
  }, [navigate]);

  useEffect(() => {
    check();
  }, [check]);

  return { isChecking, isInitialized };
}
