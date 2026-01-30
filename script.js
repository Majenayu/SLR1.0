// Fixed script.js with proper token handling for today
const userEmail = localStorage.getItem('messmate_user_email');
const userName = localStorage.getItem('messmate_user_name') || '';
let profileComplete = localStorage.getItem('messmate_profile_complete') === 'true';
let profilePhoto = localStorage.getItem('messmate_profile_photo');
let userOrders = [];
let spendingChart = null, foodChart = null;
let cameraStream = null;
let cart = JSON.parse(localStorage.getItem('messmate_cart') || '[]');
let currentSelectedMeal = null;
let currentCalendarDate = new Date();
let selectedDates = new Map(); // Map of date string -> batch number
let userTokens = [];

if (!userEmail) window.location.href = '/';

// Calendar Functions
function renderCalendar() {
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  // Update header
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('currentMonth').textContent = `${monthNames[month]} ${year}`;
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const calendarGrid = document.getElementById('calendarGrid');
  calendarGrid.innerHTML = '';
  
  // Add day names
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayNames.forEach(name => {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'text-center font-bold text-slate-400 text-xs py-2';
    dayHeader.textContent = name;
    calendarGrid.appendChild(dayHeader);
  });
  
  // Add empty cells for days before month starts
  const startDay = firstDay.getDay();
  for (let i = 0; i < startDay; i++) {
    const emptyCell = document.createElement('div');
    calendarGrid.appendChild(emptyCell);
  }
  
  // Add days of the month
  for (let day = 1; day <= lastDay.getDate(); day++) {
    const currentDate = new Date(year, month, day);
    const dateString = currentDate.toISOString().split('T')[0];
    
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    
    // Check if date is in the past (disable it)
    if (currentDate < today) {
      dayCell.classList.add('disabled');
    }
    
    // Check if it's today
    if (currentDate.toDateString() === today.toDateString()) {
      dayCell.classList.add('today');
    }
    
    // Check if date is selected
    if (selectedDates.has(dateString)) {
      dayCell.classList.add('selected');
    }
    
    dayCell.innerHTML = `
      <span class="day-number">${day}</span>
      <span class="day-name">${dayNames[currentDate.getDay()]}</span>
    `;
    
    if (currentDate >= today) {
      dayCell.addEventListener('click', () => toggleDateSelection(dateString, dayCell));
    }
    
    calendarGrid.appendChild(dayCell);
  }
  
  updateSelectedDaysSummary();
}

function toggleDateSelection(dateString, dayCell) {
  if (selectedDates.has(dateString)) {
    selectedDates.delete(dateString);
    dayCell.classList.remove('selected');
  } else {
    selectedDates.set(dateString, 1); // Default to Batch 1
    dayCell.classList.add('selected');
  }
  
  // Show/hide batch selection
  if (selectedDates.size > 0) {
    document.getElementById('batchSelectionContainer').classList.remove('hidden');
  } else {
    document.getElementById('batchSelectionContainer').classList.add('hidden');
  }
  
  updateSelectedDaysSummary();
}

function updateSelectedDaysSummary() {
  const summary = document.getElementById('selectedDaysSummary');
  
  if (selectedDates.size === 0) {
    summary.innerHTML = 'No days selected yet';
    return;
  }
  
  const selectedBatch = document.querySelector('input[name="batch-time"]:checked');
  const batchText = selectedBatch ? 
    (selectedBatch.value === '1' ? 'Batch 1 (12:30-1:00 PM)' : 'Batch 2 (1:00-2:00 PM)') : 
    'No batch selected';
  
  const dates = Array.from(selectedDates.keys()).sort();
  const datesList = dates.map(date => {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }).join(', ');
  
  summary.innerHTML = `
    <div class="mb-2"><strong>${selectedDates.size}</strong> day(s) selected</div>
    <div class="text-xs text-slate-400 mb-2">${datesList}</div>
    <div class="text-sm text-indigo-300 font-semibold">${batchText}</div>
  `;
}

// Update batch for all selected dates when batch changes
document.querySelectorAll('input[name="batch-time"]').forEach(radio => {
  radio.addEventListener('change', function() {
    const batch = parseInt(this.value);
    selectedDates.forEach((value, key) => {
      selectedDates.set(key, batch);
    });
    updateSelectedDaysSummary();
    
    // Update visual feedback
    document.querySelectorAll('.batch-option').forEach(option => {
      option.classList.remove('selected');
    });
    this.closest('.batch-option').classList.add('selected');
  });
});

// Month navigation
document.getElementById('prevMonth').addEventListener('click', () => {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
  renderCalendar();
});

document.getElementById('nextMonth').addEventListener('click', () => {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
  renderCalendar();
});

// Cart Management Functions
function updateCartBadge() {
  const badge = document.getElementById('cartBadge');
  const totalItems = cart.reduce((sum, item) => sum + item.days.length, 0);
  
  if (totalItems > 0) {
    badge.textContent = totalItems;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function saveCart() {
  localStorage.setItem('messmate_cart', JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(meal, selectedDays) {
  const existingIndex = cart.findIndex(item => item.mealId === meal._id);
  
  if (existingIndex >= 0) {
    const existing = cart[existingIndex];
    selectedDays.forEach(newDay => {
      const dayExists = existing.days.find(d => d.date === newDay.date);
      if (!dayExists) {
        existing.days.push(newDay);
      } else {
        dayExists.batch = newDay.batch;
      }
    });
  } else {
    cart.push({
      mealId: meal._id,
      mealName: meal.name,
      price: meal.price,
      image: meal.image,
      days: selectedDays
    });
  }
  
  saveCart();
  showToast('Added to cart successfully!', 'success');
}

function removeFromCart(mealId, date = null) {
  if (date) {
    const item = cart.find(item => item.mealId === mealId);
    if (item) {
      item.days = item.days.filter(d => d.date !== date);
      if (item.days.length === 0) {
        cart = cart.filter(item => item.mealId !== mealId);
      }
    }
  } else {
    cart = cart.filter(item => item.mealId !== mealId);
  }
  
  saveCart();
  renderCart();
  showToast('Removed from cart', 'info');
}

function clearCart() {
  cart = [];
  saveCart();
  renderCart();
}

function renderCart() {
  const cartContent = document.getElementById('cartContent');
  const cartTotal = document.getElementById('cartTotal');
  
  if (cart.length === 0) {
    cartContent.innerHTML = `
      <div class="text-center py-16 text-slate-400">
        <i class="fas fa-shopping-cart text-6xl mb-4 opacity-50"></i>
        <p class="text-xl">Your cart is empty</p>
        <p class="text-sm mt-2">Add some delicious meals to get started!</p>
      </div>
    `;
    cartTotal.textContent = '₹0';
    return;
  }
  
  let total = 0;
  
  cartContent.innerHTML = cart.map(item => {
    const itemTotal = item.price * item.days.length;
    total += itemTotal;
    
    return `
      <div class="bg-slate-700/40 p-6 rounded-xl border border-slate-600/50">
        <div class="flex gap-4">
          ${item.image ? `
            <img src="${item.image}" class="w-24 h-24 rounded-lg object-cover" alt="${item.mealName}" onerror="this.src='https://via.placeholder.com/96/667eea/ffffff?text=Meal'">
          ` : `
            <div class="w-24 h-24 rounded-lg bg-gradient-to-br from-indigo-900 to-purple-900 flex items-center justify-center">
              <i class="fas fa-utensils text-3xl text-indigo-300 opacity-50"></i>
            </div>
          `}
          
          <div class="flex-1">
            <h4 class="text-xl font-bold text-white mb-2">${item.mealName}</h4>
            <p class="text-emerald-400 font-bold mb-3">₹${item.price} per meal</p>
            
            <div class="space-y-2">
              <p class="text-sm text-slate-300 font-semibold mb-2">
                <i class="fas fa-calendar-check mr-2"></i> Selected Dates:
              </p>
              <div class="flex flex-wrap gap-2">
                ${item.days.map(d => {
                  const date = new Date(d.date + 'T00:00:00');
                  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                  const batchTime = d.batch === 1 ? '12:30-1:00 PM' : '1:00-2:00 PM';
                  return `
                    <div class="bg-slate-600/50 px-3 py-1 rounded-lg text-sm flex items-center gap-2">
                      <span>${dateStr} (Batch ${d.batch}: ${batchTime})</span>
                      <button onclick="removeFromCart('${item.mealId}', '${d.date}')" class="text-red-400 hover:text-red-300 ml-1">
                        <i class="fas fa-times"></i>
                      </button>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
          
          <div class="text-right">
            <p class="text-sm text-slate-400 mb-2">Subtotal</p>
            <p class="text-2xl font-bold text-emerald-400">₹${itemTotal}</p>
            <p class="text-xs text-slate-400 mt-1">${item.days.length} meal(s)</p>
            <button onclick="removeFromCart('${item.mealId}')" class="mt-4 text-red-400 hover:text-red-300 text-sm">
              <i class="fas fa-trash mr-1"></i> Remove All
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  cartTotal.textContent = `₹${total}`;
}

function openAddToCartModal(meal) {
  currentSelectedMeal = meal;
  selectedDates.clear();
  currentCalendarDate = new Date();
  
  const mealInfo = document.getElementById('selectedMealInfo');
  mealInfo.innerHTML = `
    <div class="flex items-center gap-4">
      ${meal.image ? `
        <img src="${meal.image}" class="w-20 h-20 rounded-lg object-cover" alt="${meal.name}" onerror="this.src='https://via.placeholder.com/80/667eea/ffffff?text=Meal'">
      ` : `
        <div class="w-20 h-20 rounded-lg bg-gradient-to-br from-indigo-900 to-purple-900 flex items-center justify-center">
          <i class="fas fa-utensils text-2xl text-indigo-300 opacity-50"></i>
        </div>
      `}
      <div>
        <h4 class="text-xl font-bold text-white">${meal.name}</h4>
        <p class="text-emerald-400 font-bold">₹${meal.price} per meal</p>
      </div>
    </div>
  `;
  
  // Pre-select dates if item is already in cart
  const existingCartItem = cart.find(item => item.mealId === meal._id);
  if (existingCartItem) {
    existingCartItem.days.forEach(dayInfo => {
      selectedDates.set(dayInfo.date, dayInfo.batch);
    });
    
    // Set batch radio
    if (existingCartItem.days.length > 0) {
      const batch = existingCartItem.days[0].batch;
      const radio = document.querySelector(`input[name="batch-time"][value="${batch}"]`);
      if (radio) {
        radio.checked = true;
        radio.closest('.batch-option').classList.add('selected');
      }
    }
  }
  
  renderCalendar();
  document.getElementById('batchSelectionContainer').classList.add('hidden');
  document.getElementById('addToCartModal').classList.remove('hidden');
}

document.getElementById('addSelectedToCart').addEventListener('click', () => {
  if (!currentSelectedMeal) return;
  
  if (selectedDates.size === 0) {
    showToast('Please select at least one date', 'error');
    return;
  }
  
  const selectedBatch = document.querySelector('input[name="batch-time"]:checked');
  if (!selectedBatch) {
    showToast('Please select a batch time', 'error');
    return;
  }
  
  const selectedDays = Array.from(selectedDates.entries()).map(([date, batch]) => ({
    date: date,
    batch: parseInt(selectedBatch.value)
  }));
  
  addToCart(currentSelectedMeal, selectedDays);
  document.getElementById('addToCartModal').classList.add('hidden');
  currentSelectedMeal = null;
  selectedDates.clear();
});

document.getElementById('cancelAddToCart').addEventListener('click', () => {
  document.getElementById('addToCartModal').classList.add('hidden');
  currentSelectedMeal = null;
  selectedDates.clear();
});

document.getElementById('closeAddToCart').addEventListener('click', () => {
  document.getElementById('addToCartModal').classList.add('hidden');
  currentSelectedMeal = null;
  selectedDates.clear();
});

document.getElementById('cartBtn').addEventListener('click', () => {
  renderCart();
  document.getElementById('cartModal').classList.remove('hidden');
});

document.getElementById('closeCart').addEventListener('click', () => {
  document.getElementById('cartModal').classList.add('hidden');
});

document.getElementById('proceedToCheckout').addEventListener('click', async () => {
  if (cart.length === 0) {
    showToast('Your cart is empty', 'error');
    return;
  }
  
  const orders = [];
  cart.forEach(item => {
    item.days.forEach(dayInfo => {
      orders.push({
        mealId: item.mealId,
        mealName: item.mealName,
        price: item.price,
        date: dayInfo.date,
        batch: dayInfo.batch
      });
    });
  });
  
  const btn = document.getElementById('proceedToCheckout');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Processing...';
  
  try {
    const response = await fetch('/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: userEmail,
        orders: orders
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      const today = new Date().toISOString().split('T')[0];
      
      // Show success message with token info
      const todayTokens = data.tokens.filter(t => t.date === today);
      const futureTokens = data.tokens.filter(t => t.date !== today);
      
      let message = '';
      if (todayTokens.length > 0) {
        message = `✓ Today's token(s): ${todayTokens.map(t => '#' + t.token).join(', ')}`;
        if (futureTokens.length > 0) {
          message += `\n${futureTokens.length} future order(s) scheduled`;
        }
      } else {
        message = `✓ ${futureTokens.length} order(s) scheduled`;
      }
      
      clearCart();
      document.getElementById('cartModal').classList.add('hidden');
      showToast(message, 'success');
      loadOrders();
      await loadUserTokens(); // Reload tokens immediately
    } else {
      showToast(data.error || 'Checkout failed', 'error');
    }
  } catch (err) {
    console.error('Checkout error:', err);
    showToast('Error during checkout. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-credit-card mr-2"></i> Proceed to Checkout';
  }
});

// Token Management
async function loadUserTokens() {
  try {
    const res = await fetch(`/user-tokens/${userEmail}`);
    const data = await res.json();
    
    if (data.success) {
      userTokens = data.tokens || [];
      console.log('✅ Loaded tokens:', userTokens.length);
    }
  } catch (err) {
    console.error('Error loading tokens:', err);
  }
}

document.getElementById('myTokensBtn').addEventListener('click', async () => {
  await loadUserTokens();
  renderTokensList();
  document.getElementById('myTokensModal').classList.remove('hidden');
});

document.getElementById('closeMyTokens').addEventListener('click', () => {
  document.getElementById('myTokensModal').classList.add('hidden');
});

function renderTokensList() {
  const tokensList = document.getElementById('tokensList');
  
  if (userTokens.length === 0) {
    tokensList.innerHTML = `
      <div class="text-center py-16 text-slate-400">
        <i class="fas fa-ticket-alt text-6xl mb-4 opacity-50"></i>
        <p class="text-xl">No tokens yet</p>
        <p class="text-sm mt-2">Order some meals to generate tokens!</p>
      </div>
    `;
    return;
  }
  
  // Group tokens by date
  const tokensByDate = {};
  userTokens.forEach(token => {
    if (!tokensByDate[token.date]) {
      tokensByDate[token.date] = [];
    }
    tokensByDate[token.date].push(token);
  });
  
  const sortedDates = Object.keys(tokensByDate).sort((a, b) => new Date(b) - new Date(a));
  
  tokensList.innerHTML = sortedDates.map(date => {
    const tokens = tokensByDate[date];
    const dateObj = new Date(date + 'T00:00:00');
    const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const isPast = dateObj < new Date(new Date().toDateString());
    const isToday = date === new Date().toISOString().split('T')[0];
    
    return `
      <div class="bg-slate-700/40 p-6 rounded-xl border border-slate-600/50">
        <h4 class="text-xl font-bold mb-4 text-indigo-200">
          <i class="fas fa-calendar-day mr-2"></i> ${dateStr}
          ${isPast ? '<span class="text-xs text-slate-400 ml-2">(Past)</span>' : ''}
          ${isToday ? '<span class="text-xs text-emerald-400 ml-2">(Today)</span>' : ''}
        </h4>
        <div class="space-y-3">
          ${tokens.map(token => `
            <div class="token-item flex justify-between items-center">
              <div class="flex-1">
                <div class="flex items-center gap-4 mb-2">
                  <div class="text-3xl font-bold text-emerald-400">Token #${token.token}</div>
                  <span class="text-sm px-3 py-1 rounded-full ${token.verified ? 'bg-green-600/30 text-green-300' : 'bg-yellow-600/30 text-yellow-300'}">
                    ${token.verified ? '✓ Verified' : '⏳ Pending'}
                  </span>
                </div>
                <div class="text-sm text-slate-300">
                  Batch ${token.batch}: ${token.batch === 1 ? '12:30-1:00 PM' : '1:00-2:00 PM'}
                </div>
                <div class="text-xs text-slate-400 mt-2">
                  ${token.meals.map(m => `${m.name} (Qty: ${m.quantity})`).join(', ')}
                </div>
              </div>
              <div class="text-right">
                <div class="text-2xl font-bold text-emerald-400 mb-2">₹${token.totalAmount}</div>
                ${!token.verified && !isPast && isToday ? `
                  <button onclick="editToken('${token._id}')" class="text-sm bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded-lg transition">
                    <i class="fas fa-edit mr-1"></i> Edit
                  </button>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

async function editToken(tokenId) {
  try {
    const res = await fetch(`/token-details/${tokenId}`);
    const data = await res.json();
    
    if (!data.success) {
      showToast('Failed to load token details', 'error');
      return;
    }
    
    const token = data.token;
    currentEditingToken = token;
    
    const editContent = document.getElementById('editTokenContent');
    editContent.innerHTML = `
      <div class="bg-indigo-900/30 border border-indigo-700/50 rounded-xl p-4 mb-6">
        <div class="text-2xl font-bold text-center mb-2">Token #${token.token}</div>
        <div class="text-center text-sm text-slate-300">
          ${new Date(token.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <div class="text-center text-xs text-slate-400 mt-1">
          Batch ${token.batch}: ${token.batch === 1 ? '12:30-1:00 PM' : '1:00-2:00 PM'}
        </div>
      </div>
      
      <div class="space-y-4" id="tokenMealsEdit">
        ${token.meals.map((meal, index) => `
          <div class="bg-slate-700/40 p-4 rounded-xl flex justify-between items-center">
            <div>
              <div class="font-bold text-lg">${meal.name}</div>
              <div class="text-sm text-slate-400">₹${meal.price} per meal</div>
            </div>
            <div class="flex items-center gap-4">
              <div class="flex items-center gap-2">
                <button onclick="decreaseQuantity(${index})" class="bg-red-600/70 hover:bg-red-600 w-8 h-8 rounded-lg">
                  <i class="fas fa-minus"></i>
                </button>
                <span class="text-xl font-bold w-12 text-center" id="qty-${index}">${meal.quantity}</span>
                <button onclick="increaseQuantity(${index})" class="bg-green-600/70 hover:bg-green-600 w-8 h-8 rounded-lg">
                  <i class="fas fa-plus"></i>
                </button>
              </div>
              <button onclick="removeMeal(${index})" class="text-red-400 hover:text-red-300">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
      
      <div class="mt-6 bg-slate-700/40 p-4 rounded-xl">
        <div class="flex justify-between items-center text-xl font-bold">
          <span>Total Amount:</span>
          <span id="editTokenTotal" class="text-emerald-400">₹${token.totalAmount}</span>
        </div>
      </div>
    `;
    
    document.getElementById('myTokensModal').classList.add('hidden');
    document.getElementById('editTokenModal').classList.remove('hidden');
  } catch (err) {
    console.error('Error editing token:', err);
    showToast('Failed to load token for editing', 'error');
  }
}

let currentEditingToken = null;

window.increaseQuantity = function(index) {
  currentEditingToken.meals[index].quantity++;
  updateEditTokenDisplay();
};

window.decreaseQuantity = function(index) {
  if (currentEditingToken.meals[index].quantity > 1) {
    currentEditingToken.meals[index].quantity--;
    updateEditTokenDisplay();
  }
};

window.removeMeal = function(index) {
  if (currentEditingToken.meals.length === 1) {
    showToast('Cannot remove all meals. Delete the token instead.', 'error');
    return;
  }
  currentEditingToken.meals.splice(index, 1);
  editToken(currentEditingToken._id); // Re-render
};

function updateEditTokenDisplay() {
  currentEditingToken.meals.forEach((meal, index) => {
    const qtyElement = document.getElementById(`qty-${index}`);
    if (qtyElement) {
      qtyElement.textContent = meal.quantity;
    }
  });
  
  const total = currentEditingToken.meals.reduce((sum, meal) => sum + (meal.price * meal.quantity), 0);
  document.getElementById('editTokenTotal').textContent = `₹${total}`;
}

document.getElementById('saveTokenChanges').addEventListener('click', async () => {
  if (!currentEditingToken) return;
  
  const btn = document.getElementById('saveTokenChanges');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';
  
  try {
    const response = await fetch(`/update-token/${currentEditingToken._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meals: currentEditingToken.meals
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      showToast('Token updated successfully!', 'success');
      document.getElementById('editTokenModal').classList.add('hidden');
      document.getElementById('myTokensModal').classList.remove('hidden');
      await loadUserTokens();
      renderTokensList();
    } else {
      showToast(data.error || 'Failed to update token', 'error');
    }
  } catch (err) {
    console.error('Error updating token:', err);
    showToast('Error updating token', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save mr-2"></i> Save Changes';
  }
});

document.getElementById('cancelEditToken').addEventListener('click', () => {
  document.getElementById('editTokenModal').classList.add('hidden');
  document.getElementById('myTokensModal').classList.remove('hidden');
  currentEditingToken = null;
});

document.getElementById('closeEditToken').addEventListener('click', () => {
  document.getElementById('editTokenModal').classList.add('hidden');
  document.getElementById('myTokensModal').classList.remove('hidden');
  currentEditingToken = null;
});

window.editToken = editToken;

// FIXED: Token Button - Show today's token properly
document.getElementById('tokenBtn').addEventListener('click', async () => {
  const today = new Date().toISOString().split('T')[0];
  
  console.log('🔍 Looking for today\'s token. Today:', today);
  
  // Load latest tokens
  await loadUserTokens();
  
  console.log('📋 All user tokens:', userTokens);
  
  // Find today's tokens - FIXED: proper date comparison
  const todayTokens = userTokens.filter(t => {
    console.log(`Comparing token date "${t.date}" with today "${today}"`);
    return t.date === today;
  });
  
  console.log('✅ Today\'s tokens found:', todayTokens);
  
  if (todayTokens.length === 0) {
    showToast('❌ No token for today. Please place an order first!', 'error');
    return;
  }
  
  // Show the first token (or you can show all tokens)
  const activeToken = todayTokens[0];
  
  console.log('🎫 Displaying token:', activeToken);
  
  // Display token
  document.getElementById('modalTokenNumber').textContent = activeToken.token;
  document.getElementById('modalTokenName').textContent = userName || userEmail;
  document.getElementById('modalTokenPhoto').src = profilePhoto || 'https://via.placeholder.com/120/667eea/ffffff?text=User';

  const mealsHtml = activeToken.meals.map(m => 
    `<li class="bg-white/5 p-2 rounded flex justify-between">
      <span>${m.name}</span>
      <span class="font-bold">Qty: ${m.quantity} × ₹${m.price}</span>
    </li>`
  ).join('');
  
  document.getElementById('modalMealsItems').innerHTML = mealsHtml;
  document.getElementById('modalMealsList').classList.remove('hidden');
  document.getElementById('tokenModal').classList.remove('hidden');
});

document.getElementById('closeTokenModal').addEventListener('click', () => {
  document.getElementById('tokenModal').classList.add('hidden');
});

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const bgColor = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
  const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-triangle' : 'fa-info-circle';
  
  toast.className = `fixed top-4 right-4 ${bgColor} text-white px-6 py-4 rounded-xl shadow-lg z-50 flex items-center gap-3 whitespace-pre-line`;
  toast.innerHTML = `
    <i class="fas ${icon}"></i>
    <span>${message}</span>
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transform', 'translate-x-full', 'transition-all', 'duration-300');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

async function checkProfile() {
  const res = await fetch(`/user/${userEmail}`);
  const data = await res.json();
  if (data.success) {
    profileComplete = data.profileComplete;
    profilePhoto = data.profilePhoto;
    const currentName = data.name || userName;
    
    localStorage.setItem('messmate_profile_complete', profileComplete);
    localStorage.setItem('messmate_profile_photo', profilePhoto || '');
    localStorage.setItem('messmate_user_name', currentName);
    
    document.getElementById('editProfilePreview').src = profilePhoto || 'https://via.placeholder.com/120/667eea/ffffff?text=User';
    document.getElementById('modalTokenPhoto').src = profilePhoto || 'https://via.placeholder.com/120/667eea/ffffff?text=User';
    document.getElementById('currentProfileName').textContent = currentName;
    document.getElementById('welcome').textContent = `Welcome, ${currentName}`;
    
    const avatar = document.getElementById('initialsAvatar');
    avatar.textContent = currentName.charAt(0).toUpperCase();

    if (!profileComplete) {
      document.getElementById('profileSetupModal').classList.remove('hidden');
      document.getElementById('mainContent').style.display = 'none';
      document.getElementById('cancelSetup').classList.add('hidden');
      document.getElementById('nameInput').disabled = false;
    } else {
      document.getElementById('mainContent').style.display = 'block';
      document.getElementById('nameInput').value = currentName;
      document.getElementById('nameInput').disabled = true;
      document.getElementById('nameInput').classList.add('opacity-50', 'cursor-not-allowed');
    }
  }
}

document.getElementById('startCamera').onclick = async () => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ 
      video: { aspectRatio: 1, facingMode: 'user' } 
    });
    const video = document.getElementById('cameraStream');
    video.srcObject = cameraStream;
    document.getElementById('cameraContainer').style.display = 'block';
    document.getElementById('previewPhoto').style.display = 'none';
    document.getElementById('startCamera').classList.add('hidden');
    document.getElementById('capturePhoto').classList.remove('hidden');
  } catch (err) {
    alert("Camera access denied or not available.");
    console.error(err);
  }
};

document.getElementById('capturePhoto').onclick = () => {
  const video = document.getElementById('cameraStream');
  const canvas = document.createElement('canvas');
  const size = Math.min(video.videoWidth, video.videoHeight);
  canvas.width = size;
  canvas.height = size;
  
  const startX = (video.videoWidth - size) / 2;
  const startY = (video.videoHeight - size) / 2;
  canvas.getContext('2d').drawImage(video, startX, startY, size, size, 0, 0, size, size);
  
  const dataUrl = canvas.toDataURL('image/jpeg');
  document.getElementById('previewPhoto').src = dataUrl;
  document.getElementById('previewPhoto').style.display = 'block';
  document.getElementById('cameraContainer').style.display = 'none';
  
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }
  
  document.getElementById('startCamera').classList.remove('hidden');
  document.getElementById('capturePhoto').classList.add('hidden');
  
  canvas.toBlob(blob => {
    const file = new File([blob], "profile.jpg", { type: "image/jpeg" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    document.getElementById('photoInput').files = dataTransfer.files;
  });
};

document.getElementById('photoInput').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('previewPhoto').src = e.target.result;
      document.getElementById('previewPhoto').style.display = 'block';
      document.getElementById('cameraContainer').style.display = 'none';
    }
    reader.readAsDataURL(file);
  }
});

document.getElementById('triggerEdit').onclick = () => {
  document.getElementById('profileModal').classList.add('hidden');
  document.getElementById('profileSetupModal').classList.remove('hidden');
  document.getElementById('cancelSetup').classList.remove('hidden');
  document.getElementById('previewPhoto').src = document.getElementById('editProfilePreview').src;
};

document.getElementById('cancelSetup').onclick = () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
  }
  document.getElementById('profileSetupModal').classList.add('hidden');
  document.getElementById('profileModal').classList.remove('hidden');
};

document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  const name = document.getElementById('nameInput').value.trim();
  const photo = document.getElementById('photoInput').files[0];
  
  if (!name) {
    alert('Please enter your name');
    return;
  }
  
  if (!profileComplete && !photo) {
    alert('Please select or capture a photo');
    return;
  }

  const formData = new FormData();
  formData.append('email', userEmail);
  if (photo) {
    formData.append('profilePhoto', photo);
  }

  const btn = document.getElementById('saveProfileBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';

  try {
    const res = await fetch('/complete-profile', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem('messmate_user_name', name);
      localStorage.setItem('messmate_profile_complete', 'true');
      localStorage.setItem('messmate_profile_photo', data.profilePhoto);
      profileComplete = true;
      profilePhoto = data.profilePhoto;
      
      document.getElementById('profileSetupModal').classList.add('hidden');
      document.getElementById('mainContent').style.display = 'block';
      location.reload();
    } else {
      alert(data.error || 'Failed to save profile');
    }
  } catch (err) {
    alert('Error saving profile');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-check mr-2"></i> Save & Continue';
  }
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/';
});

document.getElementById('profileBtn').addEventListener('click', () => {
  updateProfileModal();
  document.getElementById('profileModal').classList.remove('hidden');
});

document.getElementById('closeProfile').addEventListener('click', () => {
  document.getElementById('profileModal').classList.add('hidden');
  destroyCharts();
});

async function loadMeals() {
  const res = await fetch('/meals');
  const meals = await res.json();
  const container = document.getElementById('meals');
  
  container.innerHTML = meals.map(m => `
    <div class="meal-card bg-slate-800/40 rounded-2xl overflow-hidden border border-slate-700/30 shadow-xl">
      ${m.image ? `
        <div class="h-48 overflow-hidden">
          <img src="${m.image}" class="w-full h-full object-cover" alt="${m.name}" onerror="this.src='https://via.placeholder.com/400x300/667eea/ffffff?text=No+Image'">
        </div>
      ` : `
        <div class="h-48 bg-gradient-to-br from-indigo-900 to-purple-900 flex items-center justify-center">
          <i class="fas fa-utensils text-6xl text-indigo-300 opacity-50"></i>
        </div>
      `}
      
      <div class="p-6">
        <h3 class="text-2xl font-bold mb-2">${m.name}</h3>
        <p class="text-3xl font-bold text-emerald-400 mb-3">₹${m.price}</p>
        ${m.description ? `<p class="text-slate-300 text-sm mb-4 line-clamp-3">${m.description}</p>` : ''}
        
        <div class="flex items-center gap-2 mb-4">
          <div class="flex gap-1">
            ${[1,2,3,4,5].map(i => `<span class="text-lg ${i <= Math.round(m.avgRating) ? 'text-yellow-400' : 'text-gray-600'}">★</span>`).join('')}
          </div>
          <span class="text-xs text-slate-400">${m.avgRating.toFixed(1)} (${m.totalRatings})</span>
        </div>
        
        <button onclick='openAddToCartModal(${JSON.stringify(m).replace(/'/g, "&#39;")})' class="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 px-6 py-3 rounded-xl font-semibold transition-all duration-300 hover:scale-105 shadow-lg">
          <i class="fas fa-cart-plus mr-2"></i> Add to Cart
        </button>
      </div>
    </div>
  `).join('');
}

async function loadOrders() {
  const res = await fetch(`/orders/${userEmail}`);
  const data = await res.json();
  if (data.success) {
    userOrders = data.orders || [];
    const todayStr = new Date().toISOString().split('T')[0];
    const todayUnpaid = userOrders.filter(o => {
      const orderDate = new Date(o.date).toISOString().split('T')[0];
      return orderDate === todayStr && !o.paid;
    });

    let html = '';

    html += userOrders.map(o => {
      const orderDate = new Date(o.date);
      const dateStr = o.orderDate || orderDate.toISOString().split('T')[0];
      const displayDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      
      return `
        <div class="bg-slate-700/40 p-6 rounded-xl mb-4">
          <div class="flex justify-between">
            <div>
              <p class="font-bold text-xl">${o.mealName}</p>
              <p class="text-sm text-slate-300">${displayDate}</p>
              ${o.batch ? `<p class="text-xs text-indigo-300 mt-1">Batch ${o.batch}: ${o.batch === 1 ? '12:30-1:00 PM' : '1:00-2:00 PM'}</p>` : ''}
              ${o.token ? `<p class="text-xs text-emerald-300 mt-1">Token: #${o.token}</p>` : ''}
              <span class="text-${o.paid ? 'emerald' : 'red'}-400 text-sm">${o.paid ? 'Paid' : 'Unpaid'}</span>
            </div>
            <p class="text-xl font-bold text-emerald-400">₹${o.price}</p>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('orders').innerHTML = html || '<p class="text-center text-slate-400">No orders yet</p>';
  }
}

function updateProfileModal() {
  const todayStr = new Date().toISOString().split('T')[0];
  const todayUnpaid = userOrders.filter(o => {
    const orderDate = new Date(o.date).toISOString().split('T')[0];
    return orderDate === todayStr && !o.paid;
  });
  document.getElementById('unpaidCount').textContent = todayUnpaid.length;
  document.getElementById('score').textContent = -todayUnpaid.length;

  const profileOrdersEl = document.getElementById('profileOrders');
  profileOrdersEl.innerHTML = userOrders.length > 0 ? userOrders.map(o => {
    const orderDate = new Date(o.date);
    const dateStr = o.orderDate || orderDate.toISOString().split('T')[0];
    const displayDate = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    return `
      <div class="bg-slate-700/40 p-4 rounded-xl">
        <div class="flex justify-between">
          <div>
            <p class="font-bold">${o.mealName}</p>
            <p class="text-sm text-slate-300">${displayDate}</p>
            ${o.batch ? `<p class="text-xs text-indigo-300">Batch ${o.batch}: ${o.batch === 1 ? '12:30-1:00 PM' : '1:00-2:00 PM'}</p>` : ''}
          </div>
          <p class="font-bold text-emerald-400">₹${o.price}</p>
        </div>
      </div>
    `;
  }).join('') : '<p class="text-center text-slate-400">No orders yet</p>';

  updateSpendingChart();
  updateFoodChart();
}

function destroyCharts() {
  if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
  if (foodChart) { foodChart.destroy(); foodChart = null; }
}

function updateSpendingChart() {
  const period = document.getElementById('periodSelect').value;
  const now = new Date();
  let startDate;
  
  switch (period) {
    case 'day': startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case 'week': startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); break;
    case 'month': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'year': startDate = new Date(now.getFullYear(), 0, 1); break;
  }

  const filtered = userOrders.filter(o => new Date(o.date) >= startDate);
  const total = filtered.reduce((s, o) => s + o.price, 0);
  document.getElementById('totalSpent').textContent = `₹${total}`;

  const grouped = {};
  filtered.forEach(o => {
    const d = new Date(o.date);
    let key;
    switch (period) {
      case 'day': key = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); break;
      case 'week': key = d.toLocaleDateString('en-US', { weekday: 'short' }); break;
      case 'month': key = d.getDate(); break;
      case 'year': key = d.toLocaleString('default', { month: 'short' }); break;
    }
    grouped[key] = (grouped[key] || 0) + o.price;
  });

  const labels = Object.keys(grouped);
  const data = labels.map(l => grouped[l]);

  const ctx = document.getElementById('spendingChart').getContext('2d');
  if (spendingChart) spendingChart.destroy();
  
  spendingChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Spending (₹)',
        data,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        tension: 0.4,
        fill: true,
        borderWidth: 3,
        pointRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { 
          labels: { color: 'white' } 
        } 
      },
      scales: {
        y: { 
          beginAtZero: true,
          ticks: { color: 'white' }, 
          grid: { color: 'rgba(255,255,255,0.1)' } 
        },
        x: { 
          ticks: { color: 'white' }, 
          grid: { color: 'rgba(255,255,255,0.1)' } 
        }
      }
    }
  });
}

function updateFoodChart() {
  const period = document.getElementById('periodSelect').value;
  const now = new Date();
  let startDate;
  
  switch (period) {
    case 'day': startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
    case 'week': startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); break;
    case 'month': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
    case 'year': startDate = new Date(now.getFullYear(), 0, 1); break;
  }

  const filtered = userOrders.filter(o => new Date(o.date) >= startDate);
  const counts = {};
  filtered.forEach(o => counts[o.mealName] = (counts[o.mealName] || 0) + 1);

  const labels = Object.keys(counts);
  const data = labels.map(l => counts[l]);

  const ctx = document.getElementById('foodChart').getContext('2d');
  if (foodChart) foodChart.destroy();
  
  foodChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Orders',
        data,
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: '#22c55e',
        borderWidth: 2,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { 
          labels: { color: 'white' } 
        } 
      },
      scales: {
        y: { 
          beginAtZero: true,
          ticks: { color: 'white' }, 
          grid: { color: 'rgba(255,255,255,0.1)' } 
        },
        x: { 
          ticks: { color: 'white' }, 
          grid: { color: 'rgba(255,255,255,0.1)' } 
        }
      }
    }
  });
}

document.getElementById('periodSelect').addEventListener('change', () => {
  updateSpendingChart();
  updateFoodChart();
});

window.openAddToCartModal = openAddToCartModal;
window.removeFromCart = removeFromCart;

checkProfile();
loadMeals();
loadOrders();
loadUserTokens();
updateCartBadge();

// ============================================================================
// PUSH NOTIFICATION REGISTRATION
// ============================================================================

if ('serviceWorker' in navigator && 'PushManager' in window) {
  console.log('✅ Push notifications supported');
  initializePushNotifications();
}

async function initializePushNotifications() {
  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    console.log('✅ Service worker ready');
    
    if (Notification.permission === 'default') {
      setTimeout(() => showNotificationPrompt(), 2000);
    } else if (Notification.permission === 'granted') {
      await subscribeToPushNotifications(registration);
    }
  } catch (error) {
    console.error('❌ Push init error:', error);
  }
}

function showNotificationPrompt() {
  const promptDiv = document.createElement('div');
  promptDiv.className = 'fixed bottom-4 right-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white p-6 rounded-2xl shadow-2xl z-50 max-w-md animate-slide-in';
  promptDiv.innerHTML = `
    <div class="flex items-start gap-4">
      <div class="text-3xl">🔔</div>
      <div class="flex-1">
        <h3 class="font-bold text-lg mb-2">Stay Updated!</h3>
        <p class="text-sm mb-4">Enable notifications to receive meal reminders & order updates.</p>
        <div class="flex gap-3">
          <button id="enable-notifications" class="bg-white text-indigo-600 px-4 py-2 rounded-lg font-semibold hover:bg-indigo-50">
            Enable
          </button>
          <button id="dismiss-prompt" class="bg-white/10 px-4 py-2 rounded-lg hover:bg-white/20">
            Later
          </button>
        </div>
      </div>
      <button id="close-prompt" class="text-white/80 hover:text-white text-xl">×</button>
    </div>
  `;
  
  document.body.appendChild(promptDiv);
  
  document.getElementById('enable-notifications').addEventListener('click', async () => {
    promptDiv.remove();
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showToast('Notifications enabled!', 'success');
      const registration = await navigator.serviceWorker.ready;
      await subscribeToPushNotifications(registration);
    }
  });
  
  document.getElementById('dismiss-prompt').addEventListener('click', () => promptDiv.remove());
  document.getElementById('close-prompt').addEventListener('click', () => promptDiv.remove());
}

async function subscribeToPushNotifications(registration) {
  try {
    const vapidResponse = await fetch('/vapid-public-key');
    const { publicKey } = await vapidResponse.json();
    
    let subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    
    const response = await fetch('/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, subscription: subscription.toJSON() })
    });
    
    const result = await response.json();
    if (result.success) {
      console.log('✅ Subscription saved');
      localStorage.setItem('push-subscription-active', 'true');
    }
  } catch (error) {
    console.error('❌ Subscribe error:', error);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slide-in {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  .animate-slide-in { animation: slide-in 0.3s ease-out; }
`;
document.head.appendChild(style);

console.log('✅ MessMate dashboard loaded with FIXED token display logic');
