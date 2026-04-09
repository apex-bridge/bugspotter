import { describe, it, expect } from 'vitest';
import { BillingRegionRegistry } from '../src/registry.js';
import { KzBillingPlugin } from '../src/plugins/kz/index.js';

describe('BillingRegionRegistry', () => {
  it('registers and retrieves a plugin', () => {
    const registry = new BillingRegionRegistry();
    const plugin = new KzBillingPlugin();
    registry.register(plugin);

    expect(registry.getPlugin('kz')).toBe(plugin);
  });

  it('returns undefined for unregistered region', () => {
    const registry = new BillingRegionRegistry();
    expect(registry.getPlugin('eu')).toBeUndefined();
  });

  it('lookup is case-insensitive', () => {
    const registry = new BillingRegionRegistry();
    registry.register(new KzBillingPlugin());

    expect(registry.getPlugin('KZ')).toBeDefined();
    expect(registry.getPlugin('Kz')).toBeDefined();
    expect(registry.getPlugin('kz')).toBeDefined();
  });

  it('hasPlugin returns correct boolean', () => {
    const registry = new BillingRegionRegistry();
    registry.register(new KzBillingPlugin());

    expect(registry.hasPlugin('kz')).toBe(true);
    expect(registry.hasPlugin('eu')).toBe(false);
  });

  it('getRegisteredRegions returns all registered codes', () => {
    const registry = new BillingRegionRegistry();
    registry.register(new KzBillingPlugin());

    expect(registry.getRegisteredRegions()).toEqual(['kz']);
  });

  it('allows overwriting a plugin for the same region', () => {
    const registry = new BillingRegionRegistry();
    const plugin1 = new KzBillingPlugin();
    const plugin2 = new KzBillingPlugin();

    registry.register(plugin1);
    registry.register(plugin2);

    expect(registry.getPlugin('kz')).toBe(plugin2);
    expect(registry.getRegisteredRegions()).toEqual(['kz']);
  });
});
