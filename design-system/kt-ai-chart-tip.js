/**
 * Подсказка значения на диаграмме — один файл на оба рантайма.
 *
 * Зачем это в системе, а не в продукте. Столбец молчал: человек видел форму, но
 * не число, и уходил за ним в таблицу под диаграммой — диаграмма переставала
 * быть ответом и становилась оглавлением. Затыкали это нативным `title`, а он
 * не компонент: появляется через секунду, рисуется средствами ОС (чужой шрифт,
 * ни одного токена, в тёмной теме — вставка из другого продукта), недоступен с
 * клавиатуры, не читается диктором, на планшете не показывается вовсе и умеет
 * ровно одну строку. Собери такую подсказку каждый продукт сам — их станет
 * пять разных.
 *
 * ЧИСЛА СЧИТАЕТ ПРОДУКТ. Скрипт не форматирует и не пересчитывает ничего: он
 * показывает строки, которые пришли готовыми. Разошедшийся формат — это
 * разошедшееся число, а сервер и браузер округляют по-разному.
 *
 * Разметка марки:
 *   <div class="cc-bar" data-kt-tip="14.05.2026: 1 284">…</div>
 *   <div class="cc-bar" data-kt-tip='{"title":"14 мая 2026, четверг",
 *        "rows":[{"label":"Диалогов","value":"1 284"},
 *                {"label":"Доля периода","value":"3,9%"}]}'>…</div>
 *
 * Слушателей ровно три, на document, — не по одному на марку. Диаграмма
 * перерисовывается на каждую смену фильтра и периода (31 столбец на обзоре,
 * 168 клеток на карте нагрузки), и подсказка обязана пережить перерисовку без
 * повторной инициализации со стороны продукта.
 */
(function () {
  "use strict";
  if (typeof document === "undefined" || window.ktAiChartTip) return;

  var МЕТКА = "[data-kt-tip]";
  var узел = null;      // единственный элемент подсказки на страницу
  var текущая = null;   // марка, к которой она привязана

  function создать() {
    if (узел) return узел;
    узел = document.createElement("div");
    узел.className = "kt-ai-chart-tip";
    узел.setAttribute("role", "tooltip");
    узел.id = "kt-ai-chart-tip";
    узел.hidden = true;
    document.body.appendChild(узел);
    return узел;
  }

  function текстом(строка) {
    var el = document.createElement("div");
    el.className = "tip-title";
    el.textContent = строка;
    return [el];
  }

  /** Разбирает data-kt-tip: JSON-объект или простая строка. */
  function содержимое(марка) {
    var сырое = марка.getAttribute("data-kt-tip") || "";
    if (сырое.charAt(0) !== "{") return текстом(сырое);
    var данные;
    try {
      данные = JSON.parse(сырое);
    } catch {
      return текстом(сырое); // битый JSON показываем как есть, а не роняем экран
    }
    var части = [];
    if (данные.title) {
      var t = document.createElement("div");
      t.className = "tip-title";
      t.textContent = данные.title;
      части.push(t);
    }
    var строки = Array.isArray(данные.rows) ? данные.rows.slice(0, 3) : [];
    if (строки.length) {
      var таблица = document.createElement("dl");
      таблица.className = "tip-rows";
      строки.forEach(function (r) {
        var dt = document.createElement("dt");
        dt.textContent = r && r.label != null ? String(r.label) : "";
        var dd = document.createElement("dd");
        dd.textContent = r && r.value != null ? String(r.value) : "";
        таблица.appendChild(dt);
        таблица.appendChild(dd);
      });
      части.push(таблица);
    }
    return части.length ? части : текстом(сырое);
  }

  /**
   * Ставит подсказку над маркой и разворачивает внутрь у края.
   * Привязка к МАРКЕ, а не к курсору: иначе подсказка дрожит вместе с мышью и
   * читать её на ходу нельзя.
   */
  function поставить(марка) {
    var m = марка.getBoundingClientRect();
    var t = узел.getBoundingClientRect();
    var поля = 8;
    var x = m.left + m.width / 2 - t.width / 2;
    x = Math.max(поля, Math.min(x, window.innerWidth - t.width - поля));
    var сверху = m.top - t.height - 8;
    var снизу = m.bottom + 8;
    // Не хватило места сверху (самый высокий столбец) — уходим под марку.
    var y = сверху >= поля ? сверху : снизу;
    узел.dataset.side = сверху >= поля ? "top" : "bottom";
    узел.style.left = Math.round(x + window.scrollX) + "px";
    узел.style.top = Math.round(y + window.scrollY) + "px";
  }

  function показать(марка) {
    if (!марка || марка === текущая) return;
    скрыть();
    создать();
    узел.replaceChildren.apply(узел, содержимое(марка));
    узел.hidden = false;
    текущая = марка;
    марка.setAttribute("data-kt-tip-open", "true");
    марка.setAttribute("aria-describedby", узел.id);
    поставить(марка);
  }

  function скрыть() {
    if (!текущая) return;
    текущая.removeAttribute("data-kt-tip-open");
    текущая.removeAttribute("aria-describedby");
    текущая = null;
    if (узел) узел.hidden = true;
  }

  function марка(цель) {
    return цель && цель.closest ? цель.closest(МЕТКА) : null;
  }

  document.addEventListener("pointerover", function (e) {
    // На тач-устройстве pointerover приходит вместе с нажатием — там показом
    // управляет pointerdown ниже, иначе подсказка мигнёт и исчезнет.
    if (e.pointerType === "touch") return;
    var м = марка(e.target);
    if (м) показать(м); else скрыть();
  });

  document.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    var м = марка(e.target);
    if (м) показать(м); else скрыть();
  });

  document.addEventListener("focusin", function (e) {
    var м = марка(e.target);
    if (м) показать(м); else скрыть();
  });
  document.addEventListener("focusout", function (e) {
    if (марка(e.target)) скрыть();
  });

  // Esc убирает подсказку, НЕ снимая фокус: человек продолжает идти по маркам
  // с клавиатуры, просто перестал смотреть на числа.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && текущая) {
      e.stopPropagation();
      скрыть();
    }
  });

  // Прокрутка и смена размера сдвигают марку — подсказка обязана уехать с ней.
  window.addEventListener("scroll", function () { if (текущая) поставить(текущая); }, true);
  window.addEventListener("resize", скрыть);

  window.ktAiChartTip = { show: показать, hide: скрыть };
})();
