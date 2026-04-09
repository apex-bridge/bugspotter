/**
 * Type declarations for md-to-adf
 * The library converts Markdown to Atlassian Document Format (ADF)
 */

declare module 'md-to-adf' {
  /**
   * ADF Node - recursive structure representing content in Atlassian Document Format
   */
  interface ADFNode {
    type: string;
    content?: ADFNode[];
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  }

  /**
   * ADF Document - top-level structure for Atlassian Document Format
   */
  interface ADFDocument {
    type: 'doc';
    version: 1;
    content: ADFNode[];
  }

  /**
   * Convert Markdown string to Jira ADF (Atlassian Document Format)
   * @param markdown - The Markdown string to convert
   * @returns ADF document object compatible with Jira's description field
   */
  export default function md2adf(markdown: string): ADFDocument;
}
