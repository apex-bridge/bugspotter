import { useState } from 'react';
import { cn } from '../../lib/utils';
import { CodeSnippet } from './code-snippet';

export interface SnippetTab {
  /** Stable id used for the tab button + tracking. */
  id: string;
  /** Human-readable tab label (e.g. "JavaScript"). Already translated by the caller. */
  label: string;
  /** Code to render when this tab is active. */
  code: string;
  /** Optional language hint forwarded to `<CodeSnippet>`. Defaults to `id`. */
  language?: string;
}

export interface SnippetTabsProps {
  /** Tab definitions in render order. The first one is selected initially. */
  tabs: SnippetTab[];
  /** Accessible label for the tablist (e.g. "Code language"). */
  ariaLabel: string;
  /** Optional className for the outer container. */
  className?: string;
  /** Optional callback when the active tab changes (analytics, persistence, …). */
  onTabChange?: (tabId: string) => void;
}

/**
 * Reusable language-picker-over-snippet container. Composes a tab
 * strip and `<CodeSnippet>` so any snippet flow with multiple
 * language variants gets a consistent UX without re-implementing
 * the picker.
 */
export function SnippetTabs({ tabs, ariaLabel, className, onTabChange }: SnippetTabsProps) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? '');
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  if (!active) {
    return null;
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div role="tablist" aria-label={ariaLabel} className="flex gap-1 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active.id}
            onClick={() => {
              setActiveId(tab.id);
              onTabChange?.(tab.id);
            }}
            className={cn(
              'px-3 py-1.5 text-sm font-medium border-b-2 transition-colors',
              tab.id === active.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <CodeSnippet code={active.code} language={active.language ?? active.id} />
    </div>
  );
}
