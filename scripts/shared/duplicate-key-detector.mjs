/**
 * Duplicate Key Detection Utility
 * Detects duplicate keys in JSON content before parsing
 */

/**
 * Parse a JSON key string starting after the opening quote
 * Handles escaped characters properly
 * @param {string} line - The line containing the key
 * @param {number} startIndex - Index right after the opening quote
 * @returns {{key: string, endIndex: number} | null} Parsed key and position, or null if invalid
 */
function parseJsonKey(line, startIndex) {
  const keyChars = [];
  let currentIndex = startIndex;
  let isEscaped = false;
  
  while (currentIndex < line.length) {
    const char = line[currentIndex];
    
    if (isEscaped) {
      keyChars.push(char);
      isEscaped = false;
    } else if (char === '\\') {
      isEscaped = true;
    } else if (char === '"') {
      // Found closing quote - check if it's followed by a colon
      const colonIndex = skipWhitespace(line, currentIndex + 1);
      
      if (colonIndex < line.length && line[colonIndex] === ':') {
        return {
          key: keyChars.join(''),
          endIndex: colonIndex
        };
      }
      
      // Quote not followed by colon - this is a value, not a key
      return null;
    } else {
      keyChars.push(char);
    }
    
    currentIndex++;
  }
  
  // Reached end of line without finding closing quote
  return null;
}

/**
 * Skip whitespace characters and return the next non-whitespace index
 * @param {string} line - The line to scan
 * @param {number} startIndex - Starting position
 * @returns {number} Index of next non-whitespace character
 */
function skipWhitespace(line, startIndex) {
  let index = startIndex;
  while (index < line.length && /\s/.test(line[index])) {
    index++;
  }
  return index;
}

/**
 * Check for duplicate keys within each object scope
 * Uses character-by-character parsing to handle braces and keys in correct sequential order
 * @param {string} content - Raw JSON content  
 * @param {string} _locale - Locale name for error reporting (currently unused)
 * @returns {Array<{key: string, line: number}>} Array of duplicates with line numbers
 */
export function findDuplicateKeys(content, _locale) {
  const lines = content.split('\n');
  const duplicates = [];
  const scopeStack = []; // Stack of Sets, one per nested object level
  
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const lineNumber = lineIndex + 1;
    
    for (let charIndex = 0; charIndex < line.length; charIndex++) {
      const char = line[charIndex];
      
      if (char === '{') {
        // Enter new object scope
        scopeStack.push(new Set());
      } 
      else if (char === '}') {
        // Exit current object scope
        if (scopeStack.length > 0) {
          scopeStack.pop();
        }
      } 
      else if (char === '"' && scopeStack.length > 0) {
        // Potential key definition - parse it
        const parseResult = parseJsonKey(line, charIndex + 1);
        
        if (parseResult) {
          const { key, endIndex } = parseResult;
          const currentScope = scopeStack[scopeStack.length - 1];
          
          // Check for duplicate
          if (currentScope.has(key)) {
            duplicates.push({ key, line: lineNumber });
          }
          
          currentScope.add(key);
          charIndex = endIndex; // Skip past the parsed key
        }
      }
    }
  }
  
  return duplicates;
}
