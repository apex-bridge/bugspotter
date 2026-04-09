/**
 * Markdown to ADF Conversion
 * Handles GFM table syntax that md-to-adf doesn't support natively
 */

import md2adf from 'md-to-adf';
import type { JiraDescription, JiraDescriptionNode } from './types.js';

/**
 * Convert a Markdown table to an ADF table node.
 * Handles standard GFM tables with header row, separator, and data rows.
 */
function markdownTableToADF(tableText: string): JiraDescriptionNode {
  const lines = tableText
    .trim()
    .split('\n')
    .filter((l) => l.trim());

  const parseRow = (line: string): string[] =>
    line
      .split('|')
      .map((cell) => cell.trim())
      .filter((_cell, i, arr) => i > 0 && i < arr.length - 1);

  const headers = parseRow(lines[0]);
  // Skip separator line (index 1), parse data rows
  const dataRows = lines.slice(2).map(parseRow);

  const makeCell = (text: string, isHeader: boolean): JiraDescriptionNode => ({
    type: isHeader ? 'tableHeader' : 'tableCell',
    attrs: {},
    content: [
      {
        type: 'paragraph',
        content: text
          ? [{ type: 'text', text, ...(isHeader ? { marks: [{ type: 'strong' }] } : {}) }]
          : [],
      },
    ],
  });

  return {
    type: 'table',
    attrs: { isNumberColumnEnabled: false, layout: 'default' },
    content: [
      {
        type: 'tableRow',
        content: headers.map((h) => makeCell(h, true)),
      },
      ...dataRows.map((row) => ({
        type: 'tableRow' as const,
        content: headers.map((_, i) => makeCell(row[i] || '', false)),
      })),
    ],
  };
}

/**
 * Convert Markdown to ADF, with pre-processing for GFM tables.
 *
 * md-to-adf doesn't support table syntax, so we:
 * 1. Extract tables and replace with placeholders
 * 2. Convert the rest with md-to-adf
 * 3. Splice ADF table nodes back into the correct positions
 */
export function markdownToADFWithTables(markdown: string): JiraDescription {
  // Regex to match GFM tables (header + separator + data rows)
  const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\s*\n)\|[\s:|-]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/g;

  const tables: { placeholder: string; adfNode: JiraDescriptionNode }[] = [];
  let idx = 0;

  // Replace tables with unique placeholders.
  // Use alphanumeric-only placeholder to avoid md2adf treating underscores as bold/italic.
  const withPlaceholders = markdown.replace(tableRegex, (match) => {
    const placeholder = `ADFTABLEPLACEHOLDER${idx}`;
    tables.push({ placeholder, adfNode: markdownTableToADF(match) });
    idx++;
    return `\n\n${placeholder}\n\n`;
  });

  // Convert the rest with md-to-adf.
  // md2adf returns a class instance where type/version are prototype properties,
  // so we normalize to a plain object via JSON round-trip.
  const adf = JSON.parse(JSON.stringify(md2adf(withPlaceholders))) as JiraDescription;

  if (tables.length === 0) {
    return adf;
  }

  // Walk the ADF content and replace placeholder paragraphs with table nodes
  const newContent: JiraDescriptionNode[] = [];
  for (const node of adf.content) {
    if (
      node.type === 'paragraph' &&
      node.content?.length === 1 &&
      node.content[0].type === 'text'
    ) {
      const text = node.content[0].text?.trim() || '';
      const tableMatch = tables.find((t) => text === t.placeholder);
      if (tableMatch) {
        newContent.push(tableMatch.adfNode);
        continue;
      }
    }
    newContent.push(node);
  }

  return { ...adf, content: newContent };
}
