/**
 * Code Security Analyzer
 * Static analysis for custom integration code to detect security violations
 */

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import crypto from 'crypto';
import { getLogger } from '../../logger.js';

const traverse = (_traverse as any).default || _traverse;
const logger = getLogger();

export interface SecurityAnalysisResult {
  safe: boolean;
  violations: string[];
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  warnings: string[];
}

/**
 * Allowed npm modules that can be required in custom plugins
 */
const ALLOWED_MODULES = [
  'axios',
  'lodash',
  'date-fns',
  'crypto', // Node.js built-in (safe subset)
];

/**
 * Code Security Analyzer
 * Performs static analysis on plugin code to detect security violations
 */
export class CodeSecurityAnalyzer {
  private readonly FORBIDDEN_PATTERNS = [
    // File system access
    { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, message: 'File system access not allowed' },
    {
      pattern: /require\s*\(\s*['"]fs\/promises['"]\s*\)/,
      message: 'File system access not allowed',
    },
    {
      pattern: /require\s*\(\s*['"]child_process['"]\s*\)/,
      message: 'Child process execution not allowed',
    },
    { pattern: /import.*from\s+['"]fs['"]/, message: 'File system access not allowed' },

    // Network access (direct)
    { pattern: /require\s*\(\s*['"]net['"]\s*\)/, message: 'Direct network access not allowed' },
    { pattern: /require\s*\(\s*['"]dgram['"]\s*\)/, message: 'UDP sockets not allowed' },

    // Process manipulation
    { pattern: /process\.exit/, message: 'Process termination not allowed' },
    { pattern: /process\.kill/, message: 'Process signals not allowed' },
    { pattern: /process\.env\s*=/, message: 'Environment modification not allowed' },

    // Dangerous eval
    { pattern: /\beval\s*\(/, message: 'eval() not allowed' },
    { pattern: /new\s+Function\s*\(/, message: 'Function constructor not allowed' },
    { pattern: /setTimeout.*eval/, message: 'Deferred eval not allowed' },
    { pattern: /setInterval.*eval/, message: 'Deferred eval not allowed' },

    // Prototype pollution
    {
      pattern: /__proto__/,
      message: '__proto__ manipulation not allowed (prototype pollution risk)',
    },
    { pattern: /constructor\s*\[\s*['"]prototype['"]/, message: 'Prototype access not allowed' },
  ];

  private readonly DANGEROUS_GLOBALS = [
    'global',
    'process.binding',
    '__dirname',
    '__filename',
    'module.constructor',
    'require.cache',
    'require.main',
  ];

  /**
   * Analyze code for security violations
   * @param code - JavaScript/TypeScript code to analyze
   * @returns Analysis result with safety status and violations
   */
  async analyze(code: string): Promise<SecurityAnalysisResult> {
    const violations: string[] = [];
    const warnings: string[] = [];
    let risk_level: 'low' | 'medium' | 'high' | 'critical' = 'low';

    // 1. Pattern-based detection (regex)
    for (const { pattern, message } of this.FORBIDDEN_PATTERNS) {
      if (pattern.test(code)) {
        violations.push(message);
        risk_level = 'critical';
      }
    }

    // 2. AST-based analysis
    try {
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript'],
      });

      traverse(ast, {
        // Detect require() calls and setTimeout/setInterval abuse
        CallExpression: (path: any) => {
          if (path.node.callee.type === 'Identifier') {
            const name = path.node.callee.name;

            // Check for require()
            if (name === 'require') {
              const arg = path.node.arguments[0];
              if (arg && arg.type === 'StringLiteral') {
                const module = arg.value;

                // Check if module is allowed
                if (!ALLOWED_MODULES.includes(module)) {
                  violations.push(`Unauthorized require: '${module}'`);
                  risk_level = risk_level === 'critical' ? 'critical' : 'high';
                }
              } else {
                // Dynamic require (e.g., require(variable))
                violations.push('Dynamic require() not allowed');
                risk_level = 'critical';
              }
            }

            // Check for setTimeout/setInterval with string arguments
            if (
              (name === 'setTimeout' || name === 'setInterval') &&
              path.node.arguments.length > 0
            ) {
              const firstArg = path.node.arguments[0];
              if (firstArg.type === 'StringLiteral') {
                violations.push(`${name} with string argument not allowed (eval risk)`);
                risk_level = 'critical';
              }
            }
          }
        },

        // Detect dangerous identifiers
        Identifier: (path: any) => {
          const name = path.node.name;

          if (this.DANGEROUS_GLOBALS.includes(name)) {
            violations.push(`Dangerous global access: ${name}`);
            risk_level = risk_level === 'critical' ? 'critical' : 'high';
          }
        },

        // Detect dynamic imports
        Import: () => {
          violations.push('Dynamic imports (import()) not allowed');
          risk_level = 'high';
        },
      });

      // Check for missing exports
      let hasExport = false;
      traverse(ast, {
        ExportDefaultDeclaration: () => {
          hasExport = true;
        },
        ExportNamedDeclaration: () => {
          hasExport = true;
        },
      });

      if (!hasExport) {
        warnings.push('Plugin should export a factory function or plugin object');
      }
    } catch (error) {
      violations.push(
        `Code parsing failed: ${error instanceof Error ? error.message : String(error)}`
      );
      risk_level = 'critical';
      logger.error('Code analysis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const safe = violations.length === 0;

    logger.info('Code security analysis completed', {
      safe,
      violations_count: violations.length,
      warnings_count: warnings.length,
      risk_level,
    });

    return {
      safe,
      violations,
      risk_level,
      warnings,
    };
  }

  /**
   * Compute SHA-256 hash of code for integrity verification
   * @param code - Code to hash
   * @returns Hex-encoded SHA-256 hash
   */
  computeHash(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }
}
