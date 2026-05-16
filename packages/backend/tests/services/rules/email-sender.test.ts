/**
 * Unit tests for the email-sender layer.
 *
 * Two pieces:
 *  - `resolveEmailRecipient`: pure function mapping the
 *    `notify.email.to` token + bug context to a literal address (or
 *    null when the recipient can't be derived).
 *  - `ChannelBackedEmailSender`: stubs the channel repo and the
 *    EmailChannelHandler, asserts the wiring (channel lookup, template
 *    render, handler.send call) without touching SMTP.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import {
  ChannelBackedEmailSender,
  resolveEmailRecipient,
} from '../../../src/services/rules/email-sender.js';
import type { NotificationChannelRepository } from '../../../src/db/repositories/notification-channel.repository.js';
import type { EmailChannelHandler } from '../../../src/services/notifications/email-handler.js';
import type { RuleEvalContext } from '../../../src/services/rules/types.js';
import type { BugReport } from '../../../src/db/types.js';

function makeContext(metadata: Record<string, unknown> = {}): RuleEvalContext {
  return {
    bugReport: {
      id: 'bug-1',
      project_id: 'project-1',
      title: 'something broke',
      metadata,
    } as BugReport,
    canonical: null,
    projectId: 'project-1',
    resolved: new Map(),
  };
}

describe('resolveEmailRecipient', () => {
  it('returns null for "closer" (not yet wired)', () => {
    expect(resolveEmailRecipient('closer', makeContext())).toBeNull();
  });

  it('returns null for "all_reporters" (not yet wired)', () => {
    expect(resolveEmailRecipient('all_reporters', makeContext())).toBeNull();
  });

  it('passes a literal email through unchanged', () => {
    expect(resolveEmailRecipient('ops@example.com', makeContext())).toBe('ops@example.com');
  });

  it('resolves "reporter" to bugReport.metadata.metadata.user.email', () => {
    // The reports.ts writer wraps SDK metadata under a second-level
    // `metadata` key: bug_reports.metadata = { console, network,
    // metadata: report.metadata, source, apiKeyPrefix }. The SDK's
    // user.email therefore lives two levels deep.
    const ctx = makeContext({
      metadata: { user: { email: 'reporter@example.com' } },
    });
    expect(resolveEmailRecipient('reporter', ctx)).toBe('reporter@example.com');
  });

  it('returns null when "reporter" path is not populated', () => {
    expect(resolveEmailRecipient('reporter', makeContext({}))).toBeNull();
    expect(resolveEmailRecipient('reporter', makeContext({ metadata: {} }))).toBeNull();
    expect(resolveEmailRecipient('reporter', makeContext({ metadata: { user: {} } }))).toBeNull();
  });

  it('returns null when "reporter" email is an empty string', () => {
    expect(
      resolveEmailRecipient('reporter', makeContext({ metadata: { user: { email: '' } } }))
    ).toBeNull();
  });
});

describe('ChannelBackedEmailSender', () => {
  const FAKE_CHANNEL = {
    id: 'ch-1',
    project_id: 'project-1',
    type: 'email',
    active: true,
    config: {
      type: 'email',
      smtp_host: 'smtp.example.com',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: 'user',
      smtp_pass: 'pass',
      from_address: 'noreply@example.com',
      from_name: 'BugSpotter',
    },
  } as never;

  function buildSender() {
    const findAll: Mock = vi.fn().mockResolvedValue([FAKE_CHANNEL]);
    const channels = { findAll } as unknown as NotificationChannelRepository;
    const send: Mock = vi.fn().mockResolvedValue({ success: true });
    const handler = { send } as unknown as EmailChannelHandler;
    return {
      sender: new ChannelBackedEmailSender(channels, handler),
      findAll,
      send,
    };
  }

  it('sends via the handler with the project channel + rendered template', async () => {
    const { sender, findAll, send } = buildSender();
    const ok = await sender.send({
      projectId: 'project-1',
      to: 'reporter@example.com',
      templateId: 'dedup_ack',
      vars: { canonical: { title: 'Login crash', status: 'closed' } },
    });
    expect(ok).toBe(true);
    expect(findAll).toHaveBeenCalledWith({
      project_id: 'project-1',
      type: 'email',
      active: true,
    });
    const [, payload] = send.mock.calls[0];
    expect(payload.to).toBe('reporter@example.com');
    expect(payload.subject).toBe('Your bug report was matched to an existing issue');
    expect(payload.body).toContain('Login crash');
  });

  it('returns false when no active email channel exists for the project', async () => {
    const { sender, send } = buildSender();
    const findAll = sender['channels'].findAll as Mock;
    findAll.mockResolvedValueOnce([]);
    const ok = await sender.send({
      projectId: 'project-1',
      to: 'reporter@example.com',
      templateId: 'dedup_ack',
      vars: {},
    });
    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns false when the template id is unknown', async () => {
    const { sender, send } = buildSender();
    const ok = await sender.send({
      projectId: 'project-1',
      to: 'reporter@example.com',
      templateId: 'does-not-exist',
      vars: {},
    });
    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns false (without throwing) when the channel lookup fails', async () => {
    const { sender, send } = buildSender();
    const findAll = sender['channels'].findAll as Mock;
    findAll.mockRejectedValueOnce(new Error('db down'));
    const ok = await sender.send({
      projectId: 'project-1',
      to: 'reporter@example.com',
      templateId: 'dedup_ack',
      vars: {},
    });
    expect(ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns false when the handler reports failure', async () => {
    const { sender, send } = buildSender();
    send.mockResolvedValueOnce({ success: false, error: 'SMTP 530' });
    const ok = await sender.send({
      projectId: 'project-1',
      to: 'reporter@example.com',
      templateId: 'dedup_ack',
      vars: {},
    });
    expect(ok).toBe(false);
  });

  it('returns false when the handler throws (executor relies on no propagation)', async () => {
    const { sender, send } = buildSender();
    send.mockRejectedValueOnce(new Error('connection reset'));
    const ok = await sender.send({
      projectId: 'project-1',
      to: 'reporter@example.com',
      templateId: 'dedup_ack',
      vars: {},
    });
    expect(ok).toBe(false);
  });
});
