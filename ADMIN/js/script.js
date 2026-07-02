async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Authentication Check (Session Security) ---
async function checkAuth() {
    const loginPage = 'login.html';
    
    if (!window.supabaseClient) {
        console.error('Supabase client not ready for auth check');
        return;
    }

    const { data: { session }, error } = await window.supabaseClient.auth.getSession();
    
    // 1. Redirect if no session exists or error
    if (!session || error) {
        if (!window.location.href.includes(loginPage)) {
            console.warn('script.js: No session. Redirecting...');
            window.location.href = loginPage;
        }
        return;
    }

    // 2. Point 4 & 23: Verify Role Authority (Dual-Check)
    const user = session.user;
    const role = user.user_metadata?.role;
    const allowedEmailHash = '450aa00737e468b66054a98555fda2dadf3e9c0de961dbde2ff43c0d0a46166e';
    const userEmailHash = await sha256(user.email);

    // Double Verification: Check metadata first, then verify via Database RPC
    const { data: isAdmin, error: rpcError } = await window.supabaseClient.rpc('check_is_admin');

    if (userEmailHash !== allowedEmailHash || (role !== 'Admin' && role !== 'Super Admin') || rpcError || !isAdmin) {
        console.error('script.js: ACCESS DENIED. (Email, Role, or RPC Failed)');
        
        let reason = 'Access Denied: ';
        if (userEmailHash !== allowedEmailHash) reason += 'Unauthorized email fingerprint.';
        else if (role !== 'Admin' && role !== 'Super Admin') reason += 'Unauthorized role.';
        else reason += 'Database verification failed.';

        alert(reason);
        
        await window.supabaseClient.auth.signOut();
        window.location.href = loginPage;
        return;
    }

    // 3. Update UI Profile from session (not localStorage)
    const userProfileName = document.querySelector('.user-profile div div:first-child');
    const userProfileRole = document.querySelector('.user-profile div div:last-child');
    const avatar = document.querySelector('.avatar');

    if (userProfileName) userProfileName.textContent = user.email.split('@')[0];
    if (userProfileRole) userProfileRole.textContent = role;
    if (avatar) avatar.textContent = user.email.substring(0, 2).toUpperCase();
}
checkAuth();

// --- State Management ---
let devices = []; // Initialized from Supabase

let currentSort = { column: 'code', direction: 'asc' };
let searchQuery = '';
let statusFilter = 'all'; // New filter state
let deviceToRemove = null;
let deviceToExtend = null; // New
let removeTimerInterval = null;

// Chart Instances
let statusPieChart = null;
let trendsLineChart = null;
let expiriesBarChart = null;

// --- DOM Elements ---
const devicesBody = document.getElementById('devices-body');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const deviceSearch = document.getElementById('device-search');
const statusFilterDropdown = document.getElementById('status-filter'); // New
const breadcrumb = document.querySelector('#breadcrumb span');

// Views
const dashboardView = document.getElementById('dashboard-view');
const devicesView = document.getElementById('devices-view');
const reportsView = document.getElementById('reports-view');
const navItems = document.querySelectorAll('.nav-item');

// Stats Elements
const statTotal = document.getElementById('stat-total');
const statActive = document.getElementById('stat-active');
const statExpired = document.getElementById('stat-expired');
const statExpiringSoon = document.getElementById('stat-expiring-soon');
const statBanned = document.getElementById('stat-banned');
const statHealth = document.getElementById('stat-health');
const statUnpaid = document.getElementById('stat-unpaid');

// Modals
const addDeviceModal = document.getElementById('add-device-modal');
const editDeviceModal = document.getElementById('edit-device-modal'); // Added missing
const updateSeverityModal = document.getElementById('update-severity-modal'); // Added missing
const extendModal = document.getElementById('extend-modal');
const removeModal = document.getElementById('remove-modal');

// Buttons & Forms
const btnOpenModal = document.getElementById('btn-open-modal');
const closeModal = document.getElementById('close-modal');
const btnCancel = document.getElementById('btn-cancel');
const addDeviceForm = document.getElementById('add-device-form');

const btnCancelRemove = document.getElementById('btn-cancel-remove');
const btnConfirmRemove = document.getElementById('btn-confirm-remove');
const removeTimerSpan = document.getElementById('remove-timer');
const removeDeviceName = document.getElementById('remove-device-name');

// Extend Modal elements
const extendForm = document.getElementById('extend-form');
const extendExpiryInput = document.getElementById('extend-expiry');
const extendDeviceCodeLabel = document.getElementById('extend-device-code');
const btnCancelExtend = document.getElementById('btn-cancel-extend');
const closeExtendModal = document.getElementById('close-extend-modal');
const extendPills = document.querySelectorAll('.btn-extend-pill');

// --- Restored & New View/Modal Controls ---
const editForm = document.getElementById('edit-device-form');
const editDeviceCode = document.getElementById('edit-device-code');
const editUsername = document.getElementById('edit-device-username');
const editAmount = document.getElementById('edit-device-amount');
const editDescription = document.getElementById('edit-device-description');

const btnUpdateAll = document.getElementById('btn-update-all');
const severityModalTitle = document.getElementById('severity-modal-title');
const severityTargetInfo = document.getElementById('severity-target-info');
const severityBtns = document.querySelectorAll('.severity-btn');
const globalUpdateUrlInput = document.getElementById('global-update-url');
const updateUrlGroup = document.getElementById('update-url-group');
const btnApplySeverity = document.getElementById('btn-apply-severity');

let activeSeverityLevel = 0;
let severityTarget = 'device'; // 'device' or 'global'
let deviceToEdit = null;
let deviceToUpdateSeverity = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Admin Panel Initializing...');

    // Load Initial Data from Supabase
    const loadData = async () => {
        console.log('script.js: Starting loadData...');
        if (window.DeviceDB) {
            console.log('script.js: Calling DeviceDB.getDevices()...');
            devices = await window.DeviceDB.getDevices();
            console.log('script.js: Data received:', devices.length, 'devices');
        } else {
            console.error('script.js: DeviceDB not found on window!');
        }
        renderTable();
        updateStats();
        initCharts();
        updateReports();
    };
    await loadData();

    // Auto-refresh UI every minute to keep timers accurate
    setInterval(() => {
        renderTable();
        updateStats(); // Added to keep dashboard counts accurate
        updateReports();
    }, 60000);

    // Quick Select Expiry Logic
    const quickSelectBtns = document.querySelectorAll('.btn-pill');
    const expiryInput = document.getElementById('device-expiry');
    quickSelectBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const days = parseInt(btn.dataset.days);
            const date = new Date();
            date.setDate(date.getDate() + days);
            expiryInput.value = date.toISOString().split('T')[0];

            // Highlight active button
            quickSelectBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Quick Select for Extend Modal
    extendPills.forEach(btn => {
        btn.addEventListener('click', () => {
            const days = parseInt(btn.dataset.days);
            const date = deviceToExtend ? new Date(deviceToExtend.expiry) : new Date();
            // If already expired, start from now
            const baseDate = date < new Date() ? new Date() : date;
            baseDate.setDate(baseDate.getDate() + days);
            extendExpiryInput.value = baseDate.toISOString().split('T')[0];

            extendPills.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // View Switching
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page; // Use dataset for reliable access
            if (!page) return;

            console.log('Navigating to:', page);

            // Update UI
            navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            if (breadcrumb) breadcrumb.textContent = page.charAt(0).toUpperCase() + page.slice(1);

            // Switch views
            if (page === 'dashboard') {
                if (dashboardView) dashboardView.classList.add('active');
                if (devicesView) devicesView.classList.remove('active');
                if (reportsView) reportsView.classList.remove('active');
            } else if (page === 'devices') {
                if (dashboardView) dashboardView.classList.remove('active');
                if (devicesView) devicesView.classList.add('active');
                if (reportsView) reportsView.classList.remove('active');
            } else if (page === 'reports') {
                if (dashboardView) dashboardView.classList.remove('active');
                if (devicesView) devicesView.classList.remove('active');
                if (reportsView) reportsView.classList.add('active');
                // Force update on charts immediately after display block
                updateReports();
                if (statusPieChart) statusPieChart.resize();
                if (trendsLineChart) trendsLineChart.resize();
                if (expiriesBarChart) expiriesBarChart.resize();
            }
        });
    });

    // Logout Logic
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            
            try {
                const { error } = await window.supabaseClient.auth.signOut();
                if (error) throw error;

                // Point 20: Fully clear local storage and session data
                localStorage.clear();
                sessionStorage.clear();
                
                showToast('Logged out successfully.', 'info');
                
                // Redirect to login after clear
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 800);
            } catch (err) {
                console.error('Logout error:', err);
                showToast('Error during logout.', 'error');
            }
        });
    }

    // Setup Table Sorting
    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.sort;
            if (currentSort.column === column) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.column = column;
                currentSort.direction = 'asc';
            }
        });
    });

    // Payment Status UI Toggle for Registration
    const paymentRadios = document.querySelectorAll('input[name="payment-status"]');
    const amountLabel = document.getElementById('label-device-amount');
    paymentRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (amountLabel) {
                amountLabel.textContent = e.target.value === 'unpaid' ? 'Amount Expected' : 'Amount Paid';
            }
        });
    });

    const editPaymentRadios = document.querySelectorAll('input[name="edit-payment-status"]');
    const editAmountLabel = document.getElementById('label-edit-device-amount');
    editPaymentRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (editAmountLabel) {
                editAmountLabel.textContent = e.target.value === 'unpaid' ? 'Amount Expected' : 'Amount Paid';
            }
        });
    });
});

// --- Core Functions ---

function updateStats() {
    const now = new Date();
    const total = devices.length;
    
    // Active: status is Active AND it hasn't expired yet
    const active = devices.filter(d => d.status === 'Active' && new Date(d.expiry) > now).length;
    
    // Expired: status is Expired OR (status is Active but it HAS expired)
    // We ignore Banned devices in this count as they have their own card
    const expired = devices.filter(d => 
        d.status === 'Expired' || (d.status === 'Active' && new Date(d.expiry) <= now)
    ).length;
    
    const banned = devices.filter(d => d.status === 'Banned').length;
    const unpaid = devices.filter(d => d.payment_status === 'unpaid').length;

    // Expiring soon: within next 7 days (and still active)
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);
    const expiringSoon = devices.filter(d => {
        const expiry = new Date(d.expiry);
        return d.status === 'Active' && expiry >= now && expiry <= nextWeek;
    }).length;

    // Health Score: percentage of non-banned devices that are active
    const nonBanned = total - banned;
    const health = nonBanned > 0 ? Math.round((active / nonBanned) * 100) : 0;

    // Update Text
    if (statTotal) statTotal.textContent = total;
    if (statActive) statActive.textContent = active;
    if (statExpired) statExpired.textContent = expired;

    if (statBanned) statBanned.textContent = banned;
    if (statExpiringSoon) statExpiringSoon.textContent = expiringSoon;
    if (statHealth) statHealth.textContent = `${health}%`;
    if (statUnpaid) statUnpaid.textContent = unpaid;
}

function showToast(message, type = 'info') {
    if (window.Notifications) {
        window.Notifications.show(message, type);
    } else {
        console.warn('Notifications not initialized yet:', message);
    }
}

// Fixed XSS: Helper function to escape HTML
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function renderTable() {
    if (!devicesBody) return;

    // Filter
    let filtered = devices.filter(d => {
        const query = searchQuery.toLowerCase();
        const matchesSearch = d.code.toLowerCase().includes(query) || 
                              (d.username && d.username.toLowerCase().includes(query));
        
        let matchesStatus = false;
        if (statusFilter === 'all') {
            matchesStatus = true;
        } else if (statusFilter === 'Active' || statusFilter === 'Expired' || statusFilter === 'Banned') {
            matchesStatus = d.status === statusFilter;
        } else if (statusFilter === 'Paid') {
            matchesStatus = d.payment_status === 'paid';
        } else if (statusFilter === 'Unpaid') {
            matchesStatus = d.payment_status === 'unpaid';
        }
        
        return matchesSearch && matchesStatus;
    });

    // Sort
    filtered.sort((a, b) => {
        let valA = a[currentSort.column].toString().toLowerCase();
        let valB = b[currentSort.column].toString().toLowerCase();

        if (currentSort.column === 'expiry' || currentSort.column === 'created_at' || currentSort.column === 'cycle_start_date') {
            valA = new Date(a[currentSort.column] || 0);
            valB = new Date(b[currentSort.column] || 0);
        }

        if (valA < valB) return currentSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });

    // Render
    devicesBody.innerHTML = '';
    filtered.forEach(device => {
        const tr = document.createElement('tr');
        const now = new Date();
        
        // Determine real-time status based on expiry
        const isExpired = new Date(device.expiry) <= now && device.status !== 'Banned';
        const displayStatus = isExpired ? 'Expired' : device.status;
        const statusClass = displayStatus.toLowerCase();
        
        const timeLeft = getTimeLeft(device.expiry);

        // Severity Badge Logic
        let severityBadge = '';
        if (device.update_level > 0) {
            const levelMap = { 1: 'Nudge', 2: 'Alert', 3: 'Force' };
            const levelColor = { 1: '#0ea5e9', 2: '#f59e0b', 3: '#ef4444' };
            severityBadge = `<span style="font-size: 0.65rem; background: ${levelColor[device.update_level]}; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 600;">${levelMap[device.update_level].toUpperCase()}</span>`;
        }

        // Point 1: Fixed XSS by creating elements safely
        tr.innerHTML = `
            <td>
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <div style="display: flex; align-items: center;">
                        <span class="device-code-display" style="font-weight: 600; color: var(--text-main); font-size: 0.9375rem;"></span>
                        <span class="payment-badge-container"></span>
                        <span class="severity-badge-container"></span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 1px;">
                        <span class="device-username-display" style="font-size: 0.75rem; color: var(--primary); font-weight: 600;"></span>
                        <span class="device-description-display" style="font-size: 0.7rem; color: var(--text-muted); line-height: 1.2; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"></span>
                    </div>
                </div>
            </td>
            <td>
                <span class="status-badge ${statusClass}">
                    ${displayStatus}
                </span>
            </td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="color: var(--text-main); font-size: 0.875rem; font-weight: 500;">${device.cycle_start_date ? formatDate(device.cycle_start_date) : 'Unknown'}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 2px;">
                    <span style="color: var(--text-main); font-size: 0.875rem; font-weight: 500;">${timeLeft}</span>
                    <span style="color: var(--text-muted); font-size: 0.75rem;">${formatDate(device.expiry)}</span>
                </div>
            </td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 2px; align-items: center;">
                    <span style="color: var(--primary); font-size: 1rem; font-weight: 700;">${device.renewal_count || 0}</span>
                </div>
            </td>
            <td>
                <div class="actions" style="display: flex; gap: 0.5rem; align-items: center;">
                    <button class="btn btn-sm btn-success" onclick="extendSubscription(${device.id})" title="Extend Expiry">
                        <i data-lucide="calendar-plus" style="width: 14px; height: 14px;"></i> Extend
                    </button>
                    <button class="btn btn-sm" style="background: #f1f5f9; color: #4b5563; border: 1px solid #e2e8f0;" onclick="editDevice(${device.id})" title="Edit Details">
                        <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i> Edit
                    </button>
                    <button class="btn btn-sm" style="background: #fffbeb; color: #b45309; border: 1px solid #fde68a;" onclick="updateSeverity(${device.id})" title="Push Update to Device">
                        <i data-lucide="refresh-cw" style="width: 14px; height: 14px;"></i> Update
                    </button>
                    ${device.status === 'Banned' ? `
                        <button class="btn btn-sm" style="background: #e0e7ff; color: #4338ca;" onclick="activateDevice(${device.id})">
                            <i data-lucide="check-circle" style="width: 14px; height: 14px;"></i> Activate
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-danger" onclick="banDevice(${device.id})">
                            <i data-lucide="slash" style="width: 14px; height: 14px;"></i> Ban
                        </button>
                    `}
                    <button class="btn btn-ghost-danger" onclick="requestRemove(${device.id})" title="Delete Device">
                        <i data-lucide="trash-2" style="width: 18px; height: 18px;"></i>
                    </button>
                </div>
            </td>
        `;

        // Use textContent for safety
        tr.querySelector('.device-code-display').textContent = device.code;
        tr.querySelector('.device-username-display').textContent = device.username;
        const descSpan = tr.querySelector('.device-description-display');
        descSpan.textContent = device.description || 'No description';
        descSpan.title = device.description || '';

        if (device.update_level > 0) {
            const levelMap = { 1: 'Nudge', 2: 'Alert', 3: 'Force' };
            const levelColor = { 1: '#0ea5e9', 2: '#f59e0b', 3: '#ef4444' };
            const badge = tr.querySelector('.severity-badge-container');
            badge.innerHTML = `<span style="font-size: 0.65rem; background: ${levelColor[device.update_level]}; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 600;">${levelMap[device.update_level].toUpperCase()}</span>`;
        }
        
        // Paid/Unpaid Badge
        let payStatus = 'Paid';
        let payColor = '#10b981'; // Green
        
        if (device.payment_status === 'unpaid') {
            payStatus = 'Unpaid';
            payColor = '#f43f5e'; // Red
        } else if (device.payment_status === 'unclassified' || !device.payment_status) {
            payStatus = 'Unclassified';
            payColor = '#94a3b8'; // Gray
        }

        const payBadgeContainer = tr.querySelector('.payment-badge-container');
        if (payBadgeContainer) {
            payBadgeContainer.innerHTML = `<span style="font-size: 0.65rem; background: ${payColor}; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px; font-weight: 600;">${payStatus.toUpperCase()}</span>`;
        }

        devicesBody.appendChild(tr);
    });

    if (window.lucide) window.lucide.createIcons();
}

function formatDate(dateStr) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateStr).toLocaleDateString(undefined, options);
}

function getTimeLeft(expiryDateStr) {
    const expiryDate = new Date(expiryDateStr);
    const now = new Date();
    const diff = expiryDate - now;

    if (diff <= 0) return '<span style="color: var(--danger); font-weight: 600; font-size: 0.8125rem;">0d 0h 0m</span>';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);

    const color = days < 3 ? 'var(--danger)' : (days < 7 ? 'var(--warning)' : 'var(--success)');
    return `<span style="color: ${color}; font-weight: 600; font-size: 0.8125rem;">${parts.join(' ')}</span>`;
}

function timeAgo(date) {
    if (!date) return '<span style="color: var(--text-muted);">Never</span>';
    const now = new Date();
    const then = new Date(date);
    const seconds = Math.floor((now - then) / 1000);

    if (seconds < 60) return '<span style="color: var(--success); font-weight: 600;">Just now</span>';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(date);
}

// --- Chart Logic ---

function initCharts() {
    if (typeof Chart === 'undefined') {
        console.error('Chart.js not loaded!');
        return;
    }

    const ctxPie = document.getElementById('statusPieChart');
    const ctxLine = document.getElementById('trendsLineChart');
    const ctxBar = document.getElementById('expiriesBarChart');

    if (!ctxPie || !ctxLine || !ctxBar) {
        console.warn('Chart canvases not found');
        return;
    }

    // Pie Chart
    statusPieChart = new Chart(ctxPie, {
        type: 'doughnut',
        data: {
            labels: ['Active', 'Expired', 'Banned'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: ['#10b981', '#f59e0b', '#475569'],
                borderWidth: 0,
                cutout: '70%'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });

    // Line Chart
    trendsLineChart = new Chart(ctxLine, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'New Registrations',
                data: [2, 5, 3, 8, 4, 6, 9],
                borderColor: '#4f46e5',
                tension: 0.4,
                fill: true,
                backgroundColor: 'rgba(79, 70, 229, 0.1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });

    // Bar Chart
    expiriesBarChart = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            datasets: [{
                label: 'Expiries',
                data: [4, 7, 3, 5, 2, 6],
                backgroundColor: '#f59e0b'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });

    updateReports();
}

function updateReports() {
    if (!statusPieChart) return;

    // 1. Update Pie Chart (Status Breakdown)
    const now = new Date();
    const active = devices.filter(d => d.status === 'Active' && new Date(d.expiry) > now).length;
    const expired = devices.filter(d => d.status === 'Expired' || (d.status === 'Active' && new Date(d.expiry) <= now)).length;
    const banned = devices.filter(d => d.status === 'Banned').length;
    statusPieChart.data.datasets[0].data = [active, expired, banned];

    // 2. Update Numerical Breakdown (Expiring this month)
    const expiringSoonBody = document.getElementById('expiring-soon-body');
    if (expiringSoonBody) {
        const now = new Date();
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        const expiringThisMonth = devices.filter(d => {
            const expiry = new Date(d.expiry);
            return expiry >= now && expiry <= endOfMonth && d.status !== 'Banned';
        }).sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

        expiringSoonBody.innerHTML = '';
        if (expiringThisMonth.length === 0) {
            expiringSoonBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No devices expiring this month</td></tr>';
        } else {
            expiringThisMonth.forEach(d => {
                const timeLeft = getTimeLeft(d.expiry);
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>
                        <div style="display: flex; flex-direction: column;">
                            <span class="d-code" style="font-weight: 600;"></span>
                            <span class="d-user" style="font-size: 0.7rem; color: var(--text-muted);"></span>
                        </div>
                    </td>
                    <td>${formatDate(d.expiry)}</td>
                    <td>${timeLeft}</td>
                `;
                tr.querySelector('.d-code').textContent = d.code;
                tr.querySelector('.d-user').textContent = d.username;
                expiringSoonBody.appendChild(tr);
            });
        }
    }

    // 3. Update Line Chart (Registration Trends)
    const registrationsByMonth = new Array(12).fill(0);
    devices.forEach(d => {
        const date = new Date(d.created_at);
        if (date.getFullYear() >= 2024) {
            registrationsByMonth[date.getMonth()] += 1;
        }
    });

    if (trendsLineChart) {
        trendsLineChart.data.datasets[0].data = registrationsByMonth;
        trendsLineChart.update();
    }

    // 4. Update Activity Monitor (Last Checked At)
    const activityLogBody = document.getElementById('activity-log-body');
    if (activityLogBody) {
        // Sort by last_checked_at descending, putting nulls at the bottom
        const sortedActivity = [...devices].sort((a, b) => {
            if (!a.last_checked_at) return 1;
            if (!b.last_checked_at) return -1;
            return new Date(b.last_checked_at) - new Date(a.last_checked_at);
        }).slice(0, 10); // Show top 10 recent check-ins

        activityLogBody.innerHTML = '';
        if (sortedActivity.length === 0) {
            activityLogBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No activity recorded</td></tr>';
        } else {
            sortedActivity.forEach(d => {
                const tr = document.createElement('tr');
                const now = new Date();
                
                // Determine real-time status based on expiry
                const isExpired = new Date(d.expiry) <= now && d.status !== 'Banned';
                const displayStatus = isExpired ? 'Expired' : d.status;
                const statusClass = displayStatus.toLowerCase();
                
                const daysLeft = getTimeLeft(d.expiry);
                tr.innerHTML = `
                    <td>
                        <div style="display: flex; flex-direction: column;">
                            <span class="d-code" style="font-weight: 600;"></span>
                            <span class="d-user" style="font-size: 0.7rem; color: var(--text-muted);"></span>
                        </div>
                    </td>
                    <td><span class="status-badge ${statusClass}" style="scale: 0.8; transform-origin: left;">${displayStatus}</span></td>
                    <td>${daysLeft}</td>
                    <td style="font-size: 0.875rem; font-weight: 500;">${timeAgo(d.last_checked_at)}</td>
                `;
                tr.querySelector('.d-code').textContent = d.code;
                tr.querySelector('.d-user').textContent = d.username;
                activityLogBody.appendChild(tr);
            });
        }
    }

    // 5. Update Bar Chart (Expiries)
    const expiriesByMonth = new Array(12).fill(0);
    const currentYear = new Date().getFullYear();
    devices.forEach(d => {
        const date = new Date(d.expiry);
        if (date.getFullYear() === currentYear) {
            expiriesByMonth[date.getMonth()] += 1;
        }
    });

    if (expiriesBarChart) {
        expiriesBarChart.data.datasets[0].data = expiriesByMonth;
        expiriesBarChart.update();
    }

    statusPieChart.update();
}

// --- Event Handlers ---

if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        if (window.innerWidth <= 768) {
            sidebar.classList.toggle('mobile-open');
        }
    });
}

const sidebarClose = document.getElementById('sidebar-close');
if (sidebarClose) {
    sidebarClose.addEventListener('click', () => {
        sidebar.classList.remove('mobile-open');
    });
}

// Close sidebar when clicking on main content (mobile only)
const mainWrapper = document.querySelector('.main-wrapper');
if (mainWrapper) {
    mainWrapper.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 && sidebar.classList.contains('mobile-open')) {
            // Only close if we didn't click the toggle button again
            if (!e.target.closest('#sidebar-toggle')) {
                sidebar.classList.remove('mobile-open');
            }
        }
    });
}

if (deviceSearch) {
    deviceSearch.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderTable();
    });
}

if (statusFilterDropdown) {
    statusFilterDropdown.addEventListener('change', (e) => {
        statusFilter = e.target.value;
        renderTable();
    });
}

// Modal Toggle Helpers
const toggleAddModal = (show) => {
    if (!addDeviceModal) return;
    addDeviceModal.classList.toggle('show', show);
    if (!show && addDeviceForm) addDeviceForm.reset();
};

const toggleRemoveModal = (show) => {
    if (!removeModal) return;
    removeModal.classList.toggle('show', show);
    if (!show) {
        clearInterval(removeTimerInterval);
        deviceToRemove = null;
        if (btnConfirmRemove) {
            btnConfirmRemove.disabled = true;
            btnConfirmRemove.textContent = 'Confirm (3s)';
        }
    }
};

const toggleExtendModal = (show, device = null) => {
    if (!extendModal) return;
    extendModal.classList.toggle('show', show);
    if (show && device) {
        deviceToExtend = device;
        if (extendDeviceCodeLabel) extendDeviceCodeLabel.textContent = device.code;
        if (extendExpiryInput) {
            // Default to current expiry + 30 days
            const d = new Date(device.expiry);
            const base = d < new Date() ? new Date() : d;
            base.setDate(base.getDate() + 30);
            extendExpiryInput.value = base.toISOString().split('T')[0];
        }
        extendPills.forEach(b => b.classList.remove('active'));
    } else {
        deviceToExtend = null;
        if (extendForm) extendForm.reset();
    }
};

const toggleEditModal = (show, device = null) => {
    if (!editDeviceModal) return;
    editDeviceModal.classList.toggle('show', show);
    if (show && device) {
        deviceToEdit = device;
        if (editDeviceCode) editDeviceCode.value = device.code;
        if (editUsername) editUsername.value = device.username;
        if (editAmount) editAmount.value = device.amount;
        if (editDescription) editDescription.value = device.description;
        
        const payStatus = device.payment_status || 'unclassified';
        const radioToSelect = document.querySelector(`input[name="edit-payment-status"][value="${payStatus}"]`);
        if (radioToSelect) {
            radioToSelect.checked = true;
        } else {
            // Uncheck both if unclassified
            const allRadios = document.querySelectorAll(`input[name="edit-payment-status"]`);
            allRadios.forEach(r => r.checked = false);
        }
        
        const editAmountLabel = document.getElementById('label-edit-device-amount');
        if (editAmountLabel) {
            editAmountLabel.textContent = payStatus === 'unpaid' ? 'Amount Expected' : 'Amount Paid';
        }
    } else {
        deviceToEdit = null;
        if (editForm) editForm.reset();
    }
};

const toggleSeverityModal = (show, type = 'device', device = null) => {
    if (!updateSeverityModal) return;
    updateSeverityModal.classList.toggle('show', show);
    severityTarget = type;

    if (show) {
        if (type === 'global') {
            severityModalTitle.textContent = 'Global Update Request (All Devices)';
            severityTargetInfo.innerHTML = `
                <div style="font-size: 0.875rem; color: var(--text-muted);">Broadcasting to:</div>
                <div style="font-weight: 700; color: #f59e0b;">EVERY ACTIVE DEVICE</div>
            `;
            // Fetch global settings to pre-fill
            window.DeviceDB.getSettings().then(settings => {
                const globalLvl = parseInt(settings.find(s => s.key === 'global_update_level')?.value || '0');
                const url = settings.find(s => s.key === 'update_url')?.value || '';
                setSeverityUI(globalLvl);
                if (globalUpdateUrlInput) globalUpdateUrlInput.value = url;
            });
        } else if (device) {
            deviceToUpdateSeverity = device;
            severityModalTitle.textContent = 'Device Update Request';
            severityTargetInfo.innerHTML = `
                <div style="font-size: 0.875rem; color: var(--text-muted);">Targeting specific device:</div>
                <div class="target-name" style="font-weight: 700; color: var(--primary);"></div>
            `;
            severityTargetInfo.querySelector('.target-name').textContent = `${device.code} (${device.username})`;
            setSeverityUI(device.update_level || 0);
            updateUrlGroup.style.display = 'none'; // Only show for level 3 or global ideally, but let's keep it simple
        }
    } else {
        deviceToUpdateSeverity = null;
        activeSeverityLevel = 0;
    }
};

const setSeverityUI = (level) => {
    activeSeverityLevel = level;
    severityBtns.forEach(btn => {
        const btnLvl = parseInt(btn.dataset.level);
        btn.style.borderColor = btnLvl === level ? 'var(--primary)' : 'var(--border)';
        btn.style.background = btnLvl === level ? '#f0f9ff' : 'white';
        btn.style.boxShadow = btnLvl === level ? '0 0 0 2px var(--primary-light)' : 'none';
    });
};

// Add Device
if (btnOpenModal) btnOpenModal.addEventListener('click', () => toggleAddModal(true));
if (closeModal) closeModal.addEventListener('click', () => toggleAddModal(false));
if (btnCancel) btnCancel.addEventListener('click', () => toggleAddModal(false));

if (closeExtendModal) closeExtendModal.addEventListener('click', () => toggleExtendModal(false));
if (btnCancelExtend) btnCancelExtend.addEventListener('click', () => toggleExtendModal(false));

if (extendForm) {
    extendForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!deviceToExtend || !extendExpiryInput) return;

        const newExpiry = extendExpiryInput.value;
        const newCount = (deviceToExtend.renewal_count || 0) + 1;
        const success = await window.DeviceDB.updateDevice(deviceToExtend.id, {
            expiry: newExpiry,
            status: new Date(newExpiry) > new Date() ? 'Active' : 'Expired',
            cycle_start_date: new Date().toISOString(),
            renewal_count: newCount
        });

        if (success) {
            deviceToExtend.expiry = newExpiry;
            deviceToExtend.status = new Date(newExpiry) > new Date() ? 'Active' : 'Expired';
            deviceToExtend.cycle_start_date = new Date().toISOString();
            deviceToExtend.renewal_count = newCount;
            renderTable();
            updateStats();
            updateReports();
            toggleExtendModal(false);
            showToast(`Subscription updated for ${deviceToExtend.code}`, 'success');
        } else {
            showToast('Error updating subscription.', 'error');
        }
    });
}

// Edit Device Restored Logic
const closeEditModal = document.getElementById('close-edit-modal');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
if (closeEditModal) closeEditModal.addEventListener('click', () => toggleEditModal(false));
if (btnCancelEdit) btnCancelEdit.addEventListener('click', () => toggleEditModal(false));

if (editForm) {
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!deviceToEdit) return;

        const editPayStatusInput = document.querySelector('input[name="edit-payment-status"]:checked');
        const details = {
            username: editUsername.value,
            amount: parseFloat(editAmount.value),
            description: editDescription.value,
            payment_status: editPayStatusInput ? editPayStatusInput.value : 'paid'
        };

        const success = await window.DeviceDB.updateDeviceDetails(deviceToEdit.id, details);
        if (success) {
            // Sync local state
            deviceToEdit.username = details.username;
            deviceToEdit.amount = details.amount;
            deviceToEdit.description = details.description;
            deviceToEdit.payment_status = details.payment_status;
            renderTable();
            toggleEditModal(false);
            showToast(`Information updated for ${deviceToEdit.code}`, 'success');
        } else {
            showToast('Error updating information.', 'error');
        }
    });
}

// Severity Modal Logic
const closeSeverityModal = document.getElementById('close-severity-modal');
const btnCancelSeverity = document.getElementById('btn-cancel-severity');
if (closeSeverityModal) closeSeverityModal.addEventListener('click', () => toggleSeverityModal(false));
if (btnCancelSeverity) btnCancelSeverity.addEventListener('click', () => toggleSeverityModal(false));

severityBtns.forEach(btn => {
    btn.addEventListener('click', () => setSeverityUI(parseInt(btn.dataset.level)));
});

if (btnUpdateAll) btnUpdateAll.addEventListener('click', () => toggleSeverityModal(true, 'global'));

if (btnApplySeverity) {
    btnApplySeverity.addEventListener('click', async () => {
        if (severityTarget === 'global') {
            const levelSave = await window.DeviceDB.updateSetting('global_update_level', activeSeverityLevel.toString());
            const urlSave = await window.DeviceDB.updateSetting('update_url', globalUpdateUrlInput.value);

            if (levelSave && urlSave) {
                showToast(`Global update level set to ${activeSeverityLevel}`, 'success');
                toggleSeverityModal(false);
            } else {
                showToast('Failed to save global settings.', 'error');
            }
        } else if (deviceToUpdateSeverity) {
            const success = await window.DeviceDB.updateDeviceLevel(deviceToUpdateSeverity.id, activeSeverityLevel);
            if (success) {
                deviceToUpdateSeverity.update_level = activeSeverityLevel;
                renderTable();
                showToast(`Update level set to ${activeSeverityLevel} for ${deviceToUpdateSeverity.code}`, 'success');
                toggleSeverityModal(false);
            } else {
                showToast('Failed to update device.', 'error');
            }
        }
    });
}

if (addDeviceForm) {
    addDeviceForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const codeInput = document.getElementById('device-code');
        const usernameInput = document.getElementById('device-username');
        const amountInput = document.getElementById('device-amount');
        const descriptionInput = document.getElementById('device-description');
        const expiryInput = document.getElementById('device-expiry');
        const paymentStatusInput = document.querySelector('input[name="payment-status"]:checked');

        if (!codeInput || !usernameInput || !amountInput || !descriptionInput || !expiryInput) return;

        const newDevice = {
            code: codeInput.value,
            username: usernameInput.value,
            amount: parseFloat(amountInput.value),
            description: descriptionInput.value,
            status: new Date(expiryInput.value) > new Date() ? 'Active' : 'Expired',
            expiry: expiryInput.value,
            created_at: new Date().toISOString(), // Automatic time
            cycle_start_date: new Date().toISOString(),
            renewal_count: 0,
            payment_status: paymentStatusInput ? paymentStatusInput.value : 'paid'
        };

        try {
            const result = await window.DeviceDB.addDevice(newDevice);
            if (result) {
                devices.unshift(result);
                renderTable();
                updateStats();
                updateReports();
                toggleAddModal(false);
                showToast(`Device ${newDevice.code} for ${newDevice.username} added successfully!`, 'success');
            } else {
                throw new Error('Database rejection. Check for duplicate codes.');
            }
        } catch (err) {
            console.error('script.js: Error adding device:', err);
            showToast(`Error adding device: ${err.message}`, 'error');
        }
    });
}

// Actions
window.editDevice = (id) => {
    const device = devices.find(d => String(d.id) === String(id));
    if (device) toggleEditModal(true, device);
};

window.updateSeverity = (id) => {
    const device = devices.find(d => String(d.id) === String(id));
    if (device) toggleSeverityModal(true, 'device', device);
};

window.extendSubscription = async (id) => {
    const device = devices.find(d => String(d.id) === String(id));
    if (device) {
        toggleExtendModal(true, device);
    }
};

window.banDevice = async (id) => {
    const device = devices.find(d => String(d.id) === String(id));
    if (device) {
        try {
            const success = await window.DeviceDB.updateDevice(id, { status: 'Banned' });
            if (success) {
                device.status = 'Banned';
                renderTable();
                updateStats();
                updateReports();
                showToast(`Device ${device.code} has been banned.`, 'warning');
            } else {
                throw new Error('Update failed');
            }
        } catch (err) {
            showToast('Failed to ban device.', 'error');
        }
    }
};

window.activateDevice = async (id) => {
    const device = devices.find(d => String(d.id) === String(id));
    if (device) {
        try {
            const isExpired = new Date(device.expiry) < new Date();
            const newStatus = isExpired ? 'Expired' : 'Active';
            const success = await window.DeviceDB.updateDevice(id, { status: newStatus });

            if (success) {
                device.status = newStatus;
                renderTable();
                updateStats();
                updateReports();
                showToast(`Device ${device.code} has been activated.`, 'success');
            } else {
                throw new Error('Activation failed');
            }
        } catch (err) {
            showToast('Failed to activate device.', 'error');
        }
    }
};

window.requestRemove = (id) => {
    const device = devices.find(d => String(d.id) === String(id));
    if (!device || !removeDeviceName || !removeTimerSpan || !btnConfirmRemove) return;

    deviceToRemove = id;
    removeDeviceName.textContent = device.code;
    removeTimerSpan.textContent = '3';
    btnConfirmRemove.disabled = true;
    toggleRemoveModal(true);

    let timeLeft = 3;
    removeTimerInterval = setInterval(() => {
        timeLeft -= 1;
        removeTimerSpan.textContent = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(removeTimerInterval);
            btnConfirmRemove.disabled = false;
            btnConfirmRemove.textContent = 'Confirm Removal';
        }
    }, 1000);
};

if (btnCancelRemove) btnCancelRemove.addEventListener('click', () => toggleRemoveModal(false));

if (btnConfirmRemove) {
    btnConfirmRemove.addEventListener('click', async () => {
        if (deviceToRemove) {
            try {
                const index = devices.findIndex(d => String(d.id) === String(deviceToRemove));
                if (index !== -1) {
                    const code = devices[index].code;
                    const success = await window.DeviceDB.deleteDevice(deviceToRemove);
                    if (success) {
                        devices.splice(index, 1);
                        renderTable();
                        updateStats();
                        updateReports();
                        showToast(`Device ${code} removed successfully.`, 'info');
                    } else {
                        throw new Error('Database refused deletion');
                    }
                }
            } catch (err) {
                console.error('Delete error:', err);
                showToast('Failed to delete device.', 'error');
            }
            toggleRemoveModal(false);
        }
    });
}

window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && sidebar) {
        sidebar.classList.remove('mobile-open');
    }
});
