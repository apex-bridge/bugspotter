/**
 * Transaction types and utilities
 */

import type { RepositoryRegistry } from './repositories/factory.js';

export type { RepositoryRegistry };

export type TransactionContext = RepositoryRegistry;

export type TransactionCallback<T> = (tx: TransactionContext) => Promise<T>;
