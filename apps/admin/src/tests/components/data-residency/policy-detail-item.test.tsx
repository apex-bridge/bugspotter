/**
 * Unit tests for PolicyDetailItem component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PolicyDetailItem } from '../../../components/data-residency/policy-detail-item';

describe('PolicyDetailItem', () => {
  it('should render label and string value', () => {
    render(<PolicyDetailItem label="Region" value="US-EAST-1" />);

    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('US-EAST-1')).toBeInTheDocument();
  });

  it('should render label with React element value', () => {
    render(
      <PolicyDetailItem label="Encryption" value={<span data-testid="badge">Required</span>} />
    );

    expect(screen.getByText('Encryption')).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
  });

  it('should have correct label styling', () => {
    render(<PolicyDetailItem label="Test" value="Value" />);

    const label = screen.getByText('Test');
    expect(label).toHaveClass('text-sm', 'text-gray-600', 'mb-1');
  });

  it('should have correct value styling', () => {
    render(<PolicyDetailItem label="Test" value="Value" />);

    const value = screen.getByText('Value');
    expect(value).toHaveClass('font-medium');
  });
});
