import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SnippetTabs } from '../../components/ui/snippet-tabs';

// `<CodeSnippet>` pulls in `react-i18next` + `sonner` for its copy
// affordance — neither is relevant to the structural contract we're
// pinning here, so stub it out and let the test focus on tab ↔ panel
// id wiring.
vi.mock('../../components/ui/code-snippet', () => ({
  CodeSnippet: ({ code }: { code: string }) => <pre data-testid="stub-code">{code}</pre>,
}));

const TABS = [
  { id: 'javascript', label: 'JavaScript', code: 'js code' },
  { id: 'typescript', label: 'TypeScript', code: 'ts code' },
  { id: 'react', label: 'React', code: 'react code' },
];

describe('<SnippetTabs> multi-instance', () => {
  it('gives each instance a unique id namespace so two tablists on the same page do not collide', () => {
    const { container } = render(
      <>
        <SnippetTabs tabs={TABS} ariaLabel="Code language A" />
        <SnippetTabs tabs={TABS} ariaLabel="Code language B" />
      </>
    );

    // Tabs in instance A vs instance B must have distinct `id`s,
    // otherwise `aria-controls` / `aria-labelledby` resolve to the
    // wrong element and arrow-key focus jumps to the wrong tablist.
    const jsTabsA = container.querySelector(
      '[aria-label="Code language A"] [role="tab"][aria-selected="true"]'
    );
    const jsTabsB = container.querySelector(
      '[aria-label="Code language B"] [role="tab"][aria-selected="true"]'
    );

    expect(jsTabsA).not.toBeNull();
    expect(jsTabsB).not.toBeNull();
    expect(jsTabsA?.id).toBeTruthy();
    expect(jsTabsB?.id).toBeTruthy();
    expect(jsTabsA?.id).not.toBe(jsTabsB?.id);
  });

  it('aria-controls on each tab points to a panel that exists in the same instance', () => {
    const { container } = render(
      <>
        <SnippetTabs tabs={TABS} ariaLabel="Code language A" />
        <SnippetTabs tabs={TABS} ariaLabel="Code language B" />
      </>
    );

    const tablists = container.querySelectorAll('[role="tablist"]');
    expect(tablists).toHaveLength(2);

    tablists.forEach((tablist) => {
      // Walk up to the wrapper that contains both the tablist and its
      // panel — the component renders them as siblings inside a
      // `space-y-3` div.
      const wrapper = tablist.parentElement;
      expect(wrapper).not.toBeNull();
      const tabs = tablist.querySelectorAll<HTMLElement>('[role="tab"]');
      const activeTab = Array.from(tabs).find((t) => t.getAttribute('aria-selected') === 'true');
      expect(activeTab).toBeDefined();

      const controlsId = activeTab!.getAttribute('aria-controls');
      expect(controlsId).toBeTruthy();

      // The referenced panel must live in this instance's wrapper —
      // not in the sibling instance's wrapper.
      const panel = wrapper!.querySelector(`#${CSS.escape(controlsId!)}`);
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(activeTab!.id);
    });
  });
});
