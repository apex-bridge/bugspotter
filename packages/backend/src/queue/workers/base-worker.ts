/**
 * Base Worker Interface
 *
 * Re-exports IWorkerHost from @bugspotter/message-broker as BaseWorker
 * for backward compatibility with WorkerManager and worker factory functions.
 */

import type { IWorkerHost } from '@bugspotter/message-broker';

/**
 * Base interface that all worker wrappers must implement.
 * Alias for IWorkerHost from @bugspotter/message-broker.
 */
export type BaseWorker<
  DataType = unknown,
  ResultType = unknown,
  _NameType extends string = string,
> = IWorkerHost<DataType, ResultType>;
