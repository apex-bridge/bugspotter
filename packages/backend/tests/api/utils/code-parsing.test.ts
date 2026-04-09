import { describe, it, expect } from 'vitest';
import { extractJsonObject, extractFunctionBody } from '../../../src/api/utils/code-parsing.js';

describe('extractJsonObject', () => {
  describe('Basic Extraction', () => {
    it('should extract a simple object literal', () => {
      const code = 'metadata: { "name": "Test", "version": "1.0.0" }';
      const result = extractJsonObject(code, /metadata:\s*/);

      expect(result).toBe('{ "name": "Test", "version": "1.0.0" }');
      expect(JSON.parse(result!)).toEqual({ name: 'Test', version: '1.0.0' });
    });

    it('should extract object with single quotes (not valid JSON)', () => {
      const code = "config: { key: 'value', num: 42 }";
      const result = extractJsonObject(code, /config:\s*/);

      expect(result).toBe("{ key: 'value', num: 42 }");
      // Note: This is JavaScript object syntax, not valid JSON
    });

    it('should extract object with backticks (not valid JSON)', () => {
      const code = 'settings: { template: `Hello World`, active: true }';
      const result = extractJsonObject(code, /settings:\s*/);

      expect(result).toBe('{ template: `Hello World`, active: true }');
      // Note: This is JavaScript object syntax, not valid JSON
    });
  });

  describe('Nested Objects', () => {
    it('should extract object with nested objects', () => {
      const code =
        'metadata: { "name": "Test", "config": { "nested": true, "deep": { "level": 2 } } }';
      const result = extractJsonObject(code, /metadata:\s*/);

      expect(result).toBe(
        '{ "name": "Test", "config": { "nested": true, "deep": { "level": 2 } } }'
      );
      expect(JSON.parse(result!)).toEqual({
        name: 'Test',
        config: { nested: true, deep: { level: 2 } },
      });
    });

    it('should extract object with arrays containing objects', () => {
      const code = 'data: { "items": [{ "id": 1 }, { "id": 2 }], "count": 2 }';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe('{ "items": [{ "id": 1 }, { "id": 2 }], "count": 2 }');
      expect(JSON.parse(result!)).toEqual({
        items: [{ id: 1 }, { id: 2 }],
        count: 2,
      });
    });

    it('should handle deeply nested structures', () => {
      const code = 'root: { "a": { "b": { "c": { "d": { "e": "deep" } } } } }';
      const result = extractJsonObject(code, /root:\s*/);

      expect(result).toBe('{ "a": { "b": { "c": { "d": { "e": "deep" } } } } }');
      expect(JSON.parse(result!)).toEqual({
        a: { b: { c: { d: { e: 'deep' } } } },
      });
    });
  });

  describe('Strings with Special Characters', () => {
    it('should ignore braces inside double-quoted strings', () => {
      const code = 'data: { "message": "Hello { world }", "count": 1 }';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe('{ "message": "Hello { world }", "count": 1 }');
      expect(JSON.parse(result!)).toEqual({ message: 'Hello { world }', count: 1 });
    });

    it('should ignore braces inside single-quoted strings', () => {
      const code = "data: { message: 'Object { key }', count: 1 }";
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe("{ message: 'Object { key }', count: 1 }");
    });

    it('should ignore braces inside backtick strings', () => {
      const code = 'data: { template: `Function { return {} }`, count: 1 }';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe('{ template: `Function { return {} }`, count: 1 }');
    });

    it('should handle escaped quotes in strings', () => {
      const code = 'data: { quote: "She said \\"Hello { world }\\"", count: 1 }';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe('{ quote: "She said \\"Hello { world }\\"", count: 1 }');
    });

    it('should handle escaped backslashes', () => {
      const code = 'data: { path: "C:\\\\Users\\\\{name}", count: 1 }';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe('{ path: "C:\\\\Users\\\\{name}", count: 1 }');
    });

    it('should handle mixed quote types with braces', () => {
      const code = `config: { msg1: "{ test }", msg2: '{ test }', msg3: \`{ test }\` }`;
      const result = extractJsonObject(code, /config:\s*/);

      expect(result).toBe(`{ msg1: "{ test }", msg2: '{ test }', msg3: \`{ test }\` }`);
    });

    it('should handle double quotes containing single quotes', () => {
      const code = `data: { a: "test's value", b: "another" }`;
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe(`{ a: "test's value", b: "another" }`);
      // Verify it's valid (albeit non-standard) JavaScript
      expect(result).toContain("test's value");
    });

    it('should handle single quotes containing double quotes', () => {
      const code = `data: { a: 'say "hello"', b: 'world' }`;
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe(`{ a: 'say "hello"', b: 'world' }`);
      expect(result).toContain('say "hello"');
    });

    it('should handle template literals with mixed quotes', () => {
      const code = `data: { a: \`He said "it's working"\`, b: true }`;
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe(`{ a: \`He said "it's working"\`, b: true }`);
      expect(result).toContain(`He said "it's working"`);
    });

    it('should handle multiple different quote types in same object', () => {
      const code = `config: { 
        msg1: "contains 'single' quotes", 
        msg2: 'contains "double" quotes',
        msg3: \`contains "both" and 'types'\`,
        nested: { a: "test's", b: 'say "hi"' }
      }`;
      const result = extractJsonObject(code, /config:\s*/);

      expect(result).toContain(`"contains 'single' quotes"`);
      expect(result).toContain(`'contains "double" quotes'`);
      expect(result).toContain(`\`contains "both" and 'types'\``);
      expect(result).toContain(`"test's"`);
      expect(result).toContain(`'say "hi"'`);
    });

    it('should handle alternating quote types with braces', () => {
      // This is the critical test case for the bug fix
      const code = `obj: { a: "test { }", b: 'more { }', c: "final { }" }`;
      const result = extractJsonObject(code, /obj:\s*/);

      expect(result).toBe(`{ a: "test { }", b: 'more { }', c: "final { }" }`);
      // Ensure all values are preserved correctly
      expect(result).toContain(`"test { }"`);
      expect(result).toContain(`'more { }'`);
      expect(result).toContain(`"final { }"`);
    });
  });

  describe('Complex Real-World Cases', () => {
    it('should extract metadata from plugin code', () => {
      const code = `module.exports = {
  metadata: {
    "name": "Jira Plugin",
    "platform": "jira",
    "version": "1.0.0",
    "config": { "nested": true }
  },
  factory: (context) => ({})
};`;
      const result = extractJsonObject(code, /metadata:\s*/);

      expect(result).toContain('"Jira Plugin"');
      expect(result).toContain('"jira"');
      expect(result).toContain('{ "nested": true }');

      const parsed = JSON.parse(result!);
      expect(parsed.name).toBe('Jira Plugin');
      expect(parsed.platform).toBe('jira');
      expect(parsed.config.nested).toBe(true);
    });

    it('should handle JSON with comments (non-standard but common)', () => {
      const code = 'data: { key: "value" /* comment with { brace } */ }';
      const result = extractJsonObject(code, /data:\s*/);

      // Should extract the whole object including the comment
      expect(result).toBe('{ key: "value" /* comment with { brace } */ }');
    });

    it('should extract object followed by more code', () => {
      const code = 'const x = { a: 1, b: { c: 2 } }; const y = 3;';
      const result = extractJsonObject(code, /const x = /);

      expect(result).toBe('{ a: 1, b: { c: 2 } }');
    });
  });

  describe('Edge Cases', () => {
    it('should return null when pattern not found', () => {
      const code = 'const x = { a: 1 }';
      const result = extractJsonObject(code, /metadata:\s*/);

      expect(result).toBeNull();
    });

    it('should return null when no opening brace found', () => {
      const code = 'metadata: "not an object"';
      const result = extractJsonObject(code, /metadata:\s*/);

      expect(result).toBeNull();
    });

    it('should return null when braces are unmatched', () => {
      const code = 'data: { unclosed: true';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBeNull();
    });

    it('should handle empty object', () => {
      const code = 'data: {}';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe('{}');
      expect(JSON.parse(result!)).toEqual({});
    });

    it('should extract first complete object when multiple present', () => {
      const code = 'first: { "a": 1 }, second: { "b": 2 }';
      const result = extractJsonObject(code, /first:\s*/);

      expect(result).toBe('{ "a": 1 }');
      expect(JSON.parse(result!)).toEqual({ a: 1 });
    });

    it('should handle whitespace and newlines', () => {
      const code = `metadata:    {
        "name": "Test",
        "version": "1.0.0"
      }`;
      const result = extractJsonObject(code, /metadata:\s*/);

      expect(result).toContain('"Test"');
      expect(result).toContain('"1.0.0"');

      const parsed = JSON.parse(result!);
      expect(parsed.name).toBe('Test');
      expect(parsed.version).toBe('1.0.0');
    });
  });

  describe('Different Start Patterns', () => {
    it('should work with different regex patterns', () => {
      const code = 'const config = { key: "value" };';
      const result = extractJsonObject(code, /const config = /);

      expect(result).toBe('{ key: "value" }');
    });

    it('should work with pattern including optional whitespace', () => {
      const code = 'export const data={key:"value"}';
      const result = extractJsonObject(code, /export const data\s*=\s*/);

      expect(result).toBe('{key:"value"}');
    });

    it('should work with pattern at start of string', () => {
      const code = '{ key: "value" }';
      const result = extractJsonObject(code, /^/);

      expect(result).toBe('{ key: "value" }');
    });
  });

  describe('String Quote Handling', () => {
    it('should handle alternating quote types', () => {
      const code = `data: { a: "val1", b: 'val2', c: \`val3\`, d: "val4" }`;
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe(`{ a: "val1", b: 'val2', c: \`val3\`, d: "val4" }`);
    });

    it('should handle multiple escape sequences', () => {
      const code = 'data: { "path": "C:\\\\{name}\\\\file\\\\.txt" }';
      const result = extractJsonObject(code, /data:\s*/);

      expect(result).toBe('{ "path": "C:\\\\{name}\\\\file\\\\.txt" }');
    });
  });
});

describe('extractFunctionBody', () => {
  describe('Basic Extraction', () => {
    it('should extract simple function body', () => {
      const code = 'createTicket: async (params) => { return true; }';
      const result = extractFunctionBody(code, /createTicket:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toBe(' return true; ');
    });

    it('should extract multi-line function body', () => {
      const code = `createTicket: async (params) => {
  const result = await api.post('/tickets', params);
  return result.data;
}`;
      const result = extractFunctionBody(code, /createTicket:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('const result');
      expect(result).toContain('return result.data');
    });

    it('should handle empty function body', () => {
      const code = 'test: () => {}';
      const result = extractFunctionBody(code, /test:\s*\(\)\s*=>\s*{/);

      expect(result).toBe('');
    });
  });

  describe('Nested Structures', () => {
    it('should handle nested objects in function body', () => {
      const code = `createTicket: async (params) => {
  const config = { auth: { token: 'secret' }, nested: { deep: true } };
  return config;
}`;
      const result = extractFunctionBody(code, /createTicket:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('{ auth: { token:');
      expect(result).toContain('nested: { deep: true }');
    });

    it('should handle nested functions', () => {
      const code = `process: async (data) => {
  const helper = (x) => { return x * 2; };
  return helper(data);
}`;
      const result = extractFunctionBody(code, /process:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('const helper = (x) => { return x * 2; }');
      expect(result).toContain('return helper(data)');
    });

    it('should handle if/else blocks', () => {
      const code = `validate: (value) => {
  if (value > 10) {
    return { valid: true };
  } else {
    return { valid: false };
  }
}`;
      const result = extractFunctionBody(code, /validate:\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('if (value > 10) {');
      expect(result).toContain('} else {');
    });

    it('should handle try/catch blocks', () => {
      const code = `execute: async () => {
  try {
    const result = await api.call();
    return result;
  } catch (error) {
    throw new Error('Failed');
  }
}`;
      const result = extractFunctionBody(code, /execute:\s*async\s*\(\)\s*=>\s*{/);

      expect(result).toContain('try {');
      expect(result).toContain('} catch (error) {');
    });
  });

  describe('Strings with Special Characters', () => {
    it('should ignore braces in string literals', () => {
      const code = `format: (msg) => {
  const text = "Object { key: value }";
  return text;
}`;
      const result = extractFunctionBody(code, /format:\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('const text = "Object { key: value }"');
    });

    it('should handle template literals with braces', () => {
      const code = `build: (name) => {
  const template = \`User { name: \${name} }\`;
  return template;
}`;
      const result = extractFunctionBody(code, /build:\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('const template = `User { name: ${name} }`');
    });

    it('should handle escaped quotes in function body', () => {
      const code = `quote: () => {
  return "She said \\"Hello { world }\\"";
}`;
      const result = extractFunctionBody(code, /quote:\s*\(\)\s*=>\s*{/);

      expect(result).toContain('return "She said \\"Hello { world }\\""');
    });

    it('should handle comments with braces', () => {
      const code = `process: () => {
  // TODO: Add support for { nested } objects
  /* Block comment with { braces } */
  return true;
}`;
      const result = extractFunctionBody(code, /process:\s*\(\)\s*=>\s*{/);

      expect(result).toContain('// TODO: Add support for { nested } objects');
      expect(result).toContain('/* Block comment with { braces } */');
    });
  });

  describe('Plugin Code Patterns', () => {
    it('should extract createTicket from real plugin code', () => {
      const code = `module.exports = {
  metadata: { name: "Test", platform: "jira", version: "1.0.0" },
  factory: (context) => ({
    createTicket: async (bugReport, projectId, integrationId, metadata) => {
      const auth = Buffer.from(context.config.email + ':' + context.config.apiToken).toString('base64');
      
      const response = await fetch(\`\${context.config.host}/rest/api/3/issue\`, {
        method: 'POST',
        headers: { 'Authorization': \`Basic \${auth}\` },
        body: JSON.stringify({ fields: { summary: bugReport.title } })
      });
      
      return { ticketId: response.data.id };
    }
  })
};`;
      const result = extractFunctionBody(code, /createTicket:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('const auth = Buffer.from');
      expect(result).toContain('const response = await fetch');
      expect(result).toContain('return { ticketId: response.data.id }');
    });

    it('should extract testConnection with keyword in string', () => {
      const code = `factory: (context) => ({
  testConnection: async (projectId) => {
    const message = "Testing testConnection functionality";
    const result = await api.test();
    return result;
  }
})`;
      const result = extractFunctionBody(code, /testConnection:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('const message = "Testing testConnection functionality"');
      expect(result).toContain('const result = await api.test()');
      expect(result).toContain('return result');
    });

    it('should extract validateConfig from plugin', () => {
      const code = `factory: (context) => ({
  validateConfig: async (config) => {
    if (!config.host || !config.apiToken) {
      return { valid: false, error: 'Missing required fields' };
    }
    return { valid: true };
  }
})`;
      const result = extractFunctionBody(code, /validateConfig:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toContain('if (!config.host || !config.apiToken)');
      expect(result).toContain("return { valid: false, error: 'Missing required fields' }");
    });
  });

  describe('Edge Cases', () => {
    it('should return null when function not found', () => {
      const code = 'const x = { a: 1 }';
      const result = extractFunctionBody(code, /createTicket:\s*async\s*\([^)]*\)\s*=>\s*{/);

      expect(result).toBeNull();
    });

    it('should return null when braces are unmatched', () => {
      const code = 'test: () => { return true;';
      const result = extractFunctionBody(code, /test:\s*\(\)\s*=>\s*{/);

      expect(result).toBeNull();
    });

    it('should handle function followed by another function', () => {
      const code = `obj = {
  first: () => { return 1; },
  second: () => { return 2; }
}`;
      const result = extractFunctionBody(code, /first:\s*\(\)\s*=>\s*{/);

      expect(result).toBe(' return 1; ');
    });

    it('should handle different quote types in same function', () => {
      const code = `mix: () => {
  const a = "double { quotes }";
  const b = 'single { quotes }';
  const c = \`template { quotes }\`;
  return { a, b, c };
}`;
      const result = extractFunctionBody(code, /mix:\s*\(\)\s*=>\s*{/);

      expect(result).toContain('const a = "double { quotes }"');
      expect(result).toContain("const b = 'single { quotes }'");
      expect(result).toContain('const c = `template { quotes }`');
    });
  });
});
