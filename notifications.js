// One non-modal notice at a time; message text never becomes HTML.
function toast(message, options = {}) {
 const host = document.getElementById('toast');
 if (!host) return;
 if (typeof options === 'string') options = {type: options};
 const text = String(message);
 const inferred = /^(Проверьте|Введите|Выберите|Разрешите|Сначала|Нужно|Вставка недоступна)/i.test(text) ? 'warning'
  : /(сохранен|сохранён|сохранены|записан|обновлена|отменены|Текст готов)/i.test(text) ? 'success' : 'info';
 const type = ['info', 'success', 'warning', 'error'].includes(options.type) ? options.type : inferred;
 const titles = {info: 'Подсказка', success: 'Готово', warning: 'Обратите внимание', error: 'Не получилось'};
 const symbols = {info: 'i', success: '✓', warning: '!', error: '!'};
 clearTimeout(toast.t);
 const icon = document.createElement('span');
 icon.className = 'notice-icon'; icon.textContent = symbols[type]; icon.setAttribute('aria-hidden', 'true');
 const content = document.createElement('div'); content.className = 'notice-content';
 const title = document.createElement('strong'); title.textContent = options.title || titles[type];
 const body = document.createElement('p'); body.textContent = text;
 content.append(title, body);
 const close = document.createElement('button'); close.type = 'button'; close.className = 'notice-close';
 close.textContent = '×'; close.setAttribute('aria-label', 'Закрыть уведомление'); close.onclick = toast.hide;
 host.replaceChildren(icon, content, close);
 host.dataset.type = type; host.inert = false; host.classList.add('s');
 const duration = options.duration || (type === 'error' || type === 'warning' || text.length > 90 ? 8000 : 5000);
 let remaining = duration, started = null, hovered = host.matches(':hover'), focused = false;
 const pause = () => {clearTimeout(toast.t); if (started !== null) remaining = Math.max(0, remaining - (Date.now() - started)); started = null;};
 const resume = () => {if (hovered || focused || host.inert) return; started = Date.now(); clearTimeout(toast.t); toast.t = setTimeout(toast.hide, remaining);};
 host.onpointerenter = () => {hovered = true; pause();}; host.onpointerleave = () => {hovered = false; resume();};
 host.onfocusin = () => {focused = true; pause();};
 host.onfocusout = event => {if (!host.contains(event.relatedTarget)) {focused = false; resume();}};
 resume();
}
toast.hide = function () {
 clearTimeout(toast.t);
 const host = document.getElementById('toast');
 if (host) {host.classList.remove('s'); host.inert = true;}
};
