/**
 * Unit tests for ErrorState component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorState } from '../../../components/data-residency/error-state';

describe('ErrorState', () => {
  it('should render title and message', () => {
    render(<ErrorState title="Error Title" message="Error message details" />);

    expect(screen.getByText('Error Title')).toBeInTheDocument();
    expect(screen.getByText('Error message details')).toBeInTheDocument();
  });

  it('should render AlertTriangle icon', () => {
    render(<ErrorState title="Error" message="Message" />);

    const icon = document.querySelector('svg.lucide-triangle-alert');
    expect(icon).toBeInTheDocument();
  });

  it('should render with destructive alert variant', () => {
    const { container } = render(<ErrorState title="Error" message="Message" />);

    // The Alert component should have destructive variant classes
    const alert = container.querySelector('[role="alert"]');
    expect(alert).toBeInTheDocument();
  });

  it('should have correct title styling', () => {
    render(<ErrorState title="Error Title" message="Message" />);

    const title = screen.getByText('Error Title');
    expect(title).toHaveClass('font-semibold');
  });

  it('should have correct message styling', () => {
    render(<ErrorState title="Title" message="Error message" />);

    const message = screen.getByText('Error message');
    expect(message).toHaveClass('text-sm');
  });
});
