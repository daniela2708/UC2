import { describe, expect, it } from 'vitest';
import { buildXlsx, crc32, parseCell } from './xlsx';

describe('Excel export', () => {
  it('turns displayed values back into typed numbers', () => {
    expect(parseCell('$58,933,695')).toMatchObject({ v: 58933695 });
    expect(parseCell('$4.99')).toMatchObject({ v: 4.99 });
    expect(parseCell('$1.12B')).toMatchObject({ v: 1.12e9 });
    expect(parseCell('−$230,959')).toMatchObject({ v: -230959 });
    expect(parseCell('29.8 %').v).toBeCloseTo(0.298);
    expect(parseCell('▼ −0.6 pts')).toMatchObject({ v: -0.6 });
    expect(parseCell('1,240 lb')).toMatchObject({ v: 1240 });
    expect(parseCell('—')).toMatchObject({ v: null });
    expect(parseCell('Atlantic Salmon Fillet')).toMatchObject({ v: 'Atlantic Salmon Fillet' });
    expect(parseCell(42)).toMatchObject({ v: 42 });
  });

  it('builds a zip with the workbook parts and escapes text', () => {
    const bytes = buildXlsx({ title: 'T <&>', head: ['A', 'B'], rows: [['x"y', '$1,000']] });
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('T &lt;&amp;&gt;');
    expect(text).toContain('x&quot;y');
    expect(text).not.toContain('<&>');
  });

  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
