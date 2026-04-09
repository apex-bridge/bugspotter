/**
 * Validates that all monitoring config files referenced by
 * docker-compose.monitoring.yml volume mounts exist in the repository.
 * These files are synced to the production VM during deploy (see
 * deploy-yandex.yml) and are required for Prometheus, Grafana, and
 * Alertmanager containers to start.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

/** Files referenced by docker-compose.monitoring.yml volume mounts for monitoring services. */
const REQUIRED_FILES = [
  'monitoring/prometheus.yml',
  'monitoring/prometheus-rules.yml',
  'monitoring/alertmanager.yml',
  'monitoring/grafana/provisioning/datasources/prometheus.yml',
  'monitoring/grafana/provisioning/dashboards/dashboards.yml',
];

describe('Monitoring config files', () => {
  it('docker-compose.monitoring.yml exists', () => {
    const fullPath = resolve(ROOT, 'docker-compose.monitoring.yml');
    const stat = statSync(fullPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  it.each(REQUIRED_FILES)('%s exists and is non-empty', (file) => {
    const fullPath = resolve(ROOT, file);
    const stat = statSync(fullPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  describe('prometheus.yml', () => {
    it('contains required scrape targets', () => {
      const content = readFileSync(resolve(ROOT, 'monitoring/prometheus.yml'), 'utf-8');
      expect(content).toContain('scrape_configs');
      expect(content).toContain('job_name: bugspotter-api');
      expect(content).toContain('job_name: bugspotter-worker');
      expect(content).toContain("targets: ['api:3000']");
      expect(content).toContain("targets: ['worker:3001']");
    });

    it('references the alert rules file', () => {
      const content = readFileSync(resolve(ROOT, 'monitoring/prometheus.yml'), 'utf-8');
      expect(content).toContain('rule_files');
      expect(content).toContain('prometheus-rules.yml');
    });

    it('configures bearer token auth for app scrape jobs', () => {
      const content = readFileSync(resolve(ROOT, 'monitoring/prometheus.yml'), 'utf-8');
      expect(content).toContain('bearer_token_file');
    });
  });

  describe('prometheus-rules.yml', () => {
    it('defines alert rules for API, workers, and infrastructure', () => {
      const content = readFileSync(resolve(ROOT, 'monitoring/prometheus-rules.yml'), 'utf-8');
      expect(content).toContain('alert: HighErrorRate');
      expect(content).toContain('alert: APIInstanceDown');
      expect(content).toContain('alert: WorkerInstanceDown');
      expect(content).toContain('alert: QueueBacklog');
      expect(content).toContain('alert: DatabaseDown');
      expect(content).toContain('alert: RedisDown');
    });
  });

  describe('alertmanager.yml', () => {
    it('has a route and receiver configured', () => {
      const content = readFileSync(resolve(ROOT, 'monitoring/alertmanager.yml'), 'utf-8');
      expect(content).toContain('route:');
      expect(content).toContain('receivers:');
    });
  });

  describe('grafana provisioning', () => {
    it('datasource points to Prometheus', () => {
      const content = readFileSync(
        resolve(ROOT, 'monitoring/grafana/provisioning/datasources/prometheus.yml'),
        'utf-8'
      );
      expect(content).toContain('type: prometheus');
      expect(content).toContain('http://prometheus:9090');
    });

    it('dashboard provider is configured', () => {
      const content = readFileSync(
        resolve(ROOT, 'monitoring/grafana/provisioning/dashboards/dashboards.yml'),
        'utf-8'
      );
      expect(content).toContain('providers:');
    });
  });
});
