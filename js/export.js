// Builds downloadable files from OCR results.

export function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function baseName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'ocr';
}

export function toJson(item, text) {
  const r = item.result;
  return JSON.stringify({
    file: item.name,
    languages: r.langs,
    imageSize: { width: r.width, height: r.height },
    meanConfidence: r.confidence,
    rotationRadians: r.rotateRadians,
    durationMs: r.ms,
    text,
    words: r.words.map((w) => ({
      text: w.text,
      confidence: w.confidence,
      line: w.lineNo,
      bbox: w.bbox,
    })),
  }, null, 2);
}

export function combinedText(items) {
  return items
    .filter((it) => it.result)
    .map((it) => `===== ${it.name} =====\n\n${it.editedText ?? it.result.text}\n`)
    .join('\n');
}
