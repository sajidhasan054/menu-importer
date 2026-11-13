# QA report: reading menu photos

Each test menu is rendered from HTML and turned into a photo-like image (tilt, blur, shadow, grain;
one is sideways, one has many pictures and ornaments). `qa/run.cjs` runs it through the built tool
in Chromium with default settings (English ticked, automatic detection on) and counts the items
whose name and price were found. Names match when they are at least 75% similar.

| Menu | Before | After | Notes (after) |
|---|---|---|---|
| English, dark two-column menu with food pictures | 0/8 | 8/8 | Read as English · certainty 96% |
| French bistro, accents, decimal commas, dot leaders, patterned paper | 0/7 | 7/7 | Read as English + French · looks French · certainty 95% |
| Arabic, right to left, Arabic-Indic digits, riyal prices | 0/7 | 0/7 | Read as Arabic + English · Arabic script found · certainty 79% |
| Arabic menu with Western digits (common in the Gulf) | not tested | 4/6 | Read as Arabic + English · Arabic script found · certainty 90% |
| Spanish tapas with Tapa / Ración price columns | 8/8 | 8/8 | Read as English + Spanish · looks Spanish · certainty 95% |
| German café with umlauts | 0/6 | 6/6 | Read as English + German · looks German · certainty 89% |
| Bangla menu with Bangla digits and taka sign | 0/6 | 6/6 | Read as Bangla + English · Bengali script found · certainty 95% |
| Chinese noodle shop with yuan prices | 0/6 | 2/6 | Read as Chinese (Simplified) + English · Han script found · enlarged small text · certainty 84% |
| English menu photographed sideways, tilted, with a shadow | 0/5 | 4/5 | Read as English · turned 270° · certainty 96% |
| Busy menu: script headings, ornaments and many pictures | 0/6 | 6/6 | Read as English + Italian · looks Italian · certainty 95% |

**Total: 8/59 before, 51/65 after.**

The Arabic-with-Western-digits menu was added after the baseline run.

## Known limits

- **Arabic-Indic digits (١٢٣)** are misread by the free Arabic text model, so prices on such menus
  need typing in. Arabic names and Western-digit prices (12 SAR) read well.
- **Chinese** names are only partly recognised; prices with ¥ are found. Check names by hand.
- Words at the very edge of a tilted photo can lose a letter ("resh Orange Juice").
- With many pictures, **Select areas** around the text gives the cleanest result: on the busy test
  menu it found all 6 items at 96% certainty.
