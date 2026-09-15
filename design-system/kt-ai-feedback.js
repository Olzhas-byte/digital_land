/*
 * KT AI — режим обратной связи прототипа (drop-in).
 * Закрывает петлю «показал владельцу → собрал фидбэк → итерировал» в контексте.
 * Владелец процесса включает режим, кликает по любому элементу, оставляет заметку;
 * все заметки экспортируются в markdown, который БА берёт в работу.
 *
 * Подключение (одна строка, после kt-ai-components.css):
 *   <script src="kt-ai-feedback.js" defer><\/script>   (escaped close tag — безопасно и при инлайне)
 *
 * Самодостаточен: стили инжектятся на токенах ДС (обе темы), без зависимостей.
 * Канон: docs/PRODUCT_CONTRACT.md, docs/GOAL.md (DoD #6 — замкнутая петля обратной связи).
 */
(function () {
  'use strict';
  if (window.__ktFeedback) return;
  window.__ktFeedback = true;

  var KEY = 'kt-ai-feedback:' + location.pathname;
  var comments = load();
  var active = false;
  var visible = true;
  var seq = comments.reduce(function (m, c) { return Math.max(m, c.n); }, 0);

  // ---------- стили (на semantic-токенах ДС) ----------
  function injectStyles() {
    var css = [
      '.ktfb-ui{font-family:var(--kt-ai-font-sans);box-sizing:border-box}',
      '.ktfb-ui *{box-sizing:border-box}',
      '.ktfb-fab{position:fixed;left:20px;bottom:20px;z-index:65;display:inline-flex;align-items:center;gap:var(--kt-ai-space-3);',
      '  height:var(--kt-ai-control-h-lg);padding:0 var(--kt-ai-space-5);border-radius:var(--kt-ai-radius-full);cursor:pointer;',
      '  background:var(--kt-ai-bg-elevated);color:var(--kt-ai-fg);border:1px solid var(--kt-ai-border-strong);',
      '  box-shadow:var(--kt-ai-shadow-md);font-size:var(--kt-ai-text-sm);font-weight:var(--kt-ai-weight-medium)}',
      '.ktfb-fab[data-on="true"]{background:var(--kt-ai-primary);color:var(--kt-ai-fg-on-fill);border-color:var(--kt-ai-primary)}',
      '.ktfb-fab .dot{width:8px;height:8px;border-radius:50%;background:var(--kt-ai-primary)}',
      '.ktfb-fab[data-on="true"] .dot{background:var(--kt-ai-fg-on-fill)}',
      '.ktfb-fab .cnt{font-family:var(--kt-ai-font-mono);font-size:var(--kt-ai-text-2xs);opacity:.8}',
      'body.ktfb-pick *{cursor:crosshair!important}',
      'body.ktfb-pick .ktfb-ui, body.ktfb-pick .ktfb-ui *{cursor:default!important}',
      '.ktfb-hl{outline:2px solid var(--kt-ai-primary)!important;outline-offset:1px!important;border-radius:var(--kt-ai-radius-sm)}',
      '.ktfb-layer{position:fixed;inset:0;z-index:64;pointer-events:none}',
      '.ktfb-pin{position:fixed;z-index:64;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;',
      '  background:var(--kt-ai-primary);color:var(--kt-ai-fg-on-fill);font-size:var(--kt-ai-text-2xs);',
      '  font-weight:var(--kt-ai-weight-bold);display:flex;align-items:center;justify-content:center;',
      '  pointer-events:auto;cursor:pointer;box-shadow:var(--kt-ai-shadow-sm);border:1.5px solid var(--kt-ai-bg-elevated)}',
      '.ktfb-panel{position:fixed;left:20px;bottom:72px;z-index:65;width:320px;max-height:60vh;display:flex;flex-direction:column;',
      '  background:var(--kt-ai-bg-elevated);border:1px solid var(--kt-ai-border);border-radius:var(--kt-ai-radius-3xl);',
      '  box-shadow:var(--kt-ai-shadow-lg);overflow:hidden}',
      '.ktfb-panel[hidden]{display:none}',
      '.ktfb-head{display:flex;align-items:center;gap:var(--kt-ai-space-4);padding:var(--kt-ai-space-5) var(--kt-ai-space-6);border-bottom:1px solid var(--kt-ai-divider)}',
      '.ktfb-head .t{font-size:var(--kt-ai-text-sm);font-weight:var(--kt-ai-weight-semibold);color:var(--kt-ai-fg)}',
      '.ktfb-head .sp{margin-left:auto}',
      '.ktfb-list{overflow:auto;padding:var(--kt-ai-space-4);display:flex;flex-direction:column;gap:var(--kt-ai-space-3)}',
      '.ktfb-item{display:flex;gap:var(--kt-ai-space-4);padding:var(--kt-ai-space-4);border-radius:var(--kt-ai-radius-2xl);background:var(--kt-ai-bg-soft)}',
      '.ktfb-item .n{flex-shrink:0;width:20px;height:20px;border-radius:50%;background:var(--kt-ai-primary);color:var(--kt-ai-fg-on-fill);',
      '  font-size:var(--kt-ai-text-2xs);font-weight:var(--kt-ai-weight-bold);display:flex;align-items:center;justify-content:center}',
      '.ktfb-item .body{min-width:0;flex:1}',
      '.ktfb-item .tgt{font-size:var(--kt-ai-text-2xs);color:var(--kt-ai-fg-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ktfb-item .txt{font-size:var(--kt-ai-text-xs);color:var(--kt-ai-fg);margin-top:2px;white-space:pre-wrap;word-break:break-word}',
      '.ktfb-item .del{flex-shrink:0;background:none;border:none;color:var(--kt-ai-fg-faint);cursor:pointer;font-size:14px;line-height:1;padding:2px}',
      '.ktfb-item .del:hover{color:var(--kt-ai-danger)}',
      '.ktfb-empty{padding:var(--kt-ai-space-7);text-align:center;color:var(--kt-ai-fg-muted);font-size:var(--kt-ai-text-xs)}',
      '.ktfb-foot{display:flex;gap:var(--kt-ai-space-4);padding:var(--kt-ai-space-5);border-top:1px solid var(--kt-ai-divider)}',
      '.ktfb-foot button{flex:1}',
      '.ktfb-pop{position:fixed;z-index:66;width:260px;background:var(--kt-ai-bg-elevated);border:1px solid var(--kt-ai-border);',
      '  border-radius:var(--kt-ai-radius-2xl);box-shadow:var(--kt-ai-shadow-lg);padding:var(--kt-ai-space-5)}',
      '.ktfb-pop[hidden]{display:none}',
      '.ktfb-pop .tgt{font-size:var(--kt-ai-text-2xs);color:var(--kt-ai-fg-faint);margin-bottom:var(--kt-ai-space-3);',
      '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ktfb-pop textarea{width:100%;min-height:64px;resize:vertical;font-family:var(--kt-ai-font-sans);font-size:var(--kt-ai-text-sm);',
      '  color:var(--kt-ai-fg);background:var(--kt-ai-bg);border:1px solid var(--kt-ai-border);border-radius:var(--kt-ai-radius-xl);',
      '  padding:var(--kt-ai-space-4)}',
      '.ktfb-pop textarea:focus{outline:none;border-color:var(--kt-ai-primary);box-shadow:var(--kt-ai-focus-shadow)}',
      '.ktfb-pop .row{display:flex;gap:var(--kt-ai-space-4);margin-top:var(--kt-ai-space-4)}',
      '.ktfb-pop .row button{flex:1}',
      // если в прототипе нет компонентов ДС — минимальный фолбэк для наших кнопок
      '.ktfb-ui .ktfb-btn{height:var(--kt-ai-control-h-md);padding:0 var(--kt-ai-space-5);border-radius:var(--kt-ai-radius-xl);',
      '  font-size:var(--kt-ai-text-sm);font-family:var(--kt-ai-font-sans);cursor:pointer;border:1px solid var(--kt-ai-border-strong);',
      '  background:var(--kt-ai-bg-elevated);color:var(--kt-ai-fg)}',
      '.ktfb-ui .ktfb-btn[data-primary]{background:var(--kt-ai-primary);color:var(--kt-ai-fg-on-fill);border-color:var(--kt-ai-primary);',
      '  font-weight:var(--kt-ai-weight-semibold)}',
      '.ktfb-ui .ktfb-btn:disabled{opacity:.4;cursor:default}',
      '@media print{.ktfb-ui{display:none!important}}'
    ].join('\n');
    var s = document.createElement('style');
    s.id = 'ktfb-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------- хранилище ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(comments)); } catch {}
  }

  // ---------- надёжный селектор элемента ----------
  function selectorFor(el) {
    if (!el || el === document.body) return 'body';
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 6) {
      var tag = el.tagName.toLowerCase();
      var p = el.parentNode;
      if (p) {
        var sib = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
        if (sib.length > 1) tag += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')';
      }
      parts.unshift(tag);
      el = p;
    }
    return parts.join(' > ');
  }
  function labelFor(el) {
    var t = (el.getAttribute && el.getAttribute('aria-label')) || el.textContent || el.tagName.toLowerCase();
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : (t || el.tagName.toLowerCase());
  }

  // ---------- UI ----------
  var fab, panel, list, layer, pop, popState = null;

  var triggers = [];
  function build() {
    fab = el('button', 'ktfb-ui ktfb-fab', { type: 'button', 'aria-label': 'Режим обратной связи' });
    fab.innerHTML = '<span class="dot"></span><span class="lbl">Отзыв</span> <span class="cnt"></span>';
    fab.addEventListener('click', toggleMode);

    panel = el('div', 'ktfb-ui ktfb-panel', { hidden: '' });
    panel.innerHTML =
      '<div class="ktfb-head"><span class="t">Отзыв по прототипу</span>' +
      '<span class="sp"></span>' +
      '<button class="ktfb-btn" data-act="hide" type="button" style="height:auto;padding:4px 10px">Скрыть</button></div>' +
      '<div class="ktfb-list"></div>' +
      '<div class="ktfb-foot">' +
      '<button class="ktfb-btn" data-act="clear" type="button">Очистить</button>' +
      '<button class="ktfb-btn" data-primary data-act="export" type="button">Экспорт в markdown</button></div>';
    list = panel.querySelector('.ktfb-list');
    panel.addEventListener('click', onPanelClick);

    layer = el('div', 'ktfb-ui ktfb-layer');

    pop = el('div', 'ktfb-ui ktfb-pop', { hidden: '' });
    pop.innerHTML =
      '<div class="tgt"></div><textarea placeholder="Что не так / что улучшить?"></textarea>' +
      '<div class="row"><button class="ktfb-btn" data-act="cancel" type="button">Отмена</button>' +
      '<button class="ktfb-btn" data-primary data-act="add" type="button">Добавить</button></div>';
    pop.addEventListener('click', onPopClick);

    document.body.appendChild(layer);
    document.body.appendChild(panel);
    document.body.appendChild(pop);
    document.body.appendChild(fab);

    // Внешний триггер (напр. в нижней части сайдбара): прячем плавающий fab, навешиваем toggle.
    triggers = Array.prototype.slice.call(document.querySelectorAll('[data-kt-feedback-trigger]'));
    if (triggers.length) {
      fab.style.display = 'none';
      triggers.forEach(function (t) {
        t.classList.add('ktfb-ui');
        t.addEventListener('click', function (e) { e.preventDefault(); toggleMode(); });
      });
    }
    window.ktFeedback = { toggle: toggleMode, isActive: function () { return active; } };

    window.addEventListener('scroll', positionPins, true);
    window.addEventListener('resize', positionPins);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closePop(); if (active) toggleMode(); } });

    renderAll();
  }

  function el(tag, cls, attrs) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // ---------- режим выбора ----------
  function toggleMode() {
    active = !active;
    fab.setAttribute('data-on', active);
    var ktfbLbl = active ? 'Готово' : 'Отзыв';
    fab.querySelector('.lbl').textContent = ktfbLbl;
    triggers.forEach(function (t) { t.setAttribute('data-on', active); var l = t.querySelector('[data-ktfb-label]'); if (l) l.textContent = ktfbLbl; });
    document.body.classList.toggle('ktfb-pick', active);
    if (active) {
      visible = true; panel.hidden = false; renderPanel();
      document.addEventListener('mouseover', onHover, true);
      document.addEventListener('mouseout', onHoverOut, true);
      document.addEventListener('click', onPick, true);
    } else {
      closePop();
      document.removeEventListener('mouseover', onHover, true);
      document.removeEventListener('mouseout', onHoverOut, true);
      document.removeEventListener('click', onPick, true);
      clearHighlight();
    }
  }

  var hl = null;
  function isOurs(t) { return t && t.closest && t.closest('.ktfb-ui, [data-kt-feedback-trigger]'); }
  function onHover(e) { if (isOurs(e.target)) return; clearHighlight(); hl = e.target; hl.classList.add('ktfb-hl'); }
  function onHoverOut() { clearHighlight(); }
  function clearHighlight() { if (hl) { hl.classList.remove('ktfb-hl'); hl = null; } }

  function onPick(e) {
    if (isOurs(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    var t = e.target;
    clearHighlight();
    openPop(t, e.clientX, e.clientY);
  }

  function openPop(target, x, y) {
    popState = { selector: selectorFor(target), label: labelFor(target), x: x, y: y };
    pop.querySelector('.tgt').textContent = '▸ ' + popState.label;
    var ta = pop.querySelector('textarea'); ta.value = '';
    pop.hidden = false;
    var px = Math.min(x, window.innerWidth - 280);
    var py = Math.min(y + 8, window.innerHeight - 180);
    pop.style.left = Math.max(8, px) + 'px';
    pop.style.top = Math.max(8, py) + 'px';
    ta.focus();
  }
  function closePop() { pop.hidden = true; popState = null; }

  function onPopClick(e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'cancel') return closePop();
    if (act === 'add') {
      var txt = pop.querySelector('textarea').value.trim();
      if (!txt) return;
      comments.push({ n: ++seq, selector: popState.selector, label: popState.label, text: txt });
      save(); closePop(); renderAll();
    }
  }

  // ---------- рендер ----------
  function renderAll() { renderPanel(); renderPins(); updateCount(); }
  function updateCount() { fab.querySelector('.cnt').textContent = comments.length ? comments.length : ''; }

  function renderPanel() {
    list.innerHTML = '';
    if (!comments.length) {
      var em = el('div', 'ktfb-empty');
      em.textContent = active
        ? 'Кликните по любому элементу экрана и опишите, что поправить.'
        : 'Нажмите «Отзыв», затем кликайте по элементам и оставляйте заметки.';
      list.appendChild(em);
      return;
    }
    comments.forEach(function (c) {
      var it = el('div', 'ktfb-item');
      it.innerHTML =
        '<div class="n">' + c.n + '</div>' +
        '<div class="body"><div class="tgt">▸ ' + esc(c.label) + '</div><div class="txt">' + esc(c.text) + '</div></div>' +
        '<button class="del" data-del="' + c.n + '" type="button" aria-label="Удалить">×</button>';
      list.appendChild(it);
    });
  }

  function renderPins() {
    layer.innerHTML = '';
    if (!visible) return;
    comments.forEach(function (c) {
      var pin = el('div', 'ktfb-ui ktfb-pin', { 'data-pin': c.n });
      pin.textContent = c.n;
      pin.title = c.text;
      pin.addEventListener('click', function () { panel.hidden = false; });
      layer.appendChild(pin);
      c._pin = pin;
    });
    positionPins();
  }
  function positionPins() {
    comments.forEach(function (c) {
      if (!c._pin) return;
      var t = safeQuery(c.selector);
      if (!t) { c._pin.style.display = 'none'; return; }
      var r = t.getBoundingClientRect();
      c._pin.style.display = '';
      c._pin.style.left = Math.round(r.left + Math.min(r.width - 6, 10)) + 'px';
      c._pin.style.top = Math.round(r.top + 10) + 'px';
    });
  }
  function safeQuery(sel) { try { return document.querySelector(sel); } catch { return null; } }

  function onPanelClick(e) {
    var del = e.target.getAttribute('data-del');
    var act = e.target.getAttribute('data-act');
    if (del) {
      comments = comments.filter(function (c) { return String(c.n) !== del; });
      save(); renderAll();
    } else if (act === 'hide') {
      panel.hidden = true;
    } else if (act === 'clear') {
      if (comments.length && confirm('Удалить все ' + comments.length + ' заметок?')) { comments = []; save(); renderAll(); }
    } else if (act === 'export') {
      exportMd();
    }
  }

  // ---------- экспорт ----------
  function productName() {
    try {
      var cfg = JSON.parse(document.getElementById('kt-app-config').textContent);
      return (cfg.product && cfg.product.name) || document.title;
    } catch { return document.title || 'Прототип'; }
  }
  function exportMd() {
    if (!comments.length) return;
    var lines = ['# Отзыв по прототипу: ' + productName(), '', '_' + comments.length + ' заметок · ' + location.pathname + '_', ''];
    comments.forEach(function (c) {
      lines.push(c.n + '. **' + c.label + '**');
      lines.push('   ' + c.text.replace(/\n/g, '\n   '));
      lines.push('   `' + c.selector + '`');
      lines.push('');
    });
    var md = lines.join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(md).catch(function () {});
    var blob = new Blob([md], { type: 'text/markdown' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'feedback-' + location.pathname.replace(/\W+/g, '-').replace(/^-|-$/g, '') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }

  // ---------- init ----------
  function init() { injectStyles(); build(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
