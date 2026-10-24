# MIX-IMAGE Prompt Archive — Design QA

## Reference visual and implementation captures

- Reference character: `C:\Users\mixim\AppData\Local\Temp\codex-clipboard-3337da99-756a-41bb-a925-d0642d21e909.png`
- Previous Meet the JongJang reference: `C:\Users\mixim\AppData\Local\Temp\codex-clipboard-a32722ba-4db2-41a6-96e6-79bd8ab0ea1f.png`
- Desktop implementation capture: `C:\Users\mixim\AppData\Local\Temp\mix-prompt-desktop-qa.png`
- Mobile implementation capture: `C:\Users\mixim\AppData\Local\Temp\mix-prompt-mobile-qa.png`

The implementation was compared in the same unlocked home/category flow at 1440 × 1000 and 390 × 844 CSS pixels. The supplied robot is used as the brand character in the PIN gate, sidebar, profile and hero areas. The visual direction keeps the chat-app reference's soft pastel gradient, rounded glass cards, friendly greeting, clear hierarchy and mobile bottom navigation while preserving the prompt-vault information architecture.

## Functional QA evidence

- PIN `1449`: unlocks the app locally.
- Category selection: selecting `งานเสียง / เพลง` changes the page to the prompt list for that category; it no longer leaves `โน้ตส่วนตัว` as the active page.
- `ทั้งหมด`: clears category, folder, date and quick filters, then returns to the home view.
- Search: searching `นักเรียน` returns matching prompt content.
- Prompt details: opens and closes the detail modal.
- Add prompt: opens and closes the editor modal without saving test data.
- Desktop overflow: `scrollWidth = 1440`, `innerWidth = 1440`.
- Mobile overflow: `scrollWidth = 390`, `innerWidth = 390`.
- Mobile category selection: verified after PIN unlock.
- Browser console/page errors during the mobile interaction run: none.
- Production build: `npm run build` passed; Vite generated `dist/` and `package-deploy.py` generated `dist-deploy.zip`.
- Quick calculator: opens beside the calendar, calculates `12 + 7 = 19`, supports keyboard input, and reports `หารด้วยศูนย์ไม่ได้` for division by zero.
- Calculator is available at both 1440 × 1000 and 390 × 844 CSS pixels.
- Final hero mascot frame: 216 × 216 desktop and 168 × 168 mobile, with the full robot visible and no page overflow.
- Facebook metadata: `og:image` and `twitter:image` point to the new production share image; both `/brand/miximage-prompt-archive-og.png` and `/brand/jongjang-app-icon.png` returned HTTP 200 as PNG assets in local verification.
- Final implementation captures: `C:\Users\mixim\AppData\Local\Temp\mix-prompt-final-desktop.png` and `C:\Users\mixim\AppData\Local\Temp\mix-prompt-final-mobile.png`.
- Move-folder popover: the full menu remains visible above the next card after opening; the folder/category tabs, close control and selecting a folder were exercised at 1440 × 1000 and 390 × 844 CSS pixels.
- Move-folder viewport safety: desktop bounds were `x=377.47..657.47, y=383.45..685`; mobile bounds were `x=28.19..308.19, y=303.97..605.52`, both fully inside the viewport. The open card switches to `content-visibility: visible` so the menu is not clipped by the card's paint containment.
- Move-folder captures: `C:\Users\mixim\AppData\Local\Temp\mix-prompt-move-desktop.png` and `C:\Users\mixim\AppData\Local\Temp\mix-prompt-move-mobile.png`.

## Fix history

- Fixed mobile intrinsic-width overflow in filter, widget and folder-pill rows.
- Fixed category navigation retaining the notes page state.
- Fixed the top `ทั้งหมด` control so its label matches its actual reset behavior.
- Added a functional calculator widget beside the calendar with arithmetic, percentage, sign toggle, clear, keyboard support and division-by-zero feedback.
- Replaced the old app icon/share preview references with the JongJang app icon and generated Facebook/Open Graph image.
- Reduced and centered the hero mascot frame so the character fits the card on desktop and mobile.
- Fixed move-folder popover clipping caused by `content-visibility: auto`; added viewport-safe max height and internal scrolling for long folder/category lists.

## Scope boundary

The local app and production bundle are verified. The public Netlify URL was not overwritten in this run because the authenticated Netlify account exposes only `miximage-one-god`, while `https://miximageprompt.netlify.app/` is not present in the account's site list and this checkout has no `.netlify/state.json` link. Deploying to an unverified site identifier would risk updating the wrong project.

final result: passed
