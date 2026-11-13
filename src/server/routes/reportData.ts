import type pg from 'pg';
import type { AuthUser } from '../auth.ts';
import { LINKED_ITEM_SQL, scopeError } from '../scope.ts';
import { REPORT_GATE_CODE, REPORT_GATE_REFUSAL, reportGateStatus, buildDisclosureIndex,
  indexIncompleteMessage, type DisclosureIndexRow } from '../../lib/reports.ts';
import { calculateAggregateScore, gateDraftEvaluations } from '../../lib/scoring.ts';
import { loadReportSettings, formatDateOnly } from './reportSettings.ts';

/** Redact counters as well as score: omissions/coverage must not back-compute
 * hidden gap metrics in JSON, CSV or an incomplete-index response. */
function visibleMetrics<T extends object>(row: T, visible: boolean): T {
  if (visible) return row;
  const redacted = { ...row } as Record<string, unknown>;
  for (const key of ['score','coveragePercentage','evaluatedItems','applicableItems','aggregateScore','evaluatedCount',
    'applicableCount','notApplicableCount','notEvaluatedCount','coverageRatio','fullGapCount','partialGapCount','noGapCount'])
    if (key in redacted) redacted[key] = null;
  return redacted as T;
}

export async function buildReportPayload(client: pg.PoolClient, user: AuthUser, tenant: string, service: string | null, level: string) {
  const settings = await loadReportSettings(client, tenant, service);
  if (!reportGateStatus(settings).ok) throw Object.assign(new Error(REPORT_GATE_REFUSAL), { statusCode:409,code:REPORT_GATE_CODE });
  if (!service) throw scopeError(403, 'scope.service_unlinked');
  const flag = (await client.query('SELECT show_gap,show_corrective FROM client_services WHERE client_id=$1 AND service_id=$2', [tenant,service])).rows[0];
  if (!flag) throw scopeError(403, 'scope.service_unlinked');
  const flags = { showGap:flag.show_gap === true,showCorrective:flag.show_corrective === true };

  // The exact service predicate precedes EVERY index, error and aggregate.
  // EXISTS does not multiply items when standards overlap linked services.
  const source = (await client.query(`SELECT d.id disclosure_id,d.code disclosure_code,d.title disclosure_title,
    s.code standard_code,s.title standard_title,i.id item_id,i.code item_code,i.weight::float weight,
    dep.id department_id,dep.name department_name,e.score,e.not_evaluated,e.not_applicable,e.na_reason,e.justification,
    ans.value answer_value,ans.status answer_status
    FROM items i JOIN disclosures d ON d.id=i.disclosure_id JOIN standards s ON s.id=d.standard_id
    LEFT JOIN assignments a ON a.item_id=i.id AND a.client_id=$1
    LEFT JOIN departments dep ON dep.id=a.department_id AND dep.client_id=$1
    LEFT JOIN evaluations e ON e.item_id=i.id AND e.client_id=$1
    LEFT JOIN answers ans ON ans.item_id=i.id AND ans.client_id=$1 AND ans.department_id=a.department_id
    WHERE ${LINKED_ITEM_SQL} ORDER BY s.code,d.code,i.code,dep.id`, [tenant,service])).rows;
  const submitted = new Set(['submitted','approved','client_approved']);
  const hasSubmitted = new Set(source.filter(r => submitted.has(r.answer_status)).map(r => String(r.item_id)));
  const built = buildDisclosureIndex(source.map(r => ({
    disclosureId:String(r.disclosure_id),disclosureCode:r.disclosure_code,disclosureTitle:r.disclosure_title,
    standardCode:r.standard_code,standardTitle:r.standard_title,itemId:String(r.item_id),itemCode:r.item_code,
    weight:r.weight == null ? null : Number(r.weight),departmentId:r.department_id ?? null,departmentName:r.department_name ?? null,
    score:hasSubmitted.has(String(r.item_id)) && r.score != null ? Number(r.score) as 0|50|100 : null,
    notEvaluated:!hasSubmitted.has(String(r.item_id)) || Boolean(r.not_evaluated),
    notApplicable:hasSubmitted.has(String(r.item_id)) && Boolean(r.not_applicable),
    naReason:r.na_reason ?? null,justification:r.justification ?? null,answerValue:r.answer_value ?? null,answerStatus:r.answer_status ?? null,
  })));
  const index: DisclosureIndexRow[] = built.rows.map(row => visibleMetrics(row, flags.showGap));
  if (built.offendingCodes.length) throw Object.assign(new Error(indexIncompleteMessage(built.offendingCodes)), {
    statusCode:422,code:'reports.index_incomplete',offendingCodes:built.offendingCodes,index,
  });
  const byItem = new Map<string, any>();
  for (const r of source) if (!byItem.has(String(r.item_id))) byItem.set(String(r.item_id), {
    itemId:String(r.item_id),weight:Number(r.weight) || 2,score:r.score == null ? null : Number(r.score),
    notEvaluated:Boolean(r.not_evaluated),notApplicable:Boolean(r.not_applicable),
    hasEvaluation:r.score !== null || Boolean(r.not_evaluated) || Boolean(r.not_applicable),hasSubmittedAnswer:hasSubmitted.has(String(r.item_id)),
  });
  const aggregate = calculateAggregateScore(gateDraftEvaluations([...byItem.values()]));
  const buckets = new Map<string, { departmentId:string;departmentName:string;weightedSum:number;weightTotal:number;evaluated:number;applicable:number }>();
  const deptSeen = new Set<string>();
  for (const r of source) {
    if (!r.department_id || deptSeen.has(`${r.department_id}:${r.item_id}`)) continue;
    deptSeen.add(`${r.department_id}:${r.item_id}`);
    let b = buckets.get(r.department_id);
    if (!b) { b = { departmentId:r.department_id,departmentName:r.department_name,weightedSum:0,weightTotal:0,evaluated:0,applicable:0 }; buckets.set(r.department_id,b); }
    const ready = submitted.has(r.answer_status);
    if (ready && r.not_applicable) continue;
    b.applicable++;
    if (!ready || r.not_evaluated || r.score == null) continue;
    b.evaluated++; const w = Number(r.weight) || 2;
    b.weightedSum += w * Number(r.score); b.weightTotal += w;
  }
  const departments = [...buckets.values()].map(b => visibleMetrics({ departmentId:b.departmentId,departmentName:b.departmentName,
    score:b.weightTotal ? Math.round(b.weightedSum / b.weightTotal * 10)/10 : null,
    coveragePercentage:b.applicable ? Math.round(b.evaluated / b.applicable * 1000)/10 : 0,
    evaluatedItems:b.evaluated,applicableItems:b.applicable }, flags.showGap)).sort((a,b) => a.departmentName.localeCompare(b.departmentName));
  const actionsByStatus: Record<string, number> = {};
  if (flags.showCorrective) {
    const actions = await client.query(`SELECT a.status,count(*)::int count FROM actions a WHERE a.client_id=$1
      AND (CASE WHEN a.item_id IS NULL THEN a.service_id=$2
        ELSE (a.service_id IS NULL OR a.service_id=$2) AND b17_item_visible(a.client_id,a.item_id,$2) END)
      GROUP BY a.status`, [tenant,service]);
    for (const row of actions.rows) actionsByStatus[row.status] = row.count;
  }
  const omissions = index.filter(r => r.omitted).map(r => ({ disclosureCode:r.disclosureCode,disclosureTitle:r.disclosureTitle,
    reason:r.omissionReason,explanation:r.omissionExplanation }));
  return { clientId:tenant,serviceId:service,level,
    settings:{ disclosureLevel:settings.disclosure_level,reportLevel:settings.report_level,statementName:settings.statement_name,
      statementPeriod:settings.statement_period,notified:settings.notified,notifiedDate:formatDateOnly(settings.notified_date),notifyRef:settings.notify_ref },
    visibility:{ role:user.role,...flags },aggregate:visibleMetrics(aggregate,flags.showGap),departments,
    actions:{ byStatus:actionsByStatus,showCorrective:flags.showCorrective },omissions,
    topGaps:flags.showGap ? [...index].filter(r => !r.omitted && r.score !== null).sort((a,b) => (a.score ?? 0)-(b.score ?? 0)).slice(0,10) : [],
    index,meta:{ disclosureCount:index.length,omittedCount:omissions.length,locationGaps:index.filter(r => !r.locationComplete).map(r => r.disclosureCode) } };
}
