// script4.js - Token Verification with UPI Payment - FIXED
const tokenInput = document.getElementById('tokenInput');
const verifyBtn = document.getElementById('verifyBtn');
const errorMsg = document.getElementById('errorMsg');
const tokenDetails = document.getElementById('tokenDetails');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');

let currentToken = null;
let paymentCheckInterval = null;

// Verify token on button click
verifyBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    showError('Please enter a token number');
    return;
  }
  await fetchTokenDetails(token);
});

// Also verify on Enter key
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
      
      // Start auto-checking for payment if not verified
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
    <div class="bg-slate-700/40 p-6 rounded-xl border border-slate-600/50 hover:border-indigo-500/50 transition-all duration-300">
      <div class="flex justify-between items-center">
        <div class="flex-1">
          <p class="text-white text-xl font-semibold mb-2">${meal.name}</p>
          <p class="text-slate-400 text-sm">Price per item: ₹${meal.price}</p>
        </div>
        <div class="text-right">
          <p class="text-indigo-400 text-lg font-bold mb-1">Qty: ${meal.quantity}</p>
          <p class="text-emerald-400 text-xl font-bold">₹${meal.price * meal.quantity}</p>
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
    statusBadge.className = 'px-6 py-3 rounded-full font-semibold text-lg bg-emerald-900/30 text-emerald-400 border border-emerald-500/50';
    statusBadge.innerHTML = '<i class="fas fa-check-circle mr-2"></i> Verified';
    verifiedInfo.classList.remove('hidden');
    document.getElementById('verifiedAt').textContent = new Date(data.verifiedAt).toLocaleString('en-IN');
    paymentSection.classList.add('hidden');
    stopPaymentPolling();
  } else {
    statusBadge.className = 'px-6 py-3 rounded-full font-semibold text-lg bg-yellow-900/30 text-yellow-400 border border-yellow-500/50';
    statusBadge.innerHTML = '<i class="fas fa-clock mr-2"></i> Awaiting Payment';
    verifiedInfo.classList.add('hidden');
    paymentSection.classList.remove('hidden');
    
    // Generate UPI payment QR
    generatePaymentQR(data);
  }
}

function generatePaymentQR(data) {
  const mainAmount = data.totalAmount;
  
  // UPI string format - properly encoded
  const upiString = `upi://pay?pa=9483246283@kotak811&pn=MessMate&am=${mainAmount}&cu=INR&tn=Token${data.token}`;
  
  document.getElementById('upiId').textContent = '9483246283@kotak811';
  
  // Clear existing QR
  const qrContainer = document.getElementById('qrCanvas');
  qrContainer.innerHTML = '';
  
  // Generate QR using Google Charts API
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=256x256&data=${encodeURIComponent(upiString)}`;
  
  qrContainer.innerHTML = `
    <img src="${qrUrl}" alt="UPI QR Code" class="mx-auto rounded-lg shadow-lg" style="width: 256px; height: 256px;" onerror="this.src='https://via.placeholder.com/256/667eea/ffffff?text=QR+Error'">
  `;
}

// Auto-check payment status every 5 seconds
function startPaymentPolling(token) {
  stopPaymentPolling(); // Clear any existing interval
  
  console.log('🔄 Starting auto payment detection for token:', token);
  
  paymentCheckInterval = setInterval(async () => {
    try {
      const res = await fetch(`/token/${token}`);
      const data = await res.json();
      
      console.log('Checking payment status...', data.verified ? 'VERIFIED' : 'Not yet verified');
      
      if (data.success && data.verified) {
        // Payment detected!
        console.log('✅ Payment detected! Token verified.');
        showSuccess('Payment received! Token verified automatically.');
        currentToken = data;
        displayTokenDetails(data);
        stopPaymentPolling();
      }
    } catch (err) {
      console.error('Error checking payment status:', err);
    }
  }, 5000); // Check every 5 seconds
}

function stopPaymentPolling() {
  if (paymentCheckInterval) {
    clearInterval(paymentCheckInterval);
    paymentCheckInterval = null;
    console.log('⏹️ Stopped payment detection');
  }
}

// Manual verification button (backup)
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
    } else {
      showError(data.error || 'Verification failed.');
    }
  } catch (err) {
    showError('Error verifying payment. Please try again.');
    console.error(err);
  } finally {
    confirmPaymentBtn.disabled = false;
    confirmPaymentBtn.innerHTML = '<i class="fas fa-hand-pointer mr-2"></i> Manual Verify (if auto-detect fails)';
  }
});

// Copy UPI ID to clipboard
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
  toast.className = 'fixed top-4 right-4 bg-emerald-500 text-white px-6 py-4 rounded-xl shadow-lg z-50 flex items-center gap-3 animate-slide-in';
  toast.innerHTML = `<i class="fas fa-check-circle mr-2"></i> ${message}`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transform', 'translate-x-full', 'transition-all', 'duration-300');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  stopPaymentPolling();
});

// Log script loaded
console.log('✅ Token Verification script loaded');