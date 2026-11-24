import { Router } from 'express';
import { marked } from 'marked';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, AlignmentType, BorderStyle, ShadingType, ExternalHyperlink, PageNumber, Footer, Header,
} from 'docx';

const router = Router();

const FONT = 'Calibri';
const MONO = 'Consolas';
const ACCENT = '2F5496';

// Inline tokens -> TextRuns
function runs(tokens, style = {}) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'text':
      case 'escape':
        out.push(new TextRun({ text: t.text, font: FONT, ...style })); break;
      case 'strong': out.push(...runs(t.tokens, { ...style, bold: true })); break;
      case 'em': out.push(...runs(t.tokens, { ...style, italics: true })); break;
      case 'del': out.push(...runs(t.tokens, { ...style, strike: true })); break;
      case 'codespan': out.push(new TextRun({ text: t.text, font: MONO, size: 20, shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' }, ...style })); break;
      case 'br': out.push(new TextRun({ break: 1 })); break;
      case 'link':
        out.push(new ExternalHyperlink({ link: t.href, children: runs(t.tokens, { ...style, color: ACCENT, underline: {} }) })); break;
      case 'image': out.push(new TextRun({ text: t.text || t.href, font: FONT, italics: true, ...style })); break;
      default:
        if (t.tokens) out.push(...runs(t.tokens, style));
        else if (t.text) out.push(new TextRun({ text: t.text, font: FONT, ...style }));
    }
  }
  return out;
}

const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };

// Block tokens -> docx elements
function blocks(tokens, ctx = { listLevel: 0 }) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'heading':
        out.push(new Paragraph({ heading: HEADING[Math.min(t.depth, 4)], children: runs(t.tokens), spacing: { before: 240, after: 120 } }));
        break;
      case 'paragraph':
        out.push(new Paragraph({ children: runs(t.tokens), spacing: { after: 160 } }));
        break;
      case 'blockquote':
        for (const p of blocks(t.tokens, ctx)) { p.root; out.push(p); }
        break;
      case 'code':
        for (const line of t.text.split('\n')) {
          out.push(new Paragraph({
            children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
            shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
            spacing: { after: 0 }, indent: { left: 200 },
          }));
        }
        out.push(new Paragraph({ spacing: { after: 120 } }));
        break;
      case 'list':
        t.items.forEach((item, i) => {
          const inner = item.tokens || [];
          const first = inner[0]?.type === 'text' || inner[0]?.type === 'paragraph' ? inner[0] : null;
          const rest = first ? inner.slice(1) : inner;
          out.push(new Paragraph({
            children: runs(first?.tokens || [{ type: 'text', text: item.text }]),
            ...(t.ordered ? { numbering: { reference: 'numbers', level: ctx.listLevel } } : { bullet: { level: ctx.listLevel } }),
            spacing: { after: 60 },
          }));
          out.push(...blocks(rest, { listLevel: Math.min(ctx.listLevel + 1, 2) }));
        });
        out.push(new Paragraph({ spacing: { after: 60 } }));
        break;
      case 'table': {
        const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
        const borders = { top: border, bottom: border, left: border, right: border };
        const cell = (c, isHead) => new TableCell({
          borders,
          shading: isHead ? { type: ShadingType.CLEAR, fill: 'E7EEF8' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: runs(c.tokens, isHead ? { bold: true } : {}), alignment: c.align === 'right' ? AlignmentType.RIGHT : c.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT })],
        });
        out.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ tableHeader: true, children: t.header.map((c) => cell(c, true)) }),
            ...t.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) })),
          ],
        }));
        out.push(new Paragraph({ spacing: { after: 160 } }));
        break;
      }
      case 'hr':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF' } }, spacing: { after: 160 } }));
        break;
      case 'space':
        break;
      case 'html':
      case 'text':
        out.push(new Paragraph({ children: runs(t.tokens || [{ type: 'text', text: t.text }]), spacing: { after: 160 } }));
        break;
      default:
        if (t.tokens) out.push(...blocks(t.tokens, ctx));
    }
  }
  return out;
}

const safeName = (s) => (String(s || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'report');

// POST /api/export/docx  { title, question, markdown, database?, queries?: [{sql, rowCount}] , model? }
router.post('/docx', async (req, res) => {
  const { title, question, markdown, database, queries, model } = req.body || {};
  if (typeof markdown !== 'string' || !markdown.trim()) return res.status(400).json({ error: 'markdown is required' });

  try {
    const tokens = marked.lexer(markdown);
    const body = blocks(tokens);
    const now = new Date();
    const meta = [database && `Database: ${database}`, model && `Generated by Akanksha AI (${model})`, now.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join('  ·  ');

    const children = [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title || 'Report', font: FONT })], spacing: { after: 80 } }),
      new Paragraph({ children: [new TextRun({ text: meta, font: FONT, size: 18, color: '7F7F7F' })], spacing: { after: 240 } }),
    ];
    if (question) {
      children.push(new Paragraph({ children: [new TextRun({ text: 'Question', font: FONT, bold: true, color: ACCENT })], spacing: { after: 60 } }));
      children.push(new Paragraph({ children: [new TextRun({ text: question, font: FONT, italics: true })], spacing: { after: 240 }, indent: { left: 200 } }));
    }
    children.push(...body);

    if (Array.isArray(queries) && queries.length) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Appendix: queries used', font: FONT })], spacing: { before: 360, after: 120 } }));
      queries.forEach((q, i) => {
        children.push(new Paragraph({ children: [new TextRun({ text: `Query ${i + 1}${q.rowCount != null ? ` (${q.rowCount} rows)` : ''}`, font: FONT, bold: true, size: 20 })], spacing: { before: 120, after: 40 } }));
        for (const line of String(q.sql || '').split('\n')) {
          children.push(new Paragraph({ children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })], shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' }, spacing: { after: 0 }, indent: { left: 200 } }));
        }
      });
    }

    const doc = new Document({
      creator: 'Akanksha AI',
      title: title || 'Report',
      styles: {
        default: { document: { run: { font: FONT, size: 22 } } },
        paragraphStyles: [
          { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 44, bold: true, color: '1F3864', font: FONT } },
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: ACCENT, font: FONT } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: ACCENT, font: FONT } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: '1F3864', font: FONT } },
          { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, italics: true, font: FONT } },
        ],
      },
      numbering: {
        config: [{
          reference: 'numbers',
          levels: [0, 1, 2].map((level) => ({ level, format: 'decimal', text: `%${level + 1}.`, alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })),
        }],
      },
      sections: [{
        properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
        headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'Akanksha Foundation', font: FONT, size: 18, color: '7F7F7F' })], alignment: AlignmentType.RIGHT })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 18, color: '7F7F7F' })], alignment: AlignmentType.CENTER })] }) },
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(title)}.docx"`);
    res.send(buffer);
  } catch (err) {
    console.error('docx export error:', err);
    res.status(500).json({ error: err.message || 'Could not build the document' });
  }
});

export default router;
