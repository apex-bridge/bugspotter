/**
 * Billing Region Registry
 * Maps region codes to billing plugin implementations.
 */

import type { BillingRegionPlugin } from './interfaces.js';

export class BillingRegionRegistry {
  private readonly plugins = new Map<string, BillingRegionPlugin>();

  /**
   * Register a billing plugin for a region code.
   */
  register(plugin: BillingRegionPlugin): void {
    this.plugins.set(plugin.regionCode.toLowerCase(), plugin);
  }

  /**
   * Get the billing plugin for a region code.
   * Returns undefined if no plugin is registered for that region.
   */
  getPlugin(regionCode: string): BillingRegionPlugin | undefined {
    return this.plugins.get(regionCode.toLowerCase());
  }

  /**
   * Get all registered region codes.
   */
  getRegisteredRegions(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Check if a region has a registered billing plugin.
   */
  hasPlugin(regionCode: string): boolean {
    return this.plugins.has(regionCode.toLowerCase());
  }
}
