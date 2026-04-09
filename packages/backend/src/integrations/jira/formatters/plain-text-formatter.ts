/**
 * Plain Text Formatter
 * Implementation for older Jira versions (Jira Server/Data Center)
 */

import { JiraDescriptionFormatter } from './base-formatter.js';

/**
 * Plain text implementation
 */
export class PlainTextFormatter extends JiraDescriptionFormatter {
  protected emptyContent(): string {
    return '';
  }

  protected createSection(heading: string, summary: string, logLines: string[]): string {
    const lines = [`*${heading}*`, summary, '{code}', ...logLines, '{code}', '', ''];
    return lines.join('\n');
  }

  protected createDetailsSection(
    heading: string,
    fields: Array<{ label: string; value: string }>
  ): string {
    const lines = [`*${heading}*`];
    fields.forEach((field) => {
      lines.push(`*${field.label}:* ${field.value}`);
    });
    lines.push('', '');
    return lines.join('\n');
  }

  protected createAttachmentsSection(
    heading: string,
    links: Array<{ label: string; url: string }>
  ): string {
    const lines = [`*${heading}*`];
    links.forEach((link) => {
      lines.push(`${link.label}: ${link.url}`);
    });
    lines.push('', '');
    return lines.join('\n');
  }

  public addDescription(description: string): string {
    return `${description}\n\n`;
  }

  public addFooter(): string {
    return '---\n_Automatically created by BugSpotter_';
  }
}
