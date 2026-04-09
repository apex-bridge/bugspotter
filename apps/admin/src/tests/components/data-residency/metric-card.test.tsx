/**
 * Unit tests for MetricCard component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from '../../../components/data-residency/metric-card';

describe('MetricCard', () => {
  it('should render label and string value', () => {
    render(<MetricCard label="Test Label" value="Test Value" />);

    expect(screen.getByText('Test Label')).toBeInTheDocument();
    expect(screen.getByText('Test Value')).toBeInTheDocument();
  });

  it('should render label and numeric value', () => {
    render(<MetricCard label="Count" value={42} />);

    expect(screen.getByText('Count')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('should render label with React element value', () => {
    render(<MetricCard label="Status" value={<span data-testid="badge">Active</span>} />);

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByTestId('badge')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('should apply correct styling classes', () => {
    const { container } = render(<MetricCard label="Test" value="Value" />);

    const wrapper = container.querySelector('.p-4.bg-gray-50.rounded-lg');
    expect(wrapper).toBeInTheDocument();
  });
});
