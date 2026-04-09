/**
 * Markdown Editor Component
 *
 * A CodeMirror-based Markdown editor with syntax highlighting and live preview.
 * Used for editing integration description templates.
 */

import { useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  height = '300px',
}: MarkdownEditorProps) {
  const [showPreview, setShowPreview] = useState(false);

  const markdownComponents = useMemo<Components>(
    () => ({
      a: ({ ...props }) => (
        <a
          {...props}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
        />
      ),
      code: ({ className, children, ...props }) => {
        const isInline = !className?.includes('language-');
        return isInline ? (
          <code {...props} className="bg-gray-100 px-1 rounded text-sm">
            {children}
          </code>
        ) : (
          <code {...props} className={className}>
            {children}
          </code>
        );
      },
      pre: ({ children, ...props }) => (
        <pre {...props} className="bg-gray-100 p-2 rounded my-2 overflow-x-auto">
          {children}
        </pre>
      ),
      h1: ({ ...props }) => <h1 {...props} className="text-2xl font-bold mt-4 mb-2" />,
      h2: ({ ...props }) => <h2 {...props} className="text-xl font-semibold mt-4 mb-2" />,
      h3: ({ ...props }) => <h3 {...props} className="text-lg font-semibold mt-4 mb-2" />,
      p: ({ ...props }) => <p {...props} className="mb-2" />,
      table: ({ ...props }) => (
        <table {...props} className="border-collapse border border-gray-300 w-full my-2 text-sm" />
      ),
      thead: ({ ...props }) => <thead {...props} className="bg-gray-50" />,
      th: ({ ...props }) => (
        <th {...props} className="border border-gray-300 px-3 py-1.5 text-left font-semibold" />
      ),
      td: ({ ...props }) => <td {...props} className="border border-gray-300 px-3 py-1.5" />,
    }),
    []
  );

  return (
    <div className="space-y-2">
      {/* Tab buttons */}
      <div className="flex gap-2 border-b border-gray-200" role="tablist" aria-label="Editor mode">
        <button
          id="edit-tab"
          type="button"
          role="tab"
          aria-selected={!showPreview}
          aria-controls="editor-panel"
          onClick={() => setShowPreview(false)}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            !showPreview
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Edit
        </button>
        <button
          id="preview-tab"
          type="button"
          role="tab"
          aria-selected={showPreview}
          aria-controls="preview-panel"
          onClick={() => setShowPreview(true)}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            showPreview
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          )}
        >
          Preview
        </button>
      </div>

      {/* Editor or Preview */}
      {!showPreview ? (
        <div
          id="editor-panel"
          role="tabpanel"
          aria-labelledby="edit-tab"
          className="border border-gray-300 rounded-md overflow-hidden"
        >
          <CodeMirror
            value={value}
            height={height}
            extensions={[markdown()]}
            onChange={onChange}
            theme={vscodeDark}
            placeholder={placeholder}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              foldGutter: true,
            }}
          />
        </div>
      ) : (
        <div
          id="preview-panel"
          role="tabpanel"
          aria-labelledby="preview-tab"
          className="border border-gray-300 rounded-md p-4 bg-white overflow-auto prose prose-sm max-w-none"
          style={{ minHeight: height }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {value || placeholder || ''}
          </ReactMarkdown>
        </div>
      )}

      {/* Help text */}
      <p className="text-xs text-gray-500">
        Supports Markdown: <strong>**bold**</strong>, <em>*italic*</em>, [link](url), # headings,
        `code`, ```code blocks```, | tables |
      </p>
    </div>
  );
}
