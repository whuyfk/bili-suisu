// Minimal Marionette test client. Uses only Firefox's documented local protocol;
// the production extension has no dependency on this development helper.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function firefoxSession(executablePath, addonPath) {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const profile = await mkdtemp(join(tmpdir(), 'bili-speed-four-firefox-'));
  await writeFile(join(profile, 'user.js'), [
    `user_pref("marionette.port", ${port});`,
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("browser.aboutwelcome.enabled", false);',
  ].join('\n'));
  const process = spawn(executablePath, ['-headless', '-no-remote', '-profile', profile, '-marionette', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let log = '';
  process.stderr.on('data', chunk => { log = (log + chunk).slice(-3000); });
  let socket;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        socket = await new Promise((resolve, reject) => {
          const candidate = net.createConnection({ host: '127.0.0.1', port });
          candidate.once('connect', () => resolve(candidate));
          candidate.once('error', reject);
        });
        break;
      } catch { await delay(200); }
    }
    if (!socket) throw new Error(`Firefox Marionette did not start: ${log}`);
    let buffer = Buffer.alloc(0);
    let sequence = 0;
    const pending = new Map();
    const hello = new Promise(resolve => {
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const colon = buffer.indexOf(58);
          if (colon === -1) return;
          const size = Number(buffer.subarray(0, colon).toString());
          if (buffer.length < colon + 1 + size) return;
          const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + size));
          buffer = buffer.subarray(colon + 1 + size);
          if (!Array.isArray(message)) { resolve(message); continue; }
          const handler = pending.get(message[1]);
          if (!handler) continue;
          pending.delete(message[1]);
          clearTimeout(handler.timer);
          if (message[2]) handler.reject(new Error(JSON.stringify(message[2])));
          else handler.resolve(message[3]);
        }
      });
    });
    socket.on('error', error => {
      for (const handler of pending.values()) { clearTimeout(handler.timer); handler.reject(error); }
      pending.clear();
    });
    await hello;
    function command(name, parameters = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const body = JSON.stringify([0, id, name, parameters]);
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${name} timed out`)); }, 45_000);
        pending.set(id, { resolve, reject, timer });
        socket.write(`${Buffer.byteLength(body)}:${body}`);
      });
    }
    const capabilities = await command('WebDriver:NewSession', { capabilities: {} });
    await command('WebDriver:SetTimeouts', { pageLoad: 30_000, script: 15_000, implicit: 0 });
    const installed = await command('Addon:Install', { path: addonPath, temporary: true });
    return {
      command, capabilities, installed,
      async evaluate(script) {
        const response = await command('WebDriver:ExecuteScript', { script, args: [], newSandbox: true, sandbox: 'default' });
        return response.value;
      },
      async close() {
        await command('WebDriver:DeleteSession').catch(() => {});
        socket.destroy();
        process.kill('SIGTERM');
        await new Promise(resolve => { if (process.exitCode !== null) resolve(); else process.once('exit', resolve); });
        await rm(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    socket?.destroy();
    process.kill('SIGTERM');
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}
