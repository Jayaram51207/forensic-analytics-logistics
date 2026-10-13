// Application State
let state = {
  jobs: [],
  logs: [],
  users: [],
  activeFilter: 'active', // 'active', 'completed', 'all', 'logs', 'admin-board'
  searchQuery: '',
  currentJobId: null,
  currentUser: null, // { username, name, role }
  currentWorkspace: null // 'sea_import', 'sea_export', 'air_import', 'air_export'
};

// DOM Elements
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginUsernameSelect = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginErrorMsg = document.getElementById('login-error');

const currentUserName = document.getElementById('current-user-name');
const btnLogout = document.getElementById('btn-logout');
const menuBtnAdmin = document.getElementById('menu-btn-admin');
const btnToggleTheme = document.getElementById('btn-toggle-theme');
const themeIcon = document.getElementById('theme-icon');

const menuButtons = document.querySelectorAll('.menu-btn');
const searchInput = document.getElementById('search-input');
const btnAddJob = document.getElementById('btn-add-job');
const jobListTbody = document.getElementById('job-list-tbody');
const logsFeedContainer = document.getElementById('logs-feed-container');

// Workspace Selector Elements
const workspaceSelectorOverlay = document.getElementById('workspace-selector-overlay');
const appContainer = document.getElementById('app-container');
const btnSwitchWorkspace = document.getElementById('menu-btn-switch-workspace');
const dummyBtnSwitch = document.getElementById('dummy-btn-switch');
const seaImportDummyView = document.getElementById('sea-import-dummy-view');

// Closure Modal Elements
const closureModalBackdrop = document.getElementById('closure-modal-backdrop');
const closureModal = document.getElementById('closure-modal');
const closureForm = document.getElementById('closure-form');
const closureBillNo = document.getElementById('closure-bill-no');
const closureBillAmount = document.getElementById('closure-bill-amount');
const closureSgst = document.getElementById('closure-sgst');
const closureCgst = document.getElementById('closure-cgst');
const closureBtnClose = document.getElementById('closure-btn-close');
const closureBtnCancel = document.getElementById('closure-btn-cancel');

let closurePendingContext = null;

// Views
const shipmentsView = document.getElementById('shipments-view');
const logsView = document.getElementById('logs-view');
const adminBoardView = document.getElementById('admin-board-view');
const viewTitle = document.getElementById('view-title');

// Stats Counters
const countActive = document.getElementById('count-active');
const countCompleted = document.getElementById('count-completed');
const countAll = document.getElementById('count-all');
const statTotal = document.getElementById('stat-total');
const statPending = document.getElementById('stat-pending');
const statCompleted = document.getElementById('stat-completed');
const statDocs = document.getElementById('stat-docs');
const lanUrl = document.getElementById('lan-url');

// Drawer Elements
const drawerOverlay = document.getElementById('drawer-overlay');
const detailsDrawer = document.getElementById('details-drawer');
const drawerJobStatus = document.getElementById('drawer-job-status');
const drawerJobNo = document.getElementById('drawer-job-no');
const drawerBtnEdit = document.getElementById('drawer-btn-edit');
const drawerBtnDelete = document.getElementById('drawer-btn-delete');
const drawerBtnClose = document.getElementById('drawer-btn-close');
const drawerFlowchartContainer = document.getElementById('drawer-flowchart-container');
const drawerClosureCard = document.getElementById('drawer-closure-card');
const drawerClosureContainer = document.getElementById('drawer-closure-container');
const drawerProgressPercent = document.getElementById('drawer-progress-percent');
const drawerProgressBar = document.getElementById('drawer-progress-bar');
const drawerLogsTimeline = document.getElementById('drawer-logs-timeline');

// Modal Elements
const jobModalBackdrop = document.getElementById('job-modal-backdrop');
const jobModal = document.getElementById('job-modal');
const modalTitle = document.getElementById('modal-title');
const jobForm = document.getElementById('job-form');
const formJobId = document.getElementById('form-job-id');
const formChecklistPdfUrl = document.getElementById('form-checklist-pdf-url');
const modalBtnClose = document.getElementById('modal-btn-close');
const modalBtnCancel = document.getElementById('modal-btn-cancel');

// Modal Dinamic Grids
const formCargoTbody = document.getElementById('form-cargo-tbody');
const formContainersTbody = document.getElementById('form-containers-tbody');
const formChargesTbody = document.getElementById('form-charges-tbody');

const btnAddCargoRow = document.getElementById('btn-add-cargo-row');
const btnAddContainerRow = document.getElementById('btn-add-container-row');
const btnAddChargeRow = document.getElementById('btn-add-charge-row');

// Modal PDF Importer
const modalUploadPdf = document.getElementById('modal-upload-pdf');
const btnTriggerUpload = document.getElementById('btn-trigger-upload');
const autofillStatus = document.getElementById('autofill-status');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  checkLoginSession();
  initEventListeners();
  setupSSE();
  
  // Set LAN URL string
  lanUrl.textContent = window.location.origin;
  
  // Update theme icon text based on loaded theme
  if (document.body.classList.contains('light-theme') && themeIcon) {
    themeIcon.textContent = 'dark_mode';
  }
});

// Check Login Session
function checkLoginSession() {
  const session = localStorage.getItem('currentUser');
  if (session) {
    try {
      state.currentUser = JSON.parse(session);
      applyUserSession();
      fetchInitialData();
      
      const savedWorkspace = localStorage.getItem('currentWorkspace');
      if (savedWorkspace) {
        selectWorkspace(savedWorkspace);
      } else {
        showWorkspaceSelector();
      }
    } catch (e) {
      localStorage.removeItem('currentUser');
      showLoginScreen();
    }
  } else {
    showLoginScreen();
  }
}

function showLoginScreen() {
  loginOverlay.classList.remove('hidden');
  workspaceSelectorOverlay.classList.add('hidden');
  appContainer.classList.add('hidden');
}

function showWorkspaceSelector() {
  loginOverlay.classList.add('hidden');
  workspaceSelectorOverlay.classList.remove('hidden');
  appContainer.classList.add('hidden');
}

function selectWorkspace(workspace) {
  state.currentWorkspace = workspace;
  localStorage.setItem('currentWorkspace', workspace);
  
  workspaceSelectorOverlay.classList.add('hidden');
  appContainer.classList.remove('hidden');
  
  setupWorkspaceUI();
  renderJobs();
  updateStats();
  
  // Select active tab
  document.querySelector('.menu-btn[data-filter="active"]').click();
}

function setupWorkspaceUI() {
  const isDummy = false; // state.currentWorkspace === 'sea_import';
  const isAir = state.currentWorkspace && state.currentWorkspace.startsWith('air');
  const isImport = state.currentWorkspace && state.currentWorkspace.endsWith('import');
  
  // Toggle views
  if (isDummy) {
    shipmentsView.classList.add('hidden');
    logsView.classList.add('hidden');
    adminBoardView.classList.add('hidden');
    seaImportDummyView.classList.remove('hidden');
    btnAddJob.classList.add('hidden');
  } else {
    shipmentsView.classList.remove('hidden');
    seaImportDummyView.classList.add('hidden');
    btnAddJob.classList.remove('hidden');
    
    // Toggle form elements visibility based on workspace
    const fgMawb = document.getElementById('form-group-mawb');
    const fgHawb = document.getElementById('form-group-hawb');
    const fgChargeable = document.getElementById('form-group-chargeable_weight');
    const fgPreCarriage = document.getElementById('form-group-pre_carriage');
    const fgReceipt = document.getElementById('form-group-place_of_receipt');

    if (isAir) {
      if (fgMawb) fgMawb.classList.remove('hidden');
      if (fgHawb) fgHawb.classList.remove('hidden');
      if (fgChargeable) fgChargeable.classList.remove('hidden');
      if (fgPreCarriage) fgPreCarriage.classList.add('hidden');
      if (fgReceipt) fgReceipt.classList.add('hidden');
    } else {
      if (fgMawb) fgMawb.classList.add('hidden');
      if (fgHawb) fgHawb.classList.add('hidden');
      if (fgChargeable) fgChargeable.classList.add('hidden');
      if (fgPreCarriage) fgPreCarriage.classList.remove('hidden');
      if (fgReceipt) fgReceipt.classList.remove('hidden');
    }

    // Label tweaks
    const sbLabel = document.querySelector('label[for="form-sb_no_date"]');
    if (sbLabel) {
      sbLabel.textContent = isImport ? 'Bill of Entry (B/E) No & Date' : 'Shipping Bill (S.B.) No & Date';
    }
    const drawerSbLabel = document.querySelector('#dt-summary .info-box:nth-child(2) .info-label');
    if (drawerSbLabel) {
      drawerSbLabel.textContent = isImport ? 'Bill of Entry (B/E) No & Date' : 'Shipping Bill (S.B.) No & Date';
    }

    const lblVessel = document.querySelector('label[for="form-vessel_voyage"]');
    if (lblVessel) {
      lblVessel.textContent = isAir ? 'Flight No / Voyage' : 'Vessel / Voyage / Flight';
    }
    const lblCarrier = document.querySelector('label[for="form-carrier"]');
    if (lblCarrier) {
      lblCarrier.textContent = isAir ? 'Airline / Carrier' : 'Carrier / Shipping Line';
    }
    const lblPol = document.querySelector('label[for="form-port_of_loading"]');
    if (lblPol) {
      lblPol.textContent = isAir ? 'Airport of Departure' : 'Port of Loading';
    }
    const lblPod = document.querySelector('label[for="form-port_of_discharge"]');
    if (lblPod) {
      lblPod.textContent = isAir ? 'Airport of Destination' : 'Port of Discharge';
    }
    
    // Hide containers tab for Air shipments
    const containerTabBtn = document.querySelector('.modal-tab-btn[data-modtab="mt-containers"]');
    if (containerTabBtn) {
      if (isAir) containerTabBtn.classList.add('hidden');
      else containerTabBtn.classList.remove('hidden');
    }
    const drawerContainersTab = document.querySelector('.tab-link[data-tab="dt-cargo"]');
    if (drawerContainersTab) {
      drawerContainersTab.textContent = isAir ? 'Cargo Description' : 'Cargo & Containers';
    }
    const containersBlock = document.querySelector('.containers-block');
    if (containersBlock) {
      if (isAir) containersBlock.classList.add('hidden');
      else containersBlock.classList.remove('hidden');
    }
  }
}

function applyUserSession() {
  loginOverlay.classList.add('hidden');
  currentUserName.textContent = state.currentUser.name;

  // Show Admin Tab if Role is Admin
  if (state.currentUser.username === 'admin') {
    menuBtnAdmin.classList.remove('hidden');
    document.getElementById('menu-btn-logs').classList.remove('hidden');
  } else {
    menuBtnAdmin.classList.add('hidden');
    document.getElementById('menu-btn-logs').classList.add('hidden');
  }
}

// Setup Server-Sent Events (SSE) Client
function setupSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('job_created', (e) => {
    const job = JSON.parse(e.data);
    state.jobs.unshift(job);
    renderJobs();
    updateStats();
    renderAdminBoard();
    
    setTimeout(() => {
      const card = document.querySelector(`[data-job-id="${job.id}"]`);
      if (card) {
        card.classList.add('updated-flash');
        setTimeout(() => card.classList.remove('updated-flash'), 1500);
      }
    }, 100);
  });

  eventSource.addEventListener('job_updated', (e) => {
    const job = JSON.parse(e.data);
    const index = state.jobs.findIndex(j => j.id === job.id);
    if (index !== -1) {
      state.jobs[index] = job;
    } else {
      state.jobs.push(job);
    }
    
    renderJobs();
    updateStats();
    renderAdminBoard();

    if (state.currentJobId === job.id) {
      openJobDetails(job.id, false);
    }

    const card = document.querySelector(`[data-job-id="${job.id}"]`);
    if (card) {
      card.classList.add('updated-flash');
      setTimeout(() => card.classList.remove('updated-flash'), 1500);
    }
  });

  eventSource.addEventListener('job_deleted', (e) => {
    const { id } = JSON.parse(e.data);
    state.jobs = state.jobs.filter(j => j.id !== id);
    renderJobs();
    updateStats();
    renderAdminBoard();

    if (state.currentJobId === id) {
      closeJobDetails();
    }
  });

  eventSource.addEventListener('document_toggled', (e) => {
    const data = JSON.parse(e.data);
    const index = state.jobs.findIndex(j => j.id === data.jobId);
    if (index !== -1) {
      state.jobs[index] = data.job;
    }

    renderJobs();
    updateStats();
    renderAdminBoard();

    if (state.currentJobId === data.jobId) {
      openJobDetails(data.jobId, false);
      
      const switchEl = document.querySelector(`[data-doc-name="${data.docName}"]`);
      if (switchEl) {
        switchEl.style.backgroundColor = 'var(--primary-light)';
        setTimeout(() => {
          switchEl.style.backgroundColor = 'transparent';
        }, 1000);
      }
    }

    const card = document.querySelector(`[data-job-id="${data.jobId}"]`);
    if (card) {
      card.classList.add('updated-flash');
      setTimeout(() => card.classList.remove('updated-flash'), 1500);
    }
  });

  eventSource.addEventListener('workflow_toggled', (e) => {
    const data = JSON.parse(e.data);
    const index = state.jobs.findIndex(j => j.id === data.jobId);
    if (index !== -1) {
      state.jobs[index] = data.job;
    }

    renderJobs();
    updateStats();
    renderAdminBoard();

    if (state.currentJobId === data.jobId) {
      openJobDetails(data.jobId, false);
      
      const stepEl = document.querySelector(`[data-step-id="${data.stepId}"]`);
      if (stepEl) {
        stepEl.style.backgroundColor = 'var(--primary-light)';
        setTimeout(() => {
          stepEl.style.backgroundColor = 'transparent';
        }, 1000);
      }
    }

    const card = document.querySelector(`[data-job-id="${data.jobId}"]`);
    if (card) {
      card.classList.add('updated-flash');
      setTimeout(() => card.classList.remove('updated-flash'), 1500);
    }
  });

  eventSource.addEventListener('log_entry', (e) => {
    const log = JSON.parse(e.data);
    log.created_at = new Date().toISOString();
    log.user = log.message.split(' by ')[1] || 'System';
    state.logs.unshift(log);
    renderLogs();
  });

  eventSource.onerror = (err) => {
    console.error('SSE Connection failed. Retrying...', err);
  };
}

// Fetch Initial Database state
async function fetchInitialData() {
  try {
    const jobsRes = await fetch('/api/jobs');
    state.jobs = await jobsRes.json();
    
    if (state.currentUser && state.currentUser.username === 'admin') {
      const logsRes = await fetch(`/api/logs?adminUsername=${state.currentUser.username}`);
      state.logs = await logsRes.json();
      
      const usersRes = await fetch(`/api/users?adminUsername=${state.currentUser.username}`);
      state.users = await usersRes.json();
    }

    renderJobs();
    if (state.currentUser && state.currentUser.username === 'admin') {
      renderLogs();
      renderAdminBoard();
      renderUsersList();
    }
    updateStats();
  } catch (err) {
    console.error('Error fetching database:', err);
  }
}

// Initialize Page Toggles & Filters
function initEventListeners() {
  // Handle Login Form Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUsernameSelect.value;
    const password = loginPasswordInput.value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (!res.ok) {
        throw new Error('Unauthorized');
      }

      const userData = await res.json();
      state.currentUser = userData;
      localStorage.setItem('currentUser', JSON.stringify(userData));
      
      applyUserSession();
      fetchInitialData();
      showWorkspaceSelector();
      loginForm.reset();
    } catch (err) {
      loginErrorMsg.classList.remove('hidden');
      setTimeout(() => loginErrorMsg.classList.add('hidden'), 3000);
    }
  });

  // Logout Click
  btnLogout.addEventListener('click', () => {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentWorkspace');
    state.currentUser = null;
    state.currentWorkspace = null;
    state.jobs = [];
    state.logs = [];
    state.users = [];
    showLoginScreen();
  });

  // Sidebar Filters Change
  menuButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.currentTarget;
      const filter = targetBtn.getAttribute('data-filter');
      if (!filter) return; // ignore switch workspace button

      // Admin verification checks
      if (filter === 'logs' && (!state.currentUser || state.currentUser.role !== 'Admin')) {
        alert('Access Denied: Activity log is restricted to Admin role.');
        return;
      }
      if (filter === 'admin-board' && (!state.currentUser || state.currentUser.username !== 'admin')) {
        alert('Access Denied: Admin dashboard is restricted to System Admin.');
        return;
      }

      menuButtons.forEach(b => b.classList.remove('active'));
      targetBtn.classList.add('active');

      state.activeFilter = filter;

      // Hide all content views
      shipmentsView.classList.add('hidden');
      logsView.classList.add('hidden');
      adminBoardView.classList.add('hidden');
      seaImportDummyView.classList.add('hidden');

      if (filter === 'logs') {
        logsView.classList.remove('hidden');
        renderLogs();
      } else if (filter === 'admin-board') {
        adminBoardView.classList.remove('hidden');
        renderAdminBoard();
      } else {
        const isDummy = false; // state.currentWorkspace === 'sea_import';
        if (isDummy) {
          seaImportDummyView.classList.remove('hidden');
        } else {
          shipmentsView.classList.remove('hidden');
          
          if (filter === 'active') viewTitle.textContent = 'Active Shipments';
          else if (filter === 'completed') viewTitle.textContent = 'Completed Shipments';
          else if (filter === 'all') viewTitle.textContent = 'All Cargo Shipments';
          
          renderJobs();
        }
      }
    });
  });

  // Workspace selection card clicks
  document.querySelectorAll('.workspace-card').forEach(card => {
    card.addEventListener('click', () => {
      const workspace = card.getAttribute('data-workspace');
      selectWorkspace(workspace);
    });
  });

  // Switch workspace sidebar button
  btnSwitchWorkspace.addEventListener('click', () => {
    state.currentWorkspace = null;
    localStorage.removeItem('currentWorkspace');
    showWorkspaceSelector();
  });

  // Dummy dashboard back button
  dummyBtnSwitch.addEventListener('click', () => {
    btnSwitchWorkspace.click();
  });

  // Admin user creation form submit
  const addUserForm = document.getElementById('admin-add-user-form');
  if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('add-user-username').value.trim();
      const password = document.getElementById('add-user-password').value;
      const name = document.getElementById('add-user-name').value.trim();
      const role = document.getElementById('add-user-role').value;
      
      try {
        const res = await fetch(`/api/users?adminUsername=${state.currentUser.username}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            name,
            role
          })
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to create user');
        }
        
        // Reload users list
        const usersRes = await fetch(`/api/users?adminUsername=${state.currentUser.username}`);
        state.users = await usersRes.json();
        renderUsersList();
        addUserForm.reset();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  // Search Input Trigger
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderJobs();
  });

  // Drawer Tabs Change
  const tabLinks = document.querySelectorAll('.tab-link');
  tabLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      tabLinks.forEach(l => l.classList.remove('active'));
      e.target.classList.add('active');

      const tabId = e.target.getAttribute('data-tab');
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Modal Tabs Change
  const modalTabBtns = document.querySelectorAll('.modal-tab-btn');
  modalTabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      modalTabBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');

      const tabId = e.target.getAttribute('data-modtab');
      document.querySelectorAll('.modal-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Open Add Job Modal
  btnAddJob.addEventListener('click', () => openJobModal());

  // Close actions
  drawerBtnClose.addEventListener('click', closeJobDetails);
  drawerOverlay.addEventListener('click', closeJobDetails);
  modalBtnClose.addEventListener('click', closeModal);
  modalBtnCancel.addEventListener('click', closeModal);
  jobModalBackdrop.addEventListener('click', closeModal);

  // Edit/Delete actions in drawer
  drawerBtnEdit.addEventListener('click', () => {
    if (state.currentJobId) {
      openJobModal(state.currentJobId);
    }
  });

  drawerBtnDelete.addEventListener('click', handleDeleteJob);

  // Dynamic Add Row buttons in Form
  btnAddCargoRow.addEventListener('click', () => addCargoFormRow());
  btnAddContainerRow.addEventListener('click', () => addContainerFormRow());
  btnAddChargeRow.addEventListener('click', () => addChargeFormRow());

  // Save/Submit Job Form
  jobForm.addEventListener('submit', handleFormSubmit);

  // Clear Screen Log button
  document.getElementById('btn-clear-logs-ui').addEventListener('click', () => {
    state.logs = [];
    renderLogs();
  });

  // Importer triggers
  btnTriggerUpload.addEventListener('click', () => {
    modalUploadPdf.click();
  });

  modalUploadPdf.addEventListener('change', handleChecklistUpload);

  // Flag Shipment checkbox toggle in form
  document.getElementById('form-is_flagged').addEventListener('change', (e) => {
    const remarksGroup = document.getElementById('form-flag-remarks-group');
    if (e.target.checked) {
      remarksGroup.classList.remove('hidden');
    } else {
      remarksGroup.classList.add('hidden');
      document.getElementById('form-flag_remarks').value = '';
    }
  });

  // Accounts Closure Modal events
  closureBtnClose.addEventListener('click', closeClosureModal);
  closureBtnCancel.addEventListener('click', closeClosureModal);
  closureForm.addEventListener('submit', handleClosureSubmit);

  // Theme Toggle Button Event
  if (btnToggleTheme) {
    btnToggleTheme.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      const isLight = document.body.classList.contains('light-theme');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      if (themeIcon) {
        themeIcon.textContent = isLight ? 'dark_mode' : 'light_mode';
      }
    });
  }
}

function openClosureModal(jobId, stepId) {
  closurePendingContext = { jobId, stepId };
  closureForm.reset();
  
  // Pre-fill fields if invoice info exists
  const job = state.jobs.find(j => j.id === jobId);
  if (job) {
    closureBillNo.value = job.closing_bill_no || '';
    closureBillAmount.value = job.closing_bill_amount || '';
    closureSgst.value = job.closing_sgst || '';
    closureCgst.value = job.closing_cgst || '';
  }

  closureModalBackdrop.classList.add('active');
  closureModal.classList.add('active');
}

function closeClosureModal() {
  closurePendingContext = null;
  closureModalBackdrop.classList.remove('active');
  closureModal.classList.remove('active');
  
  // Refresh drawer details to reset the checkbox to unchecked state
  if (state.currentJobId) {
    openJobDetails(state.currentJobId, false);
  }
}

async function handleClosureSubmit(e) {
  e.preventDefault();
  if (!closurePendingContext) return;

  const { jobId, stepId } = closurePendingContext;
  const bill_no = closureBillNo.value.trim();
  const bill_amount = parseFloat(closureBillAmount.value) || 0;
  const sgst = parseFloat(closureSgst.value) || 0;
  const cgst = parseFloat(closureCgst.value) || 0;

  const closingDetails = { bill_no, bill_amount, sgst, cgst };
  const user = state.currentUser.name;
  const status = 'Completed';

  try {
    const res = await fetch(`/api/jobs/${jobId}/workflow/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, user, closingDetails })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to close shipment');
    }

    const updatedJob = await res.json();
    
    const idx = state.jobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      state.jobs[idx] = updatedJob;
    }

    // Close the prompt modal
    closurePendingContext = null;
    closureModalBackdrop.classList.remove('active');
    closureModal.classList.remove('active');

    renderJobs();
    updateStats();
    openJobDetails(jobId, false);
  } catch (err) {
    alert(err.message);
  }
}

// Handle Checklist PDF Upload, Parse & Modal Autofill
async function handleChecklistUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  autofillStatus.className = 'autofill-status loading';
  autofillStatus.textContent = 'Parsing checklist...';

  const formData = new FormData();
  formData.append('checklist', file);

  try {
    const res = await fetch('/api/parse-checklist', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to parse file');
    }

    const data = await res.json();

    // Autofill fields
    document.getElementById('form-job_no').value = data.job_no || '';
    document.getElementById('form-file_ref_no').value = data.file_ref_no || '';
    document.getElementById('form-sb_no_date').value = data.sb_no_date || '';
    document.getElementById('form-mawb_no_date').value = data.mawb_no_date || '';
    document.getElementById('form-hawb_no_date').value = data.hawb_no_date || '';
    document.getElementById('form-chargeable_weight').value = data.chargeable_weight || '';
    document.getElementById('form-invoice_no_date').value = data.invoice_no_date || '';
    document.getElementById('form-vessel_voyage').value = data.vessel_voyage || '';
    document.getElementById('form-port_of_loading').value = data.port_of_loading || 'CHENNAI / INDIA';
    document.getElementById('form-port_of_discharge').value = data.port_of_discharge || '';
    document.getElementById('form-final_destination').value = data.final_destination || '';
    document.getElementById('form-country_of_origin').value = data.country_of_origin || 'INDIA';
    document.getElementById('form-country_of_dest').value = data.country_of_dest || '';
    document.getElementById('form-hs_code').value = data.hs_code || '';
    document.getElementById('form-payment_mode').value = data.payment_mode || 'PREPAID';
    
    document.getElementById('form-total_pkgs').value = data.total_pkgs || '';
    document.getElementById('form-gross_weight').value = data.gross_weight || '';
    document.getElementById('form-net_weight').value = data.net_weight || '';

    // Addresses
    document.getElementById('form-shipper').value = data.shipper || '';
    document.getElementById('form-consignee').value = data.consignee || '';
    document.getElementById('form-notify').value = data.notify || 'SAME AS CONSIGNEE';
    document.getElementById('form-also_notify').value = data.also_notify || 'SAME AS CONSIGNEE';

    // Cargo Manifest
    document.getElementById('form-cargo_desc').value = data.cargo_desc || '';

    // Hidden Checklist Path Link
    formChecklistPdfUrl.value = data.checklist_pdf_url || '';

    // Clear and autofill cargo grid
    formCargoTbody.innerHTML = '';
    if (data.cargo_items && data.cargo_items.length > 0) {
      data.cargo_items.forEach((item, idx) => {
        addCargoFormRow({
          sl_no: item.sl_no || (idx + 1),
          description: item.description,
          hs_code: item.hs_code,
          qty: item.qty,
          unit: item.unit,
          rate: 0.0,
          net_wt: 0.0,
          gross_wt: 0.0
        });
      });
    } else {
      addCargoFormRow();
    }

    // Clear and autofill container grid
    formContainersTbody.innerHTML = '';
    if (data.containers && data.containers.length > 0) {
      data.containers.forEach((cnt, idx) => {
        addContainerFormRow({
          sl_no: cnt.sl_no || (idx + 1),
          container_no: cnt.container_no,
          seal_no: cnt.seal_no,
          pkgs: cnt.pkgs,
          net_wt: cnt.net_wt,
          gross_wt: cnt.gross_wt,
          cbm: cnt.cbm
        });
      });
    } else {
      addContainerFormRow();
    }

    // Load default charges for Billing sheet
    formChargesTbody.innerHTML = '';
    let defaults = [];
    if (state.currentWorkspace && state.currentWorkspace.startsWith('air')) {
      defaults = [
        { description: "A/F - AIR FREIGHT CHARGES", amount: 85000.0 },
        { description: "AIRPORT TERMINAL HANDLING (THC)", amount: 6500.0 },
        { description: "AWB DOCUMENTATION & PROCESSING FEES", amount: 3500.0 }
      ];
    } else {
      defaults = [
        { description: "O/F - OCEAN FREIGHT CHARGES", amount: 120000.0 },
        { description: "LOCAL THC TERMINAL CHARGES", amount: 9500.0 },
        { description: "DOCUMENTATION & BL ISSUANCE FEES", amount: 4500.0 }
      ];
    }
    defaults.forEach(d => addChargeFormRow(d));

    autofillStatus.className = 'autofill-status success';
    autofillStatus.textContent = 'Autofill Success!';
  } catch (err) {
    autofillStatus.className = 'autofill-status error';
    autofillStatus.textContent = `Autofill Failed: ${err.message}`;
  }
}

// Update Dashboard Statistics UI
function updateStats() {
  const workspaceJobs = state.jobs.filter(j => j.type === state.currentWorkspace);
  const total = workspaceJobs.length;
  const completed = workspaceJobs.filter(j => j.status === 'Completed' || j.status === 'Closed').length;
  const active = total - completed;

  let totalStepsCount = 0;
  let completedStepsCount = 0;
  workspaceJobs.forEach(j => {
    if (j.workflow_steps) {
      const relevant = j.workflow_steps.filter(s => s.status !== 'N/A');
      totalStepsCount += relevant.length;
      completedStepsCount += relevant.filter(s => s.status === 'Completed').length;
    }
  });

  countActive.textContent = active;
  countCompleted.textContent = completed;
  countAll.textContent = total;

  statTotal.textContent = total;
  statPending.textContent = active;
  statCompleted.textContent = completed;
  statDocs.textContent = `${completedStepsCount}/${totalStepsCount}`;
}

// Render Shipment Cards
function renderJobs() {
  if (state.activeFilter === 'logs' || state.activeFilter === 'admin-board') {
    const tracker = document.getElementById('pipeline-tracker-container');
    if (tracker) tracker.classList.add('hidden');
    return;
  }

  let filtered = state.jobs.filter(j => j.type === state.currentWorkspace);

  if (state.activeFilter === 'active') {
    filtered = filtered.filter(j => j.status === 'Active');
  } else if (state.activeFilter === 'completed') {
    filtered = filtered.filter(j => j.status === 'Completed' || j.status === 'Closed');
  }

  if (state.searchQuery) {
    filtered = filtered.filter(j => {
      return j.job_no.toLowerCase().includes(state.searchQuery) ||
             j.consignee.toLowerCase().includes(state.searchQuery) ||
             j.shipper.toLowerCase().includes(state.searchQuery) ||
             j.vessel_voyage.toLowerCase().includes(state.searchQuery) ||
             j.port_of_discharge.toLowerCase().includes(state.searchQuery) ||
             (j.file_ref_no && j.file_ref_no.toLowerCase().includes(state.searchQuery));
    });
  }

  // Render pipeline stage tracker
  renderPipelineTracker(filtered);

  jobListTbody.innerHTML = '';

  if (filtered.length === 0) {
    jobListTbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted" style="padding: 40px 0;">
          <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
            <span class="material-symbols-outlined" style="font-size:32px;">inbox</span>
            <p>No shipments match the current search or filter criteria.</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach(job => {
    const steps = job.workflow_steps || [];
    const relevant = steps.filter(s => s.status !== 'N/A');
    const completed = relevant.filter(s => s.status === 'Completed').length;
    const percent = relevant.length > 0 ? Math.round((completed / relevant.length) * 100) : 0;

    const statusLower = job.status.toLowerCase();
    const badgeClass = (statusLower === 'completed' || statusLower === 'closed') ? 'status-completed' : 'status-active';
    const displayStatus = (statusLower === 'completed' || statusLower === 'closed') ? 'Closed' : 'Active';

    const tr = document.createElement('tr');
    tr.setAttribute('data-job-id', job.id);
    
    if (state.currentJobId === job.id) {
      tr.classList.add('active-selected');
    }
    
    if (job.is_flagged) {
      tr.classList.add('flagged-row');
      tr.setAttribute('title', `Delayed Shipment issue:\n${job.flag_remarks || 'No remarks provided'}`);
    }

    const flagHtml = job.is_flagged
      ? `<span class="material-symbols-outlined" style="color: var(--danger); font-size: 18px; vertical-align: middle; margin-left: 6px; cursor: help;" title="Delayed Reason: ${job.flag_remarks || 'No remarks provided'}">flag</span>`
      : '';
    
    const isAdmin = state.currentUser && state.currentUser.username === 'admin';
    const deleteBtnHtml = isAdmin 
      ? `<button class="btn-delete-job" style="background:transparent; border:none; color:var(--danger); cursor:pointer; vertical-align:middle; margin-left:10px; display:inline-flex; align-items:center; outline:none; padding:4px;" onclick="handleTableDeleteJob(event, ${job.id})" title="Delete Shipment">
           <span class="material-symbols-outlined" style="font-size: 18px;">delete</span>
         </button>` 
      : '';

    tr.innerHTML = `
      <td><strong style="color: var(--primary);"># ${job.job_no}</strong>${flagHtml}</td>
      <td>${job.file_ref_no || 'Not Assigned'}</td>
      <td>${job.vessel_voyage || 'Pending'}</td>
      <td>${job.final_destination || 'Pending'}</td>
      <td>${job.eta || 'TBA'}</td>
      <td>
        <div class="progress-cell">
          <div class="meter-bar" style="width: 100px; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 8px;">
            <div class="meter-fill" style="width: ${percent}%; height:100%; background: ${displayStatus === 'Closed' ? 'var(--success)' : 'linear-gradient(90deg, var(--primary) 0%, #818cf8 100%)'};"></div>
          </div>
          <span class="progress-cell-text" style="font-size:0.8rem; color:var(--text-muted); font-weight:600;">${completed}/${relevant.length} (${percent}%)</span>
        </div>
      </td>
      <td>
        <span class="job-card-badge ${badgeClass}" style="display:inline-block; vertical-align:middle;">${displayStatus}</span>
        ${deleteBtnHtml}
      </td>
    `;

    tr.addEventListener('click', () => {
      document.querySelectorAll('#job-list-tbody tr').forEach(r => r.classList.remove('active-selected'));
      tr.classList.add('active-selected');
      openJobDetails(job.id);
    });
    jobListTbody.appendChild(tr);
  });
}

function renderPipelineTracker(jobs) {
  const container = document.getElementById('pipeline-tracker-container');
  if (!container) return;

  // Only show pipeline tracker on 'active' shipments tab
  if (state.activeFilter !== 'active') {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  // Filter only active jobs (status === 'Active')
  const activeJobs = jobs.filter(j => j.status === 'Active');
  if (activeJobs.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  // Group jobs by their current active step
  const groups = {};
  activeJobs.forEach(job => {
    const steps = job.workflow_steps || [];
    const currentStep = steps.find(s => s.status === 'Pending');
    const stepName = currentStep ? currentStep.name : 'Unknown Stage';

    if (!groups[stepName]) {
      groups[stepName] = [];
    }
    groups[stepName].push(job);
  });

  // Get chronological workflow steps list
  const defaultSteps = getDefaultWorkflowSteps(state.currentWorkspace);

  // Filter defaultSteps to only those that actually have jobs in them
  const activeStages = defaultSteps.filter(stepName => groups[stepName] && groups[stepName].length > 0);

  // If there are stages with jobs that are not in defaultSteps, add them to the end
  Object.keys(groups).forEach(stepName => {
    if (!activeStages.includes(stepName)) {
      activeStages.push(stepName);
    }
  });

  if (activeStages.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'pipeline-tracker-grid';

  activeStages.forEach(stageName => {
    const stageJobs = groups[stageName];
    const stageCard = document.createElement('div');
    stageCard.className = 'pipeline-stage-card';

    stageCard.innerHTML = `
      <div class="pipeline-stage-header">
        <span class="pipeline-stage-title" title="${stageName}">${stageName}</span>
        <span class="pipeline-stage-count">${stageJobs.length} ${stageJobs.length === 1 ? 'Job' : 'Jobs'}</span>
      </div>
      <div class="pipeline-jobs-list"></div>
    `;

    const jobsListContainer = stageCard.querySelector('.pipeline-jobs-list');

    stageJobs.forEach(job => {
      const jobBadge = document.createElement('div');
      jobBadge.className = 'pipeline-job-badge';

      const flagIcon = job.is_flagged
        ? `<span class="material-symbols-outlined" style="color: var(--danger); font-size: 14px;" title="Delayed: ${job.flag_remarks || 'No remarks'}">flag</span>`
        : '';

      jobBadge.innerHTML = `
        <div class="pipeline-job-no">
          <span># ${job.job_no}</span>
          ${flagIcon}
        </div>
        <div class="pipeline-job-ref" title="${job.file_ref_no || 'No File Ref'}">
          ${job.file_ref_no || 'No File Ref'}
        </div>
      `;

      jobBadge.addEventListener('click', () => {
        openJobDetails(job.id);
        
        document.querySelectorAll('#job-list-tbody tr').forEach(r => r.classList.remove('active-selected'));
        const row = document.querySelector(`#job-list-tbody tr[data-job-id="${job.id}"]`);
        if (row) {
          row.classList.add('active-selected');
        }
      });

      jobsListContainer.appendChild(jobBadge);
    });

    grid.appendChild(stageCard);
  });

  container.appendChild(grid);
  container.classList.remove('hidden');
}

function getDefaultWorkflowSteps(type) {
  if (type === 'air_import') {
    return [
      'Job Created',
      'Invoice and P-List Received',
      'Checklist Approval',
      'Consol Manifest Filing Status',
      'Bill Filing',
      'Duty Payment',
      'Bill Registration',
      'OOC',
      'Accounts Processed',
      'Job Closed'
    ];
  } else if (type === 'air_export') {
    return [
      'Job Created',
      'Shipping Instruction',
      'AWB Instruction',
      'Cargo Ready Status',
      'Checklist Approval',
      'Shipping Bill Filing',
      'TC Generation',
      'LEO Copy',
      'Flight Status',
      'EGM Status',
      'DBK Status',
      'Accounts Processing',
      'Job Closed'
    ];
  } else if (type === 'sea_import') {
    return [
      'Job Created',
      'KYC',
      'Invoice and Packing List',
      'IGM Manifest',
      'Checklist',
      'Filling of BL',
      'First copy',
      'Duty payment',
      'OOC',
      'Delivery completed',
      'Accounts proccessed',
      'Job Closed'
    ];
  } else {
    // Default is 'sea_export'
    return [
      'Job Created',
      'Shipping Instruction Received',
      'Invoice and Packing List Received',
      'Checklist Preparing',
      'Prepared Checklist',
      'BL Instruction & Bill Generated',
      'Bill Assessment First Copy',
      'Cargo Movement',
      'Bill Goes to Let Export',
      'Gatepass Generation (Stuffing Completed)',
      'FCL Form 13 Applied (If FCL)',
      'Shipping Bill EIR, Let Export, Gatepass Submission',
      'Document Verified (Before Sailing)',
      'Sailing Completed',
      'EGM - Normal (INMAA-1 CCTL/CITPL)',
      'EGM - Transhipment (INKAT1/INENN1)',
      'Accounts Processing Done',
      'Incentive Processed',
      'Job Closed'
    ];
  }
}

// Render Office Logs Feed
function renderLogs() {
  logsFeedContainer.innerHTML = '';
  
  if (state.logs.length === 0) {
    logsFeedContainer.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined">receipt_long</span>
        <p>Log is empty. Office updates will stream here in real-time.</p>
      </div>
    `;
    return;
  }

  state.logs.forEach(log => {
    const date = new Date(log.created_at);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
      <span class="log-time">[${timeStr}]</span>
      <span class="log-user">${log.user || 'System'}</span>
      <span class="log-message">${log.message}</span>
    `;
    logsFeedContainer.appendChild(item);
  });
}

// Render Admin Board Desk audits
function renderAdminBoard() {
  if (!state.currentUser || state.currentUser.username !== 'admin') return;

  // 1. Calculate stats per desk
  let counts = {
    'Desk 1': 0, // Invoice / desk1
    'Desk 2': 0, // Documentation / desk2
    'Desk 3': 0, // Customs / desk3
    'Desk 4': 0  // Operations / desk4
  };

  // List of submissions
  let submissions = [];

  state.jobs.forEach(job => {
    if (job.workflow_steps) {
      job.workflow_steps.forEach(step => {
        if (step.status !== 'Pending' && step.updated_by) {
          const userKey = step.updated_by;
          let deskMatched = null;
          if (userKey.startsWith('Desk 1')) deskMatched = 'Desk 1';
          else if (userKey.startsWith('Desk 2')) deskMatched = 'Desk 2';
          else if (userKey.startsWith('Desk 3')) deskMatched = 'Desk 3';
          else if (userKey.startsWith('Desk 4')) deskMatched = 'Desk 4';

          if (deskMatched) {
            counts[deskMatched]++;
          }
          submissions.push({
            time: step.updated_at ? new Date(step.updated_at) : new Date(job.updated_at),
            user: step.updated_by,
            job_no: job.job_no,
            doc_name: step.name,
            status: step.status
          });
        }
      });
    }
  });

  // Update desk text nodes
  document.getElementById('desk1-count').textContent = counts['Desk 1'];
  document.getElementById('desk2-count').textContent = counts['Desk 2'];
  document.getElementById('desk3-count').textContent = counts['Desk 3'];
  document.getElementById('desk4-count').textContent = counts['Desk 4'];

  // Sort submissions by time desc
  submissions.sort((a, b) => b.time - a.time);

  // Populate admin submissions table
  const tbody = document.querySelector('#admin-submissions-table tbody');
  tbody.innerHTML = '';

  if (submissions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No workflow steps cleared yet.</td></tr>`;
    return;
  }

  submissions.forEach(sub => {
    const tr = document.createElement('tr');
    const badgeClass = sub.status === 'Completed' ? 'badge-completed' : 'badge-all';
    tr.innerHTML = `
      <td>${sub.time.toLocaleDateString()} ${sub.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
      <td><strong>${sub.user}</strong></td>
      <td>#${sub.job_no}</td>
      <td>${sub.doc_name}</td>
      <td><span class="badge ${badgeClass}">${sub.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Open Details Drawer
function openJobDetails(jobId, triggerSlide = true) {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;

  state.currentJobId = jobId;

  if (triggerSlide) {
    drawerOverlay.classList.add('active');
    detailsDrawer.classList.add('active');
  }

  const isAir = job.type && job.type.startsWith('air');
  const isImport = job.type && job.type.endsWith('import');
  
  const drawerSbLabel = document.querySelector('#dt-summary .info-box:nth-child(2) .info-label');
  if (drawerSbLabel) {
    drawerSbLabel.textContent = isImport ? 'Bill of Entry (B/E) No & Date' : 'Shipping Bill (S.B.) No & Date';
  }
  
  const drawerContainersTab = document.querySelector('.tab-link[data-tab="dt-cargo"]');
  if (drawerContainersTab) {
    drawerContainersTab.textContent = isAir ? 'Cargo Description' : 'Cargo & Containers';
  }
  
  const containersBlock = document.querySelector('.containers-block');
  if (containersBlock) {
    if (isAir) containersBlock.classList.add('hidden');
    else containersBlock.classList.remove('hidden');
  }

  drawerJobNo.textContent = `JOB NO: ${job.job_no}`;
  drawerJobStatus.textContent = job.status;
  drawerJobStatus.className = `drawer-status-badge ${job.status.toLowerCase()}`;

  // Update flagged UI in drawer
  const flaggedBadge = document.getElementById('drawer-job-flagged');
  const flaggedSection = document.getElementById('drawer-flagged-section');
  const flaggedRemarksVal = document.getElementById('val-flag_remarks');
  if (job.is_flagged) {
    flaggedBadge.classList.remove('hidden');
    flaggedSection.classList.remove('hidden');
    flaggedRemarksVal.textContent = job.flag_remarks || 'No remarks provided.';
  } else {
    flaggedBadge.classList.add('hidden');
    flaggedSection.classList.add('hidden');
    flaggedRemarksVal.textContent = '';
  }

  document.getElementById('val-file_ref_no').textContent = job.file_ref_no || '-';
  document.getElementById('val-sb_no_date').textContent = job.sb_no_date || '-';
  document.getElementById('val-mawb_no_date').textContent = job.mawb_no_date || '-';
  document.getElementById('val-hawb_no_date').textContent = job.hawb_no_date || '-';
  document.getElementById('val-invoice_no_date').textContent = job.invoice_no_date || '-';
  document.getElementById('val-buyer_order_no_date').textContent = job.buyer_order_no_date || '-';
  document.getElementById('val-vessel_voyage').textContent = job.vessel_voyage || '-';
  document.getElementById('val-carrier').textContent = job.carrier || '-';
  document.getElementById('val-port_of_loading').textContent = job.port_of_loading || '-';
  document.getElementById('val-port_of_discharge').textContent = job.port_of_discharge || '-';
  document.getElementById('val-final_destination').textContent = job.final_destination || '-';
  document.getElementById('val-hs_code').textContent = job.hs_code || '-';
  document.getElementById('val-payment_mode').textContent = job.payment_mode || '-';
  document.getElementById('val-eta_etd').textContent = (job.eta || job.etd) ? `ETA: ${job.eta || 'N/A'} | ETD: ${job.etd || 'N/A'}` : '-';

  document.getElementById('val-dimensions').textContent = job.dimensions || '-';
  document.getElementById('val-total_pkgs').textContent = (job.total_pkgs || job.type_of_packing) ? `${job.total_pkgs || ''} (${job.type_of_packing || ''})` : '-';
  document.getElementById('val-chargeable_weight').textContent = job.chargeable_weight || '-';
  document.getElementById('val-gross_weight').textContent = job.gross_weight || '-';
  document.getElementById('val-net_weight').textContent = job.net_weight || '-';

  // Toggle drawer elements visibility based on job type
  const drawerGroupMawb = document.getElementById('drawer-group-mawb');
  const drawerGroupHawb = document.getElementById('drawer-group-hawb');
  const drawerGroupChargeableWeight = document.getElementById('drawer-group-chargeable_weight');

  if (isAir) {
    if (drawerGroupMawb) drawerGroupMawb.classList.remove('hidden');
    if (drawerGroupHawb) drawerGroupHawb.classList.remove('hidden');
    if (drawerGroupChargeableWeight) drawerGroupChargeableWeight.classList.remove('hidden');
  } else {
    if (drawerGroupMawb) drawerGroupMawb.classList.add('hidden');
    if (drawerGroupHawb) drawerGroupHawb.classList.add('hidden');
    if (drawerGroupChargeableWeight) drawerGroupChargeableWeight.classList.add('hidden');
  }

  // Sibling label logic for drawer labels
  const vesselVal = document.getElementById('val-vessel_voyage');
  if (vesselVal && vesselVal.previousElementSibling) {
    vesselVal.previousElementSibling.textContent = isAir ? 'Flight No / Voyage' : 'Vessel & Voyage / Flight No';
  }
  const carrierVal = document.getElementById('val-carrier');
  if (carrierVal && carrierVal.previousElementSibling) {
    carrierVal.previousElementSibling.textContent = isAir ? 'Airline / Carrier' : 'Shipping Line / Carrier';
  }
  const polVal = document.getElementById('val-port_of_loading');
  if (polVal && polVal.previousElementSibling) {
    polVal.previousElementSibling.textContent = isAir ? 'Airport of Departure' : 'Port of Loading';
  }
  const podVal = document.getElementById('val-port_of_discharge');
  if (podVal && podVal.previousElementSibling) {
    podVal.previousElementSibling.textContent = isAir ? 'Airport of Destination' : 'Port of Discharge';
  }

  document.getElementById('val-shipper').textContent = job.shipper || 'N/A';
  document.getElementById('val-consignee').textContent = job.consignee || 'N/A';
  document.getElementById('val-notify').textContent = job.notify || 'N/A';
  document.getElementById('val-cha').textContent = job.cha || 'N/A';
  document.getElementById('val-forwarding_agent').textContent = job.forwarding_agent || 'N/A';
  document.getElementById('val-buyer_if_other').textContent = job.buyer_if_other || 'N/A';

  document.getElementById('val-cargo_desc').textContent = job.cargo_desc || 'No manifest text provided.';

  // Render Cargo Items table
  const cargoTbody = document.querySelector('#table-cargo-items tbody');
  cargoTbody.innerHTML = '';
  if (job.cargo_items && job.cargo_items.length > 0) {
    job.cargo_items.forEach(item => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${item.sl_no}</td>
        <td>${item.description}</td>
        <td>${item.hs_code}</td>
        <td class="text-right">${item.qty}</td>
        <td>${item.unit}</td>
        <td class="text-right">$${parseFloat(item.rate).toFixed(2)}</td>
        <td class="text-right">${item.net_wt}</td>
        <td class="text-right">${item.gross_wt}</td>
        <td class="text-right">$${parseFloat(item.amount).toFixed(2)}</td>
      `;
      cargoTbody.appendChild(tr);
    });
  } else {
    cargoTbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">No individual cargo items created.</td></tr>`;
  }

  // Render Containers
  const cntTbody = document.querySelector('#table-containers tbody');
  cntTbody.innerHTML = '';
  if (job.containers && job.containers.length > 0) {
    job.containers.forEach(cnt => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${cnt.sl_no}</td>
        <td>${cnt.container_no || 'TBA'}</td>
        <td>${cnt.seal_no || 'TBA'}</td>
        <td>${cnt.pkgs || '0'}</td>
        <td class="text-right">${cnt.net_wt}</td>
        <td class="text-right">${cnt.gross_wt}</td>
        <td class="text-right">${parseFloat(cnt.cbm).toFixed(3)}</td>
      `;
      cntTbody.appendChild(tr);
    });
  } else {
    cntTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No containers registered.</td></tr>`;
  }

  // Render Billing
  document.getElementById('val-exchange_rate').textContent = job.exchange_rate ? `Rs. ${parseFloat(job.exchange_rate).toFixed(2)}` : '-';
  document.getElementById('val-bank_ac_drawback').textContent = job.bank_ac_drawback || 'Bank account details empty.';

  const chargesTbody = document.querySelector('#table-billing-charges tbody');
  chargesTbody.innerHTML = '';
  let taxable = 0;
  if (job.billing_charges && job.billing_charges.length > 0) {
    job.billing_charges.forEach(charge => {
      taxable += parseFloat(charge.amount) || 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${charge.description}</td>
        <td class="text-right">Rs. ${parseFloat(charge.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      `;
      chargesTbody.appendChild(tr);
    });
  } else {
    chargesTbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">No charges added yet.</td></tr>`;
  }

  const cgst = taxable * 0.09;
  const sgst = taxable * 0.09;
  const grandTotal = taxable + cgst + sgst;

  document.getElementById('val-taxable-val').textContent = `Rs. ${taxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('val-cgst-val').textContent = `Rs. ${cgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('val-sgst-val').textContent = `Rs. ${sgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.getElementById('val-grand-total').textContent = `Rs. ${grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // History timeline logs
  const historyTimeline = document.getElementById('drawer-logs-timeline');
  historyTimeline.innerHTML = '';
  if (job.logs && job.logs.length > 0) {
    job.logs.forEach((log, index) => {
      const date = new Date(log.created_at);
      const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.innerHTML = `
        <div class="timeline-dot ${index === 0 ? 'active' : ''}"></div>
        <div class="timeline-content">
          <div class="timeline-meta">${dateStr} by <strong>${log.user || 'System'}</strong></div>
          <div class="timeline-message">${log.message}</div>
        </div>
      `;
      historyTimeline.appendChild(item);
    });
  }

  // Billing Closure details card
  if (job.closing_bill_no) {
    drawerClosureCard.classList.remove('hidden');
    drawerClosureContainer.innerHTML = `
      <div class="closure-details-content-row">
        <span>Bill Number:</span>
        <span>${job.closing_bill_no}</span>
      </div>
      <div class="closure-details-content-row">
        <span>Bill Amount:</span>
        <span>Rs. ${parseFloat(job.closing_bill_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="closure-details-content-row">
        <span>SGST:</span>
        <span>Rs. ${parseFloat(job.closing_sgst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="closure-details-content-row">
        <span>CGST:</span>
        <span>Rs. ${parseFloat(job.closing_cgst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
      <div class="closure-details-content-row" style="border-top: 1px dashed var(--border); padding-top: 6px; margin-top: 4px;">
        <span>Total Tax Paid:</span>
        <span>Rs. ${(parseFloat(job.closing_sgst) + parseFloat(job.closing_cgst)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
      </div>
    `;
  } else {
    drawerClosureCard.classList.add('hidden');
    drawerClosureContainer.innerHTML = '';
  }

  renderDrawerChecklist(job);
}

// Render Workflow Checklist Toggles & Downloads Card
function renderDrawerChecklist(job) {
  // 1. Handle downloads card
  const downloadsCard = document.getElementById('drawer-downloads-card');
  const downloadsContainer = document.getElementById('drawer-downloads-container');
  downloadsContainer.innerHTML = '';

  const docsWithUrls = job.documents ? job.documents.filter(d => d.download_url) : [];
  if (docsWithUrls.length > 0) {
    downloadsCard.classList.remove('hidden');
    docsWithUrls.forEach(doc => {
      const btn = document.createElement('a');
      btn.className = 'btn-doc-download';
      btn.href = doc.download_url;
      btn.setAttribute('download', '');
      btn.setAttribute('target', '_blank');
      
      // Inline styles to match the slate-dark premium theme
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '8px';
      btn.style.padding = '10px 14px';
      btn.style.background = 'rgba(255, 255, 255, 0.02)';
      btn.style.border = '1px solid var(--border)';
      btn.style.borderRadius = 'var(--radius-md)';
      btn.style.color = 'var(--text)';
      btn.style.textDecoration = 'none';
      btn.style.fontSize = '0.82rem';
      btn.style.fontWeight = '500';
      btn.style.transition = 'var(--transition)';
      btn.style.cursor = 'pointer';
      btn.innerHTML = `
        <span class="material-symbols-outlined" style="font-size: 18px; color: var(--primary);">download</span>
        <span>Download ${doc.name}</span>
      `;
      // Hover effects
      btn.onmouseover = () => { btn.style.background = 'var(--primary-light)'; btn.style.borderColor = 'var(--primary)'; };
      btn.onmouseout = () => { btn.style.background = 'rgba(255, 255, 255, 0.02)'; btn.style.borderColor = 'var(--border)'; };

      downloadsContainer.appendChild(btn);
    });
  } else {
    downloadsCard.classList.add('hidden');
  }

  // 2. Handle workflow checklist rendering
  drawerFlowchartContainer.innerHTML = '';

  const steps = job.workflow_steps || [];
  const relevant = steps.filter(s => s.status !== 'N/A');
  const completed = relevant.filter(s => s.status === 'Completed').length;
  const percent = relevant.length > 0 ? Math.round((completed / relevant.length) * 100) : 0;

  drawerProgressPercent.textContent = `${percent}%`;
  drawerProgressBar.style.width = `${percent}%`;

  steps.forEach((step, idx) => {
    const isCompleted = step.status === 'Completed';
    const isNA = step.status === 'N/A';
    
    const nodeEl = document.createElement('div');
    nodeEl.className = `flowchart-node ${step.status.toLowerCase()}`;
    nodeEl.setAttribute('data-step-id', step.id);
    
    let statusLog = 'Pending';
    if (step.updated_by) {
      const date = new Date(step.updated_at);
      const dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      statusLog = `${step.status === 'Completed' ? 'Cleared' : 'N/A'} by ${step.updated_by}`;
    }

    nodeEl.innerHTML = `
      <div class="flowchart-step-card">
        <div class="flowchart-node-title" title="${step.name}">${step.name}</div>
        <div class="flowchart-node-actions">
          <!-- N/A button -->
          <button type="button" class="btn-na" style="background: ${isNA ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${isNA ? 'var(--danger)' : 'var(--border)'}; color: ${isNA ? 'var(--danger)' : 'var(--text-muted)'}; padding: 2px 6px; font-size: 10px; border-radius: 4px; cursor: pointer; font-weight: 600; outline: none; transition: var(--transition);" onclick="toggleStepNA(${job.id}, ${step.id}, '${step.status}')">N/A</button>
          <!-- Complete checkbox -->
          <input type="checkbox" ${isCompleted ? 'checked' : ''} ${isNA ? 'disabled' : ''} onchange="toggleStepComplete(${job.id}, ${step.id}, this.checked)" style="width: 16px; height: 16px; cursor: ${isNA ? 'not-allowed' : 'pointer'};">
        </div>
        <div class="checklist-item-log" style="font-size: 0.68rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px; margin-top: 4px;">
          <span class="material-symbols-outlined" style="font-size: 12px; color: ${isCompleted ? 'var(--success)' : isNA ? 'var(--text-muted)' : 'var(--warning)'};">${isCompleted ? 'check_circle' : isNA ? 'block' : 'schedule'}</span>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px;" title="${statusLog}">${statusLog}</span>
        </div>
      </div>
    `;

    drawerFlowchartContainer.appendChild(nodeEl);
    
    // Add connection line if not the last node
    if (idx < steps.length - 1) {
      const connEl = document.createElement('div');
      connEl.className = 'flowchart-connection';
      drawerFlowchartContainer.appendChild(connEl);
    }
  });
}

async function toggleWorkflowStepStatus(jobId, stepId, status) {
  const user = state.currentUser.name;

  try {
    const res = await fetch(`/api/jobs/${jobId}/workflow/${stepId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, user })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update workflow step');
    }

    const updatedJob = await res.json();
    
    const idx = state.jobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      state.jobs[idx] = updatedJob;
    }

    renderJobs();
    updateStats();
    openJobDetails(jobId, false);
  } catch (err) {
    alert(err.message);
    openJobDetails(jobId, false);
  }
}

function toggleStepComplete(jobId, stepId, isChecked) {
  const job = state.jobs.find(j => j.id === jobId);
  if (job) {
    const step = job.workflow_steps.find(s => s.id === stepId);
    if (step && (step.name === 'Job Closed' || step.name === 'Close job' || step.name === 'Close Job')) {
      if (isChecked) {
        openClosureModal(jobId, stepId);
        return;
      }
    }
  }
  const status = isChecked ? 'Completed' : 'Pending';
  toggleWorkflowStepStatus(jobId, stepId, status);
}
window.toggleStepComplete = toggleStepComplete;

function toggleStepNA(jobId, stepId, currentStatus) {
  const status = currentStatus === 'N/A' ? 'Pending' : 'N/A';
  toggleWorkflowStepStatus(jobId, stepId, status);
}
window.toggleStepNA = toggleStepNA;

// Toggle doc switch
async function toggleDocument(jobId, docId, isChecked) {
  const status = isChecked ? 'Submitted' : 'Pending';
  const user = state.currentUser.name;

  try {
    const res = await fetch(`/api/jobs/${jobId}/documents/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, user })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to update document');
    }

    const updatedJob = await res.json();
    
    const idx = state.jobs.findIndex(j => j.id === jobId);
    if (idx !== -1) {
      state.jobs[idx] = updatedJob;
    }

    renderJobs();
    updateStats();
    openJobDetails(jobId, false);
  } catch (err) {
    alert(err.message);
    openJobDetails(jobId, false);
  }
}
window.toggleDocument = toggleDocument;

// Close Drawer
function closeJobDetails() {
  state.currentJobId = null;
  drawerOverlay.classList.remove('active');
  detailsDrawer.classList.remove('active');
}

// Delete Job
async function handleDeleteJob() {
  if (!state.currentJobId) return;

  const job = state.jobs.find(j => j.id === state.currentJobId);
  if (!job) return;

  const confirmed = await showCustomConfirm(`Are you sure you want to archive/delete Shipment Job #${job.job_no}?`);
  if (!confirmed) {
    return;
  }

  try {
    const res = await fetch(`/api/jobs/${state.currentJobId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      throw new Error('Failed to delete job');
    }

    closeJobDetails();
  } catch (err) {
    alert(err.message);
  }
}

async function handleTableDeleteJob(event, jobId) {
  event.stopPropagation(); // Prevent row click opening details drawer
  
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;

  const confirmed = await showCustomConfirm(`Are you sure you want to archive/delete Shipment Job #${job.job_no}?`);
  if (!confirmed) {
    return;
  }

  try {
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: 'DELETE'
    });

    if (!res.ok) {
      throw new Error('Failed to delete job');
    }

    if (state.currentJobId === jobId) {
      closeJobDetails();
    }
  } catch (err) {
    alert(err.message);
  }
}
window.handleTableDeleteJob = handleTableDeleteJob;

// Promise-based Custom Confirmation Dialog
function showCustomConfirm(message) {
  return new Promise((resolve) => {
    const backdrop = document.getElementById('confirm-modal-backdrop');
    const modal = document.getElementById('confirm-modal');
    const msgEl = document.getElementById('confirm-modal-message');
    const btnClose = document.getElementById('confirm-btn-close');
    const btnCancel = document.getElementById('confirm-btn-cancel');
    const btnSubmit = document.getElementById('confirm-btn-submit');

    msgEl.textContent = message;

    const cleanup = (value) => {
      backdrop.classList.remove('active');
      modal.classList.remove('active');

      // Remove event listeners
      btnClose.removeEventListener('click', handleCancel);
      btnCancel.removeEventListener('click', handleCancel);
      backdrop.removeEventListener('click', handleCancel);
      btnSubmit.removeEventListener('click', handleConfirm);

      resolve(value);
    };

    const handleCancel = () => cleanup(false);
    const handleConfirm = () => cleanup(true);

    btnClose.addEventListener('click', handleCancel);
    btnCancel.addEventListener('click', handleCancel);
    backdrop.addEventListener('click', handleCancel);
    btnSubmit.addEventListener('click', handleConfirm);

    backdrop.classList.add('active');
    modal.classList.add('active');
  });
}

// Copy address text
function copyText(elementId) {
  const text = document.getElementById(elementId).textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector(`[onclick="copyText('${elementId}')"]`);
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = `<span class="material-symbols-outlined" style="color:var(--success)">done</span>`;
      setTimeout(() => {
        btn.innerHTML = originalText;
      }, 1500);
    }
  }).catch(err => {
    console.error('Failed to copy text:', err);
  });
}
window.copyText = copyText;

// Open Job Creator Modals
function openJobModal(jobId = null) {
  jobForm.reset();
  formJobId.value = '';
  formChecklistPdfUrl.value = '';
  autofillStatus.className = 'autofill-status';
  autofillStatus.textContent = '';
  document.getElementById('form-is_flagged').checked = false;
  document.getElementById('form-flag_remarks').value = '';
  document.getElementById('form-flag-remarks-group').classList.add('hidden');
  
  formCargoTbody.innerHTML = '';
  formContainersTbody.innerHTML = '';
  formChargesTbody.innerHTML = '';

  // Reset Air specific fields
  document.getElementById('form-mawb_no_date').value = '';
  document.getElementById('form-hawb_no_date').value = '';
  document.getElementById('form-chargeable_weight').value = '';

  const isAir = state.currentWorkspace && state.currentWorkspace.startsWith('air');
  const isImport = state.currentWorkspace && state.currentWorkspace.endsWith('import');
  
  const sbLabel = document.querySelector('label[for="form-sb_no_date"]');
  if (sbLabel) {
    sbLabel.textContent = isImport ? 'Bill of Entry (B/E) No & Date' : 'Shipping Bill (S.B.) No & Date';
  }
  
  const containerTabBtn = document.querySelector('.modal-tab-btn[data-modtab="mt-containers"]');
  if (containerTabBtn) {
    if (isAir) containerTabBtn.classList.add('hidden');
    else containerTabBtn.classList.remove('hidden');
  }

  document.querySelectorAll('.modal-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector('.modal-tab-btn[data-modtab="mt-core"]').classList.add('active');
  document.querySelectorAll('.modal-tab-content').forEach(content => content.classList.remove('active'));
  document.getElementById('mt-core').classList.add('active');

  if (jobId) {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) return;

    modalTitle.textContent = `Edit Shipment Details #${job.job_no}`;
    formJobId.value = job.id;

    // Set core values
    document.getElementById('form-job_no').value = job.job_no;
    document.getElementById('form-file_ref_no').value = job.file_ref_no || '';
    document.getElementById('form-sb_no_date').value = job.sb_no_date || '';
    document.getElementById('form-mawb_no_date').value = job.mawb_no_date || '';
    document.getElementById('form-hawb_no_date').value = job.hawb_no_date || '';
    document.getElementById('form-chargeable_weight').value = job.chargeable_weight || '';
    document.getElementById('form-invoice_no_date').value = job.invoice_no_date || '';
    document.getElementById('form-buyer_order_no_date').value = job.buyer_order_no_date || '';
    document.getElementById('form-vessel_voyage').value = job.vessel_voyage || '';
    document.getElementById('form-carrier').value = job.carrier || '';
    document.getElementById('form-port_of_loading').value = job.port_of_loading || '';
    document.getElementById('form-port_of_discharge').value = job.port_of_discharge || '';
    document.getElementById('form-final_destination').value = job.final_destination || '';
    document.getElementById('form-country_of_origin').value = job.country_of_origin || 'INDIA';
    document.getElementById('form-country_of_dest').value = job.country_of_dest || '';
    document.getElementById('form-pre_carriage').value = job.pre_carriage || '';
    document.getElementById('form-place_of_receipt').value = job.place_of_receipt || '';
    document.getElementById('form-hs_code').value = job.hs_code || '';
    document.getElementById('form-payment_mode').value = job.payment_mode || '';
    document.getElementById('form-eta').value = job.eta || '';
    document.getElementById('form-etd').value = job.etd || '';
    document.getElementById('form-is_flagged').checked = job.is_flagged || false;
    document.getElementById('form-flag_remarks').value = job.flag_remarks || '';
    if (job.is_flagged) {
      document.getElementById('form-flag-remarks-group').classList.remove('hidden');
    } else {
      document.getElementById('form-flag-remarks-group').classList.add('hidden');
    }

    // Core weights
    document.getElementById('form-dimensions').value = job.dimensions || '';
    document.getElementById('form-type_of_packing').value = job.type_of_packing || '';
    document.getElementById('form-total_pkgs').value = job.total_pkgs || '';
    document.getElementById('form-gross_weight').value = job.gross_weight || '';
    document.getElementById('form-net_weight').value = job.net_weight || '';
    document.getElementById('form-cbm').value = job.cbm || '';

    // Addresses
    document.getElementById('form-shipper').value = job.shipper || '';
    document.getElementById('form-consignee').value = job.consignee || '';
    document.getElementById('form-notify').value = job.notify || '';
    document.getElementById('form-also_notify').value = job.also_notify || '';
    document.getElementById('form-cha').value = job.cha || '';
    document.getElementById('form-forwarding_agent').value = job.forwarding_agent || '';
    document.getElementById('form-buyer_if_other').value = job.buyer_if_other || '';

    // Cargo Manifest
    document.getElementById('form-cargo_desc').value = job.cargo_desc || '';

    // Grids
    if (job.cargo_items && job.cargo_items.length > 0) {
      job.cargo_items.forEach(item => addCargoFormRow(item));
    } else {
      addCargoFormRow();
    }

    if (job.containers && job.containers.length > 0) {
      job.containers.forEach(cnt => addContainerFormRow(cnt));
    } else {
      addContainerFormRow();
    }

    document.getElementById('form-exchange_rate').value = job.exchange_rate || '';
    document.getElementById('form-bank_ac_drawback').value = job.bank_ac_drawback || '';

    if (job.billing_charges && job.billing_charges.length > 0) {
      job.billing_charges.forEach(charge => addChargeFormRow(charge));
    } else {
      addChargeFormRow();
    }

  } else {
    modalTitle.textContent = 'Create Shipment Job';
    formJobId.value = '';

    addCargoFormRow();
    addContainerFormRow();
    addChargeFormRow();
  }

  jobModalBackdrop.classList.add('active');
  jobModal.classList.add('active');
}

// Close Modal
function closeModal() {
  jobModalBackdrop.classList.remove('active');
  jobModal.classList.remove('active');
}

// Add Cargo Form Inputs
function addCargoFormRow(data = null) {
  const rowCount = formCargoTbody.children.length;
  const nextSl = rowCount + 1;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="cargo-sl" value="${data ? data.sl_no : nextSl}" readonly style="background:transparent; border:none; text-align:center"></td>
    <td><input type="text" class="cargo-desc" value="${data ? data.description : ''}" placeholder="e.g. Cotton Yarns"></td>
    <td><input type="text" class="cargo-hs" value="${data ? data.hs_code : ''}" placeholder="e.g. 5205"></td>
    <td><input type="number" step="any" class="cargo-qty" value="${data ? data.qty : '0'}"></td>
    <td><input type="text" class="cargo-unit" value="${data ? data.unit : 'NOS'}" placeholder="e.g. KGS"></td>
    <td><input type="number" step="any" class="cargo-rate" value="${data ? data.rate : '0.00'}"></td>
    <td><input type="number" step="any" class="cargo-net" value="${data ? data.net_wt : '0.00'}"></td>
    <td><input type="number" step="any" class="cargo-gross" value="${data ? data.gross_wt : '0.00'}"></td>
    <td><button type="button" class="remove-row-btn" onclick="this.closest('tr').remove()"><span class="material-symbols-outlined">delete</span></button></td>
  `;
  formCargoTbody.appendChild(tr);
}

// Add Container Form Inputs
function addContainerFormRow(data = null) {
  const rowCount = formContainersTbody.children.length;
  const nextSl = rowCount + 1;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="cnt-sl" value="${data ? data.sl_no : nextSl}" readonly style="background:transparent; border:none; text-align:center"></td>
    <td><input type="text" class="cnt-no" value="${data ? data.container_no : ''}" placeholder="e.g. MSMU1234567"></td>
    <td><input type="text" class="cnt-seal" value="${data ? data.seal_no : ''}" placeholder="e.g. SE-98765"></td>
    <td><input type="text" class="cnt-pkgs" value="${data ? data.pkgs : ''}" placeholder="e.g. 400 BAGS"></td>
    <td><input type="number" step="any" class="cnt-net" value="${data ? data.net_wt : '0'}"></td>
    <td><input type="number" step="any" class="cnt-gross" value="${data ? data.gross_wt : '0'}"></td>
    <td><input type="number" step="any" class="cnt-cbm" value="${data ? data.cbm : '0.000'}"></td>
    <td><button type="button" class="remove-row-btn" onclick="this.closest('tr').remove()"><span class="material-symbols-outlined">delete</span></button></td>
  `;
  formContainersTbody.appendChild(tr);
}

// Add Charge Form Inputs
function addChargeFormRow(data = null) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="chg-desc" value="${data ? data.description : ''}" placeholder="e.g. OCEAN FREIGHT"></td>
    <td><input type="number" step="any" class="chg-amt" value="${data ? data.amount : '0.00'}"></td>
    <td><button type="button" class="remove-row-btn" onclick="this.closest('tr').remove()"><span class="material-symbols-outlined">delete</span></button></td>
  `;
  formChargesTbody.appendChild(tr);
}

// Submit Creation Form
async function handleFormSubmit(event) {
  event.preventDefault();

  const isEdit = formJobId.value !== '';
  const jobId = formJobId.value;

  const info = {
    job_no: document.getElementById('form-job_no').value.trim(),
    type: state.currentWorkspace,
    file_ref_no: document.getElementById('form-file_ref_no').value.trim(),
    sb_no_date: document.getElementById('form-sb_no_date').value.trim(),
    invoice_no_date: document.getElementById('form-invoice_no_date').value.trim(),
    buyer_order_no_date: document.getElementById('form-buyer_order_no_date').value.trim(),
    vessel_voyage: document.getElementById('form-vessel_voyage').value.trim(),
    carrier: document.getElementById('form-carrier').value.trim(),
    port_of_loading: document.getElementById('form-port_of_loading').value.trim(),
    port_of_discharge: document.getElementById('form-port_of_discharge').value.trim(),
    final_destination: document.getElementById('form-final_destination').value.trim(),
    country_of_origin: document.getElementById('form-country_of_origin').value.trim(),
    country_of_dest: document.getElementById('form-country_of_dest').value.trim(),
    pre_carriage: document.getElementById('form-pre_carriage').value.trim(),
    place_of_receipt: document.getElementById('form-place_of_receipt').value.trim(),
    mawb_no_date: document.getElementById('form-mawb_no_date').value.trim(),
    hawb_no_date: document.getElementById('form-hawb_no_date').value.trim(),
    chargeable_weight: document.getElementById('form-chargeable_weight').value.trim(),
    hs_code: document.getElementById('form-hs_code').value.trim(),
    payment_mode: document.getElementById('form-payment_mode').value.trim(),
    eta: document.getElementById('form-eta').value.trim(),
    etd: document.getElementById('form-etd').value.trim(),

    dimensions: document.getElementById('form-dimensions').value.trim(),
    type_of_packing: document.getElementById('form-type_of_packing').value.trim(),
    total_pkgs: document.getElementById('form-total_pkgs').value.trim(),
    gross_weight: document.getElementById('form-gross_weight').value.trim(),
    net_weight: document.getElementById('form-net_weight').value.trim(),
    cbm: document.getElementById('form-cbm').value.trim(),

    shipper: document.getElementById('form-shipper').value.trim(),
    consignee: document.getElementById('form-consignee').value.trim(),
    notify: document.getElementById('form-notify').value.trim(),
    also_notify: document.getElementById('form-also_notify').value.trim(),
    cha: document.getElementById('form-cha').value.trim(),
    forwarding_agent: document.getElementById('form-forwarding_agent').value.trim(),
    buyer_if_other: document.getElementById('form-buyer_if_other').value.trim(),

    cargo_desc: document.getElementById('form-cargo_desc').value.trim(),
    exchange_rate: document.getElementById('form-exchange_rate').value.trim(),
    bank_ac_drawback: document.getElementById('form-bank_ac_drawback').value.trim(),
    
    // Inject checklist url
    checklist_pdf_url: formChecklistPdfUrl.value || null,

    is_flagged: document.getElementById('form-is_flagged').checked,
    flag_remarks: document.getElementById('form-flag_remarks').value.trim(),

    cargo_items: [],
    containers: [],
    billing_charges: []
  };

  // Gather cargo
  Array.from(formCargoTbody.children).forEach((tr, index) => {
    const desc = tr.querySelector('.cargo-desc').value.trim();
    if (!desc) return;
    const qty = parseFloat(tr.querySelector('.cargo-qty').value) || 0;
    const rate = parseFloat(tr.querySelector('.cargo-rate').value) || 0;
    
    info.cargo_items.push({
      sl_no: index + 1,
      description: desc,
      hs_code: tr.querySelector('.cargo-hs').value.trim(),
      qty,
      unit: tr.querySelector('.cargo-unit').value.trim(),
      rate,
      net_wt: parseFloat(tr.querySelector('.cargo-net').value) || 0,
      gross_wt: parseFloat(tr.querySelector('.cargo-gross').value) || 0,
      amount: qty * rate
    });
  });

  // Gather containers
  Array.from(formContainersTbody.children).forEach((tr, index) => {
    const no = tr.querySelector('.cnt-no').value.trim();
    if (!no) return;
    info.containers.push({
      sl_no: index + 1,
      container_no: no,
      seal_no: tr.querySelector('.cnt-seal').value.trim(),
      pkgs: tr.querySelector('.cnt-pkgs').value.trim(),
      net_wt: parseFloat(tr.querySelector('.cnt-net').value) || 0,
      gross_wt: parseFloat(tr.querySelector('.cnt-gross').value) || 0,
      cbm: parseFloat(tr.querySelector('.cnt-cbm').value) || 0
    });
  });

  // Gather charges
  Array.from(formChargesTbody.children).forEach((tr) => {
    const desc = tr.querySelector('.chg-desc').value.trim();
    const amt = parseFloat(tr.querySelector('.chg-amt').value) || 0;
    if (!desc || amt <= 0) return;
    info.billing_charges.push({
      description: desc,
      amount: amt
    });
  });

  const payload = {
    info,
    creator: state.currentUser.name
  };

  const url = isEdit ? `/api/jobs/${jobId}` : '/api/jobs';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to save job');
    }

    closeModal();
    const savedJob = await res.json();
    
    if (!isEdit && state.activeFilter === 'completed') {
      document.querySelector('.menu-btn[data-filter="active"]').click();
    }
  } catch (err) {
    alert(err.message);
  }
}

function renderUsersList() {
  const tbody = document.querySelector('#admin-users-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  if (!state.users || state.users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No users registered.</td></tr>`;
    return;
  }
  
  state.users.forEach(u => {
    const tr = document.createElement('tr');
    const isSelf = u.username === 'admin';
    
    let actionBtnHtml = '';
    if (isSelf) {
      actionBtnHtml = `<span style="font-size:0.75rem; color:var(--text-muted)">Default</span>`;
    } else {
      actionBtnHtml = `<button type="button" class="admin-users-action-btn" title="Delete User"><span class="material-symbols-outlined" style="font-size:18px;">delete</span></button>`;
    }
    
    tr.innerHTML = `
      <td><strong>${u.name}</strong><br><span style="font-size:0.75rem; color:var(--text-muted)">@${u.username}</span></td>
      <td><span class="badge badge-all">${u.role}</span></td>
      <td style="text-align:center; vertical-align:middle;">${actionBtnHtml}</td>
    `;
    
    if (!isSelf) {
      const btn = tr.querySelector('.admin-users-action-btn');
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleDeleteUser(u.username);
      });
    }
    
    tbody.appendChild(tr);
  });
}

async function handleDeleteUser(username) {
  const confirmed = await showCustomConfirm(`Are you sure you want to delete user account @${username}?`);
  if (!confirmed) return;
  
  try {
    const res = await fetch(`/api/users/${username}?adminUsername=${state.currentUser.username}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete user');
    }
    
    state.users = state.users.filter(u => u.username !== username);
    renderUsersList();
  } catch (err) {
    alert(err.message);
  }
}
window.handleDeleteUser = handleDeleteUser;
