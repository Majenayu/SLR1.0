// producer-dashboard-merged.js - Combined Producer Dashboard & Token Verification
const userEmail = localStorage.getItem('messmate_user_email');
const userRole = localStorage.getItem('messmate_user_role') || 'producer';
const userName = localStorage.getItem('messmate_user_name') || '';

if (!userEmail || userRole !== 'producer') {
  window.location.href = '/';
}

let eventSource = null;
let notificationEventSource = null;
let currentToken = null;
let paymentCheckInterval = null;

let notificationStats = {
  subscribedStudents: 0,
  totalStudents: 0,
  todayNotifications: 0,
  targeting: {
    noOrderToday: 0,
    notVerified: 0,
    alreadyVerified: 0,
    willNotify: 0
  }
};

document.getElementById('producer-welcome').textContent = `Logged in as: ${userName || userEmail}`;

// ==================== NOTIFICATION SYSTEM ====================

async function initNotificationSystem() {
  await loadNotificationStats();
  connectToNotificationSSE();
  loadRecentNotifications();
}

async function loadNotificationStats() {
  try {
    const res = await fetch('/producer/notification-stats');
    const data = await res.json();
    
    if (data.success) {
      notificationStats = {
        subscribedStudents: data.stats.subscribedStudents,
        totalStudents: data.stats.totalStudents,
        todayNotifications: data.stats.notificationsToday.successful,
        targeting: data.stats.targeting || {
          noOrderToday: 0,
          notVerified: 0,
          alreadyVerified: 0,
          willNotify: 0
        }
      };
      
      updateNotificationBadge();
      updateNotificationPanel();
    }
  } catch (err) {
    console.error('Error loading notification stats:', err);
  }
}

function updateNotificationBadge() {
  const badge = document.getElementById('notificationDot');
  const willNotify = notificationStats.targeting.willNotify;
  
  if (willNotify > 0) {
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function updateNotificationPanel() {
  const sendBtn = document.getElementById('sendReminderBtn');
  const willNotify = notificationStats.targeting.willNotify;
  
  if (willNotify === 0) {
    sendBtn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>All Verified!';
    sendBtn.disabled = true;
    sendBtn.classList.remove('bg-orange-600', 'hover:bg-orange-700');
    sendBtn.classList.add('bg-emerald-600');
  } else {
    sendBtn.innerHTML = `<i class="fas fa-paper-plane mr-2"></i>Send to ${willNotify}`;
    sendBtn.disabled = false;
    sendBtn.classList.remove('bg-emerald-600');
    sendBtn.classList.add('bg-orange-600', 'hover:bg-orange-700');
  }
}

function connectToNotificationSSE() {
  if (notificationEventSource) {
    notificationEventSource.close();
  }

  notificationEventSource = new EventSource('/producer/sse');
  
  notificationEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleNotificationEvent(data);
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };

  notificationEventSource.onerror = () => {
    console.log('Notification SSE connection lost, reconnecting...');
    setTimeout(connectToNotificationSSE, 5000);
  };
}

function handleNotificationEvent(data) {
  console.log('Notification event:', data);
  
  switch (data.type) {
    case 'reminder_sent':
    case 'scheduled_reminder_sent':
      playNotificationSound();
      
      const breakdown = data.results?.breakdown || {};
      const message = `📢 ${data.results?.successful || 0} students notified!\n` +
                     `• No orders: ${breakdown.noOrder || 0}\n` +
                     `• Not verified: ${breakdown.notVerified || 0}\n` +
                     `• Skipped (verified): ${breakdown.alreadyVerified || 0}`;
      
      showNotificationToast(message, 'success');
      addNotificationToPanel(data);
      loadNotificationStats();
      break;
  }
}

document.getElementById('sendReminderBtn').addEventListener('click', async () => {
  const willNotify = notificationStats.targeting.willNotify;
  
  if (willNotify === 0) {
    showNotificationToast('✅ All students have ordered and verified!', 'success');
    return;
  }
  
  const noOrder = notificationStats.targeting.noOrderToday;
  const notVerified = notificationStats.targeting.notVerified;
  
  const confirmMsg = `Send reminders to ${willNotify} students?\n\n` +
                     `• ${noOrder} haven't ordered today\n` +
                     `• ${notVerified} haven't verified their token\n\n` +
                     `Students who already verified will NOT be notified.`;
  
  if (!confirm(confirmMsg)) {
    return;
  }

  const btn = document.getElementById('sendReminderBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Sending...';

  try {
    const res = await fetch('/producer/send-reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        producerEmail: userEmail,
        message: null
      })
    });

    const data = await res.json();

    if (data.success) {
      showNotificationToast(
        `✅ Sent to ${data.results.successful}/${data.results.total} students!\n` +
        `Skipped ${data.results.skipped} students who already verified.`,
        'success'
      );
      loadRecentNotifications();
      loadNotificationStats();
    } else {
      showNotificationToast('❌ Failed to send reminders', 'error');
    }
  } catch (err) {
    console.error('Send reminders error:', err);
    showNotificationToast('❌ Error sending reminders', 'error');
  } finally {
    btn.disabled = false;
    loadNotificationStats();
  }
});

async function loadRecentNotifications() {
  try {
    const res = await fetch('/producer/recent-notifications?limit=10');
    const data = await res.json();

    if (data.success) {
      displayNotifications(data.notifications);
    }
  } catch (err) {
    console.error('Error loading notifications:', err);
  }
}

function displayNotifications(notifications) {
  const list = document.getElementById('notificationList');
  
  const targeting = notificationStats.targeting;
  const summaryHtml = `
    <div class="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 p-3 sm:p-4 rounded-xl border border-indigo-500/30 mb-3 sm:mb-4">
      <h4 class="text-xs sm:text-sm font-bold text-indigo-200 mb-2 sm:mb-3">📊 Current Status</h4>
      <div class="grid grid-cols-2 gap-2 sm:gap-3 text-xs">
        <div class="bg-slate-700/40 p-2 sm:p-3 rounded-lg">
          <p class="text-slate-400 mb-1 text-xs">No Orders</p>
          <p class="text-xl sm:text-2xl font-bold text-orange-400">${targeting.noOrderToday}</p>
        </div>
        <div class="bg-slate-700/40 p-2 sm:p-3 rounded-lg">
          <p class="text-slate-400 mb-1 text-xs">Not Verified</p>
          <p class="text-xl sm:text-2xl font-bold text-yellow-400">${targeting.notVerified}</p>
        </div>
        <div class="bg-slate-700/40 p-2 sm:p-3 rounded-lg">
          <p class="text-slate-400 mb-1 text-xs">Verified</p>
          <p class="text-xl sm:text-2xl font-bold text-emerald-400">${targeting.alreadyVerified}</p>
        </div>
        <div class="bg-slate-700/40 p-2 sm:p-3 rounded-lg">
          <p class="text-slate-400 mb-1 text-xs">Will Notify</p>
          <p class="text-xl sm:text-2xl font-bold text-indigo-400">${targeting.willNotify}</p>
        </div>
      </div>
    </div>
  `;
  
  if (notifications.length === 0) {
    list.innerHTML = summaryHtml + '<p class="text-slate-400 text-center py-4 text-sm">No notifications sent today</p>';
    return;
  }

  const notificationsHtml = notifications.map(n => {
    const time = new Date(n.sentAt).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const icon = n.type === 'daily_reminder' ? 'fa-clock' : 
                 n.type === 'payment_reminder' ? 'fa-money-bill-wave' :
                 n.type === 'producer_alert' ? 'fa-bullhorn' : 'fa-bell';
    
    const statusColor = n.success ? 'text-emerald-400' : 'text-red-400';
    const statusIcon = n.success ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    const reasonBadge = n.reason === 'no_order_today' ? 
      '<span class="text-xs bg-orange-600/30 text-orange-300 px-2 py-1 rounded">No Order</span>' :
      n.reason === 'not_verified' ? 
      '<span class="text-xs bg-yellow-600/30 text-yellow-300 px-2 py-1 rounded">Not Verified</span>' :
      '';

    return `
      <div class="bg-slate-700/40 p-3 sm:p-4 rounded-xl border border-slate-600/30 hover:border-indigo-500/50 transition-all">
        <div class="flex items-start gap-2 sm:gap-3">
          <i class="fas ${icon} text-indigo-400 mt-1 text-sm"></i>
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between mb-1 gap-2">
              <p class="font-semibold text-white text-xs sm:text-sm truncate">${n.title}</p>
              <span class="text-xs text-slate-400 flex-shrink-0">${time}</span>
            </div>
            <p class="text-slate-300 text-xs mb-2 line-clamp-2">${n.message.substring(0, 80)}...</p>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="${statusColor} text-xs flex items-center gap-1">
                <i class="fas ${statusIcon}"></i>
                ${n.success ? 'Delivered' : 'Failed'}
              </span>
              ${reasonBadge}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  list.innerHTML = summaryHtml + notificationsHtml;
}

function addNotificationToPanel(data) {
  const list = document.getElementById('notificationList');
  
  const time = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const breakdown = data.results?.breakdown || {};
  const detailsHtml = `
    <div class="text-xs mt-2 space-y-1">
      <p class="text-emerald-400">✓ ${breakdown.noOrder || 0} no orders</p>
      <p class="text-yellow-400">✓ ${breakdown.notVerified || 0} not verified</p>
      <p class="text-slate-400">⊘ ${breakdown.alreadyVerified || 0} skipped</p>
    </div>
  `;

  const newNotification = document.createElement('div');
  newNotification.className = 'bg-slate-700/40 p-3 sm:p-4 rounded-xl border border-emerald-500/50 animate-slide-in';
  newNotification.innerHTML = `
    <div class="flex items-start gap-2 sm:gap-3">
      <i class="fas fa-bullhorn text-emerald-400 mt-1 text-sm"></i>
      <div class="flex-1">
        <div class="flex items-start justify-between mb-1 gap-2">
          <p class="font-semibold text-white text-xs sm:text-sm">
            ${data.type === 'scheduled_reminder_sent' ? '⏰ Scheduled' : '📢 Manual'}
          </p>
          <span class="text-xs text-slate-400">${time}</span>
        </div>
        <p class="text-slate-300 text-xs mb-2">
          Sent to ${data.results?.successful || 0} (${data.results?.skipped || 0} skipped)
        </p>
        ${detailsHtml}
      </div>
    </div>
  `;

  const summary = list.querySelector('.bg-gradient-to-r');
  if (summary && summary.nextSibling) {
    list.insertBefore(newNotification, summary.nextSibling);
  } else {
    list.appendChild(newNotification);
  }
  
  while (list.children.length > 11) {
    list.removeChild(list.lastChild);
  }
}

document.getElementById('notificationBell').addEventListener('click', () => {
  const panel = document.getElementById('notificationPanel');
  panel.classList.toggle('hidden');
  
  if (!panel.classList.contains('hidden')) {
    loadRecentNotifications();
    loadNotificationStats();
    document.getElementById('notificationBell').classList.add('bell-ringing');
    setTimeout(() => {
      document.getElementById('notificationBell').classList.remove('bell-ringing');
    }, 500);
  }
});

document.addEventListener('click', (e) => {
  const panel = document.getElementById('notificationPanel');
  const bell = document.getElementById('notificationBell');
  
  if (!panel.contains(e.target) && !bell.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

function playNotificationSound() {
  const audio = document.getElementById('notificationSound');
  if (audio) {
    audio.play().catch(() => {
      console.log('Audio play failed');
    });
  }
}

function showNotificationToast(message, type = 'info') {
  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  
  toast.className = `fixed top-20 right-4 ${bgColor} text-white px-4 sm:px-6 py-3 sm:py-4 rounded-xl shadow-2xl z-50 flex items-center gap-2 sm:gap-3 animate-slide-in max-w-xs sm:max-w-md`;
  toast.innerHTML = `
    <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'} flex-shrink-0"></i>
    <span class="whitespace-pre-line text-xs sm:text-sm">${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ==================== STATS & PRODUCER FUNCTIONALITY ====================

async function loadStats() {
  try {
    const period = document.getElementById('periodSelect').value;
    const res = await fetch(`/producer/stats?period=${period}`);
    const data = await res.json();

    document.getElementById('totalOrders').textContent = data.total || 0;
    document.getElementById('paidOrders').textContent = data.paid || 0;
    document.getElementById('unpaidOrders').textContent = data.unpaid || 0;
    document.getElementById('scannedOrders').textContent = data.verified || 0;

    const mealTypesDiv = document.getElementById('mealTypes');
    const meals = data.meals || {};
    const mealEntries = Object.entries(meals);

    if (mealEntries.length === 0) {
      mealTypesDiv.innerHTML = '<p class="text-slate-400 text-center col-span-full py-6 sm:py-8 text-sm sm:text-base">No orders yet for this period</p>';
      return;
    }

    mealTypesDiv.innerHTML = mealEntries.map(([name, count]) => `
      <div class="bg-gradient-to-br from-slate-700/60 to-slate-800/60 backdrop-blur-sm p-4 sm:p-6 rounded-xl border border-slate-600/40 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105">
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <p class="text-slate-300 text-xs sm:text-sm font-medium mb-1 truncate">${name}</p>
            <p class="text-2xl sm:text-3xl font-bold text-white">${count}</p>
          </div>
          <div class="w-10 h-10 sm:w-14 sm:h-14 bg-indigo-500/20 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
            <i class="fas fa-utensils text-lg sm:text-2xl text-indigo-300"></i>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

document.getElementById('periodSelect').addEventListener('change', loadStats);

// ==================== TOKEN VERIFICATION ====================

const tokenInput = document.getElementById('tokenInput');
const verifyBtn = document.getElementById('verifyBtn');
const errorMsg = document.getElementById('errorMsg');
const tokenDetails = document.getElementById('tokenDetails');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');

verifyBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showError('Please enter a token number');
    return;
  }
  await fetchTokenDetails(token);
});

tokenInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') verifyBtn.click();
});

async function fetchTokenDetails(token) {
  try {
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Verifying...';
    errorMsg.classList.add('hidden');

    const res = await fetch(`/token/${token}`);
    const data = await res.json();

    if (data.success) {
      currentToken = data;
      displayTokenDetails(data);
      tokenDetails.classList.remove('hidden');
      
      if (!data.verified && !data.paid) {
        startPaymentPolling(token);
      }
    } else {
      showError(data.error || 'Token not found');
      tokenDetails.classList.add('hidden');
    }
  } catch (err) {
    showError('Error fetching token details. Please try again.');
    console.error(err);
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.innerHTML = '<i class="fas fa-search mr-2"></i> Verify Token';
  }
}

function displayTokenDetails(data) {
  // Display customer photo
  const customerPhoto = document.getElementById('customerPhoto');
  if (data.userPhoto) {
    customerPhoto.src = data.userPhoto;
  } else {
    customerPhoto.src = 'https://via.placeholder.com/80/667eea/ffffff?text=' + (data.userName ? data.userName.charAt(0).toUpperCase() : 'U');
  }

  // User details
  document.getElementById('userName').textContent = data.userName || 'Unknown User';
  document.getElementById('userEmail').textContent = data.userEmail;
  document.getElementById('tokenNumber').textContent = `#${data.token}`;
  document.getElementById('tokenDate').textContent = new Date(data.date).toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Meals list
  const mealsList = document.getElementById('mealsList');
  mealsList.innerHTML = data.meals.map(meal => `
    <div class="bg-slate-700/40 p-4 sm:p-6 rounded-xl border border-slate-600/50 hover:border-indigo-500/50 transition-all duration-300">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div class="flex-1">
          <p class="text-white text-lg sm:text-xl font-semibold mb-1 sm:mb-2">${meal.name}</p>
          <p class="text-slate-400 text-xs sm:text-sm">Price per item: ₹${meal.price}</p>
        </div>
        <div class="text-left sm:text-right">
          <p class="text-indigo-400 text-base sm:text-lg font-bold mb-1">Qty: ${meal.quantity}</p>
          <p class="text-emerald-400 text-lg sm:text-xl font-bold">₹${meal.price * meal.quantity}</p>
        </div>
      </div>
    </div>
  `).join('');

  // Total amount
  document.getElementById('totalAmount').textContent = `₹${data.totalAmount}`;

  // Status
  const statusBadge = document.getElementById('statusBadge');
  const verifiedInfo = document.getElementById('verifiedInfo');
  const paymentSection = document.getElementById('paymentSection');
  
  if (data.verified) {
    statusBadge.className = 'px-4 sm:px-6 py-2 sm:py-3 rounded-full font-semibold text-base sm:text-lg bg-emerald-900/30 text-emerald-400 border border-emerald-500/50';
    statusBadge.innerHTML = '<i class="fas fa-check-circle mr-2"></i> Verified';
    verifiedInfo.classList.remove('hidden');
    document.getElementById('verifiedAt').textContent = new Date(data.verifiedAt).toLocaleString('en-IN');
    paymentSection.classList.add('hidden');
    stopPaymentPolling();
  } else {
    statusBadge.className = 'px-4 sm:px-6 py-2 sm:py-3 rounded-full font-semibold text-base sm:text-lg bg-yellow-900/30 text-yellow-400 border border-yellow-500/50';
    statusBadge.innerHTML = '<i class="fas fa-clock mr-2"></i> Awaiting Payment';
    verifiedInfo.classList.add('hidden');
    paymentSection.classList.remove('hidden');
    generatePaymentQR(data);
  }
}

function generatePaymentQR(data) {
  const mainAmount = data.totalAmount;
  const upiString = `upi://pay?pa=9483246283@kotak811&pn=MessMate&am=${mainAmount}&cu=INR&tn=Token${data.token}`;
  
  document.getElementById('upiId').textContent = '9483246283@kotak811';
  
  const qrContainer = document.getElementById('qrCanvas');
  qrContainer.innerHTML = '';
  
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(upiString)}`;
  
  qrContainer.innerHTML = `
    <img src="${qrUrl}" alt="UPI QR Code" class="mx-auto rounded-lg shadow-lg w-48 h-48 sm:w-64 sm:h-64" onerror="this.src='https://via.placeholder.com/256/667eea/ffffff?text=QR+Error'">
  `;
}

function startPaymentPolling(token) {
  stopPaymentPolling();
  
  console.log('🔄 Starting auto payment detection for token:', token);
  
  paymentCheckInterval = setInterval(async () => {
    try {
      const res = await fetch(`/token/${token}`);
      const data = await res.json();
      
      console.log('Checking payment status...', data.verified ? 'VERIFIED' : 'Not yet verified');
      
      if (data.success && data.verified) {
        console.log('✅ Payment detected! Token verified.');
        showSuccess('Payment received! Token verified automatically.');
        currentToken = data;
        displayTokenDetails(data);
        stopPaymentPolling();
        loadStats();
        loadNotificationStats();
      }
    } catch (err) {
      console.error('Error checking payment status:', err);
    }
  }, 5000);
}

function stopPaymentPolling() {
  if (paymentCheckInterval) {
    clearInterval(paymentCheckInterval);
    paymentCheckInterval = null;
    console.log('⏹️ Stopped payment detection');
  }
}

confirmPaymentBtn.addEventListener('click', async () => {
  if (!currentToken) {
    showError('No token loaded');
    return;
  }

  if (!confirm('Have you completed the UPI payment?\n\nThis will manually mark the payment as received.')) {
    return;
  }

  try {
    confirmPaymentBtn.disabled = true;
    confirmPaymentBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Verifying...';

    const res = await fetch('/verify-token-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        token: currentToken.token,
        amount: currentToken.totalAmount,
        paymentMethod: 'upi'
      })
    });

    const data = await res.json();

    if (data.success) {
      showSuccess('Payment verified manually! Token activated.');
      stopPaymentPolling();
      await fetchTokenDetails(currentToken.token);
      loadStats();
      loadNotificationStats();
    } else {
      showError(data.error || 'Verification failed.');
    }
  } catch (err) {
    showError('Error verifying payment. Please try again.');
    console.error(err);
  } finally {
    confirmPaymentBtn.disabled = false;
    confirmPaymentBtn.innerHTML = '<i class="fas fa-hand-pointer mr-2"></i> Manual Verify';
  }
});

window.copyUPI = function() {
  const upiId = document.getElementById('upiId').textContent;
  navigator.clipboard.writeText(upiId).then(() => {
    showSuccess('UPI ID copied to clipboard!');
  }).catch(() => {
    showError('Failed to copy UPI ID');
  });
};

function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.remove('hidden');
  setTimeout(() => errorMsg.classList.add('hidden'), 5000);
}

function showSuccess(message) {
  const toast = document.createElement('div');
  toast.className = 'fixed top-4 right-4 bg-emerald-500 text-white px-4 sm:px-6 py-3 sm:py-4 rounded-xl shadow-lg z-50 flex items-center gap-2 sm:gap-3 animate-slide-in max-w-xs sm:max-w-md';
  toast.innerHTML = `<i class="fas fa-check-circle mr-2"></i> <span class="text-sm sm:text-base">${message}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transform', 'translate-x-full', 'transition-all', 'duration-300');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==================== LIVE RATINGS SSE ====================

function connectToRatingsSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/sse-ratings');
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      displayLiveUpdate(data);
    } catch (err) {
      console.error('SSE parse error:', err);
    }
  };

  eventSource.onerror = () => {
    console.log('SSE connection lost, reconnecting...');
    setTimeout(connectToRatingsSSE, 5000);
  };
}

function displayLiveUpdate(data) {
  const liveDiv = document.getElementById('live');
  const stars = Array.from({ length: 5 }, (_, i) => 
    i < Math.round(data.avgRating) ? '⭐' : '☆'
  ).join('');

  const update = document.createElement('div');
  update.className = 'bg-slate-700/40 p-4 sm:p-6 rounded-xl mb-3 sm:mb-4 border border-slate-600/50 animate-slide-in';
  update.innerHTML = `
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div class="flex-1">
        <p class="text-lg sm:text-xl font-bold text-white">${data.mealName}</p>
        <p class="text-xs sm:text-sm text-slate-300 mt-1">New rating received</p>
      </div>
      <div class="text-left sm:text-right">
        <p class="text-xl sm:text-2xl mb-1">${stars}</p>
        <p class="text-emerald-400 font-bold text-sm sm:text-base">${data.avgRating.toFixed(1)} / 5.0</p>
        <p class="text-xs text-slate-400">${data.totalRatings} ratings</p>
      </div>
    </div>
  `;

  liveDiv.insertBefore(update, liveDiv.firstChild);
  
  while (liveDiv.children.length > 5) {
    liveDiv.removeChild(liveDiv.lastChild);
  }
}

// ==================== LOGOUT & CLEANUP ====================

document.getElementById('logout').addEventListener('click', () => {
  if (confirm('Are you sure you want to logout?')) {
    if (eventSource) eventSource.close();
    if (notificationEventSource) notificationEventSource.close();
    stopPaymentPolling();
    localStorage.clear();
    window.location.href = '/';
  }
});

window.addEventListener('beforeunload', () => {
  if (eventSource) eventSource.close();
  if (notificationEventSource) notificationEventSource.close();
  stopPaymentPolling();
});

// Refresh targeting stats periodically
setInterval(() => {
  loadNotificationStats();
}, 30000);

// ==================== INITIALIZE ====================

loadStats();
connectToRatingsSSE();
initNotificationSystem();

console.log('✅ Merged producer dashboard loaded');
