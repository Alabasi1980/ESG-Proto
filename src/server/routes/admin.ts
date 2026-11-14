// B12 (R-01) — admin sub-router: clients, departments, users, client×service
// links, assignments, staff-list flow, GE overview, client dashboard.
// Mounted by src/server/routes.ts under the /api prefix. requireFreshPassword
// on every mutating route (F-03); no optional-auth mount anywhere.
//
// B17 U2-F (task §2/§3): declaration-only shell — all 25 §3.4 rows mount
// F-03 + requireDomainAccess and delegate to a focused handler file so no
// touched file crosses ~500 lines (task §3(4) split):
//   adminClients.ts       rows 1,2,9,10,11,12,13,14        (+ §6 progress counts)
//   adminPlatformOps.ts   rows 8,15                         (targetless platform rows)
//   adminDirectory.ts     rows 3,4,5
//   adminAssignments.ts   rows 16,17,18,19                 (+ SHIELD-U2F-01 blockers)
//   adminStaff.ts         rows 20,21,22,24,25
//   adminProvisioning.ts  rows 6,7,23                       (round 2: platformConfigContext
//                                                            + §3(2) lock order + E3-02)
//   adminCommon.ts        the server-selected context helpers for all of them.
// Admission (role/mode/tenant) is the dispatcher + requireDomainAccess matrix
// ring (SHIELD-U2A-01/02); handlers only resolve their server-selected context
// and pin their rows. contextFromUser/b11bRequireGeAdmin/b11bAssertPasswordFresh
// are gone from this file (zero legacy context builders outside
// _shared.requireFreshPassword — U2-G gate met for admin).

import express from 'express';
import { authMiddleware } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { requireFreshPassword } from './_shared.ts';
import {
  createClient, getClient, linkClientService, listClients,
  listClientServices, unlinkClientService, updateClient, updateClientServiceFlags,
} from './adminClients.ts';
import { geOverview, linkAllTenants } from './adminPlatformOps.ts';
import { listDepartments, listUsers, setDepartmentHead } from './adminDirectory.ts';
import {
  assignNotApplicable, createAssignment, deleteAssignment, listAssignments,
} from './adminAssignments.ts';
import {
  clientDashboard, createStaffList, listStaffLists, rejectStaffList, submitStaffList,
} from './adminStaff.ts';
import { approveStaffList, createUser, deactivateUser } from './adminProvisioning.ts';

const router = express.Router();

// ---------------------------------------------------------------------------
// §3.4 rows 1,2,3,4,5,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,24,25 —
// activated in round 1: declaration + F-03 gate + §3 matrix wrapper, handler in
// its focused file.
// ---------------------------------------------------------------------------
router.get('/clients', authMiddleware, requireDomainAccess, listClients);
router.post('/clients', authMiddleware, requireFreshPassword, requireDomainAccess, createClient);
router.get('/departments', authMiddleware, requireDomainAccess, listDepartments);
router.patch('/departments/:id/head', authMiddleware, requireFreshPassword, requireDomainAccess, setDepartmentHead);
router.get('/users', authMiddleware, requireDomainAccess, listUsers);
router.get('/ge/overview', authMiddleware, requireDomainAccess, geOverview);
router.get('/clients/:id', authMiddleware, requireDomainAccess, getClient);
router.patch('/clients/:id', authMiddleware, requireFreshPassword, requireDomainAccess, updateClient);
router.get('/clients/:id/services', authMiddleware, requireDomainAccess, listClientServices);
router.post('/clients/:id/services', authMiddleware, requireFreshPassword, requireDomainAccess, linkClientService);
router.patch('/clients/:id/services/:serviceId', authMiddleware, requireFreshPassword, requireDomainAccess, updateClientServiceFlags);
router.delete('/clients/:id/services/:serviceId', authMiddleware, requireFreshPassword, requireDomainAccess, unlinkClientService);
router.post('/services/link-all', authMiddleware, requireFreshPassword, requireDomainAccess, linkAllTenants);
router.get('/assignments', authMiddleware, requireDomainAccess, listAssignments);
router.post('/assignments', authMiddleware, requireFreshPassword, requireDomainAccess, createAssignment);
router.delete('/assignments', authMiddleware, requireFreshPassword, requireDomainAccess, deleteAssignment);
router.post('/assignments/na', authMiddleware, requireFreshPassword, requireDomainAccess, assignNotApplicable);
router.get('/staff-lists', authMiddleware, requireDomainAccess, listStaffLists);
router.post('/staff-lists', authMiddleware, requireFreshPassword, requireDomainAccess, createStaffList);
router.post('/staff-lists/:id/submit', authMiddleware, requireFreshPassword, requireDomainAccess, submitStaffList);
router.post('/staff-lists/:id/reject', authMiddleware, requireFreshPassword, requireDomainAccess, rejectStaffList);
router.get('/client/dashboard', authMiddleware, requireDomainAccess, clientDashboard);

// ---------------------------------------------------------------------------
// §3.4 PROVISIONING rows 6,7,23 — activated in ROUND 2 (final) after the
// R2-A substrate + §3(2) lock-order proof (parent §15): platformConfigContext
// (explicit T / NULL-target), users INSERT/UPDATE + provisioning-audit row
// scope (SHIELD-U2F-01 extension), writeFailure catches (R2-C), and the
// approve row behind its OTP-once/all-or-nothing proof (R2-D).
// ---------------------------------------------------------------------------
router.post('/users', authMiddleware, requireFreshPassword, requireDomainAccess, createUser);
router.patch('/users/:id', authMiddleware, requireFreshPassword, requireDomainAccess, deactivateUser);
router.post('/staff-lists/:id/approve', authMiddleware, requireFreshPassword, requireDomainAccess, approveStaffList);

export default router;
