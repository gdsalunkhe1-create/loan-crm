// Turns an ordered array of line strings into synthetic pdfjs-dist
// content-item rows for the pdfjs-dist mock. Each line becomes one row,
// positioned top-to-bottom (descending y, matching real PDF coordinate
// space) so pdfToLines() reconstructs them in the same order they're listed
// here - no need to hand-pick x/y coordinates per fixture.
export function page(lines, { startY = 1000, step = 20, x = 0 } = {}) {
  return lines.map((str, i) => ({ y: startY - i * step, x, str }));
}
