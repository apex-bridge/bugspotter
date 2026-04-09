/**
 * ADF (Atlassian Document Format) Formatter
 * Implementation for Jira Cloud rich text format
 */

import type { JiraDescriptionNode } from '../types.js';
import { JiraDescriptionFormatter } from './base-formatter.js';

/**
 * Create ADF heading node
 */
function createADFHeading(text: string, level = 3): JiraDescriptionNode {
  return {
    type: 'heading',
    attrs: { level },
    content: [
      {
        type: 'text',
        text,
        marks: [{ type: 'strong' }],
      },
    ],
  };
}

/**
 * Create ADF paragraph node
 */
function createADFParagraph(text: string): JiraDescriptionNode {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

/**
 * Create ADF code block node
 */
function createADFCodeBlock(content: string, language = 'text'): JiraDescriptionNode {
  return {
    type: 'codeBlock',
    attrs: { language },
    content: [
      {
        type: 'text',
        text: content,
      },
    ],
  };
}

/**
 * Create ADF labeled paragraph (field with label and value)
 */
function createADFLabeledParagraph(label: string, value: string): JiraDescriptionNode {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: `${label}: `,
        marks: [{ type: 'strong' }],
      },
      {
        type: 'text',
        text: value,
      },
    ],
  };
}

/**
 * Create ADF paragraph with link
 */
function createADFLinkParagraph(label: string, url: string): JiraDescriptionNode {
  return {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: `${label}: `,
        marks: [{ type: 'strong' }],
      },
      {
        type: 'text',
        text: url,
        marks: [
          {
            type: 'link',
            attrs: { href: url },
          },
        ],
      },
    ],
  };
}

/**
 * ADF (Atlassian Document Format) implementation
 */
export class ADFFormatter extends JiraDescriptionFormatter {
  protected emptyContent(): JiraDescriptionNode[] {
    return [];
  }

  protected createSection(
    heading: string,
    summary: string,
    logLines: string[]
  ): JiraDescriptionNode[] {
    return [
      createADFHeading(heading),
      createADFParagraph(summary),
      createADFCodeBlock(logLines.join('\n')),
    ];
  }

  protected createDetailsSection(
    heading: string,
    fields: Array<{ label: string; value: string }>
  ): JiraDescriptionNode[] {
    const nodes: JiraDescriptionNode[] = [createADFHeading(heading)];
    fields.forEach((field) => {
      nodes.push(createADFLabeledParagraph(field.label, field.value));
    });
    return nodes;
  }

  protected createAttachmentsSection(
    heading: string,
    links: Array<{ label: string; url: string }>
  ): JiraDescriptionNode[] {
    const nodes: JiraDescriptionNode[] = [createADFHeading(heading)];
    links.forEach((link) => {
      nodes.push(createADFLinkParagraph(link.label, link.url));
    });
    return nodes;
  }

  public addDescription(description: string): JiraDescriptionNode[] {
    return [createADFParagraph(description)];
  }

  public addFooter(): JiraDescriptionNode[] {
    return [createADFParagraph('---'), createADFParagraph('Automatically created by BugSpotter')];
  }
}
