import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGRIFile } from './griParser';

test('parses CSV disclosure rows with standard, disclosure, and items', () => {
  const csvData = `Standard Code,Standard Title,Category,Disclosure Code,Disclosure Title,Item Code,Requirement,Priority,ESG Class,Weight,Answer Type
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-a,Report its legal name,high,governance,1.0,text
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-b,Report the nature of ownership and legal form,mid,governance,1.0,text
GRI 305,Emissions 2016,Environmental,305-1,Direct (Scope 1) GHG emissions,305-1-a,Gross direct GHG emissions in metric tons,high,environmental,2.0,number
`;

  const result = parseGRIFile(csvData);

  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.totalStandards, 2);
  assert.equal(result.summary.totalDisclosures, 2);
  assert.equal(result.summary.totalItems, 3);

  const gri2 = result.standards.find(s => s.code === 'GRI 2');
  assert.ok(gri2);
  assert.equal(gri2.disclosures.length, 1);
  assert.equal(gri2.disclosures[0].items.length, 2);
  assert.equal(gri2.disclosures[0].items[0].code, '2-1-a');
  assert.equal(gri2.disclosures[0].items[0].priority, 'high');
  assert.equal(gri2.disclosures[0].items[0].esgClass, 'governance');

  const gri305 = result.standards.find(s => s.code === 'GRI 305');
  assert.ok(gri305);
  assert.equal(gri305.disclosures[0].items[0].weight, 2.0);
  assert.equal(gri305.disclosures[0].items[0].answerType, 'number');
});

test('handles empty CSV gracefully', () => {
  const result = parseGRIFile('');
  assert.equal(result.summary.totalStandards, 0);
  assert.equal(result.summary.totalItems, 0);
});
