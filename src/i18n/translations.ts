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
    importGRI: string;
    auditLog: string;
    settings: string;
    profile: string;
    logout: string;
    login: string;
    setup: string;
    tenantBadge: string;
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
    role: string;
    roles: {
      ge_admin: string;
      client_admin: string;
      employee: string;
    };
    tenant: string;
    department: string;
    notAssigned: string;
    dbUnconfiguredNotice: string;
    dbUnconfiguredHelp: string;
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
    demoBanner: string;
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
      importGRI: 'Import GRI Data',
      auditLog: 'Audit Log',
      settings: 'Settings & Database',
      profile: 'User Profile',
      logout: 'Sign Out',
      login: 'Sign In',
      setup: 'Initial Setup',
      tenantBadge: 'Tenant',
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
      passwordTooShort: 'New password must contain at least 6 characters.',
      role: 'Role',
      roles: {
        ge_admin: 'Platform Administrator',
        client_admin: 'Client Tenant Admin',
        employee: 'Department Employee',
      },
      tenant: 'Client Tenant',
      department: 'Department',
      notAssigned: 'Enterprise Level (Unrestricted)',
      dbUnconfiguredNotice: 'Live PostgreSQL connection (DATABASE_URL) is not yet set.',
      dbUnconfiguredHelp: 'Set DATABASE_URL in your environment or .env file to persist records with Row-Level Security.',
    },

    setup: {
      title: 'Initialize ESG GRI Platform',
      subtitle: 'Create the initial administrator account and verify PostgreSQL database',
      adminName: 'Full Name',
      adminEmail: 'Administrator Email',
      adminPassword: 'Password',
      adminPasswordHint: 'Minimum 6 characters, must be kept secure',
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
    },

    users: {
      title: 'User Management',
      subtitle: 'Create tenant users and deactivate accounts (accounts are never deleted)',
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
        demoBanner: "Demo build — content is the client's own GRI workbook",
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
      importGRI: 'استيراد بيانات GRI',
      auditLog: 'سجل التدقيق',
      settings: 'الإعدادات وقاعدة البيانات',
      profile: 'الملف الشخصي',
      logout: 'تسجيل الخروج',
      login: 'تسجيل الدخول',
      setup: 'التهيئة الأولية',
      tenantBadge: 'المستأجر',
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
      passwordTooShort: 'يجب أن تتكون كلمة المرور الجديدة من 6 أحرف على الأقل.',
      role: 'الدور الوظيفي',
      roles: {
        ge_admin: 'مدير المنصة',
        client_admin: 'مدير العميل (المستأجر)',
        employee: 'موظف القسم',
      },
      tenant: 'العميل المستأجر',
      department: 'القسم',
      notAssigned: 'مستوى المنشأة العام (شامل)',
      dbUnconfiguredNotice: 'اتصال PostgreSQL المباشر (DATABASE_URL) غير معين حتى الآن.',
      dbUnconfiguredHelp: 'قم بتعيين DATABASE_URL في البيئة أو ملف .env لحفظ السجلات مع عزل RLS.',
    },

    setup: {
      title: 'تهيئة منصة ESG GRI',
      subtitle: 'إنشاء حساب المسؤول الرئيسي والتحقق من قاعدة بيانات PostgreSQL',
      adminName: 'الاسم الكامل',
      adminEmail: 'بريد المسؤول الإلكتروني',
      adminPassword: 'كلمة المرور',
      adminPasswordHint: '6 أحرف على الأقل، يجب الحفاظ على سريتها',
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
    },

    users: {
      title: 'إدارة المستخدمين',
      subtitle: 'إنشاء مستخدمي المستأجرين وإلغاء تنشيط الحسابات (لا تُحذف الحسابات أبداً)',
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
        demoBanner: 'نسخة عرض تجريبية — المحتوى من ملف GRI الخاص بالعميل',
      },
  },
};
