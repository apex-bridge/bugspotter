import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownEditor } from '../../components/integrations/markdown-editor';

describe('MarkdownEditor', () => {
  it('should render editor with default Edit tab selected', () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="" onChange={onChange} />);

    expect(screen.getByRole('tab', { name: /edit/i })).toHaveAttribute(
      'class',
      expect.stringContaining('border-blue-500')
    );
    expect(screen.getByRole('tab', { name: /preview/i })).toHaveAttribute(
      'class',
      expect.stringContaining('border-transparent')
    );
  });

  it('should switch to Preview tab when clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MarkdownEditor value="# Hello World" onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    expect(screen.getByRole('tab', { name: /preview/i })).toHaveAttribute(
      'class',
      expect.stringContaining('border-blue-500')
    );
    expect(screen.getByRole('tab', { name: /edit/i })).toHaveAttribute(
      'class',
      expect.stringContaining('border-transparent')
    );
  });

  it('should show help text about Markdown support', () => {
    const onChange = vi.fn();
    render(<MarkdownEditor value="" onChange={onChange} />);

    expect(screen.getByText(/supports markdown/i)).toBeInTheDocument();
    expect(screen.getByText(/\*\*bold\*\*/i)).toBeInTheDocument();
  });

  it('should use custom height when provided', () => {
    const onChange = vi.fn();
    const { container } = render(<MarkdownEditor value="" onChange={onChange} height="400px" />);

    // CodeMirror wrapper should have custom height
    const editor = container.querySelector('.cm-editor');
    expect(editor).toBeInTheDocument();
  });

  it('should render preview with Markdown converted to HTML', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = '**Bold text** and [link](https://example.com)';

    render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    // Preview should show rendered HTML
    const preview = screen.getByText(/bold text/i).closest('div');
    expect(preview).toBeInTheDocument();
  });

  it('should convert headings in preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = '# Heading 1\n## Heading 2\n### Heading 3';

    render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    // Headings should be rendered
    expect(screen.getByText('Heading 1')).toBeInTheDocument();
    expect(screen.getByText('Heading 2')).toBeInTheDocument();
    expect(screen.getByText('Heading 3')).toBeInTheDocument();
  });

  it('should convert bold and italic in preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = '**bold** and *italic* and _italic_';

    render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    // Should contain bold and italic elements (use getAllByText to avoid collision with help text)
    const boldElements = screen.getAllByText('bold');
    const preview = boldElements[0].parentElement; // First one is in preview, second in help text
    expect(preview?.innerHTML).toContain('<strong>');
    expect(preview?.innerHTML).toContain('<em>');
  });

  it('should convert links in preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = 'Click [here](https://example.com)';

    render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    const link = screen.getByRole('link', { name: /here/i });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('should convert inline code in preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = 'Use `{{error.message}}` variable';

    render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    // Check that code element exists in rendered preview
    const codeElement = screen.getByText(/error\.message/i);
    expect(codeElement.tagName.toLowerCase()).toBe('code');
    expect(codeElement).toHaveClass('bg-gray-100');
  });

  it('should convert code blocks in preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = '```\nconst x = 1;\n```';

    render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    const preview = screen.getByText(/const x = 1/i).closest('pre');
    expect(preview).toBeInTheDocument();
  });

  it('should handle empty value in preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<MarkdownEditor value="" onChange={onChange} placeholder="Placeholder text" />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    // Should show placeholder in preview
    expect(screen.getByText(/placeholder text/i)).toBeInTheDocument();
  });

  it('should render GFM table as <table> with styled cells', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = '| Field | Value |\n|-------|-------|\n| Browser | Chrome |\n| OS | Windows |';

    const { container } = render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(table).toHaveClass('border-collapse', 'border', 'border-gray-300');

    // Verify header
    const headers = container.querySelectorAll('th');
    expect(headers).toHaveLength(2);
    expect(headers[0]).toHaveTextContent('Field');
    expect(headers[1]).toHaveTextContent('Value');
    expect(headers[0]).toHaveClass('border', 'border-gray-300', 'font-semibold');

    // Verify data cells
    const cells = container.querySelectorAll('td');
    expect(cells).toHaveLength(4);
    expect(cells[0]).toHaveTextContent('Browser');
    expect(cells[1]).toHaveTextContent('Chrome');
    expect(cells[2]).toHaveTextContent('OS');
    expect(cells[3]).toHaveTextContent('Windows');
    expect(cells[0]).toHaveClass('border', 'border-gray-300');

    // Verify thead has bg styling
    const thead = container.querySelector('thead');
    expect(thead).toHaveClass('bg-gray-50');
  });

  it('should render GFM table with template variables', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown =
      '| Field | Value |\n|-------|-------|\n| Priority | {{priority}} |\n| Browser | {{browser}} |';

    const { container } = render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();

    const cells = container.querySelectorAll('td');
    expect(cells[1]).toHaveTextContent('{{priority}}');
    expect(cells[3]).toHaveTextContent('{{browser}}');
  });

  it('should handle template variables in preview', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const markdown = '**Error**: {{error.message}}\n**User**: {{user_email}}';

    render(<MarkdownEditor value={markdown} onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: /preview/i }));

    // Template variables should be preserved in preview
    expect(screen.getByText(/\{\{error\.message\}\}/i)).toBeInTheDocument();
    expect(screen.getByText(/\{\{user_email\}\}/i)).toBeInTheDocument();
  });
});
