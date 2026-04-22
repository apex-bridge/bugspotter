/**
 * OrgRetentionConfirmDialog component tests.
 *
 * The E2E spec (`tests/e2e/org-retention.spec.ts`) covers the page-level
 * wiring — list fetch, row rendering, confirmation happy path. These unit
 * tests narrowly cover the dialog component's own invariants so the subtle
 * a11y behavior around the in-flight state is pinned down without a full
 * testcontainer stack.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrgRetentionConfirmDialog } from '../../pages/platform/org-retention';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));

const target = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Abandoned Tenant',
  subdomain: 'abandoned-test',
  deleted_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
  deleted_by: null,
  project_count: 2,
  bug_report_count: 17,
  days_since_deleted: 45,
};

function renderDialog(props: Partial<Parameters<typeof OrgRetentionConfirmDialog>[0]> = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const onConfirmInputChange = vi.fn();
  const utils = render(
    <OrgRetentionConfirmDialog
      target={target}
      confirmInput=""
      onConfirmInputChange={onConfirmInputChange}
      onCancel={onCancel}
      onConfirm={onConfirm}
      isDeleting={false}
      {...props}
    />
  );
  return { ...utils, onCancel, onConfirm, onConfirmInputChange };
}

describe('OrgRetentionConfirmDialog', () => {
  beforeEach(() => {
    // Reset any residual scroll-lock from an earlier test rendering.
    document.body.style.overflow = '';
  });

  it('locks body scroll while the dialog is mounted', () => {
    renderDialog();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape when no mutation is in flight', async () => {
    const { onCancel } = renderDialog({ isDeleting: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('enables the submit button when the typed subdomain matches', async () => {
    // Sanity check — matches the E2E coverage but fast. Drives the
    // `confirmInput` prop like the parent page does: onChange normalizes
    // to lowercase before forwarding to `onConfirmInputChange`.
    const user = userEvent.setup();
    const { getByLabelText, getByRole, rerender, onConfirmInputChange } = renderDialog({
      confirmInput: '',
    });
    const input = getByLabelText(/Subdomain confirmation/i);
    await user.type(input, 'abandoned-test');
    // Each keystroke fires onConfirmInputChange; the parent would flow
    // the accumulated value back through the `confirmInput` prop.
    expect(onConfirmInputChange).toHaveBeenCalled();
    rerender(
      <OrgRetentionConfirmDialog
        target={target}
        confirmInput="abandoned-test"
        onConfirmInputChange={onConfirmInputChange}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isDeleting={false}
      />
    );
    const submit = getByRole('button', { name: /^Delete permanently$/i });
    expect(submit).not.toBeDisabled();
  });

  describe('in-flight state (regression coverage)', () => {
    // These tests pin the fix for a subtle bug: the dialog's a11y wiring
    // (body scroll lock, Escape handler, focus trap) is provided by
    // `useModalFocus`. Early iterations toggled the hook's enabled flag
    // off the moment `isDeleting` went true, which caused the hook's
    // cleanup to run WHILE the dialog was still rendered — background
    // scroll re-enabled, Escape listener removed, focus hopped back to
    // the underlying row. For the ~200–500ms the request was in flight
    // the modal was visually up but its accessibility contract had
    // silently unraveled. The hook must stay enabled for the dialog's
    // lifetime; close attempts are gated inside the close handler.

    it('keeps body scroll locked after isDeleting flips to true', () => {
      const { rerender } = renderDialog({ isDeleting: false });
      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <OrgRetentionConfirmDialog
          target={target}
          confirmInput="abandoned-test"
          onConfirmInputChange={vi.fn()}
          onCancel={vi.fn()}
          onConfirm={vi.fn()}
          isDeleting={true}
        />
      );
      // If `useModalFocus` tore down because its enabled flag flipped off,
      // body.style.overflow would have been cleared back to ''.
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('ignores Escape while isDeleting is true (no-op, no onCancel)', () => {
      const { onCancel } = renderDialog({ isDeleting: true });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('disables both submit and cancel while isDeleting is true', () => {
      const { getByRole } = renderDialog({
        confirmInput: 'abandoned-test',
        isDeleting: true,
      });
      expect(getByRole('button', { name: /Cancel/i })).toBeDisabled();
      expect(getByRole('button', { name: /Deleting/i })).toBeDisabled();
    });
  });
});
