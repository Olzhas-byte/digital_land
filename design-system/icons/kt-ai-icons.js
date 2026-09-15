// Загрузчик спрайта иконок ДС KT AI (наложение платформы Vibe AI).
// Внешний <use href="sprite.svg#home"> браузеры блокируют, поэтому спрайт вставляется в документ:
//   <script src="design-system/icons/kt-ai-icons.js"></script>
//   <svg class="kt-icon" aria-hidden="true"><use href="#home"></use></svg>
// Путь к спрайту берётся рядом со скриптом; переопределить: data-sprite="/icons.svg".
(function () {
  var s = document.currentScript;
  var url = (s && s.getAttribute("data-sprite")) || (s ? s.src.replace(/[^/]*$/, "kt-ai-lucide-sprite.svg") : "design-system/icons/kt-ai-lucide-sprite.svg");
  function inject(svgText) {
    if (document.getElementById("kt-ai-sprite")) return;
    var box = document.createElement("div");
    box.id = "kt-ai-sprite"; box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    box.innerHTML = svgText;
    (document.body || document.documentElement).insertBefore(box, (document.body || document.documentElement).firstChild);
  }
  var ready = fetch(url, { credentials: "same-origin" }).then(function (r) { if (!r.ok) throw new Error("sprite " + r.status); return r.text(); })
    .then(function (t) { if (document.body) inject(t); else document.addEventListener("DOMContentLoaded", function () { inject(t); }); })
    .catch(function (e) { console.warn("[kt-ai-icons] спрайт не загрузился:", e && e.message); });
  window.KTIcons = { ready: ready, url: url };
})();
