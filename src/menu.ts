import { ACTIVE_CLASS, CONTROL, getItemRate, ITEM, ITEM_CLASS, rateItems, RESULT } from './adapter';
import { MediaController } from './media';
import { PresetStore } from './presets';
import { CUSTOM_RATES, customRateIndex, EXTRA_RATES, formatRate, MAX_RATE, MIN_RATE, isSupportedRate, sameRate } from './rate';

type MenuState = 'closed' | 'browse' | 'edit';
let nextInputId = 0;

function actionIcon(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/** Owns the entire interaction lifecycle; focus never implicitly reopens a closed menu. */
export class SpeedMenu {
  readonly control: HTMLElement;
  private readonly custom: HTMLLIElement;
  private readonly trigger: HTMLButtonElement;
  private readonly footer: HTMLDivElement;
  private readonly separator: HTMLSpanElement;
  private readonly editor: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly value: HTMLOutputElement;
  private readonly save: HTMLButtonElement;
  private readonly pin: HTMLButtonElement;
  private readonly pins = new Map<HTMLElement, HTMLButtonElement>();
  private readonly clear: HTMLButtonElement;
  private readonly unsubscribe: () => void;
  private pending = false;
  private revision = 0;
  private readonly status: HTMLElement;
  private readonly originalLabel: string;
  private readonly initialActive: Set<HTMLElement>;
  private readonly originalExpanded: string | null;
  private readonly originalPopup: string | null;
  private readonly events = new AbortController();
  private state: MenuState = 'closed';
  private pointerInside = false;
  private pointerOverButton = false;
  private dragPointer: number | null = null;
  private leaveTimer: ReturnType<typeof setTimeout> | undefined;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private transitioning = false;

  constructor(readonly menu: HTMLElement, private readonly media: MediaController, private readonly presets: PresetStore) {
    this.control = menu.closest<HTMLElement>(CONTROL)!;
    this.originalLabel = this.control.querySelector(RESULT)?.textContent ?? '倍速';
    this.initialActive = new Set(rateItems(menu).filter(item => item.classList.contains(ACTIVE_CLASS)));
    this.originalExpanded = this.control.getAttribute('aria-expanded');
    this.originalPopup = this.control.getAttribute('aria-haspopup');
    this.control.dataset.bs4Enhanced = '';
    this.control.setAttribute('aria-haspopup', 'true');
    menu.dataset.bs4Menu = '';

    this.custom = document.createElement('li');
    this.custom.dataset.bs4Custom = '';
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.dataset.bs4Trigger = '';
    this.trigger.title = '自定义';
    this.trigger.setAttribute('aria-label', '自定义');
    this.trigger.append(actionIcon(['M21 4h-7', 'M10 4H3', 'M21 12h-9', 'M8 12H3',
      'M21 20h-5', 'M12 20H3', 'M14 2v4', 'M8 10v4', 'M16 18v4']));
    this.footer = document.createElement('div');
    this.footer.dataset.bs4Footer = '';
    this.separator = document.createElement('span');
    this.separator.dataset.bs4Separator = '';
    this.separator.textContent = '/';
    this.separator.setAttribute('aria-hidden', 'true');
    this.editor = document.createElement('div');
    this.editor.dataset.bs4Editor = '';
    this.editor.setAttribute('role', 'group');
    this.editor.setAttribute('aria-label', '自定义倍速');
    const label = document.createElement('label');
    const inputId = `bs4-rate-${++nextInputId}`;
    label.htmlFor = inputId;
    label.textContent = '自定义倍速';
    const field = document.createElement('div');
    field.className = 'bs4-value-field';
    this.input = document.createElement('input');
    this.input.id = inputId;
    this.input.type = 'range';
    this.input.min = '0';
    this.input.max = String(CUSTOM_RATES.length - 1);
    this.input.step = '1';
    this.input.setAttribute('aria-valuemin', String(MIN_RATE));
    this.input.setAttribute('aria-valuemax', String(MAX_RATE));
    this.input.title = '拖动选择倍速，点击确定应用；每档 0.1 倍，保留 0.25 倍最低档';
    this.input.setAttribute('aria-label', `自定义倍速，${MIN_RATE} 到 ${MAX_RATE} 倍`);
    this.input.setAttribute('aria-describedby', `${inputId}-hint ${inputId}-status`);
    const unit = document.createElement('span');
    unit.className = 'bs4-unit';
    unit.textContent = '×';
    unit.setAttribute('aria-hidden', 'true');
    this.value = document.createElement('output');
    this.value.htmlFor.add(inputId);
    this.value.setAttribute('aria-hidden', 'true');
    const rateValue = document.createElement('span');
    rateValue.className = 'bs4-rate-value';
    rateValue.append(this.value, unit);
    field.append(rateValue);
    const hint = document.createElement('div');
    hint.className = 'bs4-hint';
    hint.id = `${inputId}-hint`;
    for (const rate of [MIN_RATE, MAX_RATE]) {
      const endpoint = document.createElement('span');
      endpoint.textContent = `${rate}×`;
      hint.append(endpoint);
    }
    this.status = document.createElement('div');
    this.status.className = 'bs4-status';
    this.status.id = `${inputId}-status`;
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    actions.className = 'bs4-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = '取消';
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'bs4-confirm';
    apply.textContent = '确定';
    apply.setAttribute('aria-label', '应用');
    actions.append(cancel, apply);
    this.save = document.createElement('button');
    this.save.type = 'button';
    this.save.dataset.bs4Save = '';
    const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    star.setAttribute('viewBox', '0 0 24 24');
    star.setAttribute('aria-hidden', 'true');
    star.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm12 3 2.78 5.63L21 9.54l-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.93 1.06-6.2L3 9.54l6.22-.91L12 3Z');
    star.append(path);
    this.save.append(star);
    field.append(this.save);
    this.pin = document.createElement('button');
    this.pin.type = 'button';
    this.pin.dataset.bs4Pin = '';
    const pinIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pinIcon.setAttribute('viewBox', '0 0 24 24');
    pinIcon.setAttribute('aria-hidden', 'true');
    pinIcon.setAttribute('focusable', 'false');
    for (const d of ['M8 3h8v3h-1v4l3 3v1H6v-1l3-3V6H8Z', 'M12 14v7']) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      pinIcon.append(path);
    }
    this.pin.append(pinIcon);
    this.clear = document.createElement('button');
    this.clear.type = 'button';
    this.clear.dataset.bs4Clear = '';
    this.clear.title = '清空';
    this.clear.setAttribute('aria-label', '清空');
    this.clear.append(actionIcon(['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
      'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6']));
    this.editor.append(label, field, this.input, hint, this.status, actions);
    this.footer.append(this.trigger, this.separator, this.clear);
    this.custom.append(this.footer, this.editor);
    this.unsubscribe = this.presets.subscribe(() => this.ensure());

    const signal = this.events.signal;
    this.trigger.addEventListener('click', () => this.edit(), { signal });
    apply.addEventListener('click', () => this.submit(), { signal });
    this.save.addEventListener('click', () => { void this.toggleFavorite(); }, { signal });
    this.clear.addEventListener('click', () => {
      this.trigger.focus({ preventScroll: true });
      void this.changePresets(() => this.presets.clear());
    }, { signal });
    cancel.addEventListener('click', () => {
      this.setState('browse');
      this.message('');
      this.trigger.focus();
      this.render();
    }, { signal });
    this.input.addEventListener('input', () => {
      this.updateDraft();
      this.message('');
    }, { signal });
    this.custom.addEventListener('click', event => event.stopPropagation(), { signal });
    this.control.addEventListener('click', this.onClick, { capture: true, signal });
    this.control.addEventListener('pointerenter', this.onEnter, { signal });
    this.control.addEventListener('pointermove', this.onMove, { signal });
    this.control.addEventListener('pointerleave', this.onLeave, { signal });
    this.control.addEventListener('focusout', this.onFocusOut, { signal });
    window.addEventListener('blur', this.onSuspend, { signal });
    window.addEventListener('pointerout', this.onViewportLeave, { capture: true, signal });
    document.addEventListener('visibilitychange', this.onVisibility, { signal });
    window.addEventListener('pointerdown', this.onOutside, { capture: true, signal });
    window.addEventListener('pointerup', this.onDragEnd, { capture: true, signal });
    window.addEventListener('pointercancel', this.onDragEnd, { capture: true, signal });
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'dblclick']) {
      this.control.addEventListener(type, this.onPointer, { capture: true, signal });
    }
    for (const type of ['keydown', 'keyup', 'keypress']) {
      window.addEventListener(type, this.onKey, { capture: true, signal });
    }
    this.setState('closed');
    this.ensure();
  }

  ensure(): void {
    const existing = rateItems(this.menu);
    const native = existing.filter(item => !item.hasAttribute('data-bs4-rate'));
    const descending = native.length < 2
      || (getItemRate(native[0])! >= getItemRate(native[native.length - 1])!);

    const desired = [...new Set([...EXTRA_RATES, ...this.presets.rates, ...(this.presets.pinnedRate === null ? [] : [this.presets.pinnedRate])])]
      .filter(rate => !native.some(item => sameRate(getItemRate(item)!, rate)));
    // Remove only stale injected items; keep nodes stable during focus and editing.
    for (const item of existing.filter(item => item.hasAttribute('data-bs4-rate'))) {
      if (!desired.some(rate => sameRate(getItemRate(item)!, rate))) item.remove();
    }
    desired.sort((a, b) => descending ? b - a : a - b);
    for (const rate of desired) {
      if (rateItems(this.menu).some(item => sameRate(getItemRate(item)!, rate))) continue;
      const option = document.createElement('li');
      option.className = ITEM_CLASS;
      option.dataset.value = String(rate);
      option.dataset.bs4Rate = String(rate);
      const text = `${Number.isInteger(rate) ? rate.toFixed(1) : formatRate(rate)}x`;
      if (EXTRA_RATES.some(extra => sameRate(extra, rate))) {
        option.textContent = text;
        option.tabIndex = 0;
        option.setAttribute('role', 'button');
        option.setAttribute('aria-label', `${formatRate(rate)} 倍速`);
      } else {
        option.dataset.bs4Saved = '';
        const choose = document.createElement('button');
        choose.type = 'button';
        choose.className = 'bs4-choice';
        choose.textContent = text;
        choose.setAttribute('aria-label', `${formatRate(rate)} 倍速`);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.bs4Delete = String(rate);
        remove.title = `删除 ${text}`;
        remove.setAttribute('aria-label', `删除 ${formatRate(rate)} 倍快捷项`);
        option.append(choose, remove);
      }
      const before = rateItems(this.menu).find(item => descending
        ? getItemRate(item)! < rate : getItemRate(item)! > rate);
      this.menu.insertBefore(option, before ?? (this.custom.parentElement === this.menu ? this.custom : null));
    }
    this.updateClear();
    if (this.custom.parentElement !== this.menu || this.menu.lastElementChild !== this.custom) {
      this.menu.append(this.custom);
    }
    this.render();
    this.updateSave();
  }

  render(): void {
    const rate = this.media.video?.playbackRate;
    if (rate === undefined || !Number.isFinite(rate)) { this.updatePin(); return; }
    const text = sameRate(rate, 1) ? '倍速' : `${formatRate(rate)}x`;
    const label = this.control.querySelector(RESULT);
    if (label && label.textContent !== text) label.textContent = text;
    let matched = false;
    for (const item of rateItems(this.menu)) {
      const active = sameRate(getItemRate(item)!, rate);
      item.classList.toggle(ACTIVE_CLASS, active);
      if (item.hasAttribute('data-bs4-rate')) {
        const button = item.querySelector('.bs4-choice') ?? item;
        button.setAttribute('aria-pressed', String(active));
      }
      matched ||= active;
    }
    this.updatePin();
    this.custom.classList.toggle('bs4-custom-active', !matched);
    // Preserve the draft for the whole editing session, including Tab to Confirm.
    if (this.state !== 'edit') {
      this.input.value = String(customRateIndex(rate));
      this.updateDraft();
    }
  }

  message(text: string, error = false): void {
    if (this.status.textContent !== text) this.status.textContent = text;
    this.status.classList.toggle('bs4-error', error);
    this.input.setAttribute('aria-invalid', String(error));
    // A failed preset can be corrected here; background recovery never pops UI open.
    if (error && this.state === 'browse') this.edit(false);
  }

  destroy(): void {
    clearTimeout(this.leaveTimer);
    clearTimeout(this.hoverTimer);
    this.events.abort();
    this.unsubscribe();
    for (const [host, pin] of this.pins) { delete host.dataset.bs4PinHost; pin.remove(); }
    this.pins.clear();
    this.menu.querySelectorAll('[data-bs4-rate]').forEach(item => item.remove());
    this.custom.remove();
    delete this.control.dataset.bs4Enhanced;
    delete this.control.dataset.bs4State;
    delete this.menu.dataset.bs4Menu;
    for (const [attribute, value] of [['aria-expanded', this.originalExpanded], ['aria-haspopup', this.originalPopup]]) {
      if (value === null) this.control.removeAttribute(attribute!);
      else this.control.setAttribute(attribute!, value!);
    }
    const label = this.control.querySelector(RESULT);
    if (label) label.textContent = this.originalLabel;
    for (const item of rateItems(this.menu)) item.classList.toggle(ACTIVE_CLASS, this.initialActive.has(item));
  }

  private setState(state: MenuState): void {
    clearTimeout(this.leaveTimer);
    clearTimeout(this.hoverTimer);
    this.transitioning = true;
    this.state = state;
    this.revision++;
    if (state !== 'edit') this.dragPointer = null;
    this.control.dataset.bs4State = state;
    this.control.setAttribute('aria-expanded', String(state !== 'closed'));
    this.trigger.hidden = state === 'edit';
    this.footer.hidden = state === 'edit';
    this.editor.hidden = state !== 'edit';
    this.updateClear();
    this.menu.scrollTop = 0;
    this.updatePin();
    this.transitioning = false;
  }

  private browse(): void {
    if (this.state !== 'closed') return;
    this.setState('browse');
    this.message('');
    this.render();
  }

  private edit(clearError = true): void {
    this.input.value = String(customRateIndex(this.media.video?.playbackRate ?? 1));
    if (clearError) this.message('');
    this.setState('edit');
    this.input.focus({ preventScroll: true });
    this.updateDraft();
  }

  private updateDraft(): void {
    const index = Number(this.input.value);
    const rate = CUSTOM_RATES[index]!;
    const text = rate === MIN_RATE ? String(rate) : rate.toFixed(1);
    if (this.value.value !== text) this.value.value = text;
    this.input.setAttribute('aria-valuenow', String(rate));
    this.input.setAttribute('aria-valuetext', `${text} 倍速`);
    this.input.style.setProperty('--bs4-progress', `${index / (CUSTOM_RATES.length - 1) * 100}%`);
    this.updateSave();
    this.updatePin();
  }

  private updateSave(): void {
    const rate = CUSTOM_RATES[Number(this.input.value)]!;
    const saved = this.presets.rates.includes(rate);
    const fixed = rateItems(this.menu).some(item => !item.hasAttribute('data-bs4-saved') && sameRate(getItemRate(item)!, rate));
    const disabled = this.pending || (fixed && !saved);
    // Firefox blurs a focused button when it becomes disabled. Keep focus in
    // the editor so that this state change is not mistaken for leaving it.
    if (disabled && this.state === 'edit' && document.activeElement === this.save) {
      this.input.focus({ preventScroll: true });
    }
    this.save.disabled = disabled;
    this.save.setAttribute('aria-pressed', String(saved));
    const text = saved ? '取消收藏' : fixed ? '默认倍速已在倍速栏中' : '添加到倍速栏';
    this.save.title = text;
    this.save.setAttribute('aria-label', text);
  }

  private updatePin(): void {
    const items = this.state === 'edit' ? [] : rateItems(this.menu);
    const actual = this.media.video?.playbackRate;
    for (const [host, pin] of this.pins) {
      if (items.includes(host)) continue;
      delete host.dataset.bs4PinHost;
      pin.remove();
      this.pins.delete(host);
    }
    for (const host of items) {
      const rate = getItemRate(host)!;
      let pin = this.pins.get(host);
      if (!pin) {
        pin = this.pin.cloneNode(true) as HTMLButtonElement;
        this.pins.set(host, pin);
        host.dataset.bs4PinHost = '';
        host.append(pin);
      }
      const active = this.presets.pinnedRate !== null && sameRate(this.presets.pinnedRate, rate);
      const current = actual !== undefined && sameRate(actual, rate);
      pin.toggleAttribute('data-bs4-pin-current', current);
      pin.disabled = this.pending;
      pin.setAttribute('aria-pressed', String(active));
      const title = active ? `取消固定 ${formatRate(rate)} 倍` : `应用并固定 ${formatRate(rate)} 倍为默认速度`;
      pin.title = title;
      pin.setAttribute('aria-label', title);
    }
  }

  private async togglePin(pin: HTMLElement): Promise<void> {
    if (this.pending) return;
    const host = pin.parentElement;
    if (!host) return;
    const rate = getItemRate(host);
    if (rate === null || !isSupportedRate(rate)) return;
    const active = this.presets.pinnedRate !== null && sameRate(this.presets.pinnedRate, rate);
    // A hover pin applies the row and persists it in one action. Unpinning
    // leaves the current media alone, including a temporary manual speed.
    if (!active && !this.media.apply(rate)) return;
    this.trigger.focus({ preventScroll: true });
    await this.changePresets(() => this.presets.pin(active ? null : rate));
  }

  private updateClear(): void {
    this.clear.hidden = this.state === 'edit'
      || (this.presets.rates.length === 0 && this.presets.pinnedRate === null);
    this.separator.hidden = this.clear.hidden;
  }

  private async toggleFavorite(): Promise<void> {
    if (this.save.disabled) return;
    const draft = this.input.value;
    const rate = CUSTOM_RATES[Number(draft)]!;
    const saved = this.presets.rates.includes(rate);
    const revision = this.revision;
    const succeeded = await this.changePresets(() => saved ? this.presets.remove(rate) : this.presets.add(rate));
    if (succeeded && this.revision === revision && this.input.value === draft && !this.events.signal.aborted) {
      this.message('');
    }
  }

  private async changePresets(operation: () => Promise<void>): Promise<boolean> {
    if (this.pending) return false;
    const revision = this.revision;
    this.pending = true;
    this.updateSave();
    this.updatePin();
    try { await operation(); return true; }
    catch (error) {
      if (this.revision === revision && !this.events.signal.aborted) {
        this.message(error instanceof Error ? error.message : '快捷倍速保存失败，请重试。', true);
      }
      return false;
    } finally {
      this.pending = false;
      if (!this.events.signal.aborted) { this.updateSave(); this.updatePin(); }
    }
  }

  private close(): void {
    const hadFocus = this.control.contains(document.activeElement);
    this.setState('closed');
    this.message('');
    this.render();
    // Focus restoration and keyboard Tab never activate the popup. Enter/Space
    // remain explicit keyboard actions, even after returning from the desktop.
    if (hadFocus) this.control.focus({ preventScroll: true });
  }

  private submit(): void {
    const rate = CUSTOM_RATES[Number(this.input.value)]!;
    if (this.media.apply(rate)) this.close();
  }

  private scheduleDismissal(): void {
    clearTimeout(this.leaveTimer);
    if (this.state === 'closed' || this.pointerInside || this.dragPointer !== null) return;
    // Bridge the small hover gap between the toolbar and its menu.
    this.leaveTimer = setTimeout(() => {
      if (!this.pointerInside && this.dragPointer === null) this.close();
    }, 120);
  }

  private pointerAt(node: HTMLElement, event: PointerEvent, visible = true): boolean {
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom) return false;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (!hit || !node.contains(hit)) return false;
    if (!visible) return true;
    // Native controls can remain hit-testable while their toolbar has faded.
    // An absolute child/pseudo-element outside the button is not its hover area.
    if (getComputedStyle(node).visibility !== 'visible') return false;
    for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
      if (Number(getComputedStyle(ancestor).opacity) === 0) return false;
    }
    return true;
  }

  private readonly onEnter = (event: PointerEvent): void => {
    this.pointerInside = this.pointerAt(this.control, event)
      || (this.state !== 'closed' && this.pointerAt(this.menu, event));
    if (this.pointerInside) clearTimeout(this.leaveTimer);
    // Layout changes and returning to a window can emit pointerenter without
    // moving over this button. Only an actual pointer move may open a popup.
  };

  private readonly onMove = (event: PointerEvent): void => {
    const overButton = this.pointerAt(this.control, event, false);
    const freshHover = overButton && !this.pointerOverButton;
    this.pointerOverButton = overButton;
    this.pointerInside = (overButton && this.pointerAt(this.control, event))
      || (this.state !== 'closed' && this.pointerAt(this.menu, event));
    if (!overButton) clearTimeout(this.hoverTimer);
    if (freshHover && this.state === 'closed' && event.buttons === 0 && event.pointerType !== 'touch') {
      // BPX reveals its faded toolbar in the following mousemove handler.
      // Confirm a brief, still-visible hover after that transition has begun.
      this.hoverTimer = setTimeout(() => {
        if (this.state !== 'closed' || !this.pointerOverButton) return;
        if (this.pointerAt(this.control, event)) this.browse();
        else this.pointerOverButton = false;
      }, 80);
    }
    if (this.pointerInside) clearTimeout(this.leaveTimer);
    else this.scheduleDismissal();
  };

  private readonly onLeave = (): void => {
    clearTimeout(this.hoverTimer);
    this.pointerInside = false;
    this.pointerOverButton = false;
    this.updatePin();
    this.scheduleDismissal();
  };

  private readonly onDragEnd = (event: PointerEvent): void => {
    if (this.dragPointer !== event.pointerId) return;
    this.dragPointer = null;
    // Native range controls may capture the pointer. Use its release position
    // rather than relying on hover events delivered during capture.
    this.pointerInside = event.type !== 'pointercancel' && [this.control, this.menu].some(node => {
      const rect = node.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    this.scheduleDismissal();
  };

  private readonly onSuspend = (): void => {
    clearTimeout(this.hoverTimer);
    this.pointerInside = false;
    this.pointerOverButton = false;
    if (this.state !== 'closed') this.close();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.onSuspend();
  };

  private readonly onViewportLeave = (event: PointerEvent): void => {
    if (event.relatedTarget === null && this.dragPointer === null) this.onSuspend();
  };

  private readonly onFocusOut = (event: FocusEvent): void => {
    if (this.transitioning || this.state === 'closed') return;
    if (!(event.relatedTarget instanceof Node) || !this.control.contains(event.relatedTarget)) this.close();
  };

  private readonly onOutside = (event: Event): void => {
    if (this.state !== 'closed' && event.target instanceof Node && !this.control.contains(event.target)) this.close();
  };

  private readonly onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const pin = target.closest<HTMLElement>('[data-bs4-pin]');
    if (pin && this.menu.contains(pin)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void this.togglePin(pin);
      return;
    }
    if (this.custom.contains(target)) return;
    const remove = target.closest<HTMLElement>('[data-bs4-delete]');
    if (remove && this.menu.contains(remove)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.trigger.focus({ preventScroll: true });
      void this.changePresets(() => this.presets.remove(Number(remove.dataset.bs4Delete)));
      return;
    }
    const item = target.closest<HTMLElement>(ITEM);
    if (!item || item.parentElement !== this.menu) {
      if (target === this.control || target.closest(RESULT)) this.browse();
      return;
    }
    this.message('');
    const rate = getItemRate(item);
    if (rate === null) return;
    if (item.hasAttribute('data-bs4-rate')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.media.apply(rate)) this.close();
    } else {
      this.media.nativeSelection(rate);
      // Native bubble handlers still run after this capture handler.
      this.close();
    }
  };

  private readonly onPointer = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    if (event instanceof PointerEvent && event.type === 'pointerdown' && event.target === this.input) {
      this.dragPointer = event.pointerId;
      clearTimeout(this.leaveTimer);
    }
    if (this.custom.contains(event.target) || event.target.closest('[data-bs4-rate], [data-bs4-pin]')) event.stopPropagation();
  };

  private readonly onKey = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || !(event.target instanceof Element)) return;
    if (!this.control.contains(event.target)) return;
    // A hold may have started in the video before focus moved into this menu.
    // Native keyup must clear its held-key state even though editor keydown is isolated.
    if (event.key === 'ArrowRight' && event.type === 'keyup') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown') this.close();
      return;
    }
    if (event.target === this.control && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown' && !event.repeat) {
        if (this.state === 'closed') this.browse(); else this.close();
      }
      return;
    }
    if (event.target.closest('[data-bs4-pin]')) {
      event.stopImmediatePropagation();
      return;
    }
    const option = event.target.closest<HTMLElement>('[data-bs4-rate]');
    if (option?.parentElement === this.menu) {
      event.stopImmediatePropagation();
      if (option.hasAttribute('data-bs4-saved') && event.target.closest('button')) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (event.type === 'keydown' && !event.repeat) option.click();
      }
      return;
    }
    if (!this.custom.contains(event.target)) return;
    event.stopImmediatePropagation();
    if (event.key === 'Enter' && event.target === this.input) {
      event.preventDefault();
      if (event.type === 'keydown' && !event.repeat && !event.isComposing) this.submit();
    }
  };
}
