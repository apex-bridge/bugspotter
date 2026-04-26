/**
 * Auth Service
 * Handles authentication operations
 */

import { api, API_ENDPOINTS } from '../lib/api-client';
import type { AuthResponse } from '../types';

export const authService = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const response = await api.post<{ success: boolean; data: AuthResponse }>(
      API_ENDPOINTS.auth.login(),
      {
        email,
        password,
      }
    );
    return response.data.data;
  },

  magicLogin: async (token: string): Promise<AuthResponse> => {
    const response = await api.post<{ success: boolean; data: AuthResponse }>(
      API_ENDPOINTS.auth.magicLogin(),
      {
        token,
      }
    );
    return response.data.data;
  },

  register: async (
    email: string,
    password: string,
    name?: string,
    inviteToken?: string
  ): Promise<AuthResponse> => {
    const response = await api.post<{ success: boolean; data: AuthResponse }>(
      API_ENDPOINTS.auth.register(),
      {
        email,
        password,
        ...(name ? { name } : {}),
        ...(inviteToken ? { invite_token: inviteToken } : {}),
      }
    );
    return response.data.data;
  },

  getRegistrationStatus: async (): Promise<{
    allowed: boolean;
    requireInvitation: boolean;
  }> => {
    const response = await api.get<{
      success: boolean;
      data: { allowed: boolean; requireInvitation: boolean };
    }>(API_ENDPOINTS.auth.registrationStatus());
    return response.data.data;
  },

  logout: async (): Promise<void> => {
    await api.post(API_ENDPOINTS.auth.logout());
  },

  refreshToken: async (): Promise<string> => {
    const response = await api.post<{ success: boolean; data: { access_token: string } }>(
      API_ENDPOINTS.auth.refresh(),
      {}
    );
    return response.data.data.access_token;
  },

  /**
   * Consume a verification token sent by `POST /auth/signup`'s
   * verification email. The token IS the auth — no session required —
   * which is why this is wired through a public route on the admin.
   *
   * Returns nothing on success; throws for non-2xx responses. Callers
   * are expected to distinguish terminal failures (4xx — token dead,
   * already used / expired / signup disabled) from retryable ones
   * (5xx, 429, network) so a transient server hiccup doesn't surface
   * as "your link is dead." See `isTransientError` in `verify-email.tsx`
   * for the classification used by the admin landing page; missing-
   * token handling is a separate concern handled before the call.
   */
  verifyEmail: async (token: string): Promise<void> => {
    await api.post<{ success: boolean; data: { email_verified: true } }>(
      API_ENDPOINTS.auth.verifyEmail(),
      { token }
    );
  },

  /**
   * Request a new verification email for the currently-authed user.
   * Backend silent-no-ops if the user is already verified — same 200
   * either way, no probe-able state leak. 401 if not authed, 403 if
   * signup is disabled.
   */
  resendVerification: async (): Promise<void> => {
    await api.post<{ success: boolean; data: { message: string } }>(
      API_ENDPOINTS.auth.resendVerification(),
      {}
    );
  },
};
