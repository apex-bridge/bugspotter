/**
 * Secure Plugin Executor
 * Executes custom integration code in isolated-vm sandbox with security constraints
 */

import type { PluginContext } from '../plugin.types.js';
import type { TicketCreationMetadata, IntegrationResult } from '../base-integration.service.js';
import type { BugReport } from '../../db/types.js';
import { getLogger } from '../../logger.js';
import { CodeSecurityAnalyzer } from './code-analyzer.js';
import { RpcBridge } from './rpc-bridge.js';
import { ERROR_CODES } from '../plugin-utils/errors.js';

const logger = getLogger();

/**
 * Script to disable unsafe global APIs in isolated-vm context
 * Prevents plugins from bypassing RPC bridge security controls
 */
const DISABLE_UNSAFE_APIS_SCRIPT = `
  // Disable global fetch to prevent SSRF bypass
  globalThis.fetch = undefined;
  globalThis.XMLHttpRequest = undefined;
  
  // Disable other network APIs
  globalThis.WebSocket = undefined;
  globalThis.EventSource = undefined;
  
  // Disable dangerous Node.js globals (if somehow accessible)
  globalThis.require = undefined;
  globalThis.process = undefined;
  globalThis.Buffer = undefined;
`;

// Lazy load isolated-vm to allow graceful fallback if not available
let ivm: typeof import('isolated-vm') | null = null;
let ivmLoadError: Error | null = null;

async function loadIsolatedVM() {
  if (ivm) {
    return ivm;
  }
  if (ivmLoadError) {
    throw ivmLoadError;
  }

  try {
    // isolated-vm is a CommonJS module, need to access .default when using dynamic import
    const ivmImport = await import('isolated-vm');
    ivm = ivmImport.default || ivmImport;
    return ivm;
  } catch (error) {
    ivmLoadError = error as Error;
    logger.warn('isolated-vm not available, falling back to basic execution', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export interface ExecutionOptions {
  timeout?: number; // Execution timeout in milliseconds
  memoryLimit?: number; // Memory limit in MB
}

/**
 * Secure Plugin Executor
 * Uses isolated-vm to execute untrusted code with strong isolation
 */
export class SecurePluginExecutor {
  private analyzer: CodeSecurityAnalyzer;
  private defaultTimeout: number;
  private defaultMemoryLimit: number;

  constructor(options?: ExecutionOptions) {
    this.analyzer = new CodeSecurityAnalyzer();
    const envTimeout = process.env.PLUGIN_EXECUTION_TIMEOUT_MS
      ? parseInt(process.env.PLUGIN_EXECUTION_TIMEOUT_MS, 10)
      : 15000; // Default 15 seconds (allows 10s HTTP timeout + overhead)
    this.defaultTimeout = options?.timeout ?? envTimeout;
    this.defaultMemoryLimit = options?.memoryLimit ?? 128; // 128 MB
  }

  /**
   * Execute plugin code in isolated sandbox
   * @param code - Plugin code to execute
   * @param context - Plugin context (db, storage, projectId)
   * @param codeHash - Expected SHA-256 hash for verification
   * @returns Plugin metadata and code hash
   */
  async execute(
    code: string,
    context: PluginContext,
    codeHash?: string
  ): Promise<{
    metadata: {
      name: string;
      platform: string;
      version: string;
      description: string | null;
      author: string | null;
    };
    code: string;
    codeHash: string;
  }> {
    // 1. Verify code hash if provided
    if (codeHash) {
      const actualHash = this.analyzer.computeHash(code);
      if (actualHash !== codeHash) {
        throw new Error('Code integrity check failed: hash mismatch');
      }
    }

    // 2. Analyze code for security violations
    const analysis = await this.analyzer.analyze(code);
    if (!analysis.safe) {
      logger.error('Code security analysis failed', {
        violations: analysis.violations,
        risk_level: analysis.risk_level,
      });
      throw new Error(`Security violation: ${analysis.violations.join(', ')}`);
    }

    if (analysis.warnings.length > 0) {
      logger.warn('Code analysis warnings', { warnings: analysis.warnings });
    }

    // 3. Try to load isolated-vm
    let ivmModule: typeof import('isolated-vm');
    try {
      ivmModule = await loadIsolatedVM();
    } catch (error) {
      logger.error('isolated-vm not available, cannot execute plugin code safely', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        'isolated-vm module not available. Plugin code execution requires isolated-vm to be installed and built.'
      );
    }

    // 4. Create isolated VM
    const isolate = new ivmModule.Isolate({ memoryLimit: this.defaultMemoryLimit });

    try {
      // 5. Create execution context
      const context_ivm = await isolate.createContext();

      // 6. Set up safe global environment
      const jail = context_ivm.global;

      // Inject safe console methods
      await jail.set(
        'log',
        new ivmModule.Reference((msg: string) => {
          logger.info('[Plugin] ' + msg);
        })
      );

      await jail.set(
        'logError',
        new ivmModule.Reference((msg: string) => {
          logger.error('[Plugin] ' + msg);
        })
      );

      // Inject safe context data (read-only)
      await jail.set(
        'contextData',
        new ivmModule.ExternalCopy({
          platform: context.db ? 'available' : 'unavailable',
          storage: context.storage ? 'available' : 'unavailable',
        }).copyInto()
      );

      // 7. Disable unsafe global APIs (force use of secure RPC methods)
      const disableUnsafeApis = await isolate.compileScript(DISABLE_UNSAFE_APIS_SCRIPT);
      await disableUnsafeApis.run(context_ivm);

      // 8. Create module.exports support
      const createModuleSystem = await isolate.compileScript(`
        const module = { exports: {} };
        const exports = module.exports;
      `);
      await createModuleSystem.run(context_ivm);

      // 8a. Inject plugin utils constants (ERROR_CODES, validators)
      const utilsConstants = new ivmModule.ExternalCopy({
        ERROR_CODES: ERROR_CODES,
        validators: {
          // Export validator names (plugins will call via RPC)
          required: 'required',
          url: 'url',
          email: 'email',
          pattern: 'pattern',
          oneOf: 'oneOf',
          length: 'length',
          range: 'range',
        },
      }).copyInto();
      await jail.set('utilsConstants', utilsConstants);

      // 8b. Make utils constants globally available
      const exposeUtilsConstants = await isolate.compileScript(`
        globalThis.ERROR_CODES = utilsConstants.ERROR_CODES;
        globalThis.validators = utilsConstants.validators;
      `);
      await exposeUtilsConstants.run(context_ivm);

      // 9. Create secure RPC bridge for safe method calls
      // Instantiate RpcBridge with full security controls
      // Provides project-scoped access to db.bugReports, db.projectIntegrations, storage
      const rpcBridge = new RpcBridge(
        context.db,
        context.storage,
        context.projectId,
        context.platform
      );
      await this.setupRpcBridge(ivmModule, isolate, context_ivm, jail, rpcBridge, 'exec');

      // 10. Wrap code in safe execution wrapper that extracts metadata and factory
      // Reset module.exports and wrap plugin code in IIFE for fresh scope
      const wrappedCode = `
        'use strict';
        
        // Reset module.exports for fresh execution
        module.exports = {};
        
        // Wrap plugin code in IIFE to create fresh scope for const/let declarations
        (function() {
          // Safe console using RPC
          const console = {
            log: (...args) => rpcBridge.callMethod('log', args),
            error: (...args) => rpcBridge.callMethod('logError', args),
            warn: (...args) => rpcBridge.callMethod('logWarn', args),
          };
          
          // Plugin code (runs in function scope, allows const/let redeclaration)
          ${code}
        })();
        
        // Extract and serialize plugin metadata and factory signature (OUTSIDE IIFE)
        let pluginMetadata = null;
        let hasFactory = false;
        
        if (typeof module !== 'undefined' && module.exports) {
          const exported = module.exports;
          
          // Check for metadata
          if (exported.metadata) {
            pluginMetadata = {
              name: exported.metadata.name,
              platform: exported.metadata.platform,
              version: exported.metadata.version,
              description: exported.metadata.description || null,
              author: exported.metadata.author || null,
            };
          }
          
          // Check for factory (don't execute, just verify existence)
          if (typeof exported.factory === 'function') {
            hasFactory = true;
          }
        }
        
        // Return result as the script's return value
        JSON.stringify({
          metadata: pluginMetadata,
          hasFactory: hasFactory,
          success: pluginMetadata !== null && hasFactory
        });
      `;

      // 12. Execute code with timeout
      const script = await isolate.compileScript(wrappedCode);

      const resultString = await script.run(context_ivm, {
        timeout: this.defaultTimeout,
        release: true, // Auto-release ExternalCopy to prevent memory leak
      });

      if (!resultString) {
        throw new Error('Failed to extract plugin metadata');
      }

      // 13. Parse the serialized result
      const result = JSON.parse(String(resultString));

      if (!result.success) {
        throw new Error('Plugin code must export metadata and factory function');
      }

      logger.info('Plugin code validated successfully', {
        platform: result.metadata?.platform,
        version: result.metadata?.version,
      });

      // 14. Return metadata only (factory will be called in host context separately)
      return {
        metadata: result.metadata,
        code, // Return original code for later execution in host context
        codeHash: codeHash || this.computeHash(code),
      };
    } catch (error) {
      logger.error('Plugin execution failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(`Plugin execution timeout (${this.defaultTimeout}ms)`);
      }

      throw new Error(
        `Plugin execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      // 15. Cleanup isolate
      isolate.dispose();
    }
  }

  /**
   * Validate plugin code without executing
   * @param code - Plugin code to validate
   * @returns Analysis result
   */
  async validate(code: string) {
    return await this.analyzer.analyze(code);
  }

  /**
   * Execute factory function and return service instance
   * @param code - Plugin code containing factory
   * @param platform - Platform identifier for logging
   * @param context - Plugin context (db, storage, projectId)
   * @param config - Integration configuration
   * @returns Service instance that can call createFromBugReport, with dispose method for cleanup
   */
  async executeFactory(
    code: string,
    platform: string,
    context: PluginContext,
    config: Record<string, unknown>
  ): Promise<{
    createFromBugReport: (
      bugReport: BugReport,
      projectId: string,
      integrationId: string,
      metadata?: TicketCreationMetadata
    ) => Promise<IntegrationResult>;
    testConnection: (projectId: string) => Promise<boolean>;
    validateConfig: (
      config: Record<string, unknown>
    ) => Promise<{ valid: boolean; error?: string }>;
    dispose: () => void;
  }> {
    // Load isolated-vm
    const ivmModule = await loadIsolatedVM();

    // Create isolated VM (same memory limit as validation)
    const isolate = new ivmModule.Isolate({ memoryLimit: this.defaultMemoryLimit });

    try {
      // Create execution context
      const context_ivm = await isolate.createContext();
      const jail = context_ivm.global;

      // Disable unsafe global APIs in factory context
      const disableUnsafeApis = await isolate.compileScript(DISABLE_UNSAFE_APIS_SCRIPT);
      await disableUnsafeApis.run(context_ivm);

      // Set up RPC bridge
      const rpcBridge = new RpcBridge(
        context.db,
        context.storage,
        context.projectId,
        context.platform
      );
      await this.setupRpcBridge(ivmModule, isolate, context_ivm, jail, rpcBridge, 'factory');

      // Create module system and execute plugin code
      const createModuleSystem = await isolate.compileScript(`
        const module = { exports: {} };
        const exports = module.exports;
      `);
      await createModuleSystem.run(context_ivm);

      // Execute plugin code
      const wrappedCode = `
        'use strict';
        
        module.exports = {};
        
        (function() {
          const console = {
            log: (...args) => rpcBridge.callMethod('log', args),
            error: (...args) => rpcBridge.callMethod('logError', args),
            warn: (...args) => rpcBridge.callMethod('logWarn', args),
          };
          
          ${code}
        })();
        
        // Return factory reference
        module.exports.factory;
      `;

      const script = await isolate.compileScript(wrappedCode);
      const factoryRef = await script.run(context_ivm, {
        timeout: this.defaultTimeout,
        reference: true,
      });

      if (!factoryRef || typeof factoryRef !== 'object') {
        throw new Error('Plugin must export a factory function');
      }

      // Call factory with config to get service instance
      const configCopy = new ivmModule.ExternalCopy(config).copyInto();
      await jail.set('pluginConfig', configCopy);

      const createService = await isolate.compileScript(`
        const service = module.exports.factory({ rpcBridge, config: pluginConfig });
        service;
      `);

      await createService.run(context_ivm, {
        timeout: this.defaultTimeout,
        reference: true,
      });

      // Return host-side proxy that bridges to isolated service
      let isDisposed = false;

      return {
        createFromBugReport: async (
          bugReport: BugReport,
          projectId: string,
          integrationId: string,
          metadata?: TicketCreationMetadata
        ) => {
          if (isDisposed) {
            logger.error('Plugin createFromBugReport called after dispose', { platform });
            return {
              success: false,
              external_id: '',
              error: 'Service has been disposed',
            };
          }

          try {
            // Serialize bug report data
            // NOTE: Dates are converted to ISO strings for serialization across isolated-vm boundary
            // Plugins receive created_at as string (ISO 8601 format), not Date object
            const bugReportCopy = new ivmModule.ExternalCopy({
              id: bugReport.id,
              title: bugReport.title,
              description: bugReport.description,
              priority: bugReport.priority,
              status: bugReport.status,
              metadata: bugReport.metadata,
              created_at: bugReport.created_at?.toISOString(),
            }).copyInto();

            await jail.set('currentBugReport', bugReportCopy);
            await jail.set('currentProjectId', projectId);
            await jail.set('currentIntegrationId', integrationId);

            // Pass metadata to plugin (optional)
            if (metadata) {
              const metadataCopy = new ivmModule.ExternalCopy(metadata).copyInto();
              await jail.set('currentMetadata', metadataCopy);
            }

            // Call service.createFromBugReport in isolate
            const callService = await isolate.compileScript(`
              (async () => {
                const result = await service.createFromBugReport(currentBugReport, currentProjectId, currentIntegrationId, ${metadata ? 'currentMetadata' : 'undefined'});
                return JSON.stringify(result);
              })();
            `);

            const resultString = await callService.run(context_ivm, {
              timeout: this.defaultTimeout,
              promise: true,
              release: true, // Auto-release ExternalCopy to prevent memory leak
            });

            const result = JSON.parse(String(resultString));

            logger.info('Plugin createFromBugReport succeeded', {
              external_id: result.external_id,
              platform: platform,
              integrationId,
            });

            return result;
          } catch (error) {
            logger.error('Plugin createFromBugReport failed', {
              error: error instanceof Error ? error.message : String(error),
              integrationId,
            });

            return {
              success: false,
              external_id: '',
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        testConnection: async (projectId: string) => {
          if (isDisposed) {
            logger.error('Plugin testConnection called after dispose', { platform });
            return false;
          }

          try {
            await jail.set('currentProjectId', projectId);

            // Check if service has testConnection method
            const hasMethod = await isolate.compileScript(`
              typeof service.testConnection === 'function';
            `);
            const hasTestConnection = await hasMethod.run(context_ivm, {
              timeout: this.defaultTimeout,
              release: true,
            });

            if (!hasTestConnection) {
              logger.debug('Plugin does not implement testConnection', { platform });
              return false;
            }

            // Call service.testConnection in isolate
            const callService = await isolate.compileScript(`
              (async () => {
                const result = await service.testConnection(currentProjectId);
                return JSON.stringify({ success: result });
              })();
            `);

            const resultString = await callService.run(context_ivm, {
              timeout: this.defaultTimeout,
              promise: true,
              release: true,
            });

            const result = JSON.parse(String(resultString));

            logger.info('Plugin testConnection completed', {
              success: result.success,
              platform: platform,
            });

            return result.success;
          } catch (error) {
            logger.error('Plugin testConnection failed', {
              error: error instanceof Error ? error.message : String(error),
              platform: platform,
            });
            return false;
          }
        },
        validateConfig: async (config: Record<string, unknown>) => {
          if (isDisposed) {
            logger.error('Plugin validateConfig called after dispose', { platform });
            return { valid: false, error: 'Service has been disposed' };
          }

          try {
            // Serialize config
            const configCopy = new ivmModule.ExternalCopy(config).copyInto();
            await jail.set('configToValidate', configCopy);

            // Check if service has validateConfig method
            const hasMethod = await isolate.compileScript(`
              typeof service.validateConfig === 'function';
            `);
            const hasValidateConfig = await hasMethod.run(context_ivm, {
              timeout: this.defaultTimeout,
              release: true,
            });

            if (!hasValidateConfig) {
              logger.debug('Plugin does not implement validateConfig', { platform });
              return { valid: true }; // Default to valid if not implemented
            }

            // Call service.validateConfig in isolate
            const callService = await isolate.compileScript(`
              (async () => {
                const result = await service.validateConfig(configToValidate);
                return JSON.stringify(result);
              })();
            `);

            const resultString = await callService.run(context_ivm, {
              timeout: this.defaultTimeout,
              promise: true,
              release: true,
            });

            const result = JSON.parse(String(resultString));

            logger.info('Plugin validateConfig completed', {
              valid: result.valid,
              platform: platform,
            });

            return result;
          } catch (error) {
            logger.error('Plugin validateConfig failed', {
              error: error instanceof Error ? error.message : String(error),
              platform: platform,
            });
            return {
              valid: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        // Cleanup method to dispose isolate when service is no longer needed
        dispose: () => {
          if (isDisposed) {
            logger.warn('Plugin dispose called multiple times', { platform });
            return;
          }

          // Mark as disposed BEFORE attempting disposal to prevent retry loops
          isDisposed = true;

          try {
            isolate.dispose();
            logger.info('Plugin isolate disposed', { platform });
          } catch (error) {
            logger.error('Failed to dispose isolate', {
              platform,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      };
    } catch (error) {
      isolate.dispose();
      throw new Error(
        `Factory execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute validateConfig in a temporary isolate (resource-efficient)
   * Creates isolate, runs validation, disposes immediately
   * @param code - Plugin code containing factory
   * @param platform - Platform identifier for logging
   * @param config - Configuration to validate
   * @returns Validation result
   */
  async executeValidateConfig(
    code: string,
    platform: string,
    config: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> {
    const ivmModule = await loadIsolatedVM();
    const isolate = new ivmModule.Isolate({ memoryLimit: this.defaultMemoryLimit });

    try {
      const context_ivm = await isolate.createContext();
      const jail = context_ivm.global;

      // Disable unsafe global APIs
      const disableUnsafeApis = await isolate.compileScript(DISABLE_UNSAFE_APIS_SCRIPT);
      await disableUnsafeApis.run(context_ivm);

      // No RPC bridge needed - validation should be pure logic
      // Create minimal module system
      const createModuleSystem = await isolate.compileScript(`
        const module = { exports: {} };
        const exports = module.exports;
      `);
      await createModuleSystem.run(context_ivm);

      // Execute plugin code to get factory
      const wrappedCode = `
        'use strict';
        
        module.exports = {};
        
        (function() {
          ${code}
        })();
        
        module.exports.factory;
      `;

      const script = await isolate.compileScript(wrappedCode);
      await script.run(context_ivm, {
        timeout: this.defaultTimeout,
        reference: true,
      });

      // Create service instance with config
      const configCopy = new ivmModule.ExternalCopy(config).copyInto({ release: true });
      await jail.set('pluginConfig', configCopy);

      const createService = await isolate.compileScript(`
        const service = module.exports.factory({ config: pluginConfig });
        service;
      `);

      await createService.run(context_ivm, {
        timeout: this.defaultTimeout,
        reference: true,
      });

      // Check if validateConfig method exists
      const hasMethod = await isolate.compileScript(`
        typeof service.validateConfig === 'function';
      `);
      const hasValidateConfig = await hasMethod.run(context_ivm, {
        timeout: this.defaultTimeout,
        release: true,
      });

      if (!hasValidateConfig) {
        logger.debug('Plugin does not implement validateConfig', { platform });
        return { valid: true }; // Default to valid if not implemented
      }

      // Run validation
      const validateScript = await isolate.compileScript(`
        (async () => {
          const result = await service.validateConfig(pluginConfig);
          return JSON.stringify(result);
        })();
      `);

      const resultString = await validateScript.run(context_ivm, {
        timeout: this.defaultTimeout,
        promise: true,
        release: true,
      });

      const result = JSON.parse(String(resultString));

      logger.info('Plugin validateConfig completed (temporary isolate)', {
        valid: result.valid,
        platform,
      });

      return result;
    } catch (error) {
      logger.error('Plugin validateConfig failed', {
        error: error instanceof Error ? error.message : String(error),
        platform,
      });
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      isolate.dispose(); // Always cleanup immediately
    }
  }

  /**
   * Execute testConnection in a temporary isolate (resource-efficient)
   * Creates isolate, runs test, disposes immediately
   * @param code - Plugin code containing factory
   * @param platform - Platform identifier for logging
   * @param context - Plugin context (db, storage, projectId)
   * @param config - Integration configuration
   * @returns Connection test result
   */
  async executeTestConnection(
    code: string,
    platform: string,
    context: PluginContext,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const ivmModule = await loadIsolatedVM();
    const isolate = new ivmModule.Isolate({ memoryLimit: this.defaultMemoryLimit });

    try {
      const context_ivm = await isolate.createContext();
      const jail = context_ivm.global;

      // Disable unsafe global APIs
      const disableUnsafeApis = await isolate.compileScript(DISABLE_UNSAFE_APIS_SCRIPT);
      await disableUnsafeApis.run(context_ivm);

      // Set up RPC bridge for testConnection (may need to make API calls)
      const rpcBridge = new RpcBridge(context.db, context.storage, context.projectId, platform);
      await this.setupRpcBridge(ivmModule, isolate, context_ivm, jail, rpcBridge, 'test-conn');

      // Create module system
      const createModuleSystem = await isolate.compileScript(`
        const module = { exports: {} };
        const exports = module.exports;
      `);
      await createModuleSystem.run(context_ivm);

      // Execute plugin code
      const wrappedCode = `
        'use strict';
        
        module.exports = {};
        
        (function() {
          const console = {
            log: (...args) => rpcBridge.callMethod('log', args),
            error: (...args) => rpcBridge.callMethod('logError', args),
            warn: (...args) => rpcBridge.callMethod('logWarn', args),
          };
          
          ${code}
        })();
        
        module.exports.factory;
      `;

      const script = await isolate.compileScript(wrappedCode);
      await script.run(context_ivm, {
        timeout: this.defaultTimeout,
        reference: true,
      });

      // Create service instance with config and RPC bridge
      const configCopy = new ivmModule.ExternalCopy(config).copyInto({ release: true });
      await jail.set('pluginConfig', configCopy);
      await jail.set('testProjectId', context.projectId);

      const createService = await isolate.compileScript(`
        const service = module.exports.factory({ rpcBridge, config: pluginConfig });
        service;
      `);

      await createService.run(context_ivm, {
        timeout: this.defaultTimeout,
        reference: true,
      });

      // Check if testConnection method exists
      const hasMethod = await isolate.compileScript(`
        typeof service.testConnection === 'function';
      `);
      const hasTestConnection = await hasMethod.run(context_ivm, {
        timeout: this.defaultTimeout,
        release: true,
      });

      if (!hasTestConnection) {
        logger.debug('Plugin does not implement testConnection', { platform });
        return false;
      }

      // Run test
      const testScript = await isolate.compileScript(`
        (async () => {
          const result = await service.testConnection(testProjectId);
          return JSON.stringify({ success: result });
        })();
      `);

      const resultString = await testScript.run(context_ivm, {
        timeout: this.defaultTimeout,
        promise: true,
        release: true,
      });

      const result = JSON.parse(String(resultString));

      logger.info('Plugin testConnection completed (temporary isolate)', {
        success: result.success,
        platform,
      });

      return result.success;
    } catch (error) {
      logger.error('Plugin testConnection failed', {
        error: error instanceof Error ? error.message : String(error),
        platform,
      });
      return false;
    } finally {
      isolate.dispose(); // Always cleanup immediately
    }
  }

  /**
   * Compute code hash
   * @param code - Code to hash
   * @returns SHA-256 hash
   */
  computeHash(code: string): string {
    return this.analyzer.computeHash(code);
  }

  /**
   * Set up RPC bridge in isolated-vm context
   * Creates RPC bridge with security controls and injects hostCall reference
   * @private
   */
  private async setupRpcBridge(
    ivmModule: typeof import('isolated-vm'),
    isolate: import('isolated-vm').Isolate,
    context_ivm: import('isolated-vm').Context,
    jail: import('isolated-vm').Reference<Record<string, unknown>>,
    rpcBridge: RpcBridge,
    requestIdPrefix: string
  ): Promise<void> {
    // Inject RPC handler that delegates to RpcBridge
    await jail.set(
      'hostCall',
      new ivmModule.Reference(async (method: string, argsJson: string) => {
        // Parse arguments with error handling to prevent leaking implementation details
        let args: unknown[];
        try {
          args = JSON.parse(argsJson);
        } catch {
          throw new Error('Invalid RPC arguments: malformed JSON');
        }

        // Wrap handleCall to catch unexpected exceptions and prevent implementation detail leakage
        let result;
        try {
          result = await rpcBridge.handleCall({
            method,
            args,
            requestId: `${requestIdPrefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          });
        } catch (error) {
          // Log unexpected error for debugging (server-side only)
          logger.error('Unexpected RPC bridge error', {
            method,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });

          // Return generic error to plugin (no implementation details)
          throw new Error('Internal RPC error occurred');
        }

        if (result.success) {
          return new ivmModule.ExternalCopy(result.data).copyInto({ release: true });
        } else {
          throw new Error(result.error || 'RPC call failed');
        }
      })
    );

    // Create RPC bridge in isolate
    const createRpcBridge = await isolate.compileScript(`
      globalThis.rpcBridge = {
        callMethod: async function(method, args) {
          return await globalThis.hostCall(method, JSON.stringify(args));
        }
      };
      
      // Expose utils API through RPC bridge
      globalThis.utils = {
        // Authentication
        buildAuthHeader: async (authConfig) => {
          return await globalThis.rpcBridge.callMethod('utils.buildAuthHeader', [authConfig]);
        },
        // HTTP utilities
        buildUrl: async (baseUrl, endpoint, queryParams) => {
          return await globalThis.rpcBridge.callMethod('utils.buildUrl', [baseUrl, endpoint, queryParams]);
        },
        makeApiRequest: async (config) => {
          return await globalThis.rpcBridge.callMethod('utils.makeApiRequest', [config]);
        },
        // Storage
        getResourceUrls: async (bugReport) => {
          return await globalThis.rpcBridge.callMethod('utils.getResourceUrls', [bugReport]);
        },
        // Metadata extraction
        extractEnvironment: async (metadata) => {
          return await globalThis.rpcBridge.callMethod('utils.extractEnvironment', [metadata]);
        },
        extractConsoleLogs: async (metadata, limit) => {
          return await globalThis.rpcBridge.callMethod('utils.extractConsoleLogs', [metadata, limit]);
        },
        extractNetworkErrors: async (metadata) => {
          return await globalThis.rpcBridge.callMethod('utils.extractNetworkErrors', [metadata]);
        },
        // Validation
        validateFields: async (fields) => {
          return await globalThis.rpcBridge.callMethod('utils.validateFields', [fields]);
        },
        createValidationResult: async (isValid, errors) => {
          return await globalThis.rpcBridge.callMethod('utils.createValidationResult', [isValid, errors]);
        },
        // Error handling
        createPluginError: async (code, message, details) => {
          return await globalThis.rpcBridge.callMethod('utils.createPluginError', [code, message, details]);
        },
        // Constants (synchronous, no RPC needed)
        ERROR_CODES: globalThis.ERROR_CODES,
        validators: globalThis.validators,
      };
    `);
    await createRpcBridge.run(context_ivm);
  }
}
