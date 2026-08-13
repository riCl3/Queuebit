const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const FIXTURES = __dirname;

const wrapText = (font, text, maxWidth, size) => {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
};

async function generateSamplePdf() {
  const text = fs.readFileSync(path.join(FIXTURES, 'sample.txt'), 'utf8');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const size = 12;
  const margin = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const lines = wrapText(font, text, pageWidth - margin * 2, size);

  const maxLinesPerPage = Math.floor((pageHeight - margin * 2) / (size * 1.4));
  for (let start = 0; start < lines.length; start += maxLinesPerPage) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    const chunk = lines.slice(start, start + maxLinesPerPage);
    let y = pageHeight - margin;
    for (const line of chunk) {
      page.drawText(line, { x: margin, y, size, font });
      y -= size * 1.4;
    }
  }

  const bytes = await pdfDoc.save();
  fs.writeFileSync(path.join(FIXTURES, 'sample.pdf'), bytes);
  console.log('Generated sample.pdf', bytes.length, 'bytes');
}

function generateMalformedPdf() {
  const bytes = Buffer.from(
    '%PDF-1.4\nThis is intentionally malformed PDF data. It contains no valid objects, xref table, or trailer. %%%%%%EOF',
    'utf8'
  );
  fs.writeFileSync(path.join(FIXTURES, 'malformed.pdf'), bytes);
  console.log('Generated malformed.pdf', bytes.length, 'bytes');
}

(async () => {
  await generateSamplePdf();
  generateMalformedPdf();
})().catch((err) => {
  console.error('Fixture generation failed:', err);
  process.exit(1);
});