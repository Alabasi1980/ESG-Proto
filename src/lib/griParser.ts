import * as XLSX from 'xlsx';

export interface ParsedGRIItem {
  code: string;
  requirement: string;
  answerType: 'text' | 'number' | 'boolean' | 'date' | 'file';
  hint?: string;
  priority: 'high' | 'mid' | 'low';
  esgClass: 'environmental' | 'social' | 'governance' | 'general';
  weight: number;
  /** Owning department name as written in the workbook (optional column). */
  department?: string;
  /** Objective text (optional column). */
  objective?: string;
  /** Topic/theme text (optional column). */
  topic?: string;
  /** Reference/source text (optional column). */
  reference?: string;
  /**
   * Workbook "% OF GAP" column (col J): REFERENCE-ONLY baseline stored on the
   * item. Never pre-fills an evaluation. NULL when absent/invalid.
   */
  baselineGapPercent?: number | null;
  /** Baseline note (optional column). */
  baselineNote?: string;
  /** Row sort order within the disclosure (optional column). */
  sortOrder?: number | null;
}

export interface ParsedGRIDisclosure {
  code: string;
  title: string;
  description?: string;
  items: ParsedGRIItem[];
}

export interface ParsedGRIStandard {
  code: string;
  title: string;
  category: string;
  version?: string;
  disclosures: ParsedGRIDisclosure[];
}

export interface GRIParseResult {
  standards: ParsedGRIStandard[];
  summary: {
    totalStandards: number;
    totalDisclosures: number;
    totalItems: number;
  };
  warnings: string[];
  errors: string[];
}

/**
 * Normalizes a header name for robust matching across spreadsheets
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function inferESGClass(category: string, standardCode: string, rawClass?: string): 'environmental' | 'social' | 'governance' | 'general' {
  if (rawClass) {
    const rc = rawClass.toLowerCase();
    if (rc.includes('env') || rc.startsWith('e')) return 'environmental';
    if (rc.includes('soc') || rc.startsWith('s')) return 'social';
    if (rc.includes('gov') || rc.startsWith('g')) return 'governance';
    if (rc.includes('gen')) return 'general';
  }

  const cat = (category + ' ' + standardCode).toLowerCase();
  if (cat.includes('30') || cat.includes('env') || cat.includes('climate') || cat.includes('water') || cat.includes('emission') || cat.includes('waste')) {
    return 'environmental';
  }
  if (cat.includes('40') || cat.includes('soc') || cat.includes('labor') || cat.includes('human') || cat.includes('community') || cat.includes('health')) {
    return 'social';
  }
  if (cat.includes('20') || cat.includes('gov') || cat.includes('anticorruption') || cat.includes('tax') || cat.includes('ethics') || cat.includes('procurement')) {
    return 'governance';
  }
  return 'general';
}

function inferPriority(val?: string): 'high' | 'mid' | 'low' {
  if (!val) return 'mid';
  const v = val.toLowerCase().trim();
  if (v.includes('hi') || v === '1' || v === 'critical' || v === 'mandatory') return 'high';
  if (v.includes('low') || v === '3' || v === 'optional') return 'low';
  return 'mid';
}

function inferAnswerType(val?: string): 'text' | 'number' | 'boolean' | 'date' | 'file' {
  if (!val) return 'text';
  const v = val.toLowerCase().trim();
  if (v.includes('num') || v.includes('metric') || v.includes('quantity') || v.includes('float') || v.includes('int')) return 'number';
  if (v.includes('bool') || v.includes('yes') || v.includes('y/n')) return 'boolean';
  if (v.includes('date') || v.includes('year') || v.includes('time')) return 'date';
  if (v.includes('file') || v.includes('doc') || v.includes('upload') || v.includes('evidence')) return 'file';
  return 'text';
}

/**
 * Parses buffer or string containing .xlsx, .xls, or .csv into normalized GRI standards, disclosures and items.
 */
export function parseGRIFile(bufferOrString: Buffer | ArrayBuffer | string): GRIParseResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  let workbook: XLSX.WorkBook;
  try {
    if (typeof bufferOrString === 'string') {
      workbook = XLSX.read(bufferOrString, { type: 'string' });
    } else {
      workbook = XLSX.read(bufferOrString, { type: 'buffer' });
    }
  } catch (err: any) {
    return {
      standards: [],
      summary: { totalStandards: 0, totalDisclosures: 0, totalItems: 0 },
      warnings: [],
      errors: [`Failed to parse file: ${err.message || 'Corrupt spreadsheet or CSV'}`],
    };
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      standards: [],
      summary: { totalStandards: 0, totalDisclosures: 0, totalItems: 0 },
      warnings: [],
      errors: ['Spreadsheet contains no sheets'],
    };
  }

  const sheet = workbook.Sheets[sheetName];
  // Use raw: false and cellText: true to preserve codes like "2-1" without Excel date conversion
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: false,
  });

  if (rawRows.length === 0) {
    return {
      standards: [],
      summary: { totalStandards: 0, totalDisclosures: 0, totalItems: 0 },
      warnings: ['Spreadsheet sheet is empty'],
      errors: [],
    };
  }

  const standardsMap = new Map<string, ParsedGRIStandard>();
  const disclosuresMap = new Map<string, ParsedGRIDisclosure>();

  rawRows.forEach((row, idx) => {
    const rowNum = idx + 2; // spreadsheet 1-indexed header is row 1
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      normalized[normalizeKey(k)] = String(v).trim();
    }

    // Identify standard code
    const standardCode =
      normalized['standardcode'] ||
      normalized['standard'] ||
      normalized['girstandard'] ||
      normalized['gristandard'] ||
      normalized['stdcode'] ||
      '';

    const standardTitle =
      normalized['standardtitle'] ||
      normalized['standardname'] ||
      normalized['stdname'] ||
      standardCode ||
      'Universal Standards';

    const standardCategory =
      normalized['category'] ||
      normalized['standardcategory'] ||
      normalized['pillar'] ||
      'General';

    // Identify disclosure code
    const disclosureCode =
      normalized['disclosurecode'] ||
      normalized['disclosure'] ||
      normalized['gridisclosure'] ||
      normalized['disc'] ||
      '';

    const disclosureTitle =
      normalized['disclosuretitle'] ||
      normalized['disclosurename'] ||
      normalized['disctitle'] ||
      disclosureCode ||
      'General Disclosure';

    const disclosureDesc =
      normalized['disclosuredescription'] ||
      normalized['description'] ||
      normalized['guidance'] ||
      '';

    // Identify item code & requirement
    const itemCode =
      normalized['itemcode'] ||
      normalized['code'] ||
      normalized['requirementcode'] ||
      normalized['subitem'] ||
      (disclosureCode ? `${disclosureCode}-req-${idx + 1}` : `item-${idx + 1}`);

    const requirement =
      normalized['requirement'] ||
      normalized['requirementtext'] ||
      normalized['item'] ||
      normalized['text'] ||
      normalized['question'] ||
      '';

    if (!standardCode && !disclosureCode && !requirement) {
      // blank row
      return;
    }

    if (!standardCode) {
      warnings.push(`Row ${rowNum}: Standard code missing; defaulting to 'GRI-GEN'`);
    }
    const stdKey = standardCode || 'GRI-GEN';

    if (!disclosureCode) {
      warnings.push(`Row ${rowNum}: Disclosure code missing; defaulting to 'DISC-${stdKey}'`);
    }
    const discKey = `${stdKey}::${disclosureCode || 'GEN-01'}`;

    if (!requirement) {
      warnings.push(`Row ${rowNum}: Requirement text missing for item ${itemCode}`);
    }

    // Get or create standard
    if (!standardsMap.has(stdKey)) {
      standardsMap.set(stdKey, {
        code: stdKey,
        title: standardTitle,
        category: standardCategory,
        version: normalized['version'] || '2021',
        disclosures: [],
      });
    }

    // Get or create disclosure
    if (!disclosuresMap.has(discKey)) {
      const disc: ParsedGRIDisclosure = {
        code: disclosureCode || 'GEN-01',
        title: disclosureTitle,
        description: disclosureDesc,
        items: [],
      };
      disclosuresMap.set(discKey, disc);
      standardsMap.get(stdKey)!.disclosures.push(disc);
    }

    const rawWeight = parseFloat(normalized['weight'] || '1.0');
    const weight = !isNaN(rawWeight) && rawWeight > 0 ? rawWeight : 1.0;
    const priority = inferPriority(normalized['priority']);
    const esgClass = inferESGClass(standardCategory, stdKey, normalized['esgclass'] || normalized['esg']);
    const answerType = inferAnswerType(normalized['answertype'] || normalized['type']);
    const hint = normalized['hint'] || normalized['guidance'] || undefined;

    // Optional descriptive columns (absent in legacy sheets -> undefined, never breaks parse)
    const department =
      normalized['department'] ||
      normalized['dept'] ||
      normalized['ownerdepartment'] ||
      normalized['responsibledepartment'] ||
      normalized['departmentname'] ||
      undefined;
    const objective = normalized['objective'] || normalized['goal'] || undefined;
    const topic = normalized['topic'] || normalized['theme'] || undefined;
    const reference =
      normalized['reference'] ||
      normalized['ref'] ||
      normalized['source'] ||
      normalized['sourcereference'] ||
      undefined;
    const baselineNote =
      normalized['baselinenote'] ||
      normalized['gapnote'] ||
      undefined;

    // Workbook column J ("% OF GAP"): reference-only baseline for the item.
    // Normalised keys: '% OF GAP' -> 'ofgap', 'GAP %' -> 'gap', etc.
    const rawGap =
      normalized['ofgap'] ??
      normalized['gappercent'] ??
      normalized['gap'] ??
      normalized['baselinegap'] ??
      normalized['baselinegappercent'] ??
      '';
    let baselineGapPercent: number | null | undefined;
    if (rawGap !== '') {
      const parsed = parseFloat(String(rawGap).replace('%', '').trim());
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
        baselineGapPercent = Math.round(parsed * 100) / 100;
      } else {
        warnings.push(`Row ${rowNum}: "% OF GAP" value "${rawGap}" is not a 0-100 percent; stored as NULL (reference-only, does not block import).`);
        baselineGapPercent = undefined;
      }
    }

    // Optional sort order within the disclosure
    const rawOrder = normalized['sortorder'] || normalized['order'] || normalized['sequence'] || normalized['roworder'] || '';
    let sortOrder: number | null | undefined;
    if (rawOrder !== '') {
      const parsed = parseInt(String(rawOrder), 10);
      sortOrder = !isNaN(parsed) ? parsed : undefined;
    }

    const item: ParsedGRIItem = {
      code: itemCode,
      requirement: requirement || `Reporting requirement for ${disclosureCode || itemCode}`,
      answerType,
      hint,
      priority,
      esgClass,
      weight,
      department: department ? department.trim() || undefined : undefined,
      objective: objective ? objective.trim() || undefined : undefined,
      topic: topic ? topic.trim() || undefined : undefined,
      reference: reference ? reference.trim() || undefined : undefined,
      baselineGapPercent: baselineGapPercent ?? null,
      baselineNote: baselineNote ? baselineNote.trim() || undefined : undefined,
      sortOrder: sortOrder ?? null,
    };

    disclosuresMap.get(discKey)!.items.push(item);
  });

  const standards = Array.from(standardsMap.values());
  let totalDisclosures = 0;
  let totalItems = 0;

  for (const std of standards) {
    totalDisclosures += std.disclosures.length;
    for (const disc of std.disclosures) {
      totalItems += disc.items.length;
    }
  }

  return {
    standards,
    summary: {
      totalStandards: standards.length,
      totalDisclosures,
      totalItems,
    },
    warnings,
    errors,
  };
}
