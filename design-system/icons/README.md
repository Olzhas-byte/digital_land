# KT AI Icons

Design system icon set: Lucide SVG, local sprite build.

Source:

- Official site: `https://lucide.dev`
- Repository: `https://github.com/lucide-icons/lucide`
- Local license copy: `LUCIDE_LICENSE.txt`

License:

- Lucide: ISC.
- Icons derived from Feather: MIT, listed in `LUCIDE_LICENSE.txt`.

Usage rule:

- Use `kt-ai-lucide-sprite.svg` as the default icon source for KT AI products.
- Do not draw icons with CSS pseudo-elements.
- Do not load icon fonts or CDN icon sets for KT AI terminal products.
- Keep icons monochrome, `currentColor`, 16px default, 1.75px stroke.
- Use `sun` and `moon` for theme mode toggles.

HTML:

```html
<svg class="kt-icon" aria-hidden="true">
  <use href="icons/kt-ai-lucide-sprite.svg#home"></use>
</svg>
```

Recommended product-local setup:

1. Copy `kt-ai-lucide-sprite.svg` into the product `assets/` folder as `icons.svg`.
2. Use `<use href="assets/icons.svg#iconName">` in HTML.
3. Keep the design-system source file unchanged so future products inherit the same icon language.


## Как подключать спрайт (важно)

Внешняя ссылка `<use href="icons/kt-ai-lucide-sprite.svg#home">` **не работает**: браузеры
блокируют внешние ссылки в `<use>` из `file://` и по CORS — иконки будут пустыми.

Рабочие способы:
- **HTML-прототипы**: спрайт инлайнится в документ автоматически (`build_tokens.py`,
  функция `embed_appshell_sprite`), затем `<use href="#home">` — ссылка ВНУТРИ документа.
- **React-кит**: используй компонент `<KTIcon name="home" />` (`components/kt-ai/kt-ai-icon.tsx`),
  спрайт лежит в `public/kt-ai/icons.svg`.
- **Свой проект**: вставь содержимое спрайта в начало `<body>` (или отдай компонентом),
  дальше `<use href="#имя">`.
