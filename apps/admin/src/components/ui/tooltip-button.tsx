/**
 * TooltipButton - Button component with integrated tooltip
 */

import { type ReactNode, type ButtonHTMLAttributes } from 'react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

export interface TooltipButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button variant style */
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'destructive-ghost';
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Loading state */
  isLoading?: boolean;
  /** Tooltip text to display on hover */
  tooltip: string;
  /** Button content (typically an icon) */
  children: ReactNode;
}

/**
 * A button with an integrated tooltip. Combines Button, Tooltip, TooltipTrigger,
 * and TooltipContent into a single component to reduce boilerplate.
 */
export function TooltipButton({ tooltip, children, ...buttonProps }: TooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...buttonProps}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
