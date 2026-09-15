/**
 * Композер чата: slash-команды, пилюли навыков, вложения.
 *
 * Идеи из ai-agent-input (aicss.dev): навык выбирается по «/», становится
 * объектом, а не текстом, и удаляется целиком. Код оттуда не используется —
 * там всё построено на contenteditable, а у нас textarea (см. COMPONENTS.md,
 * «Композер чата»: почему переписывать на contenteditable нельзя).
 *
 * Разметка:
 *   <div class="kt-ai-prompt-bar" data-composer="true"
 *        data-skills='[{"id":"sverka","label":"Сверка","hint":"Сравнить счёт"}]'>
 *     <div class="kt-ai-prompt-skills"></div>
 *     <textarea rows="1" placeholder="Спросите… «/» — навыки"></textarea>
 *     <button class="kt-ai-prompt-send">…</button>
 *   </div>
 *   <script src="kt-ai-composer.js"></script>
 *
 * События: composer:submit (detail = {text, skills, files}).
 */
(function (global) {
  "use strict";

  var doc = global.document;

  function экран(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function mount(bar) {
    if (!bar || bar.__ktComposer) return;
    var ta = bar.querySelector("textarea");
    if (!ta) return;

    var ряд = bar.querySelector(".kt-ai-prompt-skills");
    if (!ряд) {
      ряд = doc.createElement("div");
      ряд.className = "kt-ai-prompt-skills";
      bar.insertBefore(ряд, bar.firstChild);
    }

    var навыки = [];
    try { навыки = JSON.parse(bar.getAttribute("data-skills") || "[]"); } catch (e) { навыки = []; }

    var меню = doc.createElement("div");
    меню.className = "kt-ai-slash-menu";
    меню.setAttribute("role", "listbox");
    меню.hidden = true;
    bar.appendChild(меню);

    var выбранные = [];   // id выбранных навыков
    var активный = 0;     // подсвеченный пункт меню
    var найденные = [];

    function добавить(навык) {
      if (выбранные.indexOf(навык.id) >= 0) return;
      выбранные.push(навык.id);
      var el = doc.createElement("span");
      el.className = "kt-ai-prompt-skill";
      el.setAttribute("data-skill", навык.id);
      el.innerHTML = экран(навык.label) +
        '<button type="button" aria-label="Убрать навык «' + экран(навык.label) + '»">' +
        '<svg class="kt-icon" style="width:10px;height:10px" aria-hidden="true"><use href="#x"></use></svg></button>';
      el.querySelector("button").addEventListener("click", function () { убрать(навык.id); });
      ряд.appendChild(el);
    }

    function убрать(id) {
      выбранные = выбранные.filter(function (x) { return x !== id; });
      var el = ряд.querySelector('[data-skill="' + id + '"]');
      if (el) el.remove();
      ta.focus();
    }

    /** Запрос после «/» непосредственно перед кареткой. null — меню не нужно. */
    function запрос() {
      var до = ta.value.slice(0, ta.selectionStart);
      var m = до.match(/(?:^|\s)\/([^\s/]*)$/);
      return m ? m[1] : null;
    }

    function показать() {
      var q = запрос();
      if (q === null) return скрыть();
      var qq = q.toLowerCase();
      найденные = навыки.filter(function (s) {
        return выбранные.indexOf(s.id) < 0 &&
          (s.label.toLowerCase().indexOf(qq) >= 0 || (s.hint || "").toLowerCase().indexOf(qq) >= 0);
      });
      if (!найденные.length) return скрыть();
      активный = 0;
      отрисовать();
      меню.hidden = false;
      ta.setAttribute("aria-expanded", "true");
    }

    function отрисовать() {
      меню.innerHTML = найденные.map(function (s, i) {
        return '<button type="button" role="option" class="kt-ai-slash-item"' +
          (i === активный ? ' data-active="true" aria-selected="true"' : ' aria-selected="false"') +
          ' data-id="' + экран(s.id) + '">' +
          "<span>" + экран(s.label) + "</span>" +
          (s.hint ? '<span class="kt-ai-meta">' + экран(s.hint) + "</span>" : "") +
          "</button>";
      }).join("");
      [].forEach.call(меню.querySelectorAll(".kt-ai-slash-item"), function (b) {
        b.addEventListener("mousedown", function (e) {
          e.preventDefault();               // не отдаём фокус: каретка нужна на месте
          выбрать(b.getAttribute("data-id"));
        });
      });
    }

    function скрыть() {
      меню.hidden = true;
      ta.setAttribute("aria-expanded", "false");
    }

    function выбрать(id) {
      var навык = навыки.filter(function (s) { return s.id === id; })[0];
      if (!навык) return;
      // Убираем «/запрос» из текста — навык теперь объект, а не строка.
      var p = ta.selectionStart;
      var до = ta.value.slice(0, p).replace(/(?:^|\s)\/[^\s/]*$/, function (m) {
        return m[0] === "/" ? "" : m[0];
      });
      ta.value = до + ta.value.slice(p);
      ta.setSelectionRange(до.length, до.length);
      добавить(навык);
      скрыть();
      ta.focus();
    }

    ta.addEventListener("input", показать);
    ta.addEventListener("click", показать);
    ta.addEventListener("blur", function () { setTimeout(скрыть, 0); });

    ta.addEventListener("keydown", function (e) {
      if (!меню.hidden) {
        if (e.key === "ArrowDown") { e.preventDefault(); активный = (активный + 1) % найденные.length; отрисовать(); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); активный = (активный - 1 + найденные.length) % найденные.length; отрисовать(); return; }
        if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); выбрать(найденные[активный].id); return; }
        if (e.key === "Escape") { e.preventDefault(); скрыть(); return; }
      }
      // Бэкспейс в пустом поле снимает последний навык — он ведёт себя как
      // объект в строке, хотя физически лежит рядом.
      if (e.key === "Backspace" && !ta.value && выбранные.length) {
        e.preventDefault();
        убрать(выбранные[выбранные.length - 1]);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); отправить(); }
    });

    function отправить() {
      var текст = ta.value.trim();
      if (!текст && !выбранные.length) return;
      bar.dispatchEvent(new CustomEvent("composer:submit", {
        bubbles: true,
        detail: { text: текст, skills: выбранные.slice() },
      }));
      ta.value = "";
      выбранные.slice().forEach(убрать);
    }

    var send = bar.querySelector(".kt-ai-prompt-send");
    if (send) send.addEventListener("click", отправить);

    bar.__ktComposer = {
      добавитьНавык: добавить,
      убратьНавык: убрать,
      выбранные: function () { return выбранные.slice(); },
      отправить: отправить,
      меню: меню,
    };
  }

  function mountAll(root) {
    var nodes = (root || doc).querySelectorAll('.kt-ai-prompt-bar[data-composer="true"]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  global.ktAiComposer = { mount: mount, mountAll: mountAll };
  if (doc && doc.readyState !== "loading") mountAll();
  else if (doc) doc.addEventListener("DOMContentLoaded", function () { mountAll(); });
})(typeof window !== "undefined" ? window : this);
