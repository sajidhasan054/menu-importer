// Builds the static site into _site/: the web app plus the libraries and
// OCR language files it needs, so the hosted tool depends on no other server.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const out = "_site";
const modules = "node_modules";
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
cpSync("web", out, { recursive: true, filter: src => !src.includes(join("web", "test")) });
cpSync("examples", join(out, "examples"), { recursive: true });

const copy = (from, to) => {
  mkdirSync(join(out, to, ".."), { recursive: true });
  cpSync(join(modules, from), join(out, to), { recursive: true });
};
copy("tesseract.js/dist/tesseract.min.js", "vendor/tesseract/tesseract.min.js");
copy("tesseract.js/dist/worker.min.js", "vendor/tesseract/worker.min.js");
mkdirSync(join(out, "vendor/tesseract-core"), { recursive: true });
for (const file of readdirSync(join(modules, "tesseract.js-core"))) {
  if (file.endsWith(".wasm.js")) copy(`tesseract.js-core/${file}`, `vendor/tesseract-core/${file}`);
}
copy("pdfjs-dist/build/pdf.min.mjs", "vendor/pdfjs/pdf.min.mjs");
copy("pdfjs-dist/build/pdf.worker.min.mjs", "vendor/pdfjs/pdf.worker.min.mjs");
copy("pdfjs-dist/cmaps", "vendor/pdfjs/cmaps");
copy("pdfjs-dist/standard_fonts", "vendor/pdfjs/standard_fonts");
copy("xlsx/dist/xlsx.full.min.js", "vendor/xlsx.full.min.js");
copy("papaparse/papaparse.min.js", "vendor/papaparse.min.js");

const languages = JSON.parse(readFileSync("web/languages.json", "utf8"));
let missing = 0;
for (const [code] of languages) {
  const file = `@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`;
  if (!existsSync(join(modules, file))) { console.warn(`missing OCR language ${code}`); missing++; continue; }
  copy(file, `lang/${code}.traineddata.gz`);
}
// Orientation and script detection (used to straighten photos and pick languages).
copy("@tesseract.js-data/osd/4.0.0/osd.traineddata.gz", "lang/legacy/osd.traineddata.gz");
console.log(`Built ${out}/ with ${languages.length - missing} OCR languages.`);
