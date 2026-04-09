/**
 * Unit tests for ViolationItem component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ViolationItem } from '../../../components/data-residency/violation-item';
import * as formatUtils from '../../../utils/format';

describe('ViolationItem', () => {
  const mockViolation = {
    id: '123',
    type: 'Cross-Region Access',
    description: 'Attempted to access data from unauthorized region',
    createdAt: '2026-01-25T12:00:00Z',
    blocked: false,
  };

  beforeEach(() => {
    // Mock formatDate to return deterministic output
    vi.spyOn(formatUtils, 'formatDate').mockReturnValue('01/25/2026, 12:00:00');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render violation details', () => {
    render(<ViolationItem violation={mockViolation} />);

    expect(screen.getByText('Cross-Region Access')).toBeInTheDocument();
    expect(
      screen.getByText('Attempted to access data from unauthorized region')
    ).toBeInTheDocument();
  });

  it('should display formatted timestamp', () => {
    render(<ViolationItem violation={mockViolation} />);

    // Test that formatDate is called and displays the formatted date
    expect(formatUtils.formatDate).toHaveBeenCalledWith('2026-01-25T12:00:00Z');
    const timestampElement = screen.getByText('01/25/2026, 12:00:00');
    expect(timestampElement).toBeInTheDocument();
    expect(timestampElement).toHaveClass('text-xs', 'text-gray-500');
  });

  it('should show AlertTriangle icon when not blocked', () => {
    render(<ViolationItem violation={mockViolation} />);

    const icon = document.querySelector('svg.lucide-triangle-alert');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-yellow-600');
  });

  it('should show Ban icon when blocked', () => {
    const blockedViolation = { ...mockViolation, blocked: true };
    render(<ViolationItem violation={blockedViolation} />);

    const icon = document.querySelector('svg.lucide-ban');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('text-red-600');
  });

  it('should have correct styling for violation container', () => {
    const { container } = render(<ViolationItem violation={mockViolation} />);

    const violationContainer = container.querySelector('.bg-red-50.border-red-200');
    expect(violationContainer).toBeInTheDocument();
  });

  it('should display Clock icon in timestamp section', () => {
    render(<ViolationItem violation={mockViolation} />);

    const clockIcon = document.querySelector('svg.lucide-clock');
    expect(clockIcon).toBeInTheDocument();
  });
});
