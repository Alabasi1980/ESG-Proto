// SHIELD-U2DR-01: string-level CSV contract, not a spreadsheet exploit test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { indexToCSV, type DisclosureIndexRow } from './reports.ts';

/** Independent CSV decoder for asserting cell boundaries and lossless escaping.
 * No spreadsheet engine or formula interpretation is involved. */
function cells(csv: string): string[][] {
  const rows: string[][] = [];
  let row = [''], quoted = false;
  for (let i=0;i<csv.length;i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i+1] === '"') { row[row.length-1] += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ',') row.push('');
    else if (!quoted && ch === '\n') { rows.push(row); row = ['']; }
    else row[row.length-1] += ch;
  }
  assert.equal(quoted,false);
  rows.push(row);
  return rows;
}
const row = (over: Partial<DisclosureIndexRow> = {}): DisclosureIndexRow => ({
  standardCode:'GRI 2',standardTitle:'General Disclosures',disclosureCode:'2-1',disclosureTitle:'Organizational details',
  location:'Evidence page 3',locationComplete:true,omitted:false,omissionReason:null,omissionExplanation:null,incomplete:false,
  evaluatedItems:1,applicableItems:2,coveragePercentage:50,score:50,itemsCount:2,departments:['HR'],departmentIds:['dept'],...over,
});
const textFields = [
  ['standardCode',0],['standardTitle',1],['disclosureCode',2],['disclosureTitle',3],['location',4],
  ['omissionReason',6],['omissionExplanation',7],['departments',13],
] as const;

test('CSV literal protection covers every dynamic text column and formula/leading whitespace variants', () => {
  for (const prefix of ['=','+','-','@']) for (const lead of ['', ' ', '\t', '\r', '\n', '\r\n', '\u0000', '\u001b', '\u007f', '\u0085', '\u00a0', '\u2003', '\ufeff', ' \t\r\n\u0001']) {
    const input = `${lead}${prefix}1+1,"literal"\r\nAR العربية`;
    for (const [field,column] of textFields) {
      const value = row({ [field]:field === 'departments' ? [input] : input });
      const jsonBefore = JSON.stringify(value), decoded = cells(indexToCSV([value]));
      assert.equal(decoded.length,2); assert.equal(decoded[1].length,14);
      assert.equal(decoded[1][column],`'${input}`,`${field} must remain one literal text cell`);
      assert.equal(JSON.stringify(value),jsonBefore,'CSV must not mutate the source/JSON');
    }
  }
});

test('CSV leading control characters are literal even without a following formula marker', () => {
  for (const control of ['\u0000','\u0001','\t','\r','\n','\u001f','\u007f','\u0085','\u009f']) {
    const text = `${control}Evidence`;
    assert.equal(cells(indexToCSV([row({ location:text })]))[1][4],`'${text}`);
  }
});

test('CSV benign AR/EN and comma/quote/CR/LF text roundtrip without business-text changes', () => {
  for (const text of ['الاستدامة — القسم البيئي','Evidence EN 2026','  Plain text  ','text =1 +2 -3 @name',
    'English, "quoted"\r\nنص عربي','CR-only\rnext','LF-only\nnext','"=not a leading formula','already \'literal',"'=1+1",'']) {
    const value = row({ location:text,standardTitle:text,omissionExplanation:text,departments:[text] });
    const decoded = cells(indexToCSV([value]));
    for (const column of [1,4,7,13]) assert.equal(decoded[1][column],text);
    assert.equal(decoded.length,2); assert.equal(decoded[1].length,14);
  }
});

test('CSV typed numeric metrics stay numeric cells; numeric-looking text stays protected text', () => {
  const value = row({ evaluatedItems:0,applicableItems:2,coveragePercentage:12.5,score:-50,itemsCount:3,location:'-50' });
  const csv = indexToCSV([value]), decoded = cells(csv)[1];
  assert.deepEqual(decoded.slice(8,13),['0','2','12.5','-50','3']);
  assert.ok(csv.includes(',0,2,12.5,-50,3,'),'numeric metrics are unquoted, without literal prefixes');
  assert.equal(decoded[4],"'-50");
  const hidden = cells(indexToCSV([row({ score:null,location:null,omissionReason:null,omissionExplanation:null })]))[1];
  for (const column of [4,6,7,11]) assert.equal(hidden[column],'');
});
