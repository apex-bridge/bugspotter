/**
 * Replay Quality Settings Component Tests
 * Tests for the admin panel replay quality configuration UI
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReplayQualitySettings } from '../../components/settings/replay-quality-settings';
import type { InstanceSettings } from '../../types';

describe('ReplayQualitySettings', () => {
  const mockUpdateField = vi.fn();

  const defaultFormData: Partial<InstanceSettings> = {
    replay_inline_stylesheets: true,
    replay_inline_images: false,
    replay_collect_fonts: true,
    replay_record_canvas: false,
    replay_record_cross_origin_iframes: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Component Rendering', () => {
    it('should render all quality settings controls', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByText('Session Replay Quality')).toBeInTheDocument();
      expect(screen.getByText('Visual Fidelity')).toBeInTheDocument();
      expect(screen.getByText('Advanced Recording')).toBeInTheDocument();
    });

    it('should render all five checkboxes', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByRole('checkbox', { name: /inline stylesheets/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /inline images/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /collect fonts/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /record canvas/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /cross-origin iframes/i })).toBeInTheDocument();
    });

    it('should display size impact calculator', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByText('Estimated Storage Impact')).toBeInTheDocument();
      expect(screen.getByText(/~145KB/i)).toBeInTheDocument(); // Default size
    });

    it('should show recommendations section', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByText(/💡 Recommendations/i)).toBeInTheDocument();
      expect(screen.getByText(/Standard setup/i)).toBeInTheDocument();
    });
  });

  describe('Checkbox States', () => {
    it('should reflect form data in checkbox states', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      const stylesheets = screen.getByRole('checkbox', { name: /inline stylesheets/i });
      const images = screen.getByRole('checkbox', { name: /inline images/i });
      const fonts = screen.getByRole('checkbox', { name: /collect fonts/i });
      const canvas = screen.getByRole('checkbox', { name: /record canvas/i });
      const iframes = screen.getByRole('checkbox', { name: /cross-origin iframes/i });

      expect(stylesheets).toBeChecked();
      expect(images).not.toBeChecked();
      expect(fonts).toBeChecked();
      expect(canvas).not.toBeChecked();
      expect(iframes).not.toBeChecked();
    });

    it('should handle all checkboxes checked', () => {
      const allEnabled = {
        replay_inline_stylesheets: true,
        replay_inline_images: true,
        replay_collect_fonts: true,
        replay_record_canvas: true,
        replay_record_cross_origin_iframes: true,
      };

      render(<ReplayQualitySettings formData={allEnabled} updateField={mockUpdateField} />);

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach((checkbox) => {
        expect(checkbox).toBeChecked();
      });
    });

    it('should handle all checkboxes unchecked', () => {
      const allDisabled = {
        replay_inline_stylesheets: false,
        replay_inline_images: false,
        replay_collect_fonts: false,
        replay_record_canvas: false,
        replay_record_cross_origin_iframes: false,
      };

      render(<ReplayQualitySettings formData={allDisabled} updateField={mockUpdateField} />);

      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach((checkbox) => {
        expect(checkbox).not.toBeChecked();
      });
    });
  });

  describe('User Interactions', () => {
    it('should call updateField when toggling stylesheets', async () => {
      const user = userEvent.setup();

      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      const checkbox = screen.getByRole('checkbox', { name: /inline stylesheets/i });
      await user.click(checkbox);

      expect(mockUpdateField).toHaveBeenCalledWith('replay_inline_stylesheets', false);
    });

    it('should call updateField when toggling images', async () => {
      const user = userEvent.setup();

      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      const checkbox = screen.getByRole('checkbox', { name: /inline images/i });
      await user.click(checkbox);

      expect(mockUpdateField).toHaveBeenCalledWith('replay_inline_images', true);
    });

    it('should call updateField for each setting independently', async () => {
      const user = userEvent.setup();

      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      await user.click(screen.getByRole('checkbox', { name: /collect fonts/i }));
      expect(mockUpdateField).toHaveBeenCalledWith('replay_collect_fonts', false);

      await user.click(screen.getByRole('checkbox', { name: /record canvas/i }));
      expect(mockUpdateField).toHaveBeenCalledWith('replay_record_canvas', true);

      await user.click(screen.getByRole('checkbox', { name: /cross-origin iframes/i }));
      expect(mockUpdateField).toHaveBeenCalledWith('replay_record_cross_origin_iframes', true);

      expect(mockUpdateField).toHaveBeenCalledTimes(3);
    });
  });

  describe('Size Impact Calculator', () => {
    it('should show default size with defaults enabled', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      // stylesheets + fonts = 130KB + 15KB = 145KB
      expect(screen.getByText(/~145KB/i)).toBeInTheDocument();
    });

    it('should calculate higher size with images enabled', () => {
      const withImages = {
        ...defaultFormData,
        replay_inline_images: true,
      };

      render(<ReplayQualitySettings formData={withImages} updateField={mockUpdateField} />);

      // Base 100KB * (1 + 0.3 + 3 + 0.15) = 445KB
      expect(screen.getByText(/~445KB/i)).toBeInTheDocument();
    });

    it('should calculate maximum size with all options enabled', () => {
      const allEnabled = {
        replay_inline_stylesheets: true,
        replay_inline_images: true,
        replay_collect_fonts: true,
        replay_record_canvas: true,
        replay_record_cross_origin_iframes: true,
      };

      render(<ReplayQualitySettings formData={allEnabled} updateField={mockUpdateField} />);

      // Base 100KB * (1 + 0.3 + 3 + 0.15 + 1) = 545KB
      expect(screen.getByText(/~545KB/i)).toBeInTheDocument();
    });

    it('should show minimum size with all options disabled', () => {
      const allDisabled = {
        replay_inline_stylesheets: false,
        replay_inline_images: false,
        replay_collect_fonts: false,
        replay_record_canvas: false,
        replay_record_cross_origin_iframes: false,
      };

      render(<ReplayQualitySettings formData={allDisabled} updateField={mockUpdateField} />);

      // Base 100KB * 1 = 100KB (use getAllByText for multiple matches)
      const sizeTexts = screen.getAllByText(/~100KB/i);
      expect(sizeTexts.length).toBeGreaterThan(0);
      expect(sizeTexts[0]).toBeInTheDocument();
    });
  });

  describe('Warning Alerts', () => {
    it('should show warning when image inlining is enabled', () => {
      const withImages = {
        ...defaultFormData,
        replay_inline_images: true,
      };

      render(<ReplayQualitySettings formData={withImages} updateField={mockUpdateField} />);

      expect(screen.getByText('High Storage Cost Warning')).toBeInTheDocument();
      expect(screen.getByText(/increase replay sizes by 3-5x/i)).toBeInTheDocument();
    });

    it('should not show warning when images are disabled', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.queryByText('High Storage Cost Warning')).not.toBeInTheDocument();
    });
  });

  describe('Status Badges', () => {
    it('should show "Recommended" badges', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      const recommendedBadges = screen.getAllByText('Recommended');
      expect(recommendedBadges.length).toBeGreaterThan(0);
    });

    it('should show "High Cost" badge for images', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByText('High Cost')).toBeInTheDocument();
    });

    it('should show "Specialized" badge for canvas', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByText('Specialized')).toBeInTheDocument();
    });

    it('should show "Privacy Risk" badge for iframes', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByText('Privacy Risk')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper labels for all checkboxes', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByRole('checkbox', { name: /inline stylesheets/i })).toHaveAccessibleName();
      expect(screen.getByRole('checkbox', { name: /inline images/i })).toHaveAccessibleName();
      expect(screen.getByRole('checkbox', { name: /collect fonts/i })).toHaveAccessibleName();
      expect(screen.getByRole('checkbox', { name: /record canvas/i })).toHaveAccessibleName();
      expect(
        screen.getByRole('checkbox', { name: /cross-origin iframes/i })
      ).toHaveAccessibleName();
    });

    it('should have descriptive text for each option', () => {
      render(<ReplayQualitySettings formData={defaultFormData} updateField={mockUpdateField} />);

      expect(screen.getByText(/Captures external CSS for accurate styling/i)).toBeInTheDocument();
      expect(screen.getByText(/Embeds images directly in replay data/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Includes custom fonts for proper text rendering/i)
      ).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined form data', () => {
      render(<ReplayQualitySettings formData={{}} updateField={mockUpdateField} />);

      // Should use default values (from ?? operators)
      const stylesheets = screen.getByRole('checkbox', { name: /inline stylesheets/i });
      expect(stylesheets).toBeChecked(); // Default is true
    });

    it('should handle null values in form data', () => {
      const nullData = {
        replay_inline_stylesheets: null as unknown as boolean,
        replay_inline_images: null as unknown as boolean,
      };

      render(<ReplayQualitySettings formData={nullData} updateField={mockUpdateField} />);

      // Should fallback to defaults
      expect(screen.getAllByRole('checkbox').length).toBe(5);
    });
  });
});
