/**
 * Intelligence Service HTTP Client
 * Wraps outbound calls to bugspotter-intelligence.
 */

import { getLogger } from '../../logger.js';
import { AppError } from '../../api/middleware/error.js';

const logger = getLogger();

export interface SimilarBug {
  id: string;
  score: number;
  title: string;
}

export interface GetSimilarBugsOptions {
  similarityThreshold?: number;
}

export interface GetMitigationsOptions {
  similarityThreshold?: number;
}

export class IntelligenceClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getSimilarBugs(bugId: string, options: GetSimilarBugsOptions = {}): Promise<SimilarBug[]> {
    const url = new URL(`${this.baseUrl}/api/v1/bugs/${encodeURIComponent(bugId)}/similar`);

    if (options.similarityThreshold !== undefined) {
      url.searchParams.set('threshold', String(options.similarityThreshold));
    }

    logger.debug({ url: url.toString() }, 'intelligence: getSimilarBugs request');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new AppError(
        `Intelligence service error: ${response.status}`,
        response.status >= 500 ? 502 : response.status
      );
    }

    return response.json() as Promise<SimilarBug[]>;
  }

  async getMitigations(bugId: string, options: GetMitigationsOptions = {}): Promise<unknown> {
    const url = new URL(`${this.baseUrl}/api/v1/bugs/${encodeURIComponent(bugId)}/mitigations`);

    if (options.similarityThreshold !== undefined) {
      url.searchParams.set('threshold', String(options.similarityThreshold));
    }

    logger.debug({ url: url.toString() }, 'intelligence: getMitigations request');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new AppError(
        `Intelligence service error: ${response.status}`,
        response.status >= 500 ? 502 : response.status
      );
    }

    return response.json();
  }
}
