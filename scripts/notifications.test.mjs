import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../notifications.js', import.meta.url), 'utf8');
function setup() {
 let clock = 0, id = 0;
 const timers = new Map();
 const host = {dataset: {}, children: [], classes: new Set(), inert: true,
  classList: {add: value => host.classes.add(value), remove: value => host.classes.delete(value)},
  replaceChildren(...children) {this.children = children;}, matches: () => false,
  contains: element => host.children.includes(element)};
 const document = {activeElement: null, getElementById: () => host, createElement: tag => ({tag,
  setAttribute(name, value) {this[name] = value;}, append(...children) {this.children = children;}})};
 const context = vm.createContext({document, Date: {now: () => clock},
  setTimeout: (fn, delay) => {timers.set(++id, {fn, at: clock + delay}); return id;},
  clearTimeout: id => timers.delete(id)});
 vm.runInContext(source, context);
 return {host, document, toast: context.toast, timers, tick(ms) {
  clock += ms;
  for (const [id, timer] of timers) if (timer.at <= clock) {timers.delete(id); timer.fn();}
 }};
}

test('notifications render untrusted text as text and provide a dismiss button', () => {
 const x = setup(); x.toast('<img src=x onerror=alert(1)>', {type: 'warning', title: 'Проверка'});
 assert.equal(x.host.children[1].children[1].textContent, '<img src=x onerror=alert(1)>');
 assert.equal(x.host.children[1].children[0].textContent, 'Проверка');
 assert.equal(x.host.children[2]['aria-label'], 'Закрыть уведомление');
 assert.equal(x.host.inert, false);
 x.host.children[2].onclick(); assert.equal(x.host.inert, true); assert.equal(x.timers.size, 0);
});

test('a new notification replaces the previous one and gets its own dismissal time', () => {
 const x = setup(); x.toast('Первое'); x.tick(4000); x.toast('Второе', {type: 'success'});
 assert.equal(x.timers.size, 1); x.tick(1000); assert.ok(x.host.classes.has('s'));
 assert.equal(x.host.children[1].children[1].textContent, 'Второе');
 x.tick(4000); assert.equal(x.host.inert, true); assert.equal(x.host.classes.has('s'), false);
});

test('reading with pointer or keyboard pauses the remaining dismissal time', () => {
 for (const input of ['pointer', 'focus']) {
  const x = setup(); x.toast('Сообщение', {type: 'warning'}); x.tick(2000);
  if (input === 'pointer') x.host.onpointerenter(); else x.host.onfocusin();
  x.tick(10000); assert.equal(x.host.inert, false);
  if (input === 'pointer') x.host.onpointerleave(); else x.host.onfocusout({relatedTarget: null});
  x.tick(5999); assert.equal(x.host.inert, false);
  x.tick(1); assert.equal(x.host.inert, true);
 }
});

test('existing callers still get useful default categories and longer warnings', () => {
 const x = setup(); x.toast('Замеры сохранены'); assert.equal(x.host.dataset.type, 'success');
 x.toast('Введите вес'); assert.equal(x.host.dataset.type, 'warning');
 x.tick(5000); assert.equal(x.host.inert, false); x.tick(3000); assert.equal(x.host.inert, true);
});

test('leaving keyboard focus does not dismiss a notice still under the pointer', () => {
 const x = setup(); x.toast('Сообщение'); x.tick(1000);
 x.host.onpointerenter(); x.host.onfocusin(); x.host.onfocusout({relatedTarget: null});
 x.tick(10000); assert.equal(x.host.inert, false); assert.equal(x.timers.size, 0);
 x.host.onpointerleave(); x.tick(4000); assert.equal(x.host.inert, true);
});
