import { type Page } from '@playwright/test';

/**
 * Helper to wait for i18n translations to load.
 * Verifies that the UI has finished loading translations by checking that
 * no elements (matching the selector) display raw translation keys.
 *
 * A string is considered a "raw translation key" if it contains a dot, has no spaces,
 * and doesn't look like a version number (e.g. "1.0.0").
 *
 * @param page The Playwright page object
 * @param options.timeout Timeout in milliseconds (default: 5000)
 * @param options.selector Selector to check (default: buttons, headings, labels, tabs)
 * @param options.match 'every' (default) requires all matching elements to be translated. 'some' requires at least one.
 */
export async function waitForI18nReady(
  page: Page,
  options: { timeout?: number; selector?: string; match?: 'every' | 'some' } = {}
): Promise<void> {
  const timeout = options.timeout ?? 5000;
  // Common UI elements that contain static text which should be translated
  const selector =
    options.selector ?? 'button, h1, h2, h3, h4, label, [role="button"], [role="tab"]';
  const matchMode = options.match ?? 'every';

  try {
    await page.waitForFunction(
      ({ sel, mode }) => {
        /**
         * Checks if text looks like a translation key (e.g., "namespace.key", "actions.save")
         * Heuristic:
         * 1. Must contain a dot
         * 2. Must NOT contain spaces
         * 3. Must NOT like a version number (e.g. "1.0.0", "2.5")
         */
        const isTranslationKey = (text: string) => {
          if (!text.includes('.') || text.includes(' ')) {
            return false;
          }
          // Ignore version numbers
          if (/^\d+(\.\d+)*$/.test(text)) {
            return false;
          }
          return true;
        };

        const elements = Array.from(document.querySelectorAll(sel));

        // Filter for visible elements that have non-empty text
        const visibleElements = elements.filter((el) => {
          const text = el.textContent?.trim();
          if (!text) {
            return false;
          }

          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        });

        // If no matching elements are visible, we might be too early (DOM not ready), return false to keep waiting
        if (visibleElements.length === 0) {
          return false;
        }

        // Check translation status
        if (mode === 'every') {
          // Ready when NO element looks like a raw key
          return visibleElements.every((el) => !isTranslationKey(el.textContent!.trim()));
        } else {
          // Ready when AT LEAST ONE element does NOT look like a raw key
          return visibleElements.some((el) => !isTranslationKey(el.textContent!.trim()));
        }
      },
      { sel: selector, mode: matchMode },
      { timeout }
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('Timeout')) {
      // Enhance error message with details about what failed to translate
      const keysFound = await page.evaluate((sel) => {
        const isKey = (text: string) =>
          text.includes('.') && !text.includes(' ') && !/^\d+(\.\d+)*$/.test(text);
        const elements = Array.from(document.querySelectorAll(sel));
        return elements
          .filter((el) => {
            const style = window.getComputedStyle(el);
            return (
              style.display !== 'none' && style.visibility !== 'hidden' && el.textContent?.trim()
            );
          })
          .map((el) => el.textContent!.trim())
          .filter((text) => isKey(text));
      }, selector);

      if (keysFound.length > 0) {
        throw new Error(
          `waitForI18nReady timeout(${timeout}ms): Found potential raw keys: ${keysFound.slice(0, 5).join(', ')}${keysFound.length > 5 ? '...' : ''}`
        );
      }
    }
    throw error;
  }
}
