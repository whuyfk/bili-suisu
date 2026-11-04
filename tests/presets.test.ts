import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PresetStore, type PresetStorage } from '../src/presets.ts';

type Listener = Parameters<PresetStorage['onChanged']['addListener']>[0];
function memoryStorage() {
  const data: Record<string, unknown> = {};
  const listeners = new Set<Listener>();
  const emit = (changes: Record<string, { newValue?: unknown }>) => listeners.forEach(fn => fn(changes, 'local'));
  const storage: PresetStorage = {
    local: {
      async get(keys) { return Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])); },
      async set(values) {
        Object.assign(data, values);
        emit(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])));
      },
      async remove(keys) {
        keys.forEach(key => { delete data[key]; });
        emit(Object.fromEntries(keys.map(key => [key, {}])));
      },
    },
    onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => { listeners.delete(fn); } },
  };
  return { storage, data, listeners };
}

test('presets persist across instances and only contain supported canonical slider rates', async () => {
  const { storage, data } = memoryStorage();
  Object.assign(data, { unrelated: 1, 'biliSuisu.preset.1.37': true, 'biliSuisu.preset.4.2': 'true' });
  const first = new PresetStore(storage);
  await first.ready;
  assert.deepEqual(first.rates, []);
  await first.add(0.25);
  await first.add(4.2);
  await first.add(4.2);
  await assert.rejects(first.add(0.89));
  const second = new PresetStore(storage);
  await second.ready;
  assert.deepEqual(second.rates, [0.25, 4.2]);
  first.destroy(); second.destroy();
});

test('delete and clear synchronize across stores while preserving unrelated storage', async () => {
  const { storage, data } = memoryStorage();
  data.unrelated = { retained: true };
  const a = new PresetStore(storage); const b = new PresetStore(storage);
  await Promise.all([a.ready, b.ready]);
  await a.add(2.8); await a.add(4.2);
  assert.deepEqual(b.rates, [2.8, 4.2]);
  await b.remove(2.8);
  assert.deepEqual(a.rates, [4.2]);
  await b.clear();
  assert.deepEqual(a.rates, []);
  assert.deepEqual(data, { unrelated: { retained: true } });
  a.destroy(); b.destroy();
});

test('different tabs adding concurrently do not overwrite each other', async () => {
  const { storage } = memoryStorage();
  const a = new PresetStore(storage); const b = new PresetStore(storage);
  await Promise.all([a.add(2.8), b.add(4.2)]);
  assert.deepEqual(a.rates, [2.8, 4.2]);
  assert.deepEqual(b.rates, [2.8, 4.2]);
  a.destroy(); b.destroy();
});

test('a change received during initial loading wins over a stale snapshot', async () => {
  const { storage } = memoryStorage();
  let finish!: (snapshot: Record<string, unknown>) => void;
  storage.local.get = () => new Promise(resolve => { finish = resolve; });
  const store = new PresetStore(storage);
  await storage.local.set({ 'biliSuisu.preset.4.2': true });
  finish({});
  await store.ready;
  assert.deepEqual(store.rates, [4.2]);
  store.destroy();
});

test('queued add-clear-add operations finish in the requested order', async () => {
  const { storage } = memoryStorage(); const store = new PresetStore(storage);
  await Promise.all([store.add(2.8), store.clear(), store.add(4.2)]);
  assert.deepEqual(store.rates, [4.2]);
  store.destroy();
});

test('failed writes leave previous presets intact and do not poison later operations', async () => {
  const { storage } = memoryStorage(); const store = new PresetStore(storage);
  await store.add(2.8);
  const original = storage.local.set;
  storage.local.set = async () => { throw new Error('quota'); };
  await assert.rejects(store.add(4.2), /保存失败/);
  assert.deepEqual(store.rates, [2.8]);
  storage.local.set = original;
  await store.add(4.2);
  assert.deepEqual(store.rates, [2.8, 4.2]);
  store.destroy();
});

test('unavailable or unreadable storage reports an error without claiming persistence', async () => {
  const unavailable = new PresetStore();
  await assert.rejects(unavailable.add(4.2), /无法读取/);
  const { storage } = memoryStorage();
  storage.local.get = async () => { throw new Error('unavailable'); };
  const unreadable = new PresetStore(storage);
  await unreadable.ready;
  await assert.rejects(unreadable.add(4.2), /无法读取/);
  assert.deepEqual(unreadable.rates, []);
  unreadable.destroy(); unavailable.destroy();
});

test('destroy unsubscribes from storage changes and releases menu listeners', async () => {
  const { storage, listeners } = memoryStorage(); const store = new PresetStore(storage);
  await store.ready;
  let updates = 0;
  store.subscribe(() => { updates++; });
  assert.equal(listeners.size, 1);
  store.destroy();
  await storage.local.set({ 'biliSuisu.preset.4.2': true });
  assert.equal(listeners.size, 0);
  assert.equal(updates, 0);
});

test('a pin persists across instances, supports native fractional presets and unpins independently of favorites', async () => {
  const { storage } = memoryStorage(); const a = new PresetStore(storage);
  await a.add(4.2); await a.pin(1.25);
  const b = new PresetStore(storage); await b.ready;
  assert.equal(b.pinnedRate, 1.25);
  await b.pin(null);
  assert.equal(a.pinnedRate, null);
  assert.deepEqual(a.rates, [4.2]);
  a.destroy(); b.destroy();
});

test('deleting a pinned shortcut and clearing all preferences remove the pin atomically', async () => {
  const { storage, data } = memoryStorage(); const store = new PresetStore(storage);
  data.unrelated = true;
  await store.add(4.2); await store.add(6); await store.pin(4.2);
  await store.remove(6);
  assert.equal(store.pinnedRate, 4.2);
  await store.remove(4.2);
  assert.equal(store.pinnedRate, null);
  assert.deepEqual(data, { unrelated: true });
  await store.pin(3); await store.add(4.2); await store.clear();
  assert.equal(store.pinnedRate, null);
  assert.deepEqual(data, { unrelated: true });
  store.destroy();
});

test('an unsaved custom rate can be pinned and removed, and invalid pinned data is ignored', async () => {
  const { storage, data } = memoryStorage();
  data['biliSuisu.pinnedRate'] = '3';
  const store = new PresetStore(storage); await store.ready;
  assert.equal(store.pinnedRate, null);
  for (const value of [NaN, Infinity, 0, -1, 10.01]) await assert.rejects(store.pin(value));
  await store.pin(4.2);
  assert.deepEqual(store.rates, []);
  assert.equal(store.pinnedRate, 4.2);
  await store.remove(4.2);
  assert.equal(store.pinnedRate, null);
  store.destroy();
});

test('failed pin updates and removals preserve the previously saved pin', async () => {
  const { storage } = memoryStorage(); const store = new PresetStore(storage);
  await store.pin(3);
  storage.local.set = async () => { throw new Error('quota'); };
  await assert.rejects(store.pin(4.2), /保存失败/);
  assert.equal(store.pinnedRate, 3);
  storage.local.remove = async () => { throw new Error('unavailable'); };
  await assert.rejects(store.pin(null), /保存失败/);
  assert.equal(store.pinnedRate, 3);
  store.destroy();
});


test('a delayed pin write completion does not overwrite a newer preference from another tab', async () => {
  const { storage } = memoryStorage();
  const original = storage.local.set.bind(storage.local);
  let release!: () => void;
  let written!: () => void;
  const started = new Promise<void>(resolve => { written = resolve; });
  storage.local.set = async values => {
    await original(values);
    if (values['biliSuisu.pinnedRate'] === 3) {
      await new Promise<void>(resolve => { release = resolve; written(); });
    }
  };
  const a = new PresetStore(storage); const b = new PresetStore(storage);
  const pending = a.pin(3);
  await started;
  await b.pin(4.2);
  release(); await pending;
  assert.equal(a.pinnedRate, 4.2);
  assert.equal(b.pinnedRate, 4.2);
  a.destroy(); b.destroy();
});
