/**
 * B10 verification: D-038 gate matrix, disclosure-index completeness (MP-48),
 * visibility subset (04 §4), statement validation (A-10), CSV shape.
 * Run: npm test (tsx --test src/**\/*.test.ts)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_GATE_REFUSAL,
  REPORT_GATE_CODE,
  applyDepartmentVisibility,
  applyShowGapFlags,
  buildDisclosureIndex,
  indexToCSV,
  reportGateStatus,
  validateReportSettingsInput,
  type IndexSourceRow,
} from './reports.ts';

function itemRow(over: Partial<IndexSourceRow> = {}): IndexSourceRow {
  return {
    disclosureId: 'd1',
    disclosureCode: '2-1',
    disclosureTitle: 'Organizational details',
    standardCode: 'GRI 2',
    standardTitle: 'General Disclosures 2021',
    itemId: 'i1',
    itemCode: '2-1-a',
    departmentId: 'dept-a',
    departmentName: 'HR',
    score: 100,
    notEvaluated: false,
    notApplicable: false,
    naReason: null,
    justification: 'HR registry 2026',
    answerValue: 'HR registry, page 3',
    answerStatus: 'approved',
    ...over,
  };
}

describe('D-038 gate matrix (A-09, MP-47)', () => {
  it('unset settings block export with the unified 409 refusal', () => {
    for (const settings of [null, undefined, {}, { disclosure_level: 'in-accordance' }]) {
      const gate = reportGateStatus(settings as never);
      assert.equal(gate.ok, false);
      if (!gate.ok) {
        assert.equal(gate.code, REPORT_GATE_CODE);
        assert.equal(gate.refusal, REPORT_GATE_REFUSAL);
      }
    }
  });

  it('legacy row missing statement fields still blocks (no default)', () => {
    const gate = reportGateStatus({
      disclosure_level: 'in-accordance',
      report_level: 'L3',
      statement_name: null,
      statement_period: '2026',
    });
    assert.equal(gate.ok, false);
  });

  it('complete settings pass the gate', () => {
    const gate = reportGateStatus({
      disclosure_level: 'with-reference',
      report_level: 'L2',
      statement_name: 'Acme Corp',
      statement_period: '2026-01-01..2026-12-31',
      notified: 'done',
      notified_date: '2026-03-01',
      notify_ref: 'GRI-2026-001',
    });
    assert.equal(gate.ok, true);
  });
});

describe('PUT validation (A-10 statement, A-11 notification)', () => {
  it('requires disclosureLevel + reportLevel + statementName + statementPeriod', () => {
    const bad = validateReportSettingsInput({
      disclosureLevel: 'in-accordance',
      reportLevel: 'L3',
      statementName: 'Acme',
      statementPeriod: '',
    });
    assert.equal(bad.ok, false);
  });

  it('rejects unknown levels', () => {
    assert.equal(
      validateReportSettingsInput({
        disclosureLevel: 'full',
        reportLevel: 'L3',
        statementName: 'Acme',
        statementPeriod: '2026',
      }).ok,
      false
    );
    assert.equal(
      validateReportSettingsInput({
        disclosureLevel: 'in-accordance',
        reportLevel: 'L9',
        statementName: 'Acme',
        statementPeriod: '2026',
      }).ok,
      false
    );
  });

  it('notified fields optional but validated when given', () => {
    const ok = validateReportSettingsInput({
      disclosureLevel: 'in-accordance',
      reportLevel: 'L1',
      statementName: 'Acme',
      statementPeriod: '2026',
    });
    assert.equal(ok.ok, true);
    const badNotified = validateReportSettingsInput({
      disclosureLevel: 'in-accordance',
      reportLevel: 'L1',
      statementName: 'Acme',
      statementPeriod: '2026',
      notified: 'emailed',
    });
    assert.equal(badNotified.ok, false);
    const badDate = validateReportSettingsInput({
      disclosureLevel: 'in-accordance',
      reportLevel: 'L1',
      statementName: 'Acme',
      statementPeriod: '2026',
      notified: 'done',
      notifiedDate: 'not-a-date',
    });
    assert.equal(badDate.ok, false);
  });
});

describe('disclosure index HARD RULE (MP-48, A-13)', () => {
  it('evaluated disclosure builds a non-omitted row with coverage beside score', () => {
    const { rows, offendingCodes } = buildDisclosureIndex([
      itemRow(),
      itemRow({ itemId: 'i2', itemCode: '2-1-b', score: 50, justification: 'partial file', answerValue: 'file B' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].omitted, false);
    assert.equal(rows[0].incomplete, false);
    assert.deepEqual(offendingCodes, []);
    assert.equal(rows[0].evaluatedItems, 2);
    assert.equal(rows[0].applicableItems, 2);
    assert.equal(rows[0].coveragePercentage, 100);
    assert.equal(typeof rows[0].score, 'number');
  });

  it('per-disclosure score uses priority weights (dashboard-traceable)', () => {
    const { rows } = buildDisclosureIndex([
      itemRow({ weight: 3, score: 100 }),
      itemRow({ itemId: 'i2', itemCode: '2-1-b', weight: 2, score: 50, justification: 'partial', answerValue: 'file' }),
    ]);
    // (3*100 + 2*50) / (3+2) = 80 — same weighted rule as the dashboard.
    assert.equal(rows[0].score, 80);
  });

  it('fully N/A disclosure with reason + explanation is omitted (not dropped)', () => {
    const { rows, offendingCodes } = buildDisclosureIndex([
      itemRow({ notApplicable: true, naReason: 'confidentiality-constraints', justification: 'board secret', score: null, answerValue: '' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].omitted, true);
    assert.equal(rows[0].omissionReason, 'confidentiality-constraints');
    assert.equal(rows[0].omissionExplanation, 'board secret');
    assert.equal(rows[0].incomplete, false);
    assert.deepEqual(offendingCodes, []);
  });

  it('N/A evaluation without stored reason → 422 payload names the disclosure', () => {
    const { rows, offendingCodes } = buildDisclosureIndex([
      itemRow({ notApplicable: true, naReason: null, justification: null, score: null, answerValue: '' }),
    ]);
    assert.equal(rows.length, 1); // returned flagged, never silently dropped
    assert.equal(rows[0].incomplete, true);
    assert.deepEqual(offendingCodes, ['2-1']);
  });

  it('tampered omission (reason without explanation) → 422 payload names it', () => {
    const { offendingCodes } = buildDisclosureIndex([
      itemRow({ notApplicable: true, naReason: 'legal-prohibitions', justification: '  ', score: null, answerValue: '' }),
    ]);
    assert.deepEqual(offendingCodes, ['2-1']);
  });

  it('mixed disclosure stays non-omitted; N/A items excluded from coverage math', () => {
    const { rows, offendingCodes } = buildDisclosureIndex([
      itemRow(),
      itemRow({ itemId: 'i9', itemCode: '2-1-c', notApplicable: true, naReason: 'not-applicable', justification: 'no ops abroad', score: null, answerValue: '' }),
    ]);
    assert.equal(rows[0].omitted, false);
    assert.deepEqual(offendingCodes, []);
    assert.equal(rows[0].applicableItems, 1);
    assert.equal(rows[0].evaluatedItems, 1);
  });
});

describe('visibility bounds (04 §4)', () => {
  const rows = [
    { departments: ['HR'], departmentIds: ['dept-a'], score: 80, coveragePercentage: 100 },
    { departments: ['Finance'], departmentIds: ['dept-b'], score: 60, coveragePercentage: 50 },
  ];

  it('employee export is a strict subset of the admin export', () => {
    const admin = applyDepartmentVisibility(rows, 'client_admin', null, null);
    const emp = applyDepartmentVisibility(rows, 'employee', 'dept-a', 'HR');
    assert.equal(admin.length, 2);
    assert.equal(emp.length, 1);
    assert.ok(admin.length > emp.length);
    assert.deepEqual(emp[0].departments, ['HR']);
  });

  it('show_gap=false redacts scores without dropping rows', () => {
    const redacted = applyShowGapFlags(rows, { showGap: false, showCorrective: true });
    assert.equal(redacted.length, 2);
    assert.equal(redacted[0].score, null);
    assert.equal(redacted[0].coveragePercentage, null);
  });
});

describe('structured export shape (MP-50)', () => {
  it('CSV carries reason + explanation columns on every row', () => {
    const { rows } = buildDisclosureIndex([itemRow()]);
    const csv = indexToCSV(rows);
    const lines = csv.split('\n');
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes('omission_reason'));
    assert.ok(lines[0].includes('omission_explanation'));
    assert.ok(lines[1].includes('2-1'));
  });
});
