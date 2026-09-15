#!/usr/bin/env python3
"""
Валидатор продуктового контракта KT AI (seed для kt-ai-lint).

Проверяет конфиг прототипа против product.schema.json (структура) И против правил
дизайн-системы (честность): целостность статусов, один primary, запрет ROI/FTE на
операционном дашборде, debug-язык в копирайте. Тот же контракт выдаёт Төре,
потребляет kt-ai-app-shell.html, читает handoff. ОДИН источник истины.

Запуск:
  python3 scripts/validate_product.py examples/dogovor-arendy.config.json
  python3 scripts/validate_product.py <config.json> --strict   # warnings → ошибка

Без внешних зависимостей (stdlib). Код выхода: 0 – ок, 1 – ошибки (или warn при --strict).
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ERRORS, WARNINGS, NOTES = [], [], []
def err(msg): ERRORS.append(msg)
def warn(msg): WARNINGS.append(msg)
# Заметка — не претензия к конфигу, а факт о системе, который лучше узнать до
# сборки («этот архетип есть только в одном рантайме»). Считать её нарушением
# честности нельзя: под --strict предупреждения блокируют, и корректный конфиг
# падал бы из-за справки. Гейт от заметок не краснеет никогда.
def note(msg): NOTES.append(msg)

_SPRITE_IDS = None
def sprite_ids():
    """id-набор иконок из канонического спрайта (для проверки nav/onboarding icon)."""
    global _SPRITE_IDS
    if _SPRITE_IDS is None:
        try:
            with open(os.path.join(ROOT, "icons", "kt-ai-lucide-sprite.svg"), encoding="utf-8") as fh:
                _SPRITE_IDS = set(re.findall(r'symbol id="([^"]+)"', fh.read()))
        except OSError:
            _SPRITE_IDS = set()
    return _SPRITE_IDS


# ---------- мини-валидатор JSON Schema (подмножество, что используем) ----------
def validate_schema(node, schema, path="$"):
    t = schema.get("type")
    if t == "object" and not isinstance(node, dict):
        return err(f"{path}: ожидался object, получено {type(node).__name__}")
    if t == "array" and not isinstance(node, list):
        return err(f"{path}: ожидался array, получено {type(node).__name__}")
    if t == "string" and not isinstance(node, str):
        return err(f"{path}: ожидалась string")
    if t == "integer" and not isinstance(node, int):
        return err(f"{path}: ожидалось integer")
    if t == "boolean" and not isinstance(node, bool):
        return err(f"{path}: ожидался boolean")

    if "enum" in schema and node not in schema["enum"]:
        err(f"{path}: значение {node!r} не из {schema['enum']}")
    if isinstance(node, str):
        if "maxLength" in schema and len(node) > schema["maxLength"]:
            warn(f"{path}: длина {len(node)} > maxLength {schema['maxLength']} (\"{node[:40]}…\")")
        if "minLength" in schema and len(node) < schema["minLength"]:
            err(f"{path}: пустое значение (minLength {schema['minLength']})")
        if "pattern" in schema and not re.match(schema["pattern"], node):
            err(f"{path}: {node!r} не соответствует pattern {schema['pattern']}")

    if isinstance(node, dict):
        for r in schema.get("required", []):
            if r not in node:
                err(f"{path}: отсутствует обязательное поле «{r}»")
        props = schema.get("properties", {})
        if "minProperties" in schema and len(node) < schema["minProperties"]:
            err(f"{path}: нужно ≥{schema['minProperties']} ключей")
        ap = schema.get("additionalProperties", True)
        for k, v in node.items():
            if k in props:
                validate_schema(v, props[k], f"{path}.{k}")
            elif ap is False:
                err(f"{path}: лишнее поле «{k}» (additionalProperties=false)")
            elif isinstance(ap, dict):
                validate_schema(v, ap, f"{path}.{k}")

    if isinstance(node, list):
        if "minItems" in schema and len(node) < schema["minItems"]:
            err(f"{path}: нужно ≥{schema['minItems']} элементов")
        item_schema = schema.get("items")
        if item_schema:
            for i, it in enumerate(node):
                validate_schema(it, item_schema, f"{path}[{i}]")


# ---------- правила дизайн-системы (kt-ai-lint) ----------
FORBIDDEN_METRIC = re.compile(r"\b(roi|fte)\b|эконом|эффект|окупаем|time\s*saved|человеко-час", re.I)
DEBUG_LANG = re.compile(r"модель вернула|не проходит дизайн|\bfallback\b|\bshell\b|\bjson\b|\bprompt\b", re.I)
# «проповеднический»/мета-копирайт: дисклеймеры прототипа и нравоучения про human-in-the-loop.
# Продукт показывает решение контролами (рекомендация + кнопки), а НЕ объясняет/оправдывает себя.
PREACHY_LANG = re.compile(
    r"это прототип|прототип на дизайн|данные иллюстративн|контрольная точка|"
    r"(ии|ai) не действует|решение (подтверждает|принимает) человек|решение[ —-]+за вами", re.I)


def load_registry():
    path = os.path.join(ROOT, "archetypes", "registry.json")
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:
        return None


def _present(cfg, block):
    """Блок контракта присутствует и не пуст."""
    v = cfg.get(block)
    if v is None:
        return False
    if isinstance(v, (dict, list, str)):
        return len(v) > 0
    return True


def lint_archetype(cfg):
    """Реестр-управляемая проверка архетипа. Добавление архетипа = запись в registry.json,
    код валидатора не меняется."""
    reg = load_registry()
    if not reg:
        return
    arch_id = cfg.get("archetype") or cfg.get("layout") or reg.get("fallback", "queue")
    by_id = {a["id"]: a for a in reg.get("archetypes", [])}
    fallback = reg.get("fallback", "queue")

    spec = by_id.get(arch_id)
    if spec is None:
        warn(f"archetype: «{arch_id}» нет в реестре archetypes/registry.json — экран деградирует в «{fallback}». "
             f"Известные: {sorted(by_id)}.")
        spec = by_id.get(fallback)
        if spec is None:
            return
    elif spec.get("status") == "planned":
        warn(f"archetype «{arch_id}» ({spec.get('title','')}): рендерер ещё не реализован (status=planned) — "
             f"экран показывается как «{fallback}».")

    for block in spec.get("requires", []):
        if not _present(cfg, block):
            err(f"archetype «{spec['id']}» требует блок «{block}» — он отсутствует или пуст.")
    for block in spec.get("forbids", []):
        if _present(cfg, block):
            err(f"archetype «{spec['id']}» запрещает блок «{block}».")
    for block in spec.get("recommends", []):
        if not _present(cfg, block):
            warn(f"archetype «{spec['id']}» рекомендует блок «{block}» — без него экран беднее.")

    if spec.get("id") == "compare" and not (cfg.get("compare", {}) or {}).get("pairs"):
        warn("archetype compare: нет compare.pairs — нечего сверять, экран деградирует в queue.")


def lint_kpi_labels(cfg):
    """Подпись KPI начинается с прописной (Michelle v4.0: капитализация не пляшет)."""
    import re as _re
    for i, k in enumerate(cfg.get("kpis") or []):
        lbl = (k or {}).get("label") or ""
        if lbl and _re.match(r"^[а-яё]", lbl):
            warn(f"kpis[{i}].label: подпись начинается со строчной («{lbl[:30]}») — начните с прописной.")


def lint_deprecated(cfg):
    """Устаревшие поля: рендерятся для старых конфигов, в новых не использовать."""
    if cfg.get("filterKeys"):
        warn("filterKeys: устаревшее поле — фильтры выводятся из statuses автоматически; уберите из новых конфигов.")
    for i, n in enumerate(cfg.get("nav") or []):
        if isinstance(n, dict) and "count" in n:
            warn(f"nav[{i}].count: устаревшее поле — счётчики в меню не входят в контракт; уберите из новых конфигов.")


def lint_nav_groups(cfg):
    """Группы разделов: заголовок собирает пункты, идущие ПОДРЯД.

    Одинаковое значение group у пунктов, разнесённых по списку, рисует два
    одинаковых заголовка — читатель видит две группы с одним именем и решает,
    что это разные вещи. Рантайм здесь честен: он ставит заголовок там, где
    группа сменилась, и склеивать разорванный список за продукт не будет —
    порядок разделов принадлежит продукту.
    """
    nav = [n for n in (cfg.get("nav") or []) if isinstance(n, dict)]
    видел, предыдущая = set(), None
    for i, n in enumerate(nav):
        g = n.get("group")
        if g and g != предыдущая and g in видел:
            warn(f"nav[{i}].group «{g}»: пункты этой группы идут не подряд — "
                 "заголовок нарисуется дважды. Соберите их рядом.")
        if g:
            видел.add(g)
        предыдущая = g

    # Порог Миллера: списком без устройства читается всё, что длиннее 7 строк.
    if len(nav) > 7 and not any(n.get("group") for n in nav):
        warn(f"nav: {len(nav)} пунктов подряд без групп — такой список читается как "
             "перечень ссылок, а не как устройство продукта. Поле nav[].group "
             "собирает пункты под общими заголовками (нумерация не меняется).")


def lint_banner_length(cfg):
    """Баннер — предупреждение, а не место для оговорок и выводов.

    Баннер стоит НАД числами: всё, что в него уходит, человек читает до первого
    числа. Продукты складывали туда оговорки к показателям (места у числа не
    было) — на одном экране это дало 716 знаков сплошного текста перед данными.
    Теперь места есть: оговорка о числе — kpis[].note, вывод раздела —
    conclusion. Порог 200 знаков — примерно три строки на широком экране.
    """
    text = ((cfg.get("banner") or {}).get("text") or "").strip()
    if len(text) > 200:
        warn(f"banner.text: {len(text)} знаков — это абзац до первого числа. "
             "Оговорка к показателю живёт в kpis[].note (рядом с числом), "
             "вывод раздела — в conclusion (после таблицы); в баннере остаётся "
             "предупреждение о том, из-за чего число соврёт.")


def lint_key_refs(cfg):
    """Ключи данных, которые раньше никто не сверял: колонка и разделы inbox.

    Ключ с опечаткой не ломает экран: колонка просто пустая, письмо просто без
    заголовка. Разбираться в этом продукт идёт глазами по строкам, а машина
    сверяет за секунду. drawer.*, chart.* и columns[].sub уже проверяет
    check_data_contract — здесь только то, чего там не было.
    """
    rows = ((cfg.get("table") or {}).get("rows") or [])
    keys = set()
    for r in rows[:200]:
        if isinstance(r, dict):
            keys |= {k for k in r if not k.startswith("_")}
    if not keys:
        return

    # drawer.fields[].key и columns[].sub уже проверяются ниже, в check_data_contract.
    for i, c in enumerate((cfg.get("table") or {}).get("columns") or []):
        if isinstance(c, dict) and c.get("key") and c["key"] not in keys:
            err(f"table.columns[{i}].key: «{c['key']}» нет в данных ряда — колонка будет пустой.")

    inbox = cfg.get("inbox") or {}
    for поле in ("titleKey", "subKey", "timeKey", "bodyKey"):
        if inbox.get(поле) and inbox[поле] not in keys:
            err(f"inbox.{поле}: «{inbox[поле]}» нет в данных ряда {sorted(keys)}")


def lint_dashboard(cfg):
    """Ряд графика привязывается к метрике по ИНДЕКСУ — индекс обязан существовать."""
    db = cfg.get("dashboard") or {}
    kpis = cfg.get("kpis") or []
    for i, ряд in enumerate(db.get("series") or []):
        if not isinstance(ряд, dict):
            continue
        ki = ряд.get("kpi", i)
        if not isinstance(ki, int) or ki >= len(kpis):
            err(f"dashboard.series[{i}].kpi: индекс {ki} вне диапазона kpis "
                f"(0..{len(kpis) - 1}) — ряд не привяжется к метрике и график не откроется.")
        if len(ряд.get("points") or []) < 2:
            warn(f"dashboard.series[{i}]: меньше двух точек — рантайм такой ряд пропускает.")


def lint_archetype_runtimes(cfg):
    """Архетип может жить не в обоих рантаймах — сказать об этом до сборки."""
    a = cfg.get("archetype") or cfg.get("layout")
    if not a:
        return
    путь = os.path.join(ROOT, "archetypes", "registry.json")
    if not os.path.exists(путь):
        return
    try:
        реестр = {x["id"]: x for x in json.load(open(путь, encoding="utf-8"))["archetypes"]}
    except (KeyError, ValueError):
        return
    спец = реестр.get(a)
    if спец and "kit" not in (спец.get("runtimes") or []):
        note(f"archetype «{a}»: реализован только в HTML-рантайме. В React-ките экран "
             "деградирует (sections → custom, таблица → queue). Для React выберите "
             "архетип с runtimes=kit или стройте экран на компонентах.")


def lint_kpi_semantics(cfg):
    """DS-016 (Töre, 28.08.2026): значение KPI повторяло число, которое подпись отменяет
    («сводка вместо 1,5-2 ч» → значение «1,5 ч»). Значение KPI — всегда НОВОЕ (to-be)
    состояние; старое число живёт в подписи или hint."""
    import re as _re
    def _nums(sv):
        return {n.replace(",", ".") for n in _re.findall(r"\d+(?:[.,]\d+)?", str(sv or ""))}
    for i, k in enumerate(cfg.get("kpis") or []):
        lbl = (k or {}).get("label") or ""
        m = _re.search(r"вместо\s+(.+)$", lbl, _re.I)
        if not m:
            continue
        old = _nums(m.group(1))
        val = _nums((k or {}).get("value"))
        if old and val and val <= old:
            warn(f"kpis[{i}] «{lbl[:40]}»: подпись говорит «вместо {m.group(1).strip()[:20]}», "
                 "а значение повторяет то же число — значение KPI показывает, сколько СТАЛО; "
                 "старое число живёт в подписи или hint.")


def lint_rules(cfg):
    lint_archetype(cfg)
    lint_deprecated(cfg)
    lint_kpi_labels(cfg)
    lint_kpi_semantics(cfg)
    lint_nav_groups(cfg)
    lint_banner_length(cfg)
    lint_key_refs(cfg)
    lint_dashboard(cfg)
    lint_archetype_runtimes(cfg)
    statuses = cfg.get("statuses", {})
    status_keys = set(statuses.keys())
    table = cfg.get("table", {})
    cols = table.get("columns", [])
    col_keys = {c["key"] for c in cols if "key" in c}
    status_cols = [c for c in cols if c.get("type") == "status"]
    # данные ряда (колонки — лишь видимая выборка; drawer/sub могут ссылаться на любое поле ряда)
    row_keys = set()
    for row in table.get("rows", []):
        row_keys.update(k for k in row.keys() if not str(k).startswith("_"))
    data_keys = col_keys | row_keys
    # col.sub должен ссылаться на реальное поле ряда
    for c in cols:
        if c.get("sub") and row_keys and c["sub"] not in data_keys:
            err(f"table.columns «{c.get('key')}».sub: «{c['sub']}» нет в данных ряда {sorted(data_keys)}")

    # tone уже проверен enum'ом в схеме.
    if len(status_cols) > 1:
        warn(f"table: {len(status_cols)} колонок type=status; обычно одна workflow-колонка.")

    # целостность статусов в рядах
    for i, row in enumerate(table.get("rows", [])):
        for sc in status_cols:
            v = row.get(sc["key"])
            if v is not None and v not in status_keys:
                err(f"table.rows[{i}].{sc['key']}: статус «{v}» не объявлен в statuses {sorted(status_keys)}")

    # scenario переходы → существующие статусы
    sc = cfg.get("scenario", {})
    for fld in ("approveTo", "rejectTo"):
        v = sc.get(fld)
        if v and v not in status_keys:
            err(f"scenario.{fld}: «{v}» не объявлен в statuses {sorted(status_keys)}")
    if "scenario" in cfg and not sc.get("control"):
        err("scenario.control: если задан scenario, в нём должно быть одно главное (primary) действие.")

    # drawer ключи → поля ряда (колонки + любые поля строки)
    dr = cfg.get("drawer", {})
    if dr.get("titleKey") and data_keys and dr["titleKey"] not in data_keys:
        err(f"drawer.titleKey: «{dr['titleKey']}» нет в данных ряда {sorted(data_keys)}")
    for j, f in enumerate(dr.get("fields", [])):
        if f.get("key") and data_keys and f["key"] not in data_keys:
            err(f"drawer.fields[{j}].key: «{f['key']}» нет в данных ряда {sorted(data_keys)}")

    # chart ключи → реальные колонки/поля ряда (как column.sub/drawer — единый класс проверок)
    ch = cfg.get("chart", {}) or {}
    if ch.get("dateKey") and data_keys and ch["dateKey"] not in data_keys:
        err(f"chart.dateKey: «{ch['dateKey']}» нет в данных ряда {sorted(data_keys)}")
    if ch.get("groupBy") and data_keys and ch["groupBy"] not in data_keys:
        err(f"chart.groupBy: «{ch['groupBy']}» нет в данных ряда {sorted(data_keys)}")
    if ch.get("bucket") == "day" and not ch.get("dateKey"):
        err("chart.bucket=\"day\": требуется chart.dateKey (колонка-дата для раскатки по дням).")

    # banner.actionNav → существующий индекс nav
    bn = cfg.get("banner", {}) or {}
    nav_len = len(cfg.get("nav", []) or [])
    if bn.get("actionNav") is not None and nav_len and not (0 <= bn["actionNav"] < nav_len):
        err(f"banner.actionNav: индекс {bn['actionNav']} вне диапазона nav (0..{nav_len - 1}).")

    # nav/onboarding иконки → существуют в спрайте (опечатка иначе рендерит пустую иконку)
    ids = sprite_ids()
    if ids:
        for k, n in enumerate(cfg.get("nav", []) or []):
            if n.get("icon") and n["icon"] not in ids:
                warn(f"nav[{k}].icon: «{n['icon']}» нет в спрайте icons/kt-ai-lucide-sprite.svg")
        for k, o in enumerate(cfg.get("onboarding", []) or []):
            if o.get("icon") and o["icon"] not in ids:
                warn(f"onboarding[{k}].icon: «{o['icon']}» нет в спрайте icons/kt-ai-lucide-sprite.svg")

    # запрет project-метрик на операционном дашборде
    view = cfg.get("product", {}).get("view", "operational")
    if view == "operational":
        for k, kpi in enumerate(cfg.get("kpis", [])):
            blob = f"{kpi.get('value','')} {kpi.get('label','')}"
            if FORBIDDEN_METRIC.search(blob):
                warn(f"kpis[{k}] «{kpi.get('label','')}»: похоже на ROI/FTE/экономию — это метрика проекта. "
                     f"Перенесите в product.view=management или замените на рабочее число (очередь, риск, просрочка).")

    # debug-язык + проповеднический/мета-копирайт в пользовательских строках
    for p, s in iter_user_strings(cfg):
        if DEBUG_LANG.search(s):
            warn(f"{p}: служебная формулировка генерации в UI («{s[:50]}…»). "
                 f"Пользователь видит продуктовый язык, не кухню сборки.")
        if PREACHY_LANG.search(s):
            warn(f"{p}: дисклеймер/нравоучение в UI («{s[:50]}…»). "
                 f"Убери — решение показывают контролы (рекомендация + кнопки), а не объяснения про прототип/human-in-the-loop.")

    # объём данных (только если экран вообще табличный)
    if "table" in cfg:
        n = len(table.get("rows", []))
        # дневной time-series график легитимно требует плотности данных → выше потолок
        daily = (cfg.get("chart", {}) or {}).get("bucket") == "day"
        cap = 60 if daily else 16
        if n < 5:
            warn(f"table.rows: {n} строк — таблица оправдана от 5 записей; добавьте правдоподобных данных (8-12).")
        elif n > cap:
            warn(f"table.rows: {n} строк — для прототипа достаточно 8-12" + (" (или ≤60 для дневного графика)." if daily else "."))

    # длина статус-лейблов (до 4 слов) — DoD G1
    for key, st in statuses.items():
        if len(st.get("label", "").split()) > 4:
            warn(f"statuses.{key}.label: > 4 слов; длинное объяснение — в drawer.")

    # DoD G1: заголовки колонок коротко (≤3 слов; деталь — в drawer)
    for c in (table.get("columns", []) if "table" in cfg else []):
        if len(str(c.get("label", "")).split()) > 3:
            warn(f"table.columns «{c.get('key')}».label: > 3 слов; заголовок таблицы — рабочий объект, не описание.")

    # DoD G1: KPI-полоса тихая — 2-4 главные метрики, не стена чисел
    if len(cfg.get("kpis", []) or []) > 4:
        warn(f"kpis: {len(cfg['kpis'])} метрик — полоса KPI отвечает на 2-4 главных вопроса; остальное в drawer/аналитику.")

    # DoD G5 / закон Хика: первичные фильтры = workflow-статусы, ≤4 + «Все»
    if len(statuses) > 5:
        warn(f"statuses: {len(statuses)} статусов — таб-фильтр держит ≤4+«Все»; confidence/risk-type/системы не идут в первичные фильтры (Хик).")


def iter_user_strings(cfg):
    """Пользовательские строки (без ai.fallback — там легитимны слова про прототип)."""
    def walk(node, path):
        if isinstance(node, str):
            yield path, node
        elif isinstance(node, dict):
            for k, v in node.items():
                if path == "$.ai" and k == "fallback":
                    continue
                yield from walk(v, f"{path}.{k}")
        elif isinstance(node, list):
            for i, v in enumerate(node):
                yield from walk(v, f"{path}[{i}]")
    yield from walk(cfg, "$")


# Нравоучение про human-in-the-loop — свой же красный флаг из CHECKLIST G4.
# Решение показывают КОНТРОЛЫ («Согласовать», «Переписать вручную»), а не абзац
# текста: пользователь и так видит кнопку, а абзац читает как недоверие к себе.
#
# Ловим ФРАЗЫ, а не корень «подтвержд». Разница принципиальна: «Тариф подтверждён
# по SAP» и «ждёт подтверждения мастера с фото» — факты о состоянии, они нужны.
# Нравоучение — это утверждение ПОЛИТИКИ («ни один договор не уходит без…»),
# которое ничего не сообщает о конкретной записи.
MORALIZING = re.compile(
    r"(только после [\w\s]{0,20}подтвержд"
    r"|без подтвержд[\w\s]{0,25}не\s"
    r"|ни один[^.]*без подтвержд|ни одна[^.]*без подтвержд"
    r"|подтверждает только"
    r"|агент ничего не (отправляет|делает)"
    r"|не действует сам|решение (за вами|принимаете вы)"
    r"|проверьте факты|это (лишь )?прототип|данные иллюстративны"
    r"|контроль человека|подтверждает человек)", re.I)


def lint_moralizing(cfg):
    for path, val in iter_user_strings(cfg):
        for sent in re.split(r"(?<=[.!?])\s+", val):
            m = MORALIZING.search(sent)
            if m:
                err(f"{path}: нравоучение про human-in-the-loop — «{sent.strip()[:70]}». "
                    f"Решение показывают контролы, а не абзац текста (CHECKLIST G4).")


def check_one(cfg_path, schema, strict):
    """Проверяет один конфиг. Возвращает True, если он ПРОВАЛИЛСЯ."""
    global ERRORS, WARNINGS, NOTES
    ERRORS, WARNINGS, NOTES = [], [], []   # глобальные списки — обнуляем на каждый файл

    try:
        cfg = json.load(open(cfg_path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(f"  ✗ ERROR  {os.path.basename(cfg_path)}: не читается — {e}")
        return True

    validate_schema(cfg, schema)
    lint_moralizing(cfg)
    if not ERRORS:                     # lint только на структурно валидном конфиге
        lint_rules(cfg)

    name = os.path.basename(cfg_path)
    for e in ERRORS:
        print(f"  ✗ ERROR  {e}")
    for n in NOTES:
        print(f"  ℹ ЗАМЕТКА  {n}")
    for w in WARNINGS:
        print(f"  ⚠ WARN   {w}")

    fail = bool(ERRORS) or (strict and WARNINGS)
    status = "FAIL" if fail else ("OK с замечаниями" if WARNINGS else "OK")
    print(f"{name}: {status} — {len(ERRORS)} ошибок, {len(WARNINGS)} предупреждений")
    if WARNINGS and not strict:
        print("  → handoff/CI: прогоните с --strict, чтобы предупреждения честности стали блокирующими.")
    return fail


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    strict = "--strict" in sys.argv
    if not args:
        print("usage: validate_product.py <config.json | 'glob/**/*.config.json'> [--strict]",
              file=sys.stderr)
        return 2

    # Глоб раскрываем САМИ: гейт из доков — "app/**/*.config.json" в кавычках,
    # то есть шелл его не раскрывает, и раньше это падало FileNotFoundError
    # на литеральной строке. Кавычки нужны, иначе шелл подставит только первый файл.
    targets, schema_arg = [], None
    for a in args:
        if any(ch in a for ch in "*?[") or os.path.isdir(a):
            pattern = os.path.join(a, "**", "*.config.json") if os.path.isdir(a) else a
            targets.extend(sorted(glob.glob(pattern, recursive=True)))
        elif a.endswith(".schema.json"):
            schema_arg = a
        else:
            targets.append(a)

    if not targets:
        print(f"Не найдено ни одного конфига по: {' '.join(args)}", file=sys.stderr)
        return 2

    schema_path = schema_arg or os.path.join(ROOT, "product.schema.json")
    schema = json.load(open(schema_path, encoding="utf-8"))

    failed = [t for t in targets if check_one(t, schema, strict)]

    if len(targets) > 1:
        print(f"\nИтого: {len(targets) - len(failed)}/{len(targets)} прошло"
              + (f", упало: {', '.join(os.path.basename(f) for f in failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
