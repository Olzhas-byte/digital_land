/**
 * Орб агента — монохромное точечное облако на canvas.
 *
 * ЗАЧЕМ СВОЙ, А НЕ ГОТОВЫЙ. Идея взята у thinking-orbs (MIT, Jakub Antalik &
 * Alex Brinza), но сам пакет не подошёл по устройству: его сборка импортирует
 * React на верхнем уровне, а HTML app-shell работает без React. Поставить его
 * только в кит значило бы развести рантаймы — один и тот же контракт показывал
 * бы разный индикатор, а это ровно тот разрыв паритета, который запрещает
 * гейт G7. Плюс у ДС политика «внешних зависимостей нет»: вендоринг
 * минифицированного бандла положил бы в систему код, который никто в команде
 * не сможет поддерживать.
 *
 * ЦВЕТ. Ни одного значения цвета внутри: точки рисуются currentColor элемента.
 * Значит орб темизуется теми же токенами, что и всё остальное, и работает в
 * обеих темах без единой строки про тему.
 *
 * Подключение:
 *   <canvas class="kt-ai-orb" data-state="thinking" width="16" height="16"></canvas>
 *   ktAiOrb.mountAll();            // или ktAiOrb.mount(canvas)
 *
 * Состояния: idle (медленное дыхание), thinking (вращение), listening (пульс).
 */
(function (global) {
  "use strict";

  /* Состояния различаются ДВИЖЕНИЕМ, а не формой. Раньше здесь был параметр
     spread, сжимавший сферу по вертикали (0.55 у idle) — облако читалось не как
     шар, а как лужа, и на витрине это было видно сразу. Силуэт должен
     оставаться круглым во всех состояниях, меняется только характер движения. */
  var СОСТОЯНИЯ = {
    idle: { speed: 0.14, pulse: 0.10 },       // медленно дышит
    thinking: { speed: 0.85, pulse: 0.03 },   // уверенно вращается
    listening: { speed: 0.30, pulse: 0.30 },  // заметно пульсирует
  };

  /* Два размера — два отдельных рисунка, а не масштаб одного.
     На 22px 44 точки радиусом меньше пикселя сливались в серую кашу: точек
     должно быть меньше, а каждая — крупнее и чётче. */
  var РАЗМЕРЫ = [
    { до: 32, точек: 26, точка: 1.15, радиус: 0.80 },
    { до: 1e9, точек: 92, точка: 1.70, радиус: 0.84 },
  ];

  function пресет(size) {
    for (var i = 0; i < РАЗМЕРЫ.length; i++) if (size <= РАЗМЕРЫ[i].до) return РАЗМЕРЫ[i];
    return РАЗМЕРЫ[РАЗМЕРЫ.length - 1];
  }

  /** Точки, равномерно разложенные по сфере (решётка Фибоначчи).
   *  Случайные точки дают комки — на 40 точках это видно сразу. */
  function точкиСферы(n) {
    var pts = [], φ = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < n; i++) {
      var y = 1 - (i / (n - 1)) * 2;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var θ = φ * i;
      pts.push([Math.cos(θ) * r, y, Math.sin(θ) * r]);
    }
    return pts;
  }

  function mount(canvas) {
    if (!canvas || canvas.__ktOrb) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    var reduce = global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var size = canvas.clientWidth || parseInt(canvas.getAttribute("width"), 10) || 16;
    var ps = пресет(size);
    var pts = точкиСферы(ps.точек);
    var t0 = null, raf = 0;

    function resize() {
      var dpr = global.devicePixelRatio || 1;
      size = canvas.clientWidth || size;
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function кадр(ts) {
      if (t0 === null) t0 = ts;
      var t = (ts - t0) / 1000;
      var st = СОСТОЯНИЯ[canvas.getAttribute("data-state")] || СОСТОЯНИЯ.idle;

      // Цвет — только currentColor: ни одного литерала в файле.
      var ink = global.getComputedStyle(canvas).color;
      var m = ink.match(/\d+/g) || [26, 26, 26];

      ctx.clearRect(0, 0, size, size);
      var c = size / 2;
      var R = c * ps.радиус * (1 + Math.sin(t * 1.6) * st.pulse * 0.14);
      var a = t * st.speed, ca = Math.cos(a), sa = Math.sin(a);
      var tilt = 0.42, ct = Math.cos(tilt), stl = Math.sin(tilt);
      var dot = ps.точка;

      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1], z = pts[i][2];
        var x1 = x * ca - z * sa, z1 = x * sa + z * ca;      // поворот вокруг Y
        var y1 = y * ct - z1 * stl, z2 = y * stl + z1 * ct;  // наклон оси
        // Дальние точки тусклее и мельче — это и создаёт объём.
        var depth = (z2 + 1) / 2;
        ctx.globalAlpha = 0.18 + depth * 0.62;
        ctx.fillStyle = "rgb(" + m[0] + "," + m[1] + "," + m[2] + ")";
        ctx.beginPath();
        ctx.arc(c + x1 * R, c + y1 * R, Math.max(0.6, dot * (0.62 + depth * 0.52)), 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = global.requestAnimationFrame(кадр);
    }

    resize();
    // ПЕРВЫЙ КАДР — СИНХРОННО, до всякого rAF. Браузер не вызывает
    // requestAnimationFrame в фоновой вкладке, и без этой строки орб в неактивном
    // окне не рисовался вообще: не «замирал», а оставался пустым прямоугольником.
    // То же самое даёт корректное поведение при prefers-reduced-motion — статичный
    // кадр вместо пустоты.
    кадр(0);   // следующий кадр ставит себе он сам — второй раз планировать нельзя

    canvas.__ktOrb = {
      stop: function () { global.cancelAnimationFrame(raf); canvas.__ktOrb = null; },
      resize: resize,
      frame: кадр,   // чтобы поведение можно было проверить без rAF
    };
  }

  function mountAll(root) {
    var nodes = (root || global.document).querySelectorAll("canvas.kt-ai-orb");
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  global.ktAiOrb = { mount: mount, mountAll: mountAll };
  if (global.document && global.document.readyState !== "loading") mountAll();
  else if (global.document) global.document.addEventListener("DOMContentLoaded", function () { mountAll(); });
})(typeof window !== "undefined" ? window : this);
