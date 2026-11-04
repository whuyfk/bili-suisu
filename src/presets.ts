import { CUSTOM_RATES, formatRate, isSupportedRate, sameRate } from './rate.ts';

const PREFIX = 'biliSuisu.preset.';
const PIN_KEY = 'biliSuisu.pinnedRate';
const keys = [...CUSTOM_RATES.map(rate => `${PREFIX}${formatRate(rate)}`), PIN_KEY];
type Changes = Record<string, { newValue?: unknown }>;
export interface PresetStorage {
  local: {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
    remove(keys: string[]): Promise<void>;
  };
  onChanged: {
    addListener(listener: (changes: Changes, area: string) => void): void;
    removeListener(listener: (changes: Changes, area: string) => void): void;
  };
}

function extensionStorage(): PresetStorage | undefined {
  const scope = globalThis as typeof globalThis & {
    browser?: { storage?: PresetStorage }; chrome?: { storage?: PresetStorage };
  };
  return scope.browser?.storage ?? scope.chrome?.storage;
}

/** One key per rate avoids lost additions from two tabs writing different shortcuts. */
export class PresetStore {
  readonly ready: Promise<void>;
  private values: Record<string, unknown> = {};
  private listeners = new Set<() => void>();
  private tail: Promise<void> = Promise.resolve();
  private loadFailed = false;
  private versions: Record<string, number> = {};

  private readonly storage: PresetStorage | undefined;

  constructor(storage = extensionStorage()) {
    this.storage = storage;
    storage?.onChanged.addListener(this.onChanged);
    // Merge changes received during the initial read instead of overwriting them.
    this.ready = storage ? storage.local.get(keys).then(snapshot => {
      this.values = { ...snapshot, ...this.values };
      this.emit();
    }).catch(() => { this.loadFailed = true; this.emit(); }) : Promise.resolve();
  }

  get rates(): number[] {
    return CUSTOM_RATES.filter((_, index) => this.values[keys[index]!] === true);
  }

  get pinnedRate(): number | null {
    const value = this.values[PIN_KEY];
    return typeof value === 'number' && isSupportedRate(value) ? value : null;
  }

  pin(rate: number | null): Promise<void> {
    if (rate !== null && !isSupportedRate(rate)) return Promise.reject(new Error('请选择有效的播放倍速。'));
    return this.mutate(async storage => {
      const version = this.versions[PIN_KEY] ?? 0;
      if (rate === null) await storage.local.remove([PIN_KEY]);
      else await storage.local.set({ [PIN_KEY]: rate });
      this.commit(PIN_KEY, rate ?? undefined, version);
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(rate: number): Promise<void> {
    const index = CUSTOM_RATES.indexOf(rate);
    if (index < 0) return Promise.reject(new Error('请选择滑块中的有效倍速。'));
    const key = keys[index]!;
    return this.mutate(async storage => {
      const version = this.versions[key] ?? 0;
      await storage.local.set({ [key]: true });
      this.commit(key, true, version);
    });
  }

  remove(rate: number): Promise<void> {
    const index = CUSTOM_RATES.indexOf(rate);
    return this.mutate(async storage => {
      const removed = index < 0 ? [] : [keys[index]!];
      if (this.pinnedRate !== null && sameRate(this.pinnedRate, rate)) removed.push(PIN_KEY);
      if (removed.length === 0) return;
      const versions = removed.map(key => this.versions[key] ?? 0);
      await storage.local.remove(removed);
      removed.forEach((key, index) => this.commit(key, undefined, versions[index]!));
    });
  }

  clear(): Promise<void> {
    return this.mutate(async storage => {
      const versions = keys.map(key => this.versions[key] ?? 0);
      await storage.local.remove(keys);
      keys.forEach((key, index) => this.commit(key, undefined, versions[index]!));
    });
  }

  destroy(): void {
    this.storage?.onChanged.removeListener(this.onChanged);
    this.listeners.clear();
  }

  private mutate(operation: (storage: PresetStorage) => Promise<void>): Promise<void> {
    const result = this.tail.then(async () => {
      await this.ready;
      if (!this.storage || this.loadFailed) throw new Error('无法读取快捷倍速，请重新加载扩展并刷新页面。');
      try { await operation(this.storage); }
      catch { throw new Error('快捷倍速保存失败，请重试。'); }
      this.emit();
    });
    this.tail = result.catch(() => {});
    return result;
  }

  private commit(key: string, value: unknown, version: number): void {
    // A delayed API completion must not overwrite a newer cross-tab change.
    if ((this.versions[key] ?? 0) === version) this.values[key] = value;
  }

  private emit(): void { this.listeners.forEach(listener => listener()); }

  private readonly onChanged = (changes: Changes, area: string): void => {
    if (area !== 'local') return;
    let changed = false;
    for (const key of keys) {
      if (!(key in changes)) continue;
      this.versions[key] = (this.versions[key] ?? 0) + 1;
      this.values[key] = changes[key]!.newValue;
      changed = true;
    }
    if (changed) this.emit();
  };
}
