/**
 * Code Parsing Utilities
 * Helper functions for parsing and extracting structured data from code strings
 */

/**
 * Extract a complete JSON object from code by counting braces
 * Handles nested objects and arrays correctly
 *
 * @param code - The source code string to parse
 * @param startPattern - Regex pattern to match the start of the JSON object
 * @returns The extracted JSON string, or null if not found
 *
 * @example
 * const json = extractJsonObject(code, /metadata:\s*\/);
 * const metadata = JSON.parse(json);
 */
export function extractJsonObject(code: string, startPattern: RegExp): string | null {
  const match = code.match(startPattern);
  if (!match) {
    return null;
  }

  const startIndex = match.index! + match[0].length;
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let stringChar: string | null = null;
  let objectStart = -1;

  for (let i = startIndex; i < code.length; i++) {
    const char = code[i];

    // Handle escape sequences in strings
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    // Track string boundaries to ignore braces inside strings
    if ((char === '"' || char === "'" || char === '`') && !inString) {
      inString = true;
      stringChar = char;
      continue;
    }

    if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
      continue;
    }

    if (inString) {
      continue;
    }

    // Count braces
    if (char === '{') {
      if (braceCount === 0) {
        objectStart = i;
      }
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0 && objectStart !== -1) {
        // Found matching closing brace
        return code.substring(objectStart, i + 1);
      }
    }
  }

  return null;
}

/**
 * Extract a function body by counting braces
 * Starts extraction after the opening brace of the function body
 * and returns content up to (but not including) the matching closing brace
 *
 * @param code - The source code string to parse
 * @param functionPattern - Regex pattern to match the function signature up to the opening brace
 * @returns The extracted function body (without surrounding braces), or null if not found
 *
 * @example
 * // Extract body of: createTicket: async (params) => { /* body *\/ }
 * const body = extractFunctionBody(code, /createTicket:\s*async\s*\([^)]*\)\s*=>\s*{/);
 */
export function extractFunctionBody(code: string, functionPattern: RegExp): string | null {
  const match = code.match(functionPattern);
  if (!match) {
    return null;
  }

  // Start after the opening brace (which is included in the pattern)
  const startIndex = match.index! + match[0].length;
  let braceCount = 1; // We're already inside the function body
  let inString = false;
  let escapeNext = false;
  let stringChar: string | null = null;

  for (let i = startIndex; i < code.length; i++) {
    const char = code[i];

    // Handle escape sequences in strings
    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    // Track string boundaries to ignore braces inside strings
    if ((char === '"' || char === "'" || char === '`') && !inString) {
      inString = true;
      stringChar = char;
      continue;
    }

    if (inString && char === stringChar) {
      inString = false;
      stringChar = null;
      continue;
    }

    if (inString) {
      continue;
    }

    // Count braces
    if (char === '{') {
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0) {
        // Found matching closing brace for the function
        return code.substring(startIndex, i);
      }
    }
  }

  return null;
}
