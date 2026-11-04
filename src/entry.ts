import { startExtension } from './content';

// Kept in the content script's isolated world; no page globals or public API.
const scope = globalThis as typeof globalThis & { __biliSpeedFourStarted?: boolean };
if (!scope.__biliSpeedFourStarted) {
  scope.__biliSpeedFourStarted = true;
  startExtension();
}
