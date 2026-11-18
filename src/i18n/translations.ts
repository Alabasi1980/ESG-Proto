export type Language = 'en' | 'ar';

export interface Translations {
  appName: string;
  appTagline: string;
  brandGreenEdge: string;

  nav: {
    dashboard: string;
    standards: string;
    gapAnalysis: string;
    correctiveActions: string;
    initiatives: string;
    esgProfile: string;
    importGRI: string;
    auditLog: string;
    settings: string;
    profile: string;
    logout: string;
    login: string;
    setup: string;
    tenantBadge: string;
    reports: string;
      geOverview: string;
      clientDetail: string;
      staffLists: string;
      clientDashboard: string;
      notifications: string;
    };

  auth: {
    signInTitle: string;
    signInSubtitle: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    signInButton: string;
    signingIn: string;
    invalidCredentials: string;
    logoutConfirm: string;
    logoutSuccess: string;
    changePassword: string;
    changePasswordTitle: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    passwordChangedSuccess: string;
      passwordMismatch: string;
      passwordTooShort: string;
      passwordComplexityHint: string;
      forcedChangeTitle: string;
      forcedChangeDesc: string;
      changeAndContinue: string;
    role: string;
    roles: {
      ge_admin: string;
      client_admin: string;
      employee: string;
    };
    tenant: string;
    department: string;
    dbUnconfiguredNotice: string;
    dbUnconfiguredHelp: string;
  };

  // TASK-PROTO-U3-B1 §2 — truthful shell identity per context (P/W/C/E).
  contextIdentity: {
    platformAdmin: string;
    consultantWorkspace: string;
    company: string;
    department: string;
  };

  setup: {
    title: string;
    subtitle: string;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    adminPasswordHint: string;
    clientSectionTitle: string;
    clientSectionDesc: string;
    clientName: string;
    clientCode: string;
    submitButton: string;
    submitting: string;
    completedNotice: string;
    dbMissingNotice: string;
    dbMissingHelp: string;
    alreadyCompleted: string;
  };

  dashboard: {
    title: string;
    subtitle: string;
    welcome: string;
    emptyTitle: string;
    emptyDescription: string;
    importDataAction: string;
    configureDbAction: string;
    complianceSummary: string;
    reviewCoverage: string;
    coverageTooltip: string;
    overallScore: string;
    scoreTooltip: string;
    notEvaluated: string;
    notApplicable: string;
    gapAnalysisTitle: string;
    fullGap: string;
    fullGapDesc: string;
    partialGap: string;
    partialGapDesc: string;
    noGap: string;
    noGapDesc: string;
    totalStandards: string;
    totalDisclosures: string;
    totalItems: string;
    standardsOverview: string;
    standardsOverviewDesc: string;
    esgPillars: string;
    environmental: string;
    social: string;
    governance: string;
    general: string;
    tenantContext: string;
  };

  importGRI: {
    title: string;
    subtitle: string;
    dragDropText: string;
    browseFiles: string;
    acceptedFormats: string;
    downloadTemplate: string;
    downloadTemplateHint: string;
    parseSuccess: string;
    standardsFound: string;
    disclosuresFound: string;
    itemsFound: string;
    previewTitle: string;
    commitButton: string;
    committing: string;
    committedSuccess: string;
    committedDescription: string;
    standardsTab: string;
    disclosuresTab: string;
    itemsTab: string;
    warningsTab: string;
    standardCode: string;
    standardTitle: string;
    category: string;
    version: string;
    disclosureCode: string;
    disclosureTitle: string;
    itemCode: string;
    requirement: string;
    priority: string;
    esgClass: string;
    weight: string;
    answerType: string;
    clearFile: string;
    validationWarnings: string;
    noWarnings: string;
    selectFilePrompt: string;
    importingNotice: string;
    targetTenantLabel: string;
    targetTenantHint: string;
    selectTenantPlaceholder: string;
  };

  standards: {
    title: string;
    subtitle: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyAction: string;
    searchPlaceholder: string;
    allCategories: string;
    disclosuresCount: string;
    itemsCount: string;
    code: string;
    name: string;
    category: string;
  };

  gapAnalysis: {
    title: string;
    subtitle: string;
    emptyTitle: string;
    emptyDescription: string;
    emptyAction: string;
    queueTitle: string;
    queueSubtitle: string;
    emptyQueueTitle: string;
    emptyQueueDesc: string;
    selectPrompt: string;
    priority: string;
    pillar: string;
    topic: string;
    department: string;
    stNotEvaluated: string;
    stDraft: string;
    stSubmitted: string;
    stApproved: string;
    stClientApproved: string;
    stReturned: string;
    stNotApplicable: string;
    evaluateTitle: string;
    scoreLabel: string;
    score0: string;
    score0Desc: string;
    score50: string;
    score50Desc: string;
    score100: string;
    score100Desc: string;
    notEvalLabel: string;
    notEvalDesc: string;
    naLabel: string;
    naDesc: string;
    naReasonLabel: string;
    naReasonOptions: Record<string, string>;
    evidenceNoteLabel: string;
    evidenceNotePh: string;
    saveDraft: string;
    submitEval: string;
    saving: string;
    submitting: string;
    approvalTitle: string;
    approvalDesc: string;
    approveBtn: string;
    returnBtn: string;
    commentLabel: string;
    commentPh: string;
    selfApprovalNote: string;
    decidedApproved: string;
    decidedReturned: string;
    historyTitle: string;
    historyEmpty: string;
    correctionTitle: string;
    correctionDesc: string;
    correctionReasonLabel: string;
    correctionReasonPh: string;
    applyCorrection: string;
  };

  // TASK-PROTO-U3-B2 §1/§5 — P Clients page (server results only, §5 fallbacks).
  clients: {
    subtitle: string;
    searchLabel: string;
    searchHint: string;
    search: string;
    clearSearch: string;
    refresh: string;
    caption: string;
    colClient: string;
    colStatus: string;
    colServices: string;
    colActions: string;
    rowCount: string;
    active: string;
    suspended: string;
    statusUnknown: string;
    emptyTitle: string;
    emptySearchTitle: string;
    loadFailed: string;
    noLinkedServices: string;
    unmappedService: string;
    mappedItems: string;
    collection: string;
    pendingSubmission: string;
    frozenPairs: string;
    noAssignments: string;
    unavailable: string;
    enterWorkspace: string;
    configureClient: string;
    suspend: string;
    unsuspend: string;
    enterConfirm: string;
    suspendConfirm: string;
    saveFailed: string;
    suspendSaved: string;
  };

  // TASK-PROTO-U3-B2 §2/§7 — workspace lifecycle states and safe recovery.
  workspace: {
    checking: string;
    opening: string;
    closing: string;
    confirmFailed: string;
    confirmFailedDesc: string;
    retry: string;
    exitToClients: string;
    exitConfirm: string;
    clientSuspended: string;
    backToClients: string;
    configureTitle: string;
  };

  settings: {
    title: string;
    subtitle: string;
    databaseConnection: string;
    dbStatus: string;
    connected: string;
    disconnected: string;
    configured: string;
    notConfigured: string;
    tableCount: string;
    databaseUrlNote: string;
    runMigrations: string;
    migrating: string;
    migrationsSuccess: string;
    languageSettings: string;
    languageDescription: string;
    currentLanguage: string;
    arabic: string;
    english: string;
    securitySettings: string;
    updatePasswordButton: string;
    userProfile: string;
    // TASK-PROTO-H13 — platform-wide app theme (app_settings).
    appThemeSection: string;
    appThemeDescription: string;
    appThemePlatformOnly: string;
    appThemeAuto: string;
    appThemeAutoHint: string;
    appThemeGe: string;
    appThemeLime: string;
    appThemeDark: string;
    appThemeSave: string;
    appThemeSaving: string;
    appThemeSaved: string;
    appThemeFailed: string;
  };

  users: {
    title: string;
    subtitle: string;
    listTitle: string;
    emptyList: string;
    emailLabel: string;
    passwordLabel: string;
    nameLabel: string;
    roleLabel: string;
    tenantLabel: string;
    departmentLabel: string;
    createButton: string;
    creating: string;
    deactivateButton: string;
    reactivateButton: string;
    deactivateConfirm: string;
    activeLabel: string;
    inactiveLabel: string;
    createdSuccess: string;
    tenantPlaceholder: string;
    noTenantOption: string;
    geOnlyNote: string;
  };

  actions: {
    title: string;
    subtitle: string;
    listTitle: string;
    emptyTitle: string;
    emptyDesc: string;
    filterStatus: string;
    filterDepartment: string;
    allStatuses: string;
    allDepartments: string;
    createTitle: string;
    titleLabel: string;
    titlePh: string;
    descLabel: string;
    descPh: string;
    deptLabel: string;
    itemLabel: string;
    dueLabel: string;
    createButton: string;
    creating: string;
    evidenceLabel: string;
    evidencePh: string;
    saveEvidence: string;
    advanceButton: string;
    closeButton: string;
    reopenButton: string;
    reasonLabel: string;
    reasonPh: string;
    reasonRequired: string;
    statusLabels: Record<string, string>;
    nextOf: Record<string, string>;
    updatedMsg: string;
  };

  initiatives: {
    title: string;
    subtitle: string;
    searchPh: string;
    filterSector: string;
    filterEsg: string;
    filterDepartment: string;
    all: string;
    selectButton: string;
    unselectButton: string;
    selectedBadge: string;
    emptyTitle: string;
    emptyDesc: string;
    standardsRef: string;
    department: string;
    sector: string;
  };

  esgProfile: {
    title: string;
    subtitle: string;
    scoreLabel: string;
    coverageLabel: string;
    ratedLabel: string;
    pillar: string;
    department: string;
    topic: string;
    parameter: string;
    profile: string;
    rating: string;
    timeline: string;
    impact: string;
    emptyTitle: string;
    emptyDesc: string;
    groupNote: string;
  };

  clientReview: {
    title: string;
    subtitle: string;
    emptyTitle: string;
    emptyDesc: string;
    completeness: string;
    readyBadge: string;
    blockedBadge: string;
    frozenBadge: string;
    pendingClient: string;
    approveGroupHint: string;
    clientApproveBtn: string;
    clientReturnBtn: string;
    approving: string;
    commentRequired: string;
  };

  geFinal: {
    title: string;
    subtitle: string;
    scopeLabel: string;
    scopeDisclosure: string;
    scopeTenant: string;
    disclosureLabel: string;
    selectDisclosure: string;
    runCheck: string;
    checking: string;
    checklistTitle: string;
    allClear: string;
    blockedItems: string;
    freezeBtn: string;
    freezing: string;
    confirmTitle: string;
    confirmDesc: string;
    confirmCheck: string;
    frozenBadge: string;
    snapshotTitle: string;
    snapshotEmpty: string;
    hashLabel: string;
    actorLabel: string;
    timeLabel: string;
    aggregateLabel: string;
    coverageLabel: string;
    noteLabel: string;
    notePh: string;
    addNote: string;
    addingNote: string;
    viewerTitle: string;
    alreadyFrozen: string;
  };

  conflict: {
    title: string;
    desc: string;
    mineLabel: string;
    theirsLabel: string;
    reloadRetry: string;
    versionLabel: string;
    actorLabel: string;
    timeLabel: string;
  };

  attachments: {
    title: string;
    attachBtn: string;
    uploading: string;
    emptyText: string;
    downloadBtn: string;
    deleteBtn: string;
    deleteConfirm: string;
    oversize: string;
    mime: string;
    missing: string;
    uploadFailed: string;
    typesNote: string;
    usageLabel: string;
  };

  storage: {
    title: string;
    subtitle: string;
    bytesLabel: string;
    filesLabel: string;
    warnMsg: string;
    okMsg: string;
  };

  weights: {
    title: string;
    subtitle: string;
    high: string;
    mid: string;
    low: string;
    notice: string;
  };

  reports: {
    navLabel: string;
    title: string;    subtitle: string;
    levelTabL1: string;
    levelTabL2: string;
    levelTabL3: string;
    levelDescL1: string;
    levelDescL2: string;
    levelDescL3: string;
    headlineScore: string;
    topGaps: string;
    byDepartment: string;
    byStandard: string;
    actionsSummary: string;
    omissionsSummary: string;
    noOmissions: string;
    standard: string;
    disclosure: string;
    location: string;
    locationMissing: string;
    omission: string;
    omittedYes: string;
    omittedNo: string;
    reason: string;
    explanation: string;
    reasonLabels: Record<string, string>;
    score: string;
    coverage: string;
    items: string;
    departments: string;
    statementTitle: string;
    statementName: string;
    statementPeriod: string;
    notificationTitle: string;
    notifiedDone: string;
    notifiedNotDone: string;
    notifiedDate: string;
    notifyRef: string;
    notificationRecordNote: string;
    settingsTitle: string;
    settingsDesc: string;
    disclosureLevel: string;
    reportLevel: string;
    inAccordance: string;
    withReference: string;
    saveSettings: string;
    saving: string;
    savedMsg: string;
    gateBlocked: string;
    gateOk: string;
    exportJson: string;
    exportCsv: string;
    printBtn: string;
    loading: string;
    loadError: string;
    incompleteTitle: string;
    selectLevelHint: string;
  };

  services: {
    title: string;
    subtitle: string;
    listTitle: string;
    emptyText: string;
    codeLabel: string;
    nameLabel: string;
    descLabel: string;
    createButton: string;
    creating: string;
    saveButton: string;
    saving: string;
    editButton: string;
    duplicateButton: string;
    duplicating: string;
    newCodeLabel: string;
    newCodePh: string;
    linkedLabel: string;
    linkButton: string;
    unlinkButton: string;
    manageHint: string;
  };

  // TASK-PROTO-U4-2 §2 — the P services workspace (rail, tabs, drill, rules,
  // settings, per-service import). Key names are workspace-specific so no
  // existing block's counter (clients.test i18n census) can be disturbed.
  servicesWorkspace: {
    headerSubtitle: string;
    railSearchLabel: string;
    railSearchPh: string;
    railEmpty: string;
    railEmptyHint: string;
    createHint: string;
    emptySearch: string;
    selectTitle: string;
    selectHint: string;
    statusReady: string;
    statusEmpty: string;
    tabOverview: string;
    tabContent: string;
    tabRules: string;
    tabSettings: string;
    tabImport: string;
    definition: string;
    created: string;
    descriptionEmpty: string;
    linkedClients: string;
    clientsUnit: string;
    lastImport: string;
    lastImportNone: string;
    lastImportHint: string;
    contentState: string;
    contentEmpty: string;
    contentOk: string;
    duplicateHint: string;
    duplicateCodeLabel: string;
    duplicateNameLabel: string;
    duplicateSubmit: string;
    breadcrumbAll: string;
    levelStandards: string;
    levelDisclosures: string;
    levelItems: string;
    searchLevelPh: string;
    addStandard: string;
    addStandardHint: string;
    noStandards: string;
    noStandardsHint: string;
    noDisclosures: string;
    noDisclosuresHint: string;
    noItems: string;
    noItemsHint: string;
    disclosureImportNote: string;
    itemDetail: string;
    itemRequirement: string;
    itemAnswerType: string;
    itemPriority: string;
    itemEsgClass: string;
    itemHint: string;
    codeImmutable: string;
    attachmentRequired: string;
    attachmentNotRequired: string;
    attachmentReadOnly: string;
    selectedCount: string;
    bulkAssign: string;
    bulkDone: string;
    bulkNoClients: string;
    rulesShownOf: string;
    discardDraft: string;
    dirtyDraft: string;
    unlinkStandardConfirm: string;
    identityTitle: string;
    identitySave: string;
    settingsHint: string;
    settingsSave: string;
    settingsInvalid: string;
    settingsEcho: string;
    actionFailed: string;
    workspaceLoadFailed: string;
    fieldRequired: string;
    importTitle: string;
    importDrop: string;
    importFormats: string;
    importPreview: string;
    importPreviewing: string;
    importConfirm: string;
    importConfirmAction: string;
    importing: string;
    importDone: string;
    importFailed: string;
    contentGroups: string;
    contentGroup: string;
    contentDirect: string;
    directHint: string;
    archivedCount: string;
    archivedSection: string;
    archivedBadge: string;
    linkedReadOnly: string;
    approvedCopiesTitle: string;
    approvedCopiesNone: string;
    approvedCopySealed: string;
    approvedCopyMissing: string;
    approvedCopiesHint: string;
    namedSettingsTitle: string;
    namedSettingsHint: string;
    namedSettingsReplace: string;
    settingDefaultAnswerType: string;
    settingDefaultAnswerTypeHint: string;
    settingDefaultPriority: string;
    settingDefaultPriorityHint: string;
    settingDefaultEsgClass: string;
    settingDefaultEsgClassHint: string;
    settingAttachmentDefault: string;
    settingAttachmentDefaultHint: string;
    settingVisibleDefault: string;
    settingVisibleDefaultHint: string;
    frozenScopeBanner: string;
    historyReopened: string;
    historyTitle: string;
    historyFailed: string;
    historyEmpty: string;
    templateDownload: string;
    templateDownloadHint: string;
    mappingTitle: string;
    mappingHint: string;
    mappingFileColumn: string;
    importConfirmService: string;
    unmappedTitle: string;
    rowErrorsTitle: string;
    commitBlocked: string;
    previewClean: string;
    createStandard: string;
    editStandard: string;
    deleteStandardConfirm: string;
    createGroup: string;
    newGroupStandard: string;
    createGroupHint: string;
    editGroup: string;
    deleteGroupConfirm: string;
    createDisclosure: string;
    editDisclosure: string;
    deleteDisclosureConfirm: string;
    itemDepartment: string;
    itemDepartmentNone: string;
    singleDeptNote: string;
    saveConflictHint: string;
    deleteItemTitle: string;
    deleteItemHint: string;
    deleteReasonPh: string;
    deleteItemConfirm: string;
    itemArchivedNote: string;
    bulkEditDone: string;
    bulkUnset: string;
    bulkEditApply: string;
    bulkEditHint: string;
    bulkRowOk: string;
  };

  // TASK-PROTO-U4-3 unit (a) — employee services workspace (own-dept only).
  // Key names are workspace-specific so no existing block's counter can be disturbed.
  employeeServices: {
    title: string;
    subtitle: string;
    railTitle: string;
    railSearchLabel: string;
    railSearchPh: string;
    railEmpty: string;
    railEmptyHint: string;
    emptySearch: string;
    countsAssigned: string;
    countsSubmitted: string;
    countsPending: string;
    tabItems: string;
    tabDocuments: string;
    tabInitiatives: string;
    actionFailed: string;
    loadFailed: string;
    searchItemsPh: string;
    itemsEmpty: string;
    itemsEmptyHint: string;
    selectItemHint: string;
    answerSection: string;
    answerTypeLabel: string;
    fileAnswerNote: string;
    outcomeSection: string;
    outcomeScore: string;
    outcomeNotEvaluated: string;
    outcomeNA: string;
    naReasonLabel: string;
    saveDraft: string;
    saving: string;
    submitAnswer: string;
    submitting: string;
    attachmentRequiredTitle: string;
    attachmentRequiredDesc: string;
    attachmentRequiredNa: string;
    attachmentLockedNote: string;
    noAnswerYet: string;
    unsavedChanges: string;
    unsavedTitle: string;
    detailLoadFailed: string;
    docsTitle: string;
    docsEmpty: string;
    docsEmptyHint: string;
    docRequired: string;
    docProvided: string;
    markProvided: string;
    noteLabel: string;
    notePh: string;
    tagLabel: string;
    tagPh: string;
    saveChanges: string;
    savingChanges: string;
    submittedAtLabel: string;
    proofFilesTitle: string;
    initsTitle: string;
    initsEmpty: string;
    initsEmptyHint: string;
    performedLabel: string;
    notPerformedLabel: string;
    versionConflict: string;
  };

  taxonomy: {
    manageTitle: string;
    manageSubtitle: string;
    importOwnsNote: string;
    showManage: string;
    hideManage: string;
    editButton: string;
    saveButton: string;
    saving: string;
    deleteButton: string;
    deleting: string;
    titleLabel: string;
    categoryLabel: string;
    descLabel: string;
    disclosuresTitle: string;
    itemsTitle: string;
    addItemButton: string;
    addingItem: string;
    requirementLabel: string;
    requirementPh: string;
    codeLabel: string;
    codePh: string;
    priorityLabel: string;
    esgLabel: string;
    answerTypeLabel: string;
    hintLabel: string;
    objectiveLabel: string;
    topicLabel: string;
    referenceLabel: string;
    codeImmutableNote: string;
    linksTitle: string;
    linkToLabel: string;
    linkButton: string;
    linking: string;
    unlinkButton: string;
    unlinkConfirm: string;
    noLinksText: string;
    evaluatedBadge: string;
    notEvaluatedByDept: string;
    relationLabel: string;
    deleteStdConfirm: string;
    deleteDiscConfirm: string;
    deleteItemConfirm: string;
  };

  common: {
    loading: string;
    save: string;
    cancel: string;
    submit: string;
    close: string;
    refresh: string;
    success: string;
    error: string;
    warning: string;
    info: string;
    retry: string;
    actions: string;
    status: string;
    view: string;
    learnMore: string;
    back: string;
    high: string;
    mid: string;
    low: string;
    text: string;
    number: string;
    boolean: string;
    date: string;
    file: string;
    checking: string;
    connected: string;
    disconnected: string;
    yes: string;
    no: string;
  };

  geOverview: Record<string, string>;
  clientDetail: Record<string, string>;
  staffLists: Record<string, any>;
  clientDashboard: Record<string, string>;
  assignments: Record<string, string>;
  b16: Record<string, string>;

  audit: {
    title: string;
    subtitle: string;
    filterAction: string;
    filterEntity: string;
    filterUser: string;
    filterFrom: string;
    filterTo: string;
    search: string;
    clear: string;
    who: string;
    what: string;
    entity: string;
    when: string;
    before: string;
    after: string;
    reason: string;
    payload: string;
    empty: string;
    limit: string;
  };

  notifications: {
    title: string;
    subtitle: string;
    markAllRead: string;
    markRead: string;
    empty: string;
    allCaughtUp: string;
    unread: string;
  };

  idle: {
    warningTitle: string;
    warningMessage: string;
    secondsLeft: string;
    staySignedIn: string;
    signOutNow: string;
  };
}

export const translations: Record<Language, Translations> = {
  en: {
    appName: 'ESG GRI Platform',
    appTagline: 'Sustainability & GRI Reporting Management System',
    brandGreenEdge: 'ESG GRI Platform',

    nav: {
      dashboard: 'Dashboard',
      standards: 'GRI Standards',
      gapAnalysis: 'Gap Analysis',
      correctiveActions: 'Corrective Actions',
      initiatives: 'Initiatives Library',
      esgProfile: 'ESG Profile',
      importGRI: 'Import GRI Data',
      auditLog: 'Audit Log',
      settings: 'Settings & Database',
      profile: 'User Profile',
      logout: 'Sign Out',
      login: 'Sign In',
      setup: 'Initial Setup',
      tenantBadge: 'Tenant',
      reports: 'Reports',
      geOverview: 'GE Operations',
      clientDetail: 'Client Detail',
      staffLists: 'Staff Lists',
      clientDashboard: 'Client Dashboard',
      notifications: 'Notifications',
    },

    auth: {
      signInTitle: 'Welcome to ESG GRI Platform',
      signInSubtitle: 'Sign in to access your ESG & GRI compliance dashboard',
      emailLabel: 'Email Address',
      emailPlaceholder: 'user@company.com',
      passwordLabel: 'Password',
      passwordPlaceholder: '••••••••',
      signInButton: 'Sign In to Platform',
      signingIn: 'Authenticating...',
      invalidCredentials: 'The email address or password provided is incorrect.',
      logoutConfirm: 'Are you sure you want to sign out?',
      logoutSuccess: 'You have been signed out successfully.',
      changePassword: 'Change Password',
      changePasswordTitle: 'Security & Password Update',
      currentPassword: 'Current Password',
      newPassword: 'New Password',
      confirmPassword: 'Confirm New Password',
      passwordChangedSuccess: 'Your password has been updated securely.',
      passwordMismatch: 'New password and confirmation do not match.',
      passwordTooShort: 'New password must be at least 10 characters with uppercase, lowercase, digit, and symbol.',
      passwordComplexityHint: 'Minimum 10 characters: uppercase, lowercase, digit, symbol.',
      forcedChangeTitle: 'Password change required',
      forcedChangeDesc: 'Your account was provisioned with a one-time password. Set a new password to continue.',
      changeAndContinue: 'Change password & continue',
      role: 'Role',
      roles: {
        ge_admin: 'Platform Administrator',
        client_admin: 'Client Tenant Admin',
        employee: 'Department Employee',
      },
      tenant: 'Client Tenant',
      department: 'Department',
      dbUnconfiguredNotice: 'Live PostgreSQL connection (DATABASE_URL) is not yet set.',
      dbUnconfiguredHelp: 'Set DATABASE_URL in your environment or .env file to persist records with Row-Level Security.',
    },

    contextIdentity: {
      platformAdmin: 'Platform administration',
      consultantWorkspace: 'Consultant workspace',
      company: 'Company',
      department: 'Department',
    },

    setup: {
      title: 'Initialize ESG GRI Platform',
      subtitle: 'Create the initial administrator account and verify PostgreSQL database',
      adminName: 'Full Name',
      adminEmail: 'Administrator Email',
      adminPassword: 'Password',
      adminPasswordHint: 'Minimum 10 characters with uppercase, lowercase, digit, and symbol — keep it secure',
      clientSectionTitle: 'Client Tenant Details (Optional)',
      clientSectionDesc: 'Leave blank to initialize as a platform administrator, or enter company details to create the first client tenant.',
      clientName: 'Organization / Client Name',
      clientCode: 'Client Code (e.g. ACME-01)',
      submitButton: 'Initialize Platform & Create Account',
      submitting: 'Setting up schema and account...',
      completedNotice: 'Platform has already been initialized.',
      dbMissingNotice: 'DATABASE_URL environment variable is not configured.',
      dbMissingHelp: 'Please set DATABASE_URL in your environment or .env file with PostgreSQL connection string.',
      alreadyCompleted: 'Administrator accounts already exist. Please sign in.',
    },

    dashboard: {
      title: 'Sustainability & GRI Dashboard',
      subtitle: 'Real-time ESG compliance metrics, review coverage, and gap status',
      welcome: 'Welcome back',
      emptyTitle: 'No Sustainability Data Imported Yet',
      emptyDescription: 'Your PostgreSQL database has no GRI disclosure records. Import your GRI Standards (.xlsx or .csv) to begin compliance assessments and gap evaluations.',
      importDataAction: 'Import GRI Standards & Disclosures',
      configureDbAction: 'Verify Database Connection',
      complianceSummary: 'Compliance & Coverage Overview',
      reviewCoverage: 'Review Coverage',
      coverageTooltip: 'Calculated as evaluated applicable items divided by all applicable items. Excludes not applicable items.',
      overallScore: 'Weighted ESG Index',
      scoreTooltip: 'Calculated as sum(weight * score) / sum(weight) over applicable and evaluated items. 100 = No Gap, 50 = Partial Gap, 0 = Full Gap.',
      notEvaluated: 'Pending Evaluation',
      notApplicable: 'Excluded (Not Applicable)',
      gapAnalysisTitle: 'Gap Distribution Across Disclosures',
      fullGap: 'Full Gap (Score 0)',
      fullGapDesc: 'Non-compliant or missing disclosures',
      partialGap: 'Partial Gap (Score 50)',
      partialGapDesc: 'Partially documented requirements',
      noGap: 'No Gap (Score 100)',
      noGapDesc: 'Fully compliant disclosures',
      totalStandards: 'Active Standards',
      totalDisclosures: 'Total Disclosures',
      totalItems: 'Reporting Items',
      standardsOverview: 'GRI Standards Catalog',
      standardsOverviewDesc: 'Universal, Environmental, Social, and Governance disclosures in system',
      esgPillars: 'ESG Pillars',
      environmental: 'Environmental',
      social: 'Social',
      governance: 'Governance',
      general: 'Universal Standards',
      tenantContext: 'Active Tenant Context',
    },

    importGRI: {
      title: 'Import GRI Standards & Disclosures',
      subtitle: 'Upload spreadsheet or CSV files with disclosure rows to populate the reporting catalog',
      dragDropText: 'Drag and drop your .xlsx or .csv disclosure file here, or click to browse',
      browseFiles: 'Select File from Computer',
      acceptedFormats: 'Supported formats: Microsoft Excel (.xlsx, .xls) and Comma-Separated Values (.csv)',
      downloadTemplate: 'Download Sample GRI Template (.csv)',
      downloadTemplateHint: 'Use this formatted template to prepare GRI standards, disclosures, priorities, and requirements.',
      parseSuccess: 'File parsed and validated successfully',
      standardsFound: 'Standards Discovered',
      disclosuresFound: 'Disclosures Identified',
      itemsFound: 'Requirements & Items Extracted',
      previewTitle: 'Extracted Disclosure Preview',
      commitButton: 'Commit Records to PostgreSQL',
      committing: 'Committing transaction to database...',
      committedSuccess: 'GRI data successfully imported into PostgreSQL database!',
      committedDescription: 'All standards, disclosures, items, and audit log entries have been committed with tenant RLS isolation.',
      standardsTab: 'Standards',
      disclosuresTab: 'Disclosures',
      itemsTab: 'Items & Requirements',
      warningsTab: 'Validation Warnings',
      standardCode: 'Standard Code',
      standardTitle: 'Standard Title',
      category: 'Category',
      version: 'Version',
      disclosureCode: 'Disclosure Code',
      disclosureTitle: 'Disclosure Title',
      itemCode: 'Item Code',
      requirement: 'Requirement Text',
      priority: 'Priority',
      esgClass: 'ESG Class',
      weight: 'Weight',
      answerType: 'Answer Type',
      clearFile: 'Clear & Choose Another File',
      validationWarnings: 'Validation Warnings',
      noWarnings: 'All rows conform strictly to GRI schema requirements.',
      selectFilePrompt: 'Please select a spreadsheet or CSV file to inspect before committing.',
      importingNotice: 'Records are written to PostgreSQL within a single atomic database transaction.',
      targetTenantLabel: 'Target tenant',
      targetTenantHint: 'As platform admin, choose which tenant receives this import.',
      selectTenantPlaceholder: 'Select a tenant…',
    },

    standards: {
      title: 'GRI Standards Catalog',
      subtitle: 'Browse imported global reporting initiative standards, disclosures, and requirements',
      emptyTitle: 'GRI Standards Catalog is Empty',
      emptyDescription: 'No standards or disclosure items found in the database. Use the GRI import tool to upload disclosure records.',
      emptyAction: 'Import GRI Disclosures',
      searchPlaceholder: 'Search standards by code, title, or category...',
      allCategories: 'All Categories',
      disclosuresCount: 'Disclosures',
      itemsCount: 'Items',
      code: 'Code',
      name: 'Title',
      category: 'Category',
    },

    gapAnalysis: {
      title: 'Gap Analysis & Scoring',
      subtitle: 'Evaluate disclosures against GRI requirements using standard 0 / 50 / 100 scoring',
      emptyTitle: 'No Gap Assessments Active',
      emptyDescription: 'Import GRI standards to enable disclosure evaluations and gap scoring.',
      emptyAction: 'Go to GRI Import',
      queueTitle: 'Department Evaluation Queue',
      queueSubtitle: 'Items assigned to your department with live evaluation state',
      emptyQueueTitle: 'No Items Assigned Yet',
      emptyQueueDesc: 'There are no disclosure items assigned to your department. Import GRI data with department assignments to begin evaluations.',
      selectPrompt: 'Select an item from the queue to evaluate it.',
      priority: 'Priority',
      pillar: 'Pillar',
      topic: 'Topic',
      department: 'Department',
      stNotEvaluated: 'Not evaluated',
      stDraft: 'Draft',
      stSubmitted: 'Submitted',
      stApproved: 'Approved',
      stClientApproved: 'Client approved',
      stReturned: 'Returned',
      stNotApplicable: 'N/A',
      evaluateTitle: 'Evaluate Item',
      scoreLabel: 'Gap score',
      score0: '0 — Full gap',
      score0Desc: 'Requirement not met at all',
      score50: '50 — Partial gap',
      score50Desc: 'Requirement partially met',
      score100: '100 — No gap',
      score100Desc: 'Requirement fully met',
      notEvalLabel: 'Not evaluated',
      notEvalDesc: 'Skip scoring for now; excluded from averages, never counted as zero',
      naLabel: 'Not applicable',
      naDesc: 'Excluded from averages and counters; a reason is stored',
      naReasonLabel: 'N/A reason',
      naReasonOptions: {
        'not-applicable': 'Not applicable to this organization',
        'legal-prohibitions': 'Legal prohibitions',
        'confidentiality-constraints': 'Confidentiality constraints',
        'information-unavailable-incomplete': 'Information unavailable / incomplete',
      },
      evidenceNoteLabel: 'Evidence note',
      evidenceNotePh: 'Reference supporting evidence or system records...',
      saveDraft: 'Save draft',
      submitEval: 'Submit for approval',
      saving: 'Saving...',
      submitting: 'Submitting...',
      approvalTitle: 'Approval',
      approvalDesc: 'Review the submitted evaluation and approve or return it with a comment.',
      approveBtn: 'Approve',
      returnBtn: 'Return',
      commentLabel: 'Comment',
      commentPh: 'Decision comment (required when returning)...',
      selfApprovalNote: 'You evaluated or submitted this item, so self-approval is not offered.',
      decidedApproved: 'Approved',
      decidedReturned: 'Returned for rework',
      historyTitle: 'Revision history',
      historyEmpty: 'No revisions recorded yet.',
      correctionTitle: 'Post-submit correction',
      correctionDesc: 'Submitted evaluations change only through an appended revision with a reason.',
      correctionReasonLabel: 'Correction reason',
      correctionReasonPh: 'Explain why the score changes...',
      applyCorrection: 'Apply correction',
    },

    clients: {
      subtitle: 'Platform clients — server results only; no local filtering or estimates',
      searchLabel: 'Search clients',
      searchHint: 'Name or code',
      search: 'Search',
      clearSearch: 'Clear search',
      refresh: 'Refresh',
      caption: 'Clients and their linked-service collection progress',
      colClient: 'Client',
      colStatus: 'Status',
      colServices: 'Linked services and progress',
      colActions: 'Actions',
      rowCount: '{count} clients returned',
      active: 'Active',
      suspended: 'Suspended',
      statusUnknown: 'Status unavailable',
      emptyTitle: 'No clients yet',
      emptySearchTitle: 'No matching clients',
      loadFailed: 'Clients could not be loaded.',
      noLinkedServices: 'No linked services',
      unmappedService: 'Service standards not mapped',
      mappedItems: 'Mapped items',
      collection: 'Collection',
      pendingSubmission: 'Pending submission',
      frozenPairs: 'Frozen pairs',
      noAssignments: 'No assignments',
      unavailable: 'Unavailable',
      enterWorkspace: 'Enter client workspace',
      configureClient: 'Configure client',
      suspend: 'Suspend',
      unsuspend: 'Unsuspend',
      enterConfirm: 'Open the client workspace for {name}? Pending edits in this platform tab are discarded.',
      suspendConfirm: '{action} {name}?',
      saveFailed: 'The client status could not be updated.',
      suspendSaved: 'Client status updated from the server.',
    },

    workspace: {
      checking: 'Verifying workspace…',
      opening: 'Opening client workspace',
      closing: 'Exiting to Clients',
      confirmFailed: 'Workspace could not be confirmed',
      confirmFailedDesc: 'The workspace state could not be verified. No cached client content is shown. Reconcile the current tab, then choose the destination again.',
      retry: 'Retry',
      exitToClients: 'Exit to Clients',
      exitConfirm: 'Exit the client workspace and return to Clients? Pending edits are discarded.',
      clientSuspended: 'Client suspended',
      backToClients: 'Back to Clients',
      configureTitle: 'Configure client',
    },

    settings: {
      title: 'Platform Settings & Database Diagnostics',
      subtitle: 'PostgreSQL connection status, migrations, RLS policies, and localization preferences',
      databaseConnection: 'PostgreSQL Database Connection',
      dbStatus: 'Database Status',
      connected: 'Connected & Responsive',
      disconnected: 'Disconnected / Unreachable',
      configured: 'DATABASE_URL is Configured',
      notConfigured: 'DATABASE_URL is Missing',
      tableCount: 'Active Database Tables',
      databaseUrlNote: 'Database connection is read from process.env.DATABASE_URL with connection pool limited to 5 connections and TLS enabled.',
      runMigrations: 'Run Database Migrations & RLS Policies',
      migrating: 'Applying schema and policies...',
      migrationsSuccess: 'Database schema, constraints, triggers, and RLS policies successfully applied.',
      languageSettings: 'Language & Regional Localization',
      languageDescription: 'Select your preferred working language. Full right-to-left (RTL) support is applied dynamically.',
      currentLanguage: 'Current Interface Language',
      arabic: 'العربية (Arabic - RTL)',
      english: 'English (LTR)',
      securitySettings: 'Account Security',
      updatePasswordButton: 'Update Password',
      userProfile: 'Current User Identity',
      appThemeSection: 'Application Theme',
      appThemeDescription: 'One theme for the whole application. It takes precedence over every tenant theme and applies immediately to all users after saving.',
      appThemePlatformOnly: 'Platform administrators only. Tenants keep their own theme when this is set to auto.',
      appThemeAuto: 'Automatic (follow each tenant)',
      appThemeAutoHint: 'Every user sees their own tenant theme',
      appThemeGe: 'GE (default)',
      appThemeLime: 'Lime',
      appThemeDark: 'Dark',
      appThemeSave: 'Save application theme',
      appThemeSaving: 'Saving...',
      appThemeSaved: 'Application theme saved. It now applies to all users.',
      appThemeFailed: 'Could not save the application theme.',
    },

    users: {
      title: 'User Management',
      subtitle: 'Accounts are provisioned by GE only, after staff-list approval (accounts are never deleted)',
      listTitle: 'Users',
      emptyList: 'No users found.',
      emailLabel: 'Email',
      passwordLabel: 'Password (min 6 characters)',
      nameLabel: 'Full name',
      roleLabel: 'Role',
      tenantLabel: 'Tenant',
      departmentLabel: 'Department',
      createButton: 'Create user',
      creating: 'Creating…',
      deactivateButton: 'Deactivate',
      reactivateButton: 'Reactivate',
      deactivateConfirm: 'Deactivate this user? They will no longer be able to sign in.',
      activeLabel: 'Active',
      inactiveLabel: 'Deactivated',
      createdSuccess: 'User created successfully.',
      tenantPlaceholder: 'Select a tenant…',
      noTenantOption: 'No tenant (platform admin only)',
      geOnlyNote: 'Account creation and activation are managed by GE only. Client admins: submit a Staff List for GE approval — see Staff Lists.',
    },

    common: {
      loading: 'Loading...',
      save: 'Save Changes',
      cancel: 'Cancel',
      submit: 'Submit',
      close: 'Close',
      refresh: 'Refresh Data',
      success: 'Operation Successful',
      error: 'An Error Occurred',
      warning: 'Attention Required',
      info: 'Information',
      retry: 'Retry',
      actions: 'Actions',
      status: 'Status',
      view: 'View Details',
      learnMore: 'Learn More',
      back: 'Go Back',
      high: 'High',
      mid: 'Medium',
      low: 'Low',
      text: 'Text',
      number: 'Number',
      boolean: 'Yes / No',
        date: 'Date',
        file: 'Document Attachment',
        checking: 'Checking',
        connected: 'Connected',
        disconnected: 'Disconnected',
        yes: 'Yes',
        no: 'No',
      },

    actions: {
      title: 'Corrective Actions',
      subtitle: 'Department-owned follow-ups with a verified close-out (WF-04)',
      listTitle: 'Actions',
      emptyTitle: 'No corrective actions yet',
      emptyDesc: 'Create the first follow-up for your department. Drafts never move numbers; closing an action never changes a score.',
      filterStatus: 'Status',
      filterDepartment: 'Department',
      allStatuses: 'All statuses',
      allDepartments: 'All departments',
      createTitle: 'New corrective action',
      titleLabel: 'Title',
      titlePh: 'e.g. Fix waste segregation in Building B',
      descLabel: 'Description',
      descPh: 'What must be done, and where...',
      deptLabel: 'Owner department',
      itemLabel: 'Linked item (optional)',
      dueLabel: 'Due date (optional)',
      createButton: 'Create action',
      creating: 'Creating...',
      evidenceLabel: 'Evidence (text reference — no file upload in this demo)',
      evidencePh: 'e.g. Waste log 2026-11-30, photos folder W-114...',
      saveEvidence: 'Save evidence note',
      advanceButton: 'Move to next step',
      closeButton: 'Verify & close',
      reopenButton: 'Reopen',
      reasonLabel: 'Reason (required for reopen)',
      reasonPh: 'Why is this action being reopened?...',
      reasonRequired: 'A reason is required to reopen an action.',
      statusLabels: {
        open: 'Open',
        in_progress: 'In progress',
        awaiting_verification: 'Awaiting verification',
        closed: 'Closed',
        reopened: 'Reopened',
      },
      nextOf: {
        open: 'Start work',
        in_progress: 'Submit for verification',
        awaiting_verification: 'Verify & close',
        reopened: 'Restart work',
      },
      updatedMsg: 'Action updated successfully.',
    },

    initiatives: {
      title: 'Initiatives Library',
      subtitle: 'Global catalogue of common initiatives — select the ones adopted by this tenant',
      searchPh: 'Search initiatives by title...',
      filterSector: 'Sector',
      filterEsg: 'E / S / G',
      filterDepartment: 'Department',
      all: 'All',
      selectButton: 'Select for client',
      unselectButton: 'Unselect',
      selectedBadge: 'Selected',
      emptyTitle: 'Initiatives library is empty',
      emptyDesc: 'The global library has no rows yet. Import the workbook initiatives to begin.',
      standardsRef: 'GRI ref',
      department: 'Department',
      sector: 'Sector',
    },

    esgProfile: {
      title: 'ESG Profile',
      subtitle: 'Tenant ESG profile by pillar, department, topic and parameter (sheet semantics preserved)',
      scoreLabel: 'Profile score',
      coverageLabel: 'Coverage',
      ratedLabel: 'Rated parameters',
      pillar: 'Pillar',
      department: 'Department',
      topic: 'Topic',
      parameter: 'Parameter',
      profile: 'Profile',
      rating: 'Rating',
      timeline: 'Timeline',
      impact: 'Eco impact',
      emptyTitle: 'No ESG profile imported',
      emptyDesc: 'Import the workbook ESG Profile sheet for this tenant to see the score and coverage.',
      groupNote: 'RATING / MAX RATING are shown on group rows exactly as in the workbook; the score aggregates all 1–3 ratings.',
    },

    clientReview: {
      title: 'Client review queue',
      subtitle: 'Dept-approved items grouped by disclosure — approve the whole disclosure at client scope',
      emptyTitle: 'No disclosures pending client review',
      emptyDesc: 'When departments approve their evaluations, the disclosure groups appear here.',
      completeness: 'Completeness',
      readyBadge: 'Ready for client approval',
      blockedBadge: 'Blocked — departments pending',
      frozenBadge: 'Frozen (GE final)',
      pendingClient: 'dept-approved, awaiting client decision',
      approveGroupHint: 'Client approval applies per item but requires the whole disclosure to be dept-approved.',
      clientApproveBtn: 'Client-approve',
      clientReturnBtn: 'Return to dept',
      approving: 'Working...',
      commentRequired: 'A comment is required when returning to the department.',
    },

    geFinal: {
      title: 'GE final review & freeze',
      subtitle: 'Verify the completeness checklist, then freeze an immutable snapshot (ge_admin only)',
      scopeLabel: 'Freeze scope',
      scopeDisclosure: 'Disclosure',
      scopeTenant: 'Whole tenant',
      disclosureLabel: 'Disclosure',
      selectDisclosure: 'Copy a disclosure id from the client-review queue…',
      runCheck: 'Run checklist',
      checking: 'Checking...',
      checklistTitle: 'Completeness checklist',
      allClear: 'All in-scope items are client-approved (or N/A with reason). Ready to freeze.',
      blockedItems: 'Blocked items',
      freezeBtn: 'Freeze snapshot',
      freezing: 'Freezing...',
      confirmTitle: 'Confirm freeze',
      confirmDesc: 'Freezing is irreversible. Editing, corrections and imports touching this scope will be refused afterwards; only append-only snapshot notes stay allowed.',
      confirmCheck: 'I understand — freeze this scope now',
      frozenBadge: 'Frozen',
      snapshotTitle: 'Frozen snapshots',
      snapshotEmpty: 'No snapshots frozen for this tenant yet.',
      hashLabel: 'Content hash',
      actorLabel: 'Frozen by',
      timeLabel: 'Frozen at',
      aggregateLabel: 'Frozen score',
      coverageLabel: 'Frozen coverage',
      noteLabel: 'Post-freeze note (append-only)',
      notePh: 'Add an audit note linked to this snapshot...',
      addNote: 'Add note',
      addingNote: 'Adding...',
      viewerTitle: 'Snapshot detail',
      alreadyFrozen: 'This scope is already frozen.',
    },

    conflict: {
      title: 'Version conflict — someone else saved first',
      desc: 'Your version is stale. Compare the current server values below, reload, then retry.',
      mineLabel: 'You attempted',
      theirsLabel: 'Current on server',
      reloadRetry: 'Reload & retry',
      versionLabel: 'Version',
      actorLabel: 'Actor',
      timeLabel: 'Time',
    },

    attachments: {
      title: 'Evidence attachments (max 5 MB each)',
      attachBtn: 'Attach file',
      uploading: 'Uploading...',
      emptyText: 'No evidence files attached yet.',
      downloadBtn: 'Download',
      deleteBtn: 'Delete',
      deleteConfirm: 'Delete this attachment?',
      oversize: 'File is too large. Evidence attachments are limited to 5 MB per file.',
      mime: 'File type not allowed. Accepted types: PDF, PNG, JPEG, XLSX, CSV, TXT.',
      missing: 'Choose a file first.',
      uploadFailed: 'Upload failed.',
      typesNote: 'PDF, PNG, JPEG, XLSX, CSV, TXT — 5 MB max, stored in-demo (OD-06).',
      usageLabel: 'Attachment storage',
    },

    storage: {
      title: 'Evidence storage',
      subtitle: 'Per-tenant attachment usage (demo DB capacity is 1 GB)',
      bytesLabel: 'Used',
      filesLabel: 'Files',
      warnMsg: 'Storage is above the 800 MB demo warning threshold.',
      okMsg: 'Storage is within the demo budget.',
    },

    weights: {
      title: 'Priority weights',
      subtitle: 'Display-only reference used by every score in this demo',
      high: 'High = 3',
      mid: 'Medium = 2',
      low: 'Low = 1',
      notice: 'Scoring detail is pinned in the scoring rule: weight is derived from priority (High 3 / Mid 2 / Low 1) and drafts never count.',
    },

    reports: {
      navLabel: 'Reports',
      title: 'GRI Reports (D-038)',
      subtitle: 'Executive, management, and detailed views — gated by report level, same numbers everywhere',
      levelTabL1: 'L1 · Executive',
      levelTabL2: 'L2 · Management',
      levelTabL3: 'L3 · Detailed',
      levelDescL1: 'Headline score, review coverage, and the biggest gaps — honest summary, no trend claims.',
      levelDescL2: 'Scores by department and standard, corrective actions, and the omissions summary.',
      levelDescL3: 'Full disclosure index with statement of use and notification record.',
      headlineScore: 'Headline score',
      topGaps: 'Biggest gaps',
      byDepartment: 'Scores by department',
      byStandard: 'Disclosures by standard',
      actionsSummary: 'Corrective actions',
      omissionsSummary: 'Omissions summary',
      noOmissions: 'No omitted disclosures.',
      standard: 'Standard',
      disclosure: 'Disclosure',
      location: 'Location in evidence',
      locationMissing: 'Not referenced yet',
      omission: 'Omitted',
      omittedYes: 'Yes',
      omittedNo: 'No',
      reason: 'Reason',
      explanation: 'Explanation',
      reasonLabels: {
        'not-applicable': 'Not applicable to this organization',
        'legal-prohibitions': 'Legal prohibitions',
        'confidentiality-constraints': 'Confidentiality constraints',
        'information-unavailable-incomplete': 'Information unavailable / incomplete',
      },
      score: 'Score',
      coverage: 'Coverage',
      items: 'Items',
      departments: 'Departments',
      statementTitle: 'Statement of use',
      statementName: 'Organization name',
      statementPeriod: 'Reporting period',
      notificationTitle: 'GRI notification record',
      notifiedDone: 'Notified',
      notifiedNotDone: 'Not notified',
      notifiedDate: 'Notification date',
      notifyRef: 'Notification reference',
      notificationRecordNote: 'This is a record only — the platform never sends the notification.',
      settingsTitle: 'Report settings (D-038)',
      settingsDesc: 'Level is stored per client and service. Export stays blocked until all required fields are set.',
      disclosureLevel: 'Disclosure level',
      reportLevel: 'Report level',
      inAccordance: 'In accordance',
      withReference: 'With reference',
      saveSettings: 'Save report settings',
      saving: 'Saving...',
      savedMsg: 'Report settings saved. Export is now unblocked for this client and service.',
      gateBlocked: 'Export blocked — set the D-038 level first.',
      gateOk: 'Level set — export unblocked.',
      exportJson: 'Export JSON',
      exportCsv: 'Export CSV',
      printBtn: 'Print / PDF',
      loading: 'Building report...',
      loadError: 'Failed to build the report.',
      incompleteTitle: 'Disclosures omitted without reason and explanation',
      selectLevelHint: 'Set the report level above, then pick a view.',
    },

    services: {
      title: 'Services',
      subtitle: 'GE-managed service catalog: create, edit, link standards, duplicate',
      listTitle: 'Services',
      emptyText: 'No services yet. Create the first one below.',
      codeLabel: 'Code',
      nameLabel: 'Name',
      descLabel: 'Description',
      createButton: 'Create service',
      creating: 'Creating...',
      saveButton: 'Save',
      saving: 'Saving...',
      editButton: 'Edit',
      duplicateButton: 'Duplicate',
      duplicating: 'Duplicating...',
      newCodeLabel: 'New service code',
      newCodePh: 'e.g. GRI-CONSULT-02',
      linkedLabel: 'Linked standards',
      linkButton: 'Link',
      unlinkButton: 'Unlink',
      manageHint: 'Services and their standard links are managed by platform admins only.',
    },

    servicesWorkspace: {
      headerSubtitle: 'One workspace per service — definition, content, settings, import',
      railSearchLabel: 'Search services',
      railSearchPh: 'Name or code',
      railEmpty: 'No services yet',
      railEmptyHint: 'Create the first service to see it here.',
      createHint: 'A new service starts empty; content comes from the Content tab and the importer.',
      emptySearch: 'No matching services.',
      selectTitle: 'No service selected',
      selectHint: 'Pick a service from the rail or create a new one.',
      statusReady: 'Content ready',
      statusEmpty: 'No content',
      tabOverview: 'Overview',
      tabContent: 'Content',
      tabRules: 'Rules',
      tabSettings: 'Settings',
      tabImport: 'Import',
      definition: 'Service definition',
      created: 'Created',
      descriptionEmpty: 'No description',
      linkedClients: 'Linked clients',
      clientsUnit: 'Linked clients',
      lastImport: 'Last import',
      lastImportNone: 'not available per service',
      lastImportHint: 'import events are recorded per tenant in the audit log.',
      contentState: 'Content state',
      contentEmpty: 'No items yet — start from the Import tab or add an item.',
      contentOk: 'Content is ready for linking and assignment.',
      duplicateHint: 'Standard links are copied to the new code; content is not copied.',
      duplicateCodeLabel: 'New service code',
      duplicateNameLabel: 'Name (optional)',
      duplicateSubmit: 'Create copy',
      breadcrumbAll: 'All standards',
      levelStandards: 'Standards',
      levelDisclosures: 'Disclosures',
      levelItems: 'Items',
      searchLevelPh: 'Search this level',
      addStandard: 'Link standard',
      addStandardHint: 'Standards are created by the importer; this links an existing one to the service.',
      noStandards: 'No standards linked',
      noStandardsHint: 'Link a standard to start the content.',
      noDisclosures: 'No disclosures',
      noDisclosuresHint: 'This standard has no disclosures inside this service.',
      noItems: 'No items',
      noItemsHint: 'Add an item or import the service data.',
      disclosureImportNote: 'Disclosures are created by the importer.',
      itemDetail: 'Item detail',
      itemRequirement: 'Requirement',
      itemAnswerType: 'Answer type',
      itemPriority: 'Priority',
      itemEsgClass: 'Classification',
      itemHint: 'Hint',
      codeImmutable: 'The code is immutable.',
      attachmentRequired: 'Attachment required',
      attachmentNotRequired: 'No attachment',
      attachmentReadOnly: 'read from the server, not editable here',
      selectedCount: 'Selected: {n}',
      bulkAssign: 'Assign selected',
      bulkDone: '{n} assigned',
      bulkNoClients: 'No client is linked to this service.',
      rulesShownOf: 'Showing {shown} of {total}',
      discardDraft: 'You have unsaved changes. Discard them?',
      dirtyDraft: 'Unsaved changes',
      unlinkStandardConfirm: 'Unlink standard {code} from this service?',
      identityTitle: 'Service identity',
      identitySave: 'Save identity',
      settingsHint: 'The object is written whole (replace) and capped at 8 KB. The API exposes no read of stored settings before writing.',
      settingsSave: 'Save settings',
      settingsInvalid: 'Enter a valid JSON object (not an array or a scalar).',
      settingsEcho: 'Server response after saving:',
      actionFailed: 'The operation could not be completed.',
      workspaceLoadFailed: 'Services data could not be loaded.',
      fieldRequired: 'This field is required.',
      importTitle: 'Import service data',
      importDrop: 'Drop the file here or choose it',
      importFormats: 'Excel or CSV with columns: Standard Code, Standard Title, Category, Disclosure Code, Disclosure Title, Item Code, Requirement (optional: Priority, ESG Class, Answer Type, Hint, Department).',
      importPreview: 'Preview',
      importPreviewing: 'Parsing...',
      importConfirm: 'Import into «{service}» for client «{client}»? The catalogue is updated by this batch.',
      importConfirmAction: 'Confirm import',
      importing: 'Importing...',
      importDone: 'Imported — standards / disclosures / items',
      importFailed: 'The import could not be completed.',
      contentGroups: 'Groups',
      contentGroup: 'Group',
      contentDirect: 'Direct items',
      directHint: 'Items of the GENERAL disclosure — no standard or disclosure of their own.',
      archivedCount: 'Archived items',
      archivedSection: 'Archived (history retained)',
      archivedBadge: 'Archived',
      linkedReadOnly: 'read-only',
      approvedCopiesTitle: 'Sealed approved copies',
      approvedCopiesNone: 'No client is linked to this service yet.',
      approvedCopySealed: 'Sealed',
      approvedCopyMissing: 'No sealed copy',
      approvedCopiesHint: 'Read-only. A sealed copy survives any later change to this service, including full removal.',
      namedSettingsTitle: 'Service settings (named fields)',
      namedSettingsHint: 'Only these named fields are written. The whole object replaces the previous one (max 8 KB). The API exposes no settings read before writing.',
      namedSettingsReplace: 'Saved as one object — unknown keys are never sent.',
      settingDefaultAnswerType: 'Default answer type',
      settingDefaultAnswerTypeHint: 'Pre-selected for newly created items.',
      settingDefaultPriority: 'Default priority',
      settingDefaultPriorityHint: 'Weight follows priority (High 3 / Medium 2 / Low 1).',
      settingDefaultEsgClass: 'Default classification',
      settingDefaultEsgClassHint: 'Environmental, social, governance or general.',
      settingAttachmentDefault: 'Attachment required by default',
      settingAttachmentDefaultHint: 'New items require an attachment.',
      settingVisibleDefault: 'Visible in reports by default',
      settingVisibleDefaultHint: 'Visibility default for new items.',
      frozenScopeBanner: 'Read-only — finally approved (GE-final snapshot).',
      historyReopened: '{n} reopened answer(s) — the previous answers are kept in the history below.',
      historyTitle: 'History',
      historyFailed: 'History could not be loaded.',
      historyEmpty: 'No versions or answers recorded yet.',
      templateDownload: 'Download per-service template (.csv)',
      templateDownloadHint: 'One template per service with the GRI columns for this service kind.',
      mappingTitle: 'Column mapping',
      mappingHint: 'Match each canonical column to a file header. Headers with no match are shown after preview — never silently dropped.',
      mappingFileColumn: 'File header',
      importConfirmService: 'Commit this preview into «{service}»? The catalogue is updated by this batch.',
      unmappedTitle: 'Unmapped file columns',
      rowErrorsTitle: 'Row errors',
      commitBlocked: 'Commit is blocked while row errors exist — fix the file and preview again.',
      previewClean: 'Preview is clean — no row errors.',
      createStandard: 'New standard',
      editStandard: 'Edit standard',
      deleteStandardConfirm: 'Delete this standard? Refused while disclosures exist.',
      createGroup: 'New group',
      newGroupStandard: 'New group container ({code})',
      createGroupHint: 'A group is a disclosure under a group-category standard. A new container standard is created only when none exists.',
      editGroup: 'Edit group',
      deleteGroupConfirm: 'Delete this group? Refused while items exist.',
      createDisclosure: 'New disclosure',
      editDisclosure: 'Edit disclosure',
      deleteDisclosureConfirm: 'Delete this disclosure? Refused while items exist.',
      itemDepartment: 'Department (single)',
      itemDepartmentNone: 'No department',
      singleDeptNote: 'One item belongs to at most one department. Assignment to clients happens outside this screen.',
      saveConflictHint: 'Someone else saved first. Reload and retry — your draft is kept.',
      deleteItemTitle: 'Delete item',
      deleteItemHint: 'Items with tenant work are archived with their history kept — never hard-deleted. Only work-free items are permanently deleted.',
      deleteReasonPh: 'Archive reason (optional)',
      deleteItemConfirm: 'Confirm delete',
      itemArchivedNote: 'Archived with history kept — read-only. It is out of the live scope.',
      bulkEditDone: '{ok} of {n} updated',
      bulkUnset: 'No change',
      bulkEditApply: 'Apply bulk edit',
      bulkEditHint: 'Only answer type, priority, classification and attachment flag. Department changes stay single-item.',
      bulkRowOk: 'Updated',
    },

    employeeServices: {
      title: 'My department services',
      subtitle: 'Answer assigned items, attach evidence, and track documents and initiatives — own department only.',
      railTitle: 'Linked services',
      railSearchLabel: 'Search services',
      railSearchPh: 'Name or code',
      railEmpty: 'No services assigned to your department',
      railEmptyHint: 'Contact your administrator if you expect work here.',
      emptySearch: 'No matching services.',
      countsAssigned: 'Assigned',
      countsSubmitted: 'Submitted',
      countsPending: 'Pending',
      tabItems: 'Items',
      tabDocuments: 'Documents',
      tabInitiatives: 'Initiatives',
      actionFailed: 'The action could not be completed.',
      loadFailed: 'The employee workspace could not be loaded.',
      searchItemsPh: 'Search by code or requirement',
      itemsEmpty: 'No items in this service',
      itemsEmptyHint: 'Items assigned to your department will appear here.',
      selectItemHint: 'Select an item to view and answer it.',
      answerSection: 'Answer',
      answerTypeLabel: 'Answer type',
      fileAnswerNote: 'The attachment IS the answer for this item — no text is accepted. Save a draft first, then attach the file.',
      outcomeSection: 'Evaluation outcome',
      outcomeScore: 'Score',
      outcomeNotEvaluated: 'Not evaluated',
      outcomeNA: 'Not applicable',
      naReasonLabel: 'N/A reason (mandatory)',
      saveDraft: 'Save draft',
      saving: 'Saving…',
      submitAnswer: 'Submit for approval',
      submitting: 'Submitting…',
      attachmentRequiredTitle: 'Attachment required',
      attachmentRequiredDesc: 'This item requires at least one attachment before it can be submitted.',
      attachmentRequiredNa: 'A not-applicable outcome does not waive the attachment requirement.',
      attachmentLockedNote: 'Attachments are locked after submit — draft only.',
      noAnswerYet: 'No answer saved yet.',
      unsavedChanges: 'Unsaved changes — save or discard before leaving.',
      unsavedTitle: 'Leave without saving?',
      detailLoadFailed: 'The item detail could not be loaded.',
      docsTitle: 'Department documents',
      docsEmpty: 'No document requirements for your department',
      docsEmptyHint: 'Requirements linked to your department will appear here.',
      docRequired: 'Required',
      docProvided: 'Submitted',
      markProvided: 'Mark as provided',
      noteLabel: 'Note',
      notePh: 'Add a note (optional)',
      tagLabel: 'Tag',
      tagPh: 'Single tag (optional)',
      saveChanges: 'Save changes',
      savingChanges: 'Saving…',
      submittedAtLabel: 'Submitted at',
      proofFilesTitle: 'Proof files',
      initsTitle: 'Assigned initiatives',
      initsEmpty: 'No initiatives assigned to your department',
      initsEmptyHint: 'Initiatives selected for your department will appear here.',
      performedLabel: 'Performed',
      notPerformedLabel: 'Not performed',
      versionConflict: 'Someone else saved first. Reload and retry — your draft is kept.',
    },

    taxonomy: {
      manageTitle: 'Taxonomy management',
      manageSubtitle: 'Edit titles, manage items and equivalent-item links (platform admins only)',
      importOwnsNote: 'Standards, disclosures and items are created by the GRI import. Use this panel only for surgical fixes: titles, items, links.',
      showManage: 'Manage taxonomy',
      hideManage: 'Hide management',
      editButton: 'Edit',
      saveButton: 'Save',
      saving: 'Saving...',
      deleteButton: 'Delete',
      deleting: 'Deleting...',
      titleLabel: 'Title',
      categoryLabel: 'Category',
      descLabel: 'Description',
      disclosuresTitle: 'Disclosures',
      itemsTitle: 'Items',
      addItemButton: 'Add item',
      addingItem: 'Adding...',
      requirementLabel: 'Requirement',
      requirementPh: 'Requirement text...',
      codeLabel: 'Code',
      codePh: 'e.g. 2-1-c',
      priorityLabel: 'Priority',
      esgLabel: 'ESG class',
      answerTypeLabel: 'Answer type',
      hintLabel: 'Hint',
      objectiveLabel: 'Objective',
      topicLabel: 'Topic',
      referenceLabel: 'Reference',
      codeImmutableNote: 'Code is immutable (natural import key).',
      linksTitle: 'Equivalent-item links',
      linkToLabel: 'Link to item code',
      linkButton: 'Link items',
      linking: 'Linking...',
      unlinkButton: 'Unlink',
      unlinkConfirm: 'Remove this equivalent-item link?',
      noLinksText: 'No equivalent-item links yet.',
      evaluatedBadge: 'Evaluated',
      notEvaluatedByDept: 'not evaluated by your department',
      relationLabel: 'Relation',
      deleteStdConfirm: 'Delete this standard? Refused while disclosures exist.',
      deleteDiscConfirm: 'Delete this disclosure? Refused while items exist.',
      deleteItemConfirm: 'Delete this item? Refused while answers, evaluations or assignments reference it.',
    },

    geOverview: {
      title: 'GE Operations',
      subtitle: 'Clients, services, collection status, review progress, gaps, actions (platform admins only)',
      totalsClients: 'Clients',
      activeLabel: 'Active clients',
      pendingStaffListsLabel: 'Pending staff lists',
      totalsSuspended: 'Suspended',
      totalsServices: 'Services',
      suspendBtn: 'Suspend',
      unsuspendBtn: 'Unsuspend',
      linkAllBtn: 'Link GRI to all tenants',
      frozenBadge: 'Frozen',
      suspendedBadge: 'Suspended',
      servicesLabel: 'Services',
      reviewLabel: 'Review',
      actionsLabel: 'Actions',
      staffLabel: 'Staff lists',
      coverageLabel: 'Coverage',
      scoreLabel: 'Score',
    },
    clientDetail: {
      title: 'Client detail',
      subtitle: 'Tenant services, flags, departments, users, assignments (GE ops; client sees own only)',
      selectTenant: 'Select a tenant…',
      servicesTitle: 'Linked services',
      linkService: 'Link service',
      unlinkBtn: 'Unlink',
      showGap: 'Show gaps',
      showCorrective: 'Show corrective',
      saveFlags: 'Save flags',
      suspendTitle: 'Suspend / unsuspend',
      departmentsTitle: 'Departments',
      usersTitle: 'Users',
      mustChangeBadge: 'Must change password',
      suspendedNote: 'Suspended tenants cannot sign in (login returns suspended with no data).',
    },
    staffLists: {
      title: 'Staff lists',
      subtitle: 'Client submits drafts; GE approves (provisions accounts, OTP once) or rejects with reason',
      createTitle: 'New staff list (draft)',
      emailPh: 'staff@client.test',
      namePh: 'Full name',
      addRow: 'Add row',
      submitList: 'Submit for GE approval',
      approveBtn: 'Approve & provision',
      rejectBtn: 'Reject',
      rejectReasonPh: 'Rejection reason (required)…',
      otpTitle: 'One-time passwords — shown ONCE (copy now, never stored)',
      otpWarning: 'Passwords are bcrypt-hashed; plaintext never stored or logged. Accounts start with forced password change.',
      emptyText: 'No staff lists yet.',
      statusLabels: { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' },
    },
    clientDashboard: {
      title: 'Client dashboard',
      subtitle: 'Own tenant only — same scoring math (drafts excluded, N/A excluded, coverage beside every score)',
      suspendedTitle: 'Tenant suspended',
      suspendedDesc: 'This tenant is suspended. Contact the platform administrator. No data is shown.',
      aggregateTitle: 'Review aggregate',
      coverageLabel: 'Coverage',
      departmentsTitle: 'Scores by department',
      servicesTitle: 'Linked services',
      hiddenNote: 'Hidden by service flags (excluded from reports/exports).',
    },
    assignments: {
      title: 'Manual assignments',
      assignBtn: 'Assign',
      unassignBtn: 'Unassign',
      naBtn: 'Mark N/A',
      naReasonLabel: 'N/A reason',
      itemLabel: 'Item',
      deptLabel: 'Department',
      justificationPh: 'justification…',
    },
    b16: {
      preliminaryBadge: 'Dept-approved — preliminary, pending client confirmation',
      deptApprovalTitle: 'Department approval',
      deptApprovalDesc: 'Members of this department review the submitted evaluation. When a head is assigned, only the head may approve or return.',
      headOnlyNote: 'This department has an assigned head — only the head may approve or return here.',
      clientNoDraftTitle: 'Evaluation drafts belong to departments',
      clientNoDraftDesc: 'Client administrators do not file drafts. Confirm submitted work at client scope instead — use the client-review queue below (client-approve / client-return).',
      geNoDraftTitle: 'GE never files fresh evaluations',
      geNoDraftDesc: 'Platform administrators rate via reasoned correction instead — use the correction box below with a reason.',
      correctionForbiddenTitle: 'Corrections are not a client path',
      correctionForbiddenDesc: 'Client administrators do not correct evaluations directly. Return the evaluation to the department with a reason instead.',
      importGeOnlyTitle: 'Imports are GE-only',
      importGeOnlyDesc: 'GRI and ESG-profile imports are filed by platform administrators only. Review imported data read-only in Standards / Gap Analysis / ESG Profile.',
      reportSettingsGeOnlyTitle: 'Report levels are set by GE',
      reportSettingsGeOnlyDesc: 'Only platform administrators set D-038 levels. Reports and gated exports stay available below.',
      assignGeOnlyTitle: 'Assignments are managed by GE',
      assignGeOnlyDesc: 'Manual assignments and N/A shortcuts are GE-only. The assignment list below is read-only.',
      actionsGeOnlyTitle: 'Corrective-action control is GE-only',
      actionsGeOnlyDesc: 'Only platform administrators open actions or verify / close / reopen them. Departments start work and save evidence notes on assigned actions.',
      initiativesGeOnlyTitle: 'Initiative selection is GE-only',
      initiativesGeOnlyDesc: 'Only platform administrators select initiatives for a tenant. The library below is read-only.',
      headTitle: 'Department head (GE)',
      headDesc: 'Designate the head per department. When set, only the head may dept-approve or return that department\u2019s evaluations; when empty, any member of the department may.',
      headLabel: 'Head',
      headNone: 'No head assigned — any member may approve',
      headAssign: 'Set head',
      headClear: 'Clear head',
      headSaved: 'Department head updated.',
      deptHeadBadge: 'Head',
    },

    audit: {
      title: 'Audit Log',
      subtitle: 'Who did what, when — with before/after values and reasons. Platform administrators only.',
      filterAction: 'Action contains',
      filterEntity: 'Entity type',
      filterUser: 'User ID',
      filterFrom: 'From',
      filterTo: 'To',
      search: 'Search',
      clear: 'Clear',
      who: 'Who',
      what: 'Action',
      entity: 'Entity',
      when: 'When',
      before: 'Before',
      after: 'After',
      reason: 'Reason',
      payload: 'Details',
      empty: 'No audit entries match these filters.',
      limit: 'Rows',
    },

    notifications: {
      title: 'Notifications',
      subtitle: 'Latest activity addressed to you — newest first. The inbox keeps the latest 50.',
      markAllRead: 'Mark all read',
      markRead: 'Mark read',
      empty: 'No notifications yet.',
      allCaughtUp: "You're all caught up.",
      unread: 'unread',
    },

    idle: {
      warningTitle: 'Session expiring soon',
      warningMessage: 'You will be signed out automatically due to inactivity.',
      secondsLeft: 'seconds left',
      staySignedIn: 'Stay signed in',
      signOutNow: 'Sign out now',
    },
  },

  ar: {
    appName: 'منصة ESG GRI',
    appTagline: 'نظام إدارة الاستدامة وتقارير المبادرة العالمية للتقارير GRI',
    brandGreenEdge: 'منصة ESG GRI',

    nav: {
      dashboard: 'لوحة المؤشرات',
      standards: 'معايير GRI',
      gapAnalysis: 'تحليل الفجوات',
      correctiveActions: 'الإجراءات التصحيحية',
      initiatives: 'مكتبة المبادرات',
      esgProfile: 'الملف البيئي والاجتماعي (ESG)',
      importGRI: 'استيراد بيانات GRI',
      auditLog: 'سجل التدقيق',
      settings: 'الإعدادات وقاعدة البيانات',
      profile: 'الملف الشخصي',
      logout: 'تسجيل الخروج',
      login: 'تسجيل الدخول',
      setup: 'التهيئة الأولية',
      tenantBadge: 'المستأجر',
      reports: 'التقارير',
      geOverview: 'عمليات GE',
      clientDetail: 'تفاصيل العميل',
      staffLists: 'قوائم الموظفين',
      clientDashboard: 'لوحة العميل',
      notifications: 'الإشعارات',
    },

    auth: {
      signInTitle: 'مرحباً بك في منصة ESG GRI',
      signInSubtitle: 'سجّل الدخول للوصول إلى لوحة امتثال الاستدامة ومعايير GRI',
      emailLabel: 'البريد الإلكتروني',
      emailPlaceholder: 'user@company.com',
      passwordLabel: 'كلمة المرور',
      passwordPlaceholder: '••••••••',
      signInButton: 'تسجيل الدخول إلى المنصة',
      signingIn: 'جارٍ التحقق...',
      invalidCredentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
      logoutConfirm: 'هل أنت متأكد من رغبتك في تسجيل الخروج؟',
      logoutSuccess: 'تم تسجيل الخروج بنجاح.',
      changePassword: 'تغيير كلمة المرور',
      changePasswordTitle: 'الأمان وتحديث كلمة المرور',
      currentPassword: 'كلمة المرور الحالية',
      newPassword: 'كلمة المرور الجديدة',
      confirmPassword: 'تأكيد كلمة المرور الجديدة',
      passwordChangedSuccess: 'تم تحديث كلمة المرور الخاصة بك بنجاح وأمان.',
      passwordMismatch: 'كلمة المرور الجديدة وتأكيدها غير متطابقين.',
      passwordTooShort: 'يجب أن تتكون كلمة المرور الجديدة من 10 أحرف على الأقل وتشمل حرفاً كبيراً وصغيراً ورقماً ورمزاً.',
      passwordComplexityHint: '10 أحرف على الأقل: حرف كبير وصغير ورقم ورمز.',
      forcedChangeTitle: 'تغيير كلمة المرور مطلوب',
      forcedChangeDesc: 'تم إنشاء حسابك بكلمة مرور لمرة واحدة. عيّن كلمة مرور جديدة للمتابعة.',
      changeAndContinue: 'تغيير كلمة المرور والمتابعة',
      role: 'الدور الوظيفي',
      roles: {
        ge_admin: 'مدير المنصة',
        client_admin: 'مدير العميل (المستأجر)',
        employee: 'موظف القسم',
      },
      tenant: 'العميل المستأجر',
      department: 'القسم',
      dbUnconfiguredNotice: 'اتصال PostgreSQL المباشر (DATABASE_URL) غير معين حتى الآن.',
      dbUnconfiguredHelp: 'قم بتعيين DATABASE_URL في البيئة أو ملف .env لحفظ السجلات مع عزل RLS.',
    },

    contextIdentity: {
      platformAdmin: 'إدارة المنصة',
      consultantWorkspace: 'مساحة الاستشاري',
      company: 'الشركة',
      department: 'القسم',
    },

    setup: {
      title: 'تهيئة منصة ESG GRI',
      subtitle: 'إنشاء حساب المسؤول الرئيسي والتحقق من قاعدة بيانات PostgreSQL',
      adminName: 'الاسم الكامل',
      adminEmail: 'بريد المسؤول الإلكتروني',
      adminPassword: 'كلمة المرور',
      adminPasswordHint: '10 أحرف على الأقل تشمل حرفاً كبيراً وصغيراً ورقماً ورمزاً — حافظ على سريتها',
      clientSectionTitle: 'تفاصيل العميل المستأجر (اختياري)',
      clientSectionDesc: 'اتركه فارغاً للتهيئة كمدير للمنصة، أو أدخل بيانات المنشأة لإنشاء العميل الأول.',
      clientName: 'اسم المنشأة / العميل',
      clientCode: 'رمز العميل (مثال: ACME-01)',
      submitButton: 'تهيئة المنصة وإنشاء الحساب',
      submitting: 'جارٍ إعداد المخطط والحساب...',
      completedNotice: 'تمت تهيئة المنصة مسبقاً بنجاح.',
      dbMissingNotice: 'متغير البيئة DATABASE_URL غير مهيأ.',
      dbMissingHelp: 'يرجى تعيين DATABASE_URL في البيئة أو ملف .env بسلسلة اتصال PostgreSQL.',
      alreadyCompleted: 'حسابات المسؤولين موجودة مسبقاً. يرجى تسجيل الدخول.',
    },

    dashboard: {
      title: 'لوحة مؤشرات الاستدامة وGRI',
      subtitle: 'مؤشرات الامتثال المباشرة، وتغطية المراجعة، وتوزيع الفجوات',
      welcome: 'مرحباً بك مجدداً',
      emptyTitle: 'لا توجد بيانات استدامة مستوردة حتى الآن',
      emptyDescription: 'قاعدة بيانات PostgreSQL لا تحتوي على أي سجلات إفصاح. قم باستيراد معايير GRI (.xlsx أو .csv) للبدء في تقييمات الامتثال وتحليل الفجوات.',
      importDataAction: 'استيراد معايير وإفصاحات GRI',
      configureDbAction: 'التحقق من اتصال قاعدة البيانات',
      complianceSummary: 'ملخص الامتثال والتغطية',
      reviewCoverage: 'تغطية المراجعة',
      coverageTooltip: 'تُحسب بقسمة البنود المطبقة المقيمة على إجمالي البنود المطبقة، مع استبعاد البنود غير المطبقة.',
      overallScore: 'المؤشر المرجح للاستدامة',
      scoreTooltip: 'يُحسب من حاصل جمع (الوزن × الدرجة) مقسوماً على مجموع الأوزان للبنود المطبقة والمقيمة. 100 = بدون فجوة، 50 = فجوة جزئية، 0 = فجوة كاملة.',
      notEvaluated: 'قيد التقييم',
      notApplicable: 'مستبعد (غير مطبق)',
      gapAnalysisTitle: 'توزيع الفجوات عبر الإفصاحات',
      fullGap: 'فجوة كاملة (درجة 0)',
      fullGapDesc: 'متطلبات غير ممتثلة أو مفقودة بالكامل',
      partialGap: 'فجوة جزئية (درجة 50)',
      partialGapDesc: 'متطلبات موثقة أو ممتثلة جزئياً',
      noGap: 'بدون فجوة (درجة 100)',
      noGapDesc: 'إفصاحات ممتثلة بالكامل وبأعلى جودة',
      totalStandards: 'المعايير النشطة',
      totalDisclosures: 'إجمالي الإفصاحات',
      totalItems: 'بنود التقرير',
      standardsOverview: 'دليل معايير GRI',
      standardsOverviewDesc: 'الإفصاحات العامة والبيئية والاجتماعية والحوكمية',
      esgPillars: 'ركائز الاستدامة (ESG)',
      environmental: 'البيئي (Environmental)',
      social: 'الاجتماعي (Social)',
      governance: 'الحوكمة (Governance)',
      general: 'المعايير العامة (Universal)',
      tenantContext: 'سياق المستأجر النشط',
    },

    importGRI: {
      title: 'استيراد معايير وإفصاحات GRI',
      subtitle: 'رفع ملفات جداول البيانات أو CSV لصفوف الإفصاحات لتغذية دليل التقارير',
      dragDropText: 'اسحب وأفلت ملف إفصاحات .xlsx أو .csv هنا، أو انقر للاختيار',
      browseFiles: 'اختيار ملف من الجهاز',
      acceptedFormats: 'الصيغ المدعومة: جداول مايكروسوفت إكسل (.xlsx, .xls) وقيم مفصولة بفواصل (.csv)',
      downloadTemplate: 'تحميل نموذج GRI التجريبي (.csv)',
      downloadTemplateHint: 'استخدم هذا النموذج المنسق لتجهيز معايير وإفصاحات ومتطلبات GRI وأوزانها.',
      parseSuccess: 'تم تحليل الملف والتحقق من صحته بنجاح',
      standardsFound: 'المعايير المكتشفة',
      disclosuresFound: 'الإفصاحات المحددة',
      itemsFound: 'البنود والمتطلبات المستخرجة',
      previewTitle: 'معاينة الإفصاحات المستخرجة',
      commitButton: 'اعتماد السجلات في قاعدة بيانات PostgreSQL',
      committing: 'جارٍ اعتماد المعاملة في قاعدة البيانات...',
      committedSuccess: 'تم استيراد بيانات GRI بنجاح في قاعدة بيانات PostgreSQL!',
      committedDescription: 'تم حفظ كافة المعايير والإفصاحات والبنود وسجلات التدقيق مع عزل RLS للمستأجرين.',
      standardsTab: 'المعايير',
      disclosuresTab: 'الإفصاحات',
      itemsTab: 'البنود والمتطلبات',
      warningsTab: 'تنبيهات التحقق',
      standardCode: 'رمز المعيار',
      standardTitle: 'عنوان المعيار',
      category: 'الفئة',
      version: 'الإصدار',
      disclosureCode: 'رمز الإفصاح',
      disclosureTitle: 'عنوان الإفصاح',
      itemCode: 'رمز البند',
      requirement: 'نص المتطلب',
      priority: 'الأولوية',
      esgClass: 'تصنيف ESG',
      weight: 'الوزن',
      answerType: 'نوع الإجابة',
      clearFile: 'مسح واختيار ملف آخر',
      validationWarnings: 'تنبيهات التحقق',
      noWarnings: 'جميع الصفوف متطابقة تماماً مع متطلبات مخطط GRI.',
      selectFilePrompt: 'يرجى اختيار ملف جدول بيانات أو CSV لمعاينته قبل الاعتماد.',
      importingNotice: 'تُكتب السجلات إلى PostgreSQL داخل معاملة قاعدة بيانات ذرية موحدة.',
      targetTenantLabel: 'المستأجر المستهدف',
      targetTenantHint: 'بصفتك مدير المنصة، اختر المستأجر الذي سيستقبل هذا الاستيراد.',
      selectTenantPlaceholder: 'اختر مستأجراً…',
    },

    standards: {
      title: 'دليل معايير GRI',
      subtitle: 'استعراض معايير وإفصاحات ومتطلبات المبادرة العالمية للتقارير المستوردة',
      emptyTitle: 'دليل معايير GRI فارغ حالياً',
      emptyDescription: 'لم يتم العثور على أي معايير أو بنود إفصاح في قاعدة البيانات. استخدم أداة استيراد GRI لرفع سجلات الإفصاح.',
      emptyAction: 'استيراد إفصاحات GRI',
      searchPlaceholder: 'البحث في المعايير بالرمز، العنوان، أو الفئة...',
      allCategories: 'كافة الفئات',
      disclosuresCount: 'الإفصاحات',
      itemsCount: 'البنود',
      code: 'الرمز',
      name: 'العنوان',
      category: 'الفئة',
    },

    gapAnalysis: {
      title: 'تحليل الفجوات والتقييم',
      subtitle: 'تقييم الإفصاحات وفقاً لمتطلبات GRI بنظام الدرجات المعياري 0 / 50 / 100',
      emptyTitle: 'لا توجد تقييمات فجوات نشطة',
      emptyDescription: 'قم باستيراد معايير GRI لتفعيل تقييمات الإفصاحات وحساب الفجوات.',
      emptyAction: 'الانتقال إلى استيراد GRI',
      queueTitle: 'قائمة بنود التقييم للقسم',
      queueSubtitle: 'البنود المسندة إلى قسمك مع حالة التقييم الحالية',
      emptyQueueTitle: 'لا توجد بنود مسندة بعد',
      emptyQueueDesc: 'لا توجد بنود إفصاح مسندة إلى قسمك. استورد بيانات GRI مع إسناد الأقسام لبدء التقييمات.',
      selectPrompt: 'اختر بنداً من القائمة لتقييمه.',
      priority: 'الأولوية',
      pillar: 'الركيزة',
      topic: 'الموضوع',
      department: 'القسم',
      stNotEvaluated: 'غير مُقيَّم',
      stDraft: 'مسودة',
      stSubmitted: 'مُرسَل',
      stApproved: 'معتمَد',
      stClientApproved: 'معتمَد من العميل',
      stReturned: 'مُعاد',
      stNotApplicable: 'غير مطبق',
      evaluateTitle: 'تقييم البند',
      scoreLabel: 'درجة الفجوة',
      score0: '0 — فجوة كاملة',
      score0Desc: 'المتطلب غير محقق إطلاقاً',
      score50: '50 — فجوة جزئية',
      score50Desc: 'المتطلب محقق جزئياً',
      score100: '100 — بدون فجوة',
      score100Desc: 'المتطلب محقق بالكامل',
      notEvalLabel: 'غير مُقيَّم',
      notEvalDesc: 'تخطَّ التسجيل مؤقتاً؛ يُستبعد من المتوسطات ولا يُحتسب صفراً أبداً',
      naLabel: 'غير مطبق',
      naDesc: 'يُستبعد من المتوسطات والعدادات؛ مع حفظ السبب',
      naReasonLabel: 'سبب عدم الانطباق',
      naReasonOptions: {
        'not-applicable': 'غير منطبق على المنشأة',
        'legal-prohibitions': 'موانع قانونية',
        'confidentiality-constraints': 'قيود السرية',
        'information-unavailable-incomplete': 'المعلومات غير متوفرة / غير مكتملة',
      },
      evidenceNoteLabel: 'ملاحظة الدليل',
      evidenceNotePh: 'اذكر الأدلة الداعمة أو السجلات المرجعية...',
      saveDraft: 'حفظ مسودة',
      submitEval: 'إرسال للاعتماد',
      saving: 'جارٍ الحفظ...',
      submitting: 'جارٍ الإرسال...',
      approvalTitle: 'الاعتماد',
      approvalDesc: 'راجع التقييم المرسل ثم اعتمده أو أعده مع تعليق.',
      approveBtn: 'اعتماد',
      returnBtn: 'إعادة',
      commentLabel: 'التعليق',
      commentPh: 'تعليق القرار (مطلوب عند الإعادة)...',
      selfApprovalNote: 'لقد قيّمت هذا البند أو أرسلته، لذا لا يُعرض الاعتماد الذاتي.',
      decidedApproved: 'معتمَد',
      decidedReturned: 'مُعاد للمعالجة',
      historyTitle: 'سجل المراجعات',
      historyEmpty: 'لا توجد مراجعات مسجلة بعد.',
      correctionTitle: 'تصحيح بعد الإرسال',
      correctionDesc: 'التقييمات المرسلة تتغير فقط عبر مراجعة مُلحقة مع ذكر السبب.',
      correctionReasonLabel: 'سبب التصحيح',
      correctionReasonPh: 'اشرح سبب تغير الدرجة...',
      applyCorrection: 'تطبيق التصحيح',
    },

    clients: {
      subtitle: 'عملاء المنصة — نتائج الخادم فقط؛ بلا فلترة أو تقديرات محلية',
      searchLabel: 'البحث عن عميل',
      searchHint: 'الاسم أو الرمز',
      search: 'بحث',
      clearSearch: 'مسح البحث',
      refresh: 'تحديث',
      caption: 'العملاء وتقدم الجمع للخدمات المرتبطة',
      colClient: 'العميل',
      colStatus: 'الحالة',
      colServices: 'الخدمات المرتبطة والتقدم',
      colActions: 'الإجراءات',
      rowCount: 'عدد العملاء الناتج: {count}',
      active: 'نشط',
      suspended: 'موقوف',
      statusUnknown: 'الحالة غير متاحة',
      emptyTitle: 'لا يوجد عملاء',
      emptySearchTitle: 'لا توجد نتائج مطابقة',
      loadFailed: 'تعذّر تحميل العملاء.',
      noLinkedServices: 'لا توجد خدمات مرتبطة',
      unmappedService: 'الخدمة غير مربوطة بمعايير',
      mappedItems: 'البنود المرتبطة',
      collection: 'الجمع',
      pendingSubmission: 'بانتظار الإرسال',
      frozenPairs: 'أزواج مجمّدة',
      noAssignments: 'لا توجد إسنادات',
      unavailable: 'غير متاح',
      enterWorkspace: 'دخول مساحة العميل',
      configureClient: 'إعداد العميل',
      suspend: 'إيقاف',
      unsuspend: 'إعادة تفعيل',
      enterConfirm: 'فتح مساحة عمل العميل {name}؟ ستُفقد التعديلات المعلّقة في تبويب المنصة.',
      suspendConfirm: '{action} {name}؟',
      saveFailed: 'تعذّر تحديث حالة العميل.',
      suspendSaved: 'حُدِّثت حالة العميل من الخادم.',
    },

    workspace: {
      checking: 'جارٍ التحقق من مساحة العمل…',
      opening: 'جارٍ فتح مساحة العميل',
      closing: 'جارٍ الخروج إلى العملاء',
      confirmFailed: 'تعذّر تأكيد مساحة العمل',
      confirmFailedDesc: 'تعذّر التحقق من حالة مساحة العمل. لا يُعرض أي محتوى عميل مخزّن. أعد مزامنة التبويب الحالي ثم اختر الوجهة مجدداً.',
      retry: 'إعادة المحاولة',
      exitToClients: 'الخروج إلى العملاء',
      exitConfirm: 'الخروج من مساحة العميل والعودة إلى العملاء؟ ستُفقد التعديلات المعلّقة.',
      clientSuspended: 'العميل موقوف',
      backToClients: 'العودة إلى العملاء',
      configureTitle: 'إعداد العميل',
    },

    settings: {
      title: 'إعدادات المنصة وتشخيص قاعدة البيانات',
      subtitle: 'حالة اتصال PostgreSQL، والترحيلات، وسياسات RLS، وتفضيلات اللغة',
      databaseConnection: 'اتصال قاعدة بيانات PostgreSQL',
      dbStatus: 'حالة قاعدة البيانات',
      connected: 'متصل ويعمل بكفاءة',
      disconnected: 'غير متصل / لا يمكن الوصول إليه',
      configured: 'تم تكوين DATABASE_URL',
      notConfigured: 'DATABASE_URL مفقود',
      tableCount: 'جداول قاعدة البيانات النشطة',
      databaseUrlNote: 'تتم قراءة اتصال قاعدة البيانات من process.env.DATABASE_URL مع تحديد مجمع الاتصالات بحد أقصى 5 اتصالات وتمكين TLS.',
      runMigrations: 'تنفيذ ترحيلات قاعدة البيانات وسياسات RLS',
      migrating: 'جارٍ تطبيق المخطط والسياسات...',
      migrationsSuccess: 'تم تطبيق مخطط قاعدة البيانات والقيود والمشغلات وسياسات RLS بنجاح.',
      languageSettings: 'اللغة والتعريب الإقليمي',
      languageDescription: 'اختر لغة العمل المفضلة لديك. يتم تطبيق الدعم الكامل من اليمين إلى اليسار (RTL) بشكل ديناميكي.',
      currentLanguage: 'لغة الواجهة الحالية',
      arabic: 'العربية (من اليمين لليسار)',
      english: 'الإنجليزية (English - LTR)',
      securitySettings: 'أمان الحساب',
      updatePasswordButton: 'تحديث كلمة المرور',
      userProfile: 'بيانات المستخدم الحالي',
      appThemeSection: 'ثيم التطبيق',
      appThemeDescription: 'ثيم واحد للتطبيق بالكامل. يسري على جميع المستأجرين والمستخدمين ويُطبَّق فوراً على كل المستخدمين بعد الحفظ.',
      appThemePlatformOnly: 'لمدير المنصة فقط. يحتفظ كل مستأجر بثيمه الخاص عندما يكون الخيار «تلقائي».',
      appThemeAuto: 'تلقائي (يتبع ثيم كل مستأجر)',
      appThemeAutoHint: 'كل مستخدم يرى ثيم مستأجره',
      appThemeGe: 'GE (الافتراضي)',
      appThemeLime: 'ليموني',
      appThemeDark: 'داكن',
      appThemeSave: 'حفظ ثيم التطبيق',
      appThemeSaving: 'جارٍ الحفظ...',
      appThemeSaved: 'تم حفظ ثيم التطبيق، وأصبح سارياً على جميع المستخدمين.',
      appThemeFailed: 'لم يتم حفظ ثيم التطبيق.',
    },

    users: {
      title: 'إدارة المستخدمين',
      subtitle: 'الحسابات تُنشأ من GE فقط بعد اعتماد قائمة الموظفين (لا تُحذف الحسابات أبداً)',
      listTitle: 'المستخدمون',
      emptyList: 'لا يوجد مستخدمون.',
      emailLabel: 'البريد الإلكتروني',
      passwordLabel: 'كلمة المرور (6 أحرف على الأقل)',
      nameLabel: 'الاسم الكامل',
      roleLabel: 'الدور',
      tenantLabel: 'المستأجر',
      departmentLabel: 'القسم',
      createButton: 'إنشاء مستخدم',
      creating: 'جارٍ الإنشاء…',
      deactivateButton: 'إلغاء التنشيط',
      reactivateButton: 'إعادة التنشيط',
      deactivateConfirm: 'إلغاء تنشيط هذا المستخدم؟ لن يتمكن من تسجيل الدخول بعد ذلك.',
      activeLabel: 'نشط',
      inactiveLabel: 'ملغى التنشيط',
      createdSuccess: 'تم إنشاء المستخدم بنجاح.',
      tenantPlaceholder: 'اختر مستأجراً…',
      noTenantOption: 'بدون مستأجر (مدير المنصة فقط)',
      geOnlyNote: 'إنشاء الحسابات وتفعيلها من GE فقط. لمديري العميل: قدّم قائمة موظفين لاعتماد GE — راجع قوائم الموظفين.',
    },

    common: {
      loading: 'جارٍ التحميل...',
      save: 'حفظ التغييرات',
      cancel: 'إلغاء',
      submit: 'إرسال',
      close: 'إغلاق',
      refresh: 'تحديث البيانات',
      success: 'تمت العملية بنجاح',
      error: 'حدث خطأ',
      warning: 'تنبيه مطلوب',
      info: 'معلومات',
      retry: 'إعادة المحاولة',
      actions: 'الإجراءات',
      status: 'الحالة',
      view: 'عرض التفاصيل',
      learnMore: 'معرفة المزيد',
      back: 'رجوع',
      high: 'مرتفعة',
      mid: 'متوسطة',
      low: 'منخفضة',
      text: 'نصي',
      number: 'رقمي',
      boolean: 'نعم / لا',
        date: 'تاريخ',
        file: 'مرفق مستند',
        checking: 'جارٍ التحقق',
        connected: 'متصل',
        disconnected: 'غير متصل',
        yes: 'نعم',
        no: 'لا',
      },

    actions: {
      title: 'الإجراءات التصحيحية',
      subtitle: 'متابعات مملوكة للأقسام مع إغلاق موثّق (WF-04)',
      listTitle: 'الإجراءات',
      emptyTitle: 'لا توجد إجراءات تصحيحية بعد',
      emptyDesc: 'أنشئ أول متابعة لقسمك. المسودات لا تحرك الأرقام أبداً؛ وإغلاق إجراء لا يغيّر أي درجة.',
      filterStatus: 'الحالة',
      filterDepartment: 'القسم',
      allStatuses: 'كل الحالات',
      allDepartments: 'كل الأقسام',
      createTitle: 'إجراء تصحيحي جديد',
      titleLabel: 'العنوان',
      titlePh: 'مثال: معالجة فرز النفايات في المبنى B',
      descLabel: 'الوصف',
      descPh: 'ما الذي يجب فعله وأين...',
      deptLabel: 'القسم المالك',
      itemLabel: 'البند المرتبط (اختياري)',
      dueLabel: 'تاريخ الاستحقاق (اختياري)',
      createButton: 'إنشاء الإجراء',
      creating: 'جارٍ الإنشاء...',
      evidenceLabel: 'الدليل (مرجع نصي — لا رفع ملفات في هذه النسخة)',
      evidencePh: 'مثال: سجل النفايات 2026-11-30، مجلد الصور W-114...',
      saveEvidence: 'حفظ ملاحظة الدليل',
      advanceButton: 'نقل للخطوة التالية',
      closeButton: 'تحقق وإغلاق',
      reopenButton: 'إعادة فتح',
      reasonLabel: 'السبب (مطلوب عند إعادة الفتح)',
      reasonPh: 'لماذا يُعاد فتح هذا الإجراء؟...',
      reasonRequired: 'يلزم ذكر سبب لإعادة فتح الإجراء.',
      statusLabels: {
        open: 'مفتوح',
        in_progress: 'قيد التنفيذ',
        awaiting_verification: 'بانتظار التحقق',
        closed: 'مغلق',
        reopened: 'مُعاد فتحه',
      },
      nextOf: {
        open: 'بدء العمل',
        in_progress: 'إرسال للتحقق',
        awaiting_verification: 'تحقق وإغلاق',
        reopened: 'إعادة بدء العمل',
      },
      updatedMsg: 'تم تحديث الإجراء بنجاح.',
    },

    initiatives: {
      title: 'مكتبة المبادرات',
      subtitle: 'دليل عام للمبادرات الشائعة — اختر المعتمد منها لهذا المستأجر',
      searchPh: 'ابحث في المبادرات بالعنوان...',
      filterSector: 'القطاع',
      filterEsg: 'E / S / G',
      filterDepartment: 'القسم',
      all: 'الكل',
      selectButton: 'اعتماد للعميل',
      unselectButton: 'إلغاء الاعتماد',
      selectedBadge: 'معتمَدة',
      emptyTitle: 'مكتبة المبادرات فارغة',
      emptyDesc: 'لا توجد صفوف في المكتبة العامة بعد. استورد مبادرات ملف العمل للبدء.',
      standardsRef: 'مرجع GRI',
      department: 'القسم',
      sector: 'القطاع',
    },

    esgProfile: {
      title: 'الملف البيئي والاجتماعي',
      subtitle: 'ملف ESG للمستأجر حسب الركيزة والقسم والموضوع والمعامل (بدلالات الورقة الأصلية)',
      scoreLabel: 'درجة الملف',
      coverageLabel: 'التغطية',
      ratedLabel: 'المعاملات المقيّمة',
      pillar: 'الركيزة',
      department: 'القسم',
      topic: 'الموضوع',
      parameter: 'المعامل',
      profile: 'الملف',
      rating: 'التقييم',
      timeline: 'الأفق الزمني',
      impact: 'الأثر البيئي',
      emptyTitle: 'لم يُستورد ملف ESG بعد',
      emptyDesc: 'استورد ورقة ESG Profile الخاصة بهذا المستأجر لعرض الدرجة والتغطية.',
      groupNote: 'تظهر RATING / MAX RATING على صفوف المجموعات كما في الورقة تماماً؛ والدرجة تجمع كل تقييمات 1–3.',
    },

    clientReview: {
      title: 'قائمة مراجعة العميل',
      subtitle: 'بنود معتمدة من الأقسام مجمعة حسب الإفصاح — اعتمد الإفصاح كاملاً على مستوى العميل',
      emptyTitle: 'لا توجد إفصاحات بانتظار مراجعة العميل',
      emptyDesc: 'عندما تعتمد الأقسام تقييماتها تظهر مجموعات الإفصاحات هنا.',
      completeness: 'الاكتمال',
      readyBadge: 'جاهز لاعتماد العميل',
      blockedBadge: 'محظور — أقسام معلقة',
      frozenBadge: 'مجمّد (اعتماد GE النهائي)',
      pendingClient: 'معتمد من القسم، بانتظار قرار العميل',
      approveGroupHint: 'اعتماد العميل يتم لكل بند لكنه يتطلب اكتمال الإفصاح كله على مستوى الأقسام.',
      clientApproveBtn: 'اعتماد العميل',
      clientReturnBtn: 'إعادة للقسم',
      approving: 'جارٍ التنفيذ...',
      commentRequired: 'التعليق مطلوب عند الإعادة إلى القسم.',
    },

    geFinal: {
      title: 'مراجعة GE النهائية والتجميد',
      subtitle: 'تحقق من قائمة الاكتمال ثم جمّد لقطة غير قابلة للتعديل (مدير المنصة فقط)',
      scopeLabel: 'نطاق التجميد',
      scopeDisclosure: 'إفصاح',
      scopeTenant: 'المستأجر كاملاً',
      disclosureLabel: 'الإفصاح',
      selectDisclosure: 'انسخ معرف الإفصاح من قائمة مراجعة العميل…',
      runCheck: 'تشغيل الفحص',
      checking: 'جارٍ الفحص...',
      checklistTitle: 'قائمة الاكتمال',
      allClear: 'جميع البنود ضمن النطاق معتمدة من العميل (أو غير مطبقة مع سبب). جاهز للتجميد.',
      blockedItems: 'البنود المحظورة',
      freezeBtn: 'تجميد لقطة',
      freezing: 'جارٍ التجميد...',
      confirmTitle: 'تأكيد التجميد',
      confirmDesc: 'التجميد لا رجعة فيه. سيُرفض أي تعديل أو تصحيح أو استيراد يمس هذا النطاق بعد ذلك؛ وتبقى ملاحظات اللقطة الإلحاقية مسموحة فقط.',
      confirmCheck: 'أفهم — جمّد هذا النطاق الآن',
      frozenBadge: 'مجمّد',
      snapshotTitle: 'اللقطات المجمّدة',
      snapshotEmpty: 'لا توجد لقطات مجمّدة لهذا المستأجر بعد.',
      hashLabel: 'بصمة المحتوى',
      actorLabel: 'جمّدها',
      timeLabel: 'وقت التجميد',
      aggregateLabel: 'الدرجة المجمّدة',
      coverageLabel: 'التغطية المجمّدة',
      noteLabel: 'ملاحظة بعد التجميد (إلحاقية فقط)',
      notePh: 'أضف ملاحظة تدقيق مرتبطة بهذه اللقطة...',
      addNote: 'إضافة ملاحظة',
      addingNote: 'جارٍ الإضافة...',
      viewerTitle: 'تفاصيل اللقطة',
      alreadyFrozen: 'هذا النطاق مجمّد مسبقاً.',
    },

    conflict: {
      title: 'تعارض نسخ — سبقك شخص آخر بالحفظ',
      desc: 'نسختك قديمة. قارن القيم الحالية على الخادم أدناه، ثم أعد التحميل وحاول مجدداً.',
      mineLabel: 'ما حاولت حفظه',
      theirsLabel: 'الحالي على الخادم',
      reloadRetry: 'إعادة تحميل ومحاولة',
      versionLabel: 'النسخة',
      actorLabel: 'الفاعل',
      timeLabel: 'الوقت',
    },

    attachments: {
      title: 'مرفقات الأدلة (5 م.ب كحد أقصى لكل ملف)',
      attachBtn: 'إرفاق ملف',
      uploading: 'جارٍ الرفع...',
      emptyText: 'لا توجد ملفات أدلة مرفقة بعد.',
      downloadBtn: 'تنزيل',
      deleteBtn: 'حذف',
      deleteConfirm: 'حذف هذا المرفق؟',
      oversize: 'الملف كبير جداً. حد مرفقات الأدلة 5 م.ب لكل ملف.',
      mime: 'نوع الملف غير مسموح. الأنواع المقبولة: PDF, PNG, JPEG, XLSX, CSV, TXT.',
      missing: 'اختر ملفاً أولاً.',
      uploadFailed: 'فشل الرفع.',
      typesNote: 'PDF وPNG وJPEG وXLSX وCSV وTXT — بحد 5 م.ب، مخزنة تجريبياً (OD-06).',
      usageLabel: 'تخزين المرفقات',
    },

    storage: {
      title: 'تخزين الأدلة',
      subtitle: 'استهلاك المرفقات لكل مستأجر (سعة نسخة العرض 1 غ.ب)',
      bytesLabel: 'المستخدم',
      filesLabel: 'الملفات',
      warnMsg: 'التخزين تجاوز عتبة التحذير (800 م.ب) لنسخة العرض.',
      okMsg: 'التخزين ضمن ميزانية العرض.',
    },

    weights: {
      title: 'أوزان الأولوية',
      subtitle: 'مرجع عرض فقط تعتمده كل الدرجات في هذه النسخة',
      high: 'مرتفعة = 3',
      mid: 'متوسطة = 2',
      low: 'منخفضة = 1',
      notice: 'تفصيل التسجيل مثبّت في قاعدة التسجيل: الوزن مشتق من الأولوية (مرتفعة 3 / متوسطة 2 / منخفضة 1) والمسودات لا تُحتسب أبداً.',
    },

    reports: {
      navLabel: 'التقارير',
      title: 'تقارير GRI ‏(D-038)',
      subtitle: 'عروض تنفيذية وإدارية وتفصيلية — محكومة بمستوى التقرير، وبأرقام واحدة في كل مكان',
      levelTabL1: 'L1 · تنفيذي',
      levelTabL2: 'L2 · إداري',
      levelTabL3: 'L3 · تفصيلي',
      levelDescL1: 'الدرجة الإجمالية وتغطية المراجعة وأكبر الفجوات — ملخص أمين دون ادعاء اتجاهات.',
      levelDescL2: 'الدرجات حسب القسم والمعيار، والإجراءات التصحيحية، وملخص الحذوفات.',
      levelDescL3: 'فهرس الإفصاحات الكامل مع بيان الاستخدام وسجل الإخطار.',
      headlineScore: 'الدرجة الإجمالية',
      topGaps: 'أكبر الفجوات',
      byDepartment: 'الدرجات حسب القسم',
      byStandard: 'الإفصاحات حسب المعيار',
      actionsSummary: 'الإجراءات التصحيحية',
      omissionsSummary: 'ملخص الحذوفات',
      noOmissions: 'لا توجد إفصاحات محذوفة.',
      standard: 'المعيار',
      disclosure: 'الإفصاح',
      location: 'الموضع في الأدلة',
      locationMissing: 'غير مشار إليه بعد',
      omission: 'محذوف',
      omittedYes: 'نعم',
      omittedNo: 'لا',
      reason: 'السبب',
      explanation: 'التفسير',
      reasonLabels: {
        'not-applicable': 'غير منطبق على المنشأة',
        'legal-prohibitions': 'موانع قانونية',
        'confidentiality-constraints': 'قيود السرية',
        'information-unavailable-incomplete': 'المعلومات غير متوفرة / غير مكتملة',
      },
      score: 'الدرجة',
      coverage: 'التغطية',
      items: 'البنود',
      departments: 'الأقسام',
      statementTitle: 'بيان الاستخدام',
      statementName: 'اسم المنشأة',
      statementPeriod: 'الفترة المشمولة',
      notificationTitle: 'سجل إخطار GRI',
      notifiedDone: 'تم الإخطار',
      notifiedNotDone: 'لم يتم الإخطار',
      notifiedDate: 'تاريخ الإخطار',
      notifyRef: 'مرجع الإخطار',
      notificationRecordNote: 'هذا سجل فقط — المنصة لا ترسل الإخطار أبداً.',
      settingsTitle: 'إعدادات التقارير ‏(D-038)',
      settingsDesc: 'يُخزن المستوى لكل عميل وخدمة. يبقى التصدير محظوراً حتى اكتمال الحقول المطلوبة.',
      disclosureLevel: 'مستوى الإفصاح',
      reportLevel: 'مستوى التقرير',
      inAccordance: 'وفقاً للمعايير (In accordance)',
      withReference: 'بالإشارة إلى المعايير (With reference)',
      saveSettings: 'حفظ إعدادات التقارير',
      saving: 'جارٍ الحفظ...',
      savedMsg: 'تم حفظ إعدادات التقارير. التصدير متاح الآن لهذا العميل وهذه الخدمة.',
      gateBlocked: 'التصدير محظور — حدد مستوى D-038 أولاً.',
      gateOk: 'تم تحديد المستوى — التصدير متاح.',
      exportJson: 'تصدير JSON',
      exportCsv: 'تصدير CSV',
      printBtn: 'طباعة / PDF',
      loading: 'جارٍ بناء التقرير...',
      loadError: 'فشل بناء التقرير.',
      incompleteTitle: 'إفصاحات محذوفة دون سبب وتفسير',
      selectLevelHint: 'حدد مستوى التقرير أعلاه ثم اختر العرض.',
    },

    services: {
      title: 'الخدمات',
      subtitle: 'دليل الخدمات بإدارة المنصة: إنشاء وتعديل وربط المعايير والتكرار',
      listTitle: 'الخدمات',
      emptyText: 'لا توجد خدمات بعد. أنشئ الأولى أدناه.',
      codeLabel: 'الرمز',
      nameLabel: 'الاسم',
      descLabel: 'الوصف',
      createButton: 'إنشاء خدمة',
      creating: 'جارٍ الإنشاء...',
      saveButton: 'حفظ',
      saving: 'جارٍ الحفظ...',
      editButton: 'تعديل',
      duplicateButton: 'تكرار',
      duplicating: 'جارٍ التكرار...',
      newCodeLabel: 'رمز الخدمة الجديدة',
      newCodePh: 'مثال: GRI-CONSULT-02',
      linkedLabel: 'المعايير المرتبطة',
      linkButton: 'ربط',
      unlinkButton: 'فك الربط',
      manageHint: 'الخدمات وروابط معاييرها تُدار من مديري المنصة فقط.',
    },

    servicesWorkspace: {
      headerSubtitle: 'مساحة عمل لكل خدمة — التعريف والمحتوى والإعدادات والاستيراد',
      railSearchLabel: 'البحث في الخدمات',
      railSearchPh: 'الاسم أو الرمز',
      railEmpty: 'لا توجد خدمات بعد',
      railEmptyHint: 'أنشئ أول خدمة لتظهر هنا.',
      createHint: 'تبدأ الخدمة فارغة؛ يأتي المحتوى من تبويب المحتوى والاستيراد.',
      emptySearch: 'لا خدمات مطابقة.',
      selectTitle: 'لا توجد خدمة محددة',
      selectHint: 'اختر خدمة من القائمة أو أنشئ خدمة جديدة.',
      statusReady: 'محتوى متاح',
      statusEmpty: 'بلا محتوى',
      tabOverview: 'نظرة عامة',
      tabContent: 'المحتوى',
      tabRules: 'القواعد',
      tabSettings: 'الإعدادات',
      tabImport: 'الاستيراد',
      definition: 'تعريف الخدمة',
      created: 'تاريخ الإنشاء',
      descriptionEmpty: 'لا وصف',
      linkedClients: 'العملاء المرتبطون',
      clientsUnit: 'العملاء المرتبطون',
      lastImport: 'آخر استيراد',
      lastImportNone: 'غير متاح لكل خدمة',
      lastImportHint: 'أحداث الاستيراد تُسجَّل لكل مستأجر في سجل التدقيق.',
      contentState: 'حالة المحتوى',
      contentEmpty: 'لا بنود بعد — ابدأ من تبويب الاستيراد أو أضف بنداً.',
      contentOk: 'المحتوى جاهز للربط والإسناد.',
      duplicateHint: 'تُنسخ روابط المعايير إلى الرمز الجديد؛ المحتوى لا يُنسخ.',
      duplicateCodeLabel: 'رمز الخدمة الجديدة',
      duplicateNameLabel: 'الاسم (اختياري)',
      duplicateSubmit: 'إنشاء نسخة',
      breadcrumbAll: 'كل المعايير',
      levelStandards: 'المعايير',
      levelDisclosures: 'الإفصاحات',
      levelItems: 'البنود',
      searchLevelPh: 'بحث في هذا المستوى',
      addStandard: 'ربط معيار',
      addStandardHint: 'تُنشأ المعايير عبر الاستيراد؛ هنا يُربط معيار قائم بالخدمة.',
      noStandards: 'لا معايير مرتبطة',
      noStandardsHint: 'اربط معياراً لبدء المحتوى.',
      noDisclosures: 'لا إفصاحات',
      noDisclosuresHint: 'لا توجد إفصاحات لهذا المعيار داخل هذه الخدمة.',
      noItems: 'لا بنود',
      noItemsHint: 'أضف بنداً أو استورد بيانات الخدمة.',
      disclosureImportNote: 'الإفصاحات تُنشأ عبر الاستيراد.',
      itemDetail: 'تفاصيل البند',
      itemRequirement: 'المتطلب',
      itemAnswerType: 'نوع الإجابة',
      itemPriority: 'الأولوية',
      itemEsgClass: 'التصنيف',
      itemHint: 'تلميح',
      codeImmutable: 'الرمز ثابت ولا يُعدَّل.',
      attachmentRequired: 'مرفق مطلوب',
      attachmentNotRequired: 'بلا مرفق',
      attachmentReadOnly: 'تُقرأ من الخادم ولا تُحرَّر هنا',
      selectedCount: 'المحدد: {n}',
      bulkAssign: 'إسناد المحدد',
      bulkDone: 'تم الإسناد: {n}',
      bulkNoClients: 'لا عميل مرتبط بهذه الخدمة.',
      rulesShownOf: 'عرض {shown} من {total}',
      discardDraft: 'لديك تغييرات غير محفوظة. تجاهلها؟',
      dirtyDraft: 'تغييرات غير محفوظة',
      unlinkStandardConfirm: 'فك ربط المعيار {code} من هذه الخدمة؟',
      identityTitle: 'هوية الخدمة',
      identitySave: 'حفظ الهوية',
      settingsHint: 'يُكتب الكائن كاملاً (استبدال) وبحد أقصى 8KB؛ لا يوفّر الـ API قراءة الإعدادات المحفوظة قبل الكتابة.',
      settingsSave: 'حفظ الإعدادات',
      settingsInvalid: 'أدخل كائن JSON صالحاً (لا مصفوفة ولا قيمة مفردة).',
      settingsEcho: 'ما أعاده الخادم بعد الحفظ:',
      actionFailed: 'تعذّر إتمام العملية.',
      workspaceLoadFailed: 'تعذّر تحميل بيانات الخدمات.',
      fieldRequired: 'هذا الحقل مطلوب.',
      importTitle: 'استيراد بيانات الخدمة',
      importDrop: 'أفلت الملف هنا أو اختره',
      importFormats: 'Excel أو CSV بالأعمدة: Standard Code, Standard Title, Category, Disclosure Code, Disclosure Title, Item Code, Requirement (واختيارياً: Priority, ESG Class, Answer Type, Hint, Department).',
      importPreview: 'معاينة',
      importPreviewing: 'جارٍ التحليل...',
      importConfirm: 'استيراد إلى «{service}» للعميل «{client}»؟ سيُحدَّث الكتالوج بهذه الدفعة.',
      importConfirmAction: 'تأكيد الاستيراد',
      importing: 'جارٍ الاستيراد...',
      importDone: 'تم الاستيراد — معايير / إفصاحات / بنود',
      importFailed: 'تعذّر إكمال الاستيراد.',
      contentGroups: 'المجموعات',
      contentGroup: 'مجموعة',
      contentDirect: 'بنود مباشرة',
      directHint: 'بنود الإفصاح GENERAL — بلا معيار أو إفصاح خاص بها.',
      archivedCount: 'البنود المؤرشفة',
      archivedSection: 'مؤرشف (التاريخ محفوظ)',
      archivedBadge: 'مؤرشف',
      linkedReadOnly: 'للقراءة فقط',
      approvedCopiesTitle: 'النسخ المعتمدة المختومة',
      approvedCopiesNone: 'لا عميل مرتبط بهذه الخدمة بعد.',
      approvedCopySealed: 'مختومة',
      approvedCopyMissing: 'لا نسخة مختومة',
      approvedCopiesHint: 'للقراءة فقط. النسخة المختومة تبقى بعد أي تغيير لاحق على الخدمة، بما فيه الإزالة الكاملة.',
      namedSettingsTitle: 'إعدادات الخدمة (حقول مسماة)',
      namedSettingsHint: 'تُكتب هذه الحقول المسماة فقط. يُستبدل الكائن كاملاً بالسابق (بحد أقصى 8KB). لا يوفّر الـ API قراءة الإعدادات قبل الكتابة.',
      namedSettingsReplace: 'تُحفظ ككائن واحد — لا تُرسل مفاتيح غير معروفة أبداً.',
      settingDefaultAnswerType: 'نوع الإجابة الافتراضي',
      settingDefaultAnswerTypeHint: 'يُختار مسبقاً للبنود المنشأة حديثاً.',
      settingDefaultPriority: 'الأولوية الافتراضية',
      settingDefaultPriorityHint: 'الوزن يتبع الأولوية (مرتفعة 3 / متوسطة 2 / منخفضة 1).',
      settingDefaultEsgClass: 'التصنيف الافتراضي',
      settingDefaultEsgClassHint: 'بيئي أو اجتماعي أو حوكمة أو عام.',
      settingAttachmentDefault: 'المرفق مطلوب افتراضياً',
      settingAttachmentDefaultHint: 'البنود الجديدة تتطلب مرفقاً.',
      settingVisibleDefault: 'ظاهرة في التقارير افتراضياً',
      settingVisibleDefaultHint: 'الظهور الافتراضي للبنود الجديدة.',
      frozenScopeBanner: 'للقراءة — معتمد نهائياً (لقطة GE النهائية).',
      historyReopened: '{n} إجابة مُعاد فتحها — الإجابات السابقة محفوظة في السجل أدناه.',
      historyTitle: 'السجل',
      historyFailed: 'تعذّر تحميل السجل.',
      historyEmpty: 'لا نسخ أو إجابات مسجلة بعد.',
      templateDownload: 'تحميل قالب الخدمة (.csv)',
      templateDownloadHint: 'قالب واحد لكل خدمة بأعمدة GRI الخاصة بهذا النوع من الخدمات.',
      mappingTitle: 'مطابقة الأعمدة',
      mappingHint: 'طابق كل عمود معياري مع عنوان في الملف. العناوين بلا مطابقة تُعرض بعد المعاينة — لا تُسقط بصمت أبداً.',
      mappingFileColumn: 'عنوان الملف',
      importConfirmService: 'اعتماد هذه المعاينة في «{service}»؟ سيُحدَّث الكتالوج بهذه الدفعة.',
      unmappedTitle: 'أعمدة الملف غير المطابقة',
      rowErrorsTitle: 'أخطاء الصفوف',
      commitBlocked: 'الاعتماد محظور ما دامت أخطاء الصفوف موجودة — صحح الملف وأعد المعاينة.',
      previewClean: 'المعاينة سليمة — لا أخطاء صفوف.',
      createStandard: 'معيار جديد',
      editStandard: 'تعديل المعيار',
      deleteStandardConfirm: 'حذف هذا المعيار؟ يُرفض ما دامت إفصاحات موجودة تحته.',
      createGroup: 'مجموعة جديدة',
      newGroupStandard: 'حاوية مجموعات جديدة ({code})',
      createGroupHint: 'المجموعة إفصاح تحت معيار بفئة مجموعة. تُنشأ حاوية جديدة فقط عند غيابها.',
      editGroup: 'تعديل المجموعة',
      deleteGroupConfirm: 'حذف هذه المجموعة؟ يُرفض ما دامت بنود موجودة تحتها.',
      createDisclosure: 'إفصاح جديد',
      editDisclosure: 'تعديل الإفصاح',
      deleteDisclosureConfirm: 'حذف هذا الإفصاح؟ يُرفض ما دامت بنود موجودة تحته.',
      itemDepartment: 'القسم (واحد)',
      itemDepartmentNone: 'بلا قسم',
      singleDeptNote: 'البند لقسم واحد على الأكثر. الإسناد للعملاء خارج هذه الشاشة.',
      saveConflictHint: 'سبقك شخص آخر بالحفظ. أعد التحميل وحاول — مسودتك محفوظة.',
      deleteItemTitle: 'حذف البند',
      deleteItemHint: 'البنود ذات العمل المستأجَر تُؤرشف مع حفظ تاريخها — لا تُحذف نهائياً. الحذف النهائي للبنود بلا عمل فقط.',
      deleteReasonPh: 'سبب الأرشفة (اختياري)',
      deleteItemConfirm: 'تأكيد الحذف',
      itemArchivedNote: 'مؤرشف مع حفظ التاريخ — للقراءة فقط. خارج النطاق الحي.',
      bulkEditDone: 'حُدِّث {ok} من {n}',
      bulkUnset: 'بلا تغيير',
      bulkEditApply: 'تطبيق التحرير الجماعي',
      bulkEditHint: 'نوع الإجابة والأولوية والتصنيف وحالة المرفق فقط. تغيير القسم يبقى مفرداً.',
      bulkRowOk: 'حُدِّث',
    },

    employeeServices: {
      title: 'خدمات قسمي',
      subtitle: 'أجب عن البنود المسندة وأرفق الأدلة وتابع المستندات والمبادرات — قسمك فقط.',
      railTitle: 'الخدمات المرتبطة',
      railSearchLabel: 'البحث في الخدمات',
      railSearchPh: 'الاسم أو الرمز',
      railEmpty: 'لا توجد خدمات مسندة لقسمك',
      railEmptyHint: 'تواصل مع مديرك إذا كنت تتوقع عملاً هنا.',
      emptySearch: 'لا خدمات مطابقة.',
      countsAssigned: 'مسندة',
      countsSubmitted: 'مُقدَّمة',
      countsPending: 'معلّقة',
      tabItems: 'البنود',
      tabDocuments: 'المستندات',
      tabInitiatives: 'المبادرات',
      actionFailed: 'تعذّر إتمام الإجراء.',
      loadFailed: 'تعذّر تحميل مساحة عمل الموظف.',
      searchItemsPh: 'بحث بالرمز أو المتطلب',
      itemsEmpty: 'لا بنود في هذه الخدمة',
      itemsEmptyHint: 'البنود المسندة لقسمك ستظهر هنا.',
      selectItemHint: 'اختر بنداً لعرضه والإجابة عنه.',
      answerSection: 'الإجابة',
      answerTypeLabel: 'نوع الإجابة',
      fileAnswerNote: 'المرفق هو الإجابة لهذا البند — لا يُقبل نص. احفظ مسودة أولاً ثم أرفق الملف.',
      outcomeSection: 'نتيجة التقييم',
      outcomeScore: 'الدرجة',
      outcomeNotEvaluated: 'غير مُقيَّم',
      outcomeNA: 'لا ينطبق',
      naReasonLabel: 'سبب عدم الانطباق (إلزامي)',
      saveDraft: 'حفظ مسودة',
      saving: 'جارٍ الحفظ…',
      submitAnswer: 'تقديم للاعتماد',
      submitting: 'جارٍ التقديم…',
      attachmentRequiredTitle: 'مرفق مطلوب',
      attachmentRequiredDesc: 'هذا البند يتطلب مرفقاً واحداً على الأقل قبل التقديم.',
      attachmentRequiredNa: 'نتيجة عدم الانطباق لا تُسقط شرط المرفق.',
      attachmentLockedNote: 'المرفقات تُقفل بعد التقديم — المسودة فقط.',
      noAnswerYet: 'لا إجابة محفوظة بعد.',
      unsavedChanges: 'تغييرات غير محفوظة — احفظ أو تجاهل قبل المغادرة.',
      unsavedTitle: 'مغادرة دون حفظ؟',
      detailLoadFailed: 'تعذّر تحميل تفاصيل البند.',
      docsTitle: 'مستندات القسم',
      docsEmpty: 'لا متطلبات مستندات لقسمك',
      docsEmptyHint: 'المتطلبات المرتبطة بقسمك ستظهر هنا.',
      docRequired: 'مطلوب',
      docProvided: 'مُقدَّم',
      markProvided: 'وضع كمُقدَّم',
      noteLabel: 'ملاحظة',
      notePh: 'أضف ملاحظة (اختياري)',
      tagLabel: 'وسم',
      tagPh: 'وسم واحد (اختياري)',
      saveChanges: 'حفظ التغييرات',
      savingChanges: 'جارٍ الحفظ…',
      submittedAtLabel: 'قُدِّم في',
      proofFilesTitle: 'ملفات الإثبات',
      initsTitle: 'المبادرات المسندة',
      initsEmpty: 'لا مبادرات مسندة لقسمك',
      initsEmptyHint: 'المبادرات المختارة لقسمك ستظهر هنا.',
      performedLabel: 'نُفِّذت',
      notPerformedLabel: 'لم تُنفَّذ',
      versionConflict: 'سبقك شخص آخر بالحفظ. أعد التحميل وحاول — مسودتك محفوظة.',
    },

    taxonomy: {
      manageTitle: 'إدارة التصنيف',
      manageSubtitle: 'تعديل العناوين وإدارة البنود وروابط البنود المكافئة (لمديري المنصة فقط)',
      importOwnsNote: 'المعايير والإفصاحات والبنود تُنشأ عبر استيراد GRI. استخدم هذه اللوحة فقط للإصلاحات الدقيقة: العناوين والبنود والروابط.',
      showManage: 'إدارة التصنيف',
      hideManage: 'إخفاء الإدارة',
      editButton: 'تعديل',
      saveButton: 'حفظ',
      saving: 'جارٍ الحفظ...',
      deleteButton: 'حذف',
      deleting: 'جارٍ الحذف...',
      titleLabel: 'العنوان',
      categoryLabel: 'الفئة',
      descLabel: 'الوصف',
      disclosuresTitle: 'الإفصاحات',
      itemsTitle: 'البنود',
      addItemButton: 'إضافة بند',
      addingItem: 'جارٍ الإضافة...',
      requirementLabel: 'المتطلب',
      requirementPh: 'نص المتطلب...',
      codeLabel: 'الرمز',
      codePh: 'مثال: 2-1-c',
      priorityLabel: 'الأولوية',
      esgLabel: 'تصنيف ESG',
      answerTypeLabel: 'نوع الإجابة',
      hintLabel: 'تلميح',
      objectiveLabel: 'الهدف',
      topicLabel: 'الموضوع',
      referenceLabel: 'المرجع',
      codeImmutableNote: 'الرمز ثابت (مفتاح الاستيراد الطبيعي).',
      linksTitle: 'روابط البنود المكافئة',
      linkToLabel: 'اربط برمز البند',
      linkButton: 'ربط البندين',
      linking: 'جارٍ الربط...',
      unlinkButton: 'فك الربط',
      unlinkConfirm: 'إزالة رابط التكافؤ هذا؟',
      noLinksText: 'لا توجد روابط بنود مكافئة بعد.',
      evaluatedBadge: 'مُقيَّم',
      notEvaluatedByDept: 'غير مُقيَّم من قسمك',
      relationLabel: 'العلاقة',
      deleteStdConfirm: 'حذف هذا المعيار؟ يُرفض ما دامت إفصاحات موجودة تحته.',
      deleteDiscConfirm: 'حذف هذا الإفصاح؟ يُرفض ما دامت بنود موجودة تحته.',
      deleteItemConfirm: 'حذف هذا البند؟ يُرفض ما دامت إجابات أو تقييمات أو إسنادات تشير إليه.',
    },

    geOverview: {
      title: 'عمليات GE',
      subtitle: 'العملاء والخدمات وحالة الجمع وتقدم المراجعة والفجوات والإجراءات (لمديري المنصة فقط)',
      totalsClients: 'العملاء',
      activeLabel: 'العملاء النشطون',
      pendingStaffListsLabel: 'قوائم الموظفين المعلّقة',
      totalsSuspended: 'الموقوفون',
      totalsServices: 'الخدمات',
      suspendBtn: 'إيقاف',
      unsuspendBtn: 'إعادة تفعيل',
      linkAllBtn: 'ربط GRI بكل المستأجرين',
      frozenBadge: 'مجمّد',
      suspendedBadge: 'موقوف',
      servicesLabel: 'الخدمات',
      reviewLabel: 'المراجعة',
      actionsLabel: 'الإجراءات',
      staffLabel: 'قوائم الموظفين',
      coverageLabel: 'التغطية',
      scoreLabel: 'الدرجة',
    },
    clientDetail: {
      title: 'تفاصيل العميل',
      subtitle: 'خدمات المستأجر والأعلام والأقسام والمستخدمون والإسنادات (عمليات GE؛ العميل يرى خاصته فقط)',
      selectTenant: 'اختر مستأجراً…',
      servicesTitle: 'الخدمات المرتبطة',
      linkService: 'ربط خدمة',
      unlinkBtn: 'فك الربط',
      showGap: 'إظهار الفجوات',
      showCorrective: 'إظهار التصحيحية',
      saveFlags: 'حفظ الأعلام',
      suspendTitle: 'إيقاف / إعادة تفعيل',
      departmentsTitle: 'الأقسام',
      usersTitle: 'المستخدمون',
      mustChangeBadge: 'يجب تغيير كلمة المرور',
      suspendedNote: 'المستأجرون الموقوفون لا يستطيعون تسجيل الدخول (الدخول يعيد موقوفاً بلا بيانات).',
    },
    staffLists: {
      title: 'قوائم الموظفين',
      subtitle: 'العميل يرسل مسودات؛ GE يعتمد (ينشئ الحسابات بكلمة مرة واحدة) أو يرفض بسبب',
      createTitle: 'قائمة موظفين جديدة (مسودة)',
      emailPh: 'staff@client.test',
      namePh: 'الاسم الكامل',
      addRow: 'إضافة صف',
      submitList: 'إرسال لاعتماد GE',
      approveBtn: 'اعتماد وإنشاء الحسابات',
      rejectBtn: 'رفض',
      rejectReasonPh: 'سبب الرفض (مطلوب)…',
      otpTitle: 'كلمات المرور لمرة واحدة — تظهر مرة واحدة (انسخ الآن، لا تُخزن)',
      otpWarning: 'كلمات المرور مخزنة بتجزئة bcrypt؛ النص الصريح لا يُخزن ولا يُسجل. الحسابات تبدأ بتغيير إجباري.',
      emptyText: 'لا توجد قوائم موظفين بعد.',
      statusLabels: { draft: 'مسودة', submitted: 'مرسلة', approved: 'معتمدة', rejected: 'مرفوضة' },
    },
    clientDashboard: {
      title: 'لوحة العميل',
      subtitle: 'مستأجرك فقط — نفس حساب الدرجات (المسودات مستبعدة، غير المطبق مستبعد، التغطية بجانب كل درجة)',
      suspendedTitle: 'المستأجر موقوف',
      suspendedDesc: 'هذا المستأجر موقوف. تواصل مع مدير المنصة. لا تُعرض أي بيانات.',
      aggregateTitle: 'إجمالي المراجعة',
      coverageLabel: 'التغطية',
      departmentsTitle: 'الدرجات حسب القسم',
      servicesTitle: 'الخدمات المرتبطة',
      hiddenNote: 'مخفي بأعلام الخدمة (مستبعد من التقارير/الصادرات).',
    },
    assignments: {
      title: 'الإسنادات اليدوية',
      assignBtn: 'إسناد',
      unassignBtn: 'فك الإسناد',
      naBtn: 'تعليم غير مطبق',
      naReasonLabel: 'سبب عدم الانطباق',
      itemLabel: 'البند',
      deptLabel: 'القسم',
      justificationPh: 'المبرر…',
    },
    b16: {
      preliminaryBadge: 'معتمد من القسم — أولي، بانتظار تأكيد العميل',
      deptApprovalTitle: 'اعتماد القسم',
      deptApprovalDesc: 'يراجع أعضاء هذا القسم التقييم المرسل. عند تعيين رئيس، يجوز للرئيس فقط الاعتماد أو الإعادة.',
      headOnlyNote: 'لهذا القسم رئيس معيَّن — يجوز للرئيس فقط الاعتماد أو الإعادة هنا.',
      clientNoDraftTitle: 'مسودات التقييم من اختصاص الأقسام',
      clientNoDraftDesc: 'لا ينشئ مديرو العميل مسودات. اعتمد الأعمال المرسلة على نطاق العميل — استخدم قائمة مراجعة العميل أدناه (اعتماد العميل / الإعادة إلى القسم).',
      geNoDraftTitle: 'GE لا ينشئ تقييمات جديدة أبداً',
      geNoDraftDesc: 'يقيّم مديرو المنصة عبر تصحيح مسبب — استخدم مربع التصحيح أدناه مع ذكر السبب.',
      correctionForbiddenTitle: 'التصحيح ليس مسار العميل',
      correctionForbiddenDesc: 'لا يصحح مديرو العميل التقييمات مباشرة. أعد التقييم إلى القسم مع ذكر السبب.',
      importGeOnlyTitle: 'الاستيراد من GE فقط',
      importGeOnlyDesc: 'استيراد GRI وملف ESG من مديري المنصة فقط. راجع البيانات المستوردة للقراءة فقط في المعايير / تحليل الفجوات / ملف ESG.',
      reportSettingsGeOnlyTitle: 'مستويات التقارير يحددها GE',
      reportSettingsGeOnlyDesc: 'يحدد مديرو المنصة فقط مستويات D-038. تبقى التقارير والصادرات المسموحة متاحة أدناه.',
      assignGeOnlyTitle: 'الإسناد يديره GE',
      assignGeOnlyDesc: 'الإسناد اليدوي وتعليم غير المطبق من GE فقط. قائمة الإسناد أدناه للقراءة فقط.',
      actionsGeOnlyTitle: 'ضبط الإجراءات التصحيحية من GE فقط',
      actionsGeOnlyDesc: 'يفتح مديرو المنصة فقط الإجراءات أو يتحققون منها / يغلقونها / يعيدون فتحها. تبدأ الأقسام العمل وتحفظ ملاحظات الأدلة في إجراءاتها المسندة.',
      initiativesGeOnlyTitle: 'اختيار المبادرات من GE فقط',
      initiativesGeOnlyDesc: 'يختار مديرو المنصة فقط المبادرات للمستأجر. المكتبة أدناه للقراءة فقط.',
      headTitle: 'رئيس القسم (GE)',
      headDesc: 'عيّن الرئيس لكل قسم. عند التعيين، يجوز للرئيس فقط اعتماد تقييمات قسمه أو إعادتها؛ وعند الفراغ يجوز لأي عضو في القسم ذلك.',
      headLabel: 'الرئيس',
      headNone: 'لا رئيس معيَّن — يجوز لأي عضو الاعتماد',
      headAssign: 'تعيين الرئيس',
      headClear: 'إزالة الرئيس',
      headSaved: 'تم تحديث رئيس القسم.',
      deptHeadBadge: 'رئيس',
    },

    audit: {
      title: 'سجل التدقيق',
      subtitle: 'من فعل ماذا ومتى — مع القيم قبل/بعد والأسباب. لمسؤولي المنصة فقط.',
      filterAction: 'يتضمن الإجراء',
      filterEntity: 'نوع الكيان',
      filterUser: 'معرّف المستخدم',
      filterFrom: 'من',
      filterTo: 'إلى',
      search: 'بحث',
      clear: 'مسح',
      who: 'من',
      what: 'الإجراء',
      entity: 'الكيان',
      when: 'متى',
      before: 'قبل',
      after: 'بعد',
      reason: 'السبب',
      payload: 'التفاصيل',
      empty: 'لا توجد قيود تدقيق تطابق هذه المرشحات.',
      limit: 'صفوف',
    },

    notifications: {
      title: 'الإشعارات',
      subtitle: 'أحدث النشاطات الموجهة إليك — الأحدث أولاً. يحتفظ البريد بآخر 50.',
      markAllRead: 'تعيين الكل كمقروء',
      markRead: 'تعيين كمقروء',
      empty: 'لا توجد إشعارات بعد.',
      allCaughtUp: 'لا جديد لديك.',
      unread: 'غير مقروء',
    },

    idle: {
      warningTitle: 'الجلسة على وشك الانتهاء',
      warningMessage: 'سيتم تسجيل خروجك تلقائياً بسبب عدم النشاط.',
      secondsLeft: 'ثانية متبقية',
      staySignedIn: 'البقاء مسجلاً',
      signOutNow: 'تسجيل الخروج الآن',
    },
  },
};
