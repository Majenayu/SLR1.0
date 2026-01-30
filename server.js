// server.js - Fixed version with proper token generation for TODAY vs FUTURE dates
const express = require("express");
require("dotenv").config();
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const path = require("path");
const cors = require("cors");
const QRCode = require('qrcode');
const crypto = require('crypto');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { OAuth2Client } = require('google-auth-library');
const webpush = require('web-push');
const cron = require('node-cron');

const app = express();
app.use(bodyParser.json());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL || 'https://slr1-0.onrender.com' : '*',
  credentials: true
}));
app.use(express.static(__dirname));

// Web Push Configuration
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BPN1TfUOyPUNLfnIu2nWTIjlQuAbHMp7et-zMlBhEYgYrXeqf7piiJD1um343wahAu2UZXptdnYgKrA6jjs8xw0';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '3bPYPaasTgVDSGJMc8wfSkseKG8TOkeAL7HtasubpJc';
const VAPID_MAILTO = process.env.VAPID_MAILTO || 'mailto:messmate@example.com';

webpush.setVapidDetails(
  VAPID_MAILTO,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "67430401790-jdomcgb5s0vcvsp6ln56j3g3aem2h26v.apps.googleusercontent.com";
const client = new OAuth2Client(CLIENT_ID);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dcd0vatd4',
  api_key: process.env.CLOUDINARY_API_KEY || '686887924855346',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'HcltpsGGsCldCyoBtuGMOpwv3iI'
});

const mealStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'messmate_meals',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }]
  }
});

const profileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'messmate_profiles',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }]
  }
});

const uploadMeal = multer({ storage: mealStorage });
const uploadProfile = multer({ storage: profileStorage });

const mongoURI = process.env.MONGODB_URI || "mongodb+srv://SLR:SLR@slr.eldww0q.mongodb.net/mess_db?retryWrites=true&w=majority&appName=SLR&serverSelectionTimeoutMS=10000&connectTimeoutMS=10000";

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000
}).then(async () => {
  console.log("✅ MongoDB Connected Successfully");
  
  // Drop the old problematic index if it exists
  try {
    await Token.collection.dropIndex('token_1');
    console.log("✅ Dropped old token index");
  } catch (err) {
    // Index might not exist, that's okay
  }
  
  initMeals();
  console.log("✅ Scheduled jobs initialized");
}).catch(err => {
  console.error("❌ MongoDB Connection Error:", err.message);
  process.exit(1);
});

// Updated User Schema with Push Subscription
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ["student", "producer"], default: "student" },
  profilePhoto: String,
  profilePhotoId: String,
  profileComplete: { type: Boolean, default: false },
  pushSubscription: {
    endpoint: String,
    keys: {
      p256dh: String,
      auth: String
    }
  },
  notificationPreferences: {
    dailyReminder: { type: Boolean, default: true },
    orderUpdates: { type: Boolean, default: true },
    paymentReminders: { type: Boolean, default: true }
  },
  lastNotificationSent: Date,
  orders: [{
    mealName: String,
    price: Number,
    date: { type: Date, default: Date.now },
    orderDate: String, // ISO date string for the actual order date
    paid: { type: Boolean, default: false },
    token: String,
    batch: Number
  }],
  verifiedToday: {
    date: String,
    verified: { type: Boolean, default: false },
    verifiedAt: Date,
    meals: [{
      name: String,
      quantity: Number,
      totalPrice: Number
    }]
  },
  ratings: {
    type: Map,
    of: Number,
    default: new Map()
  },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

const mealSchema = new mongoose.Schema({
  name: { type: String, unique: true },
  image: String,
  cloudinaryId: String,
  description: String,
  price: { type: Number, default: 0 },
  avgRating: { type: Number, default: 0 },
  totalRatings: { type: Number, default: 0 },
  ratings: [Number],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Meal = mongoose.model("Meal", mealSchema);

// FIXED Token Schema - Removed single token index
const tokenSchema = new mongoose.Schema({
  token: { type: String, required: true },
  date: { type: String, required: true }, // ISO date string (YYYY-MM-DD)
  userEmail: { type: String, required: true },
  userName: { type: String, required: true },
  userPhoto: String,
  batch: { type: Number, required: true }, // 1 or 2
  meals: [{
    name: String,
    quantity: Number,
    price: Number
  }],
  totalAmount: { type: Number, required: true },
  paid: { type: Boolean, default: true },
  verified: { type: Boolean, default: false },
  verifiedAt: Date,
  expiresAt: Date,
  createdAt: { type: Date, default: Date.now },
  paymentDetails: {
    mainAmount: Number,
    mainUPI: String,
    commissionAmount: Number,
    commissionUPI: String,
    transactionId: String,
    upiRef: String,
    paymentTime: Date
  }
});

// CRITICAL FIX: Compound unique index on token + date + batch
// This allows token "1" to exist for different dates and batches
tokenSchema.index({ token: 1, date: 1, batch: 1 }, { unique: true });

const Token = mongoose.model("Token", tokenSchema);

// Notification Log Schema
const notificationLogSchema = new mongoose.Schema({
  userEmail: String,
  type: { type: String, enum: ['daily_reminder', 'payment_reminder', 'order_update', 'producer_alert'] },
  title: String,
  message: String,
  sentAt: { type: Date, default: Date.now },
  success: Boolean,
  error: String,
  reason: String
});

const NotificationLog = mongoose.model("NotificationLog", notificationLogSchema);

// SSE connections
let sseClients = [];
let producerSSEClients = [];

// ==================== SCHEDULED TOKEN GENERATION ====================

// Run every day at 8:00 AM to generate tokens for today's orders
cron.schedule('0 8 * * *', async () => {
  console.log('🕐 Running scheduled token generation at 8:00 AM');
  await generateDailyTokens();
}, {
  timezone: "Asia/Kolkata"
});

async function generateDailyTokens() {
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`📅 Generating tokens for ${today}`);
    
    // Find all PENDING tokens for today
    const pendingTokens = await Token.find({ 
      date: today, 
      token: 'PENDING' 
    });
    
    if (pendingTokens.length === 0) {
      console.log('✅ No pending tokens to generate');
      return;
    }
    
    console.log(`📋 Found ${pendingTokens.length} pending tokens for today`);
    
    // Group by batch
    const batch1Tokens = pendingTokens.filter(t => t.batch === 1);
    const batch2Tokens = pendingTokens.filter(t => t.batch === 2);
    
    // Generate token numbers for batch 1
    for (let i = 0; i < batch1Tokens.length; i++) {
      batch1Tokens[i].token = (i + 1).toString();
      await batch1Tokens[i].save();
      
      // Update user's orders with new token number
      const user = await User.findOne({ email: batch1Tokens[i].userEmail });
      if (user) {
        user.orders.forEach(order => {
          if (order.orderDate === today && order.batch === 1 && order.token === 'PENDING') {
            order.token = batch1Tokens[i].token;
          }
        });
        await user.save();
        
        // Send notification
        await sendPushNotification(batch1Tokens[i].userEmail, {
          title: '🎫 Your Token is Ready!',
          body: `Token #${batch1Tokens[i].token} for Batch 1 (12:30-1:00 PM) is now active!`,
          type: 'order_update',
          reason: 'token_generated',
          data: { url: '/dashboard' }
        });
      }
    }
    
    // Generate token numbers for batch 2
    for (let i = 0; i < batch2Tokens.length; i++) {
      batch2Tokens[i].token = (i + 1).toString();
      await batch2Tokens[i].save();
      
      // Update user's orders with new token number
      const user = await User.findOne({ email: batch2Tokens[i].userEmail });
      if (user) {
        user.orders.forEach(order => {
          if (order.orderDate === today && order.batch === 2 && order.token === 'PENDING') {
            order.token = batch2Tokens[i].token;
          }
        });
        await user.save();
        
        // Send notification
        await sendPushNotification(batch2Tokens[i].userEmail, {
          title: '🎫 Your Token is Ready!',
          body: `Token #${batch2Tokens[i].token} for Batch 2 (1:00-2:00 PM) is now active!`,
          type: 'order_update',
          reason: 'token_generated',
          data: { url: '/dashboard' }
        });
      }
    }
    
    console.log(`✅ Generated ${batch1Tokens.length} tokens for Batch 1 and ${batch2Tokens.length} tokens for Batch 2`);
    
  } catch (err) {
    console.error('❌ Error generating daily tokens:', err);
  }
}

// ==================== PUSH NOTIFICATION FUNCTIONS ====================

// Save push subscription
app.post('/subscribe', async (req, res) => {
  try {
    const { email, subscription } = req.body;
    
    if (!email || !subscription) {
      return res.status(400).json({ success: false, error: 'Missing email or subscription' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.pushSubscription = subscription;
    await user.save();

    console.log(`✅ Push subscription saved for ${email}`);
    res.json({ success: true, message: 'Subscription saved successfully' });
  } catch (err) {
    console.error('Subscription error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get VAPID public key
app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Send push notification to a user
async function sendPushNotification(userEmail, payload) {
  try {
    const user = await User.findOne({ email: userEmail });
    
    if (!user || !user.pushSubscription) {
      console.log(`⚠️ No push subscription for ${userEmail}`);
      return { success: false, error: 'No subscription found' };
    }

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192x192.png',
      badge: payload.badge || '/badge-72x72.png',
      data: payload.data || {}
    });

    await webpush.sendNotification(user.pushSubscription, notificationPayload);
    
    await new NotificationLog({
      userEmail,
      type: payload.type || 'order_update',
      title: payload.title,
      message: payload.body,
      success: true,
      reason: payload.reason || 'manual'
    }).save();

    user.lastNotificationSent = new Date();
    await user.save();

    console.log(`✅ Push notification sent to ${userEmail}: ${payload.title}`);
    return { success: true };
  } catch (err) {
    console.error(`❌ Push notification error for ${userEmail}:`, err.message);
    
    await new NotificationLog({
      userEmail,
      type: payload.type || 'order_update',
      title: payload.title,
      message: payload.body,
      success: false,
      error: err.message,
      reason: payload.reason || 'manual'
    }).save();

    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log(`🗑️ Removing invalid subscription for ${userEmail}`);
      const user = await User.findOne({ email: userEmail });
      if (user) {
        user.pushSubscription = null;
        await user.save();
      }
    }

    return { success: false, error: err.message };
  }
}

// ==================== NOTIFICATION ENDPOINTS ====================

// Get notification stats
app.get('/producer/notification-stats', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Get all students
    const allStudents = await User.find({ role: 'student' });
    const subscribedStudents = allStudents.filter(u => u.pushSubscription).length;
    
    // Get today's notifications
    const todayNotifications = await NotificationLog.find({
      sentAt: { $gte: new Date(today) }
    });
    
    // Calculate targeting
    let noOrderToday = 0;
    let notVerified = 0;
    let alreadyVerified = 0;
    
    for (const student of allStudents) {
      // Check if they have an order for today
      const todayOrder = student.orders.find(o => o.orderDate === today);
      
      if (!todayOrder) {
        noOrderToday++;
        continue;
      }
      
      // Check if verified
      if (student.verifiedToday && student.verifiedToday.date === today && student.verifiedToday.verified) {
        alreadyVerified++;
      } else {
        notVerified++;
      }
    }
    
    const willNotify = noOrderToday + notVerified;
    
    res.json({
      success: true,
      stats: {
        subscribedStudents,
        totalStudents: allStudents.length,
        notificationsToday: {
          successful: todayNotifications.filter(n => n.success).length,
          failed: todayNotifications.filter(n => !n.success).length
        },
        targeting: {
          noOrderToday,
          notVerified,
          alreadyVerified,
          willNotify
        }
      }
    });
  } catch (err) {
    console.error('Notification stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get recent notifications
app.get('/producer/recent-notifications', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const notifications = await NotificationLog.find()
      .sort({ sentAt: -1 })
      .limit(limit);
    
    res.json({ success: true, notifications });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send reminders
app.post('/producer/send-reminders', async (req, res) => {
  try {
    const { producerEmail, message } = req.body;
    const today = new Date().toISOString().split('T')[0];
    
    const students = await User.find({ role: 'student' });
    
    let successful = 0;
    let failed = 0;
    let skipped = 0;
    const breakdown = {
      noOrder: 0,
      notVerified: 0,
      alreadyVerified: 0
    };
    
    for (const student of students) {
      // Skip if no push subscription
      if (!student.pushSubscription) {
        skipped++;
        continue;
      }
      
      // Check if they have an order for today
      const todayOrder = student.orders.find(o => o.orderDate === today);
      
      let shouldNotify = false;
      let reason = '';
      let notificationTitle = '';
      let notificationBody = '';
      
      if (!todayOrder) {
        // No order for today - send reminder to order
        shouldNotify = true;
        reason = 'no_order_today';
        notificationTitle = '🍽️ Don\'t Forget to Order!';
        notificationBody = message || 'You haven\'t ordered your meal for today. Place your order now!';
        breakdown.noOrder++;
      } else {
        // Has order - check if verified
        if (student.verifiedToday && student.verifiedToday.date === today && student.verifiedToday.verified) {
          // Already verified - skip
          skipped++;
          breakdown.alreadyVerified++;
          continue;
        } else {
          // Not verified - send payment reminder
          shouldNotify = true;
          reason = 'not_verified';
          notificationTitle = '⏰ Payment Reminder';
          notificationBody = message || 'Please complete your payment and verify your token to collect your meal!';
          breakdown.notVerified++;
        }
      }
      
      if (shouldNotify) {
        const result = await sendPushNotification(student.email, {
          title: notificationTitle,
          body: notificationBody,
          type: 'daily_reminder',
          reason: reason,
          data: { url: '/dashboard' }
        });
        
        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      }
    }
    
    // Broadcast to producer SSE clients
    const sseData = {
      type: 'reminder_sent',
      results: {
        successful,
        failed,
        skipped,
        total: students.length,
        breakdown
      },
      timestamp: new Date()
    };
    
    producerSSEClients.forEach(client => {
      try {
        client.write(`data: ${JSON.stringify(sseData)}\n\n`);
      } catch (err) {
        console.error('SSE broadcast error:', err);
      }
    });
    
    res.json({
      success: true,
      results: {
        successful,
        failed,
        skipped,
        total: students.length,
        breakdown
      }
    });
  } catch (err) {
    console.error('Send reminders error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Producer SSE endpoint
app.get('/producer/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  producerSSEClients.push(res);
  console.log('Producer client connected to SSE');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    producerSSEClients = producerSSEClients.filter(client => client !== res);
    console.log('Producer client disconnected from SSE');
  });
});

// ==================== EXISTING ENDPOINTS ====================

// Initialize meals
async function initMeals() {
  const count = await Meal.countDocuments();
  if (count === 0) {
    const defaultMeals = [
      { name: "Paneer Butter Masala", price: 120, description: "Rich and creamy paneer curry" },
      { name: "Chole Bhature", price: 100, description: "Spicy chickpeas with fluffy fried bread" },
      { name: "Masala Dosa", price: 80, description: "Crispy rice crepe with potato filling" },
      { name: "Chicken Biryani", price: 150, description: "Fragrant rice with tender chicken" },
      { name: "Veg Thali", price: 110, description: "Complete vegetarian meal platter" }
    ];
    await Meal.insertMany(defaultMeals);
    console.log("✅ Default meals initialized");
  }
}

// Google OAuth
app.post("/auth/google", async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID
    });
    const payload = ticket.getPayload();
    const email = payload.email;

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        name: payload.name,
        email,
        role: "student",
        profileComplete: false
      });
      await user.save();
      console.log("✅ New user registered via Google:", email);
    }

    res.json({
      success: true,
      email,
      role: user.role,
      name: user.name,
      profileComplete: user.profileComplete
    });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Regular signup
app.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    if (!email || !password) {
      return res.json({ success: false, error: "Email and password required" });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.json({ success: false, error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      name: name || email.split('@')[0],
      email,
      password: hashedPassword,
      role: role || "student"
    });

    await user.save();
    console.log("✅ New user registered:", email);
    res.json({ success: true, email, role: user.role, name: user.name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !user.password) {
      return res.json({ success: false, error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.json({ success: false, error: "Invalid credentials" });
    }

    res.json({
      success: true,
      email: user.email,
      role: user.role,
      name: user.name,
      profileComplete: user.profileComplete
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get user profile
app.get("/user/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) {
      return res.json({ success: false, error: "User not found" });
    }
    res.json({
      success: true,
      name: user.name,
      email: user.email,
      role: user.role,
      profilePhoto: user.profilePhoto,
      profileComplete: user.profileComplete
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Complete profile
app.post("/complete-profile", uploadProfile.single('profilePhoto'), async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ success: false, error: "User not found" });
    }

    if (req.file) {
      if (user.profilePhotoId) {
        try {
          await cloudinary.uploader.destroy(user.profilePhotoId);
        } catch (err) {
          console.log("Failed to delete old photo:", err);
        }
      }
      user.profilePhoto = req.file.path;
      user.profilePhotoId = req.file.filename;
    }

    user.profileComplete = true;
    await user.save();

    res.json({
      success: true,
      profilePhoto: user.profilePhoto
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get meals
app.get("/meals", async (req, res) => {
  try {
    const meals = await Meal.find({});
    res.json(meals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add meal
app.post("/add-meal", uploadMeal.single('image'), async (req, res) => {
  try {
    const { name, price, description } = req.body;

    if (!name || !price) {
      return res.json({ success: false, error: "Name and price required" });
    }

    const exists = await Meal.findOne({ name });
    if (exists) {
      return res.json({ success: false, error: "Meal already exists" });
    }

    const meal = new Meal({
      name,
      price: Number(price),
      description,
      image: req.file ? req.file.path : null,
      cloudinaryId: req.file ? req.file.filename : null
    });

    await meal.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update meal
app.put("/update-meal/:id", uploadMeal.single('image'), async (req, res) => {
  try {
    const { name, price, description } = req.body;
    const meal = await Meal.findById(req.params.id);

    if (!meal) {
      return res.json({ success: false, error: "Meal not found" });
    }

    meal.name = name || meal.name;
    meal.price = price ? Number(price) : meal.price;
    meal.description = description !== undefined ? description : meal.description;
    meal.updatedAt = new Date();

    if (req.file) {
      if (meal.cloudinaryId) {
        try {
          await cloudinary.uploader.destroy(meal.cloudinaryId);
        } catch (err) {
          console.log("Failed to delete old image:", err);
        }
      }
      meal.image = req.file.path;
      meal.cloudinaryId = req.file.filename;
    }

    await meal.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete meal
app.delete("/delete-meal/:id", async (req, res) => {
  try {
    const meal = await Meal.findById(req.params.id);

    if (!meal) {
      return res.json({ success: false, error: "Meal not found" });
    }

    if (meal.cloudinaryId) {
      try {
        await cloudinary.uploader.destroy(meal.cloudinaryId);
      } catch (err) {
        console.log("Failed to delete image:", err);
      }
    }

    await Meal.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== CRITICAL FIX: CHECKOUT ENDPOINT ====================
// Enhanced Checkout (Calendar-Based) - FIXED: Generate actual tokens for TODAY, PENDING for future
app.post("/checkout", async (req, res) => {
  try {
    const { email, orders } = req.body;
    
    if (!email || !orders || orders.length === 0) {
      return res.json({ success: false, error: "Invalid checkout data" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: false, error: "User not found" });
    }

    // Group orders by date and batch
    const ordersByDateBatch = {};
    
    orders.forEach(order => {
      const key = `${order.date}_${order.batch}`;
      if (!ordersByDateBatch[key]) {
        ordersByDateBatch[key] = {
          date: order.date,
          batch: order.batch,
          meals: {}
        };
      }
      
      if (!ordersByDateBatch[key].meals[order.mealName]) {
        ordersByDateBatch[key].meals[order.mealName] = {
          quantity: 0,
          price: order.price
        };
      }
      ordersByDateBatch[key].meals[order.mealName].quantity++;
    });

    const tokens = [];
    const today = new Date().toISOString().split('T')[0];

    for (const key in ordersByDateBatch) {
      const { date, batch, meals } = ordersByDateBatch[key];
      
      // Check if order is for today or future
      const isToday = date === today;
      
      let tokenDoc = null;
      
      // Check if token already exists
      tokenDoc = await Token.findOne({ date, batch, userEmail: email });
      
      if (!tokenDoc) {
        // Create new token
        const mealArray = Object.entries(meals).map(([name, data]) => ({
          name,
          quantity: data.quantity,
          price: data.price
        }));

        const totalAmount = mealArray.reduce((sum, m) => sum + (m.price * m.quantity), 0);

        if (isToday) {
          // ✅ FIX: For TODAY - Generate actual token number immediately
          // Count existing tokens for today with this batch (exclude PENDING tokens)
          const tokenCount = await Token.countDocuments({ 
            date, 
            batch,
            token: { $ne: 'PENDING' }
          });
          const newToken = (tokenCount + 1).toString();

          tokenDoc = new Token({
            token: newToken,
            date,
            batch,
            userEmail: email,
            userName: user.name,
            userPhoto: user.profilePhoto,
            meals: mealArray,
            totalAmount,
            paid: true,
            verified: false
          });

          await tokenDoc.save();
          console.log(`✅ Generated token #${newToken} for TODAY (${date}, Batch ${batch})`);
        } else {
          // For FUTURE dates: Create PENDING token (will be generated at 8 AM)
          tokenDoc = new Token({
            token: 'PENDING',
            date,
            batch,
            userEmail: email,
            userName: user.name,
            userPhoto: user.profilePhoto,
            meals: mealArray,
            totalAmount,
            paid: true,
            verified: false
          });

          await tokenDoc.save();
          console.log(`📅 Created PENDING token for FUTURE date (${date}, Batch ${batch})`);
        }
      } else {
        // Token exists - update meals
        const mealArray = Object.entries(meals).map(([name, data]) => ({
          name,
          quantity: data.quantity,
          price: data.price
        }));

        tokenDoc.meals = mealArray;
        tokenDoc.totalAmount = mealArray.reduce((sum, m) => sum + (m.price * m.quantity), 0);
        
        // ✅ FIX: If updating a today token that was PENDING, generate actual token number now
        if (isToday && tokenDoc.token === 'PENDING') {
          const tokenCount = await Token.countDocuments({ 
            date, 
            batch,
            token: { $ne: 'PENDING' }
          });
          tokenDoc.token = (tokenCount + 1).toString();
          console.log(`✅ Converted PENDING token to #${tokenDoc.token} for TODAY`);
        }
        
        await tokenDoc.save();
      }
      
      tokens.push({
        token: tokenDoc.token,
        date: tokenDoc.date,
        batch: tokenDoc.batch,
        meals: tokenDoc.meals,
        totalAmount: tokenDoc.totalAmount
      });

      // Add to user orders (clear old orders for this date/batch first)
      user.orders = user.orders.filter(o => !(o.orderDate === date && o.batch === batch));
      
      tokenDoc.meals.forEach(meal => {
        for (let i = 0; i < meal.quantity; i++) {
          user.orders.push({
            mealName: meal.name,
            price: meal.price,
            date: new Date(),
            orderDate: date,
            paid: true,
            batch: batch,
            token: tokenDoc.token
          });
        }
      });
    }

    await user.save();

    // Send order confirmation notification
    const todayTokens = tokens.filter(t => t.date === today && t.token !== 'PENDING');
    const futureOrders = tokens.filter(t => t.date !== today || t.token === 'PENDING').length;
    
    let notificationBody = '';
    if (todayTokens.length > 0) {
      notificationBody = `Today's token(s) ready: ${todayTokens.map(t => `#${t.token}`).join(', ')}`;
      if (futureOrders > 0) {
        notificationBody += `. ${futureOrders} future order(s) scheduled.`;
      }
    } else {
      notificationBody = `${futureOrders} order(s) scheduled. Tokens will be generated at 8 AM on order date.`;
    }

    await sendPushNotification(email, {
      title: '✅ Order Confirmed!',
      body: notificationBody,
      type: 'order_update',
      reason: 'order_placed',
      data: { url: '/dashboard' }
    });

    res.json({ success: true, tokens });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get user tokens
app.get("/user-tokens/:email", async (req, res) => {
  try {
    const tokens = await Token.find({ userEmail: req.params.email }).sort({ date: -1, batch: 1 });
    res.json({ success: true, tokens });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get token details
app.get("/token-details/:id", async (req, res) => {
  try {
    const token = await Token.findById(req.params.id);
    
    if (!token) {
      return res.json({ success: false, error: "Token not found" });
    }

    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update token
app.put("/update-token/:id", async (req, res) => {
  try {
    const { meals } = req.body;
    const token = await Token.findById(req.params.id);

    if (!token) {
      return res.json({ success: false, error: "Token not found" });
    }

    if (token.verified) {
      return res.json({ success: false, error: "Cannot edit verified token" });
    }

    // Check if token date is in the past
    const tokenDate = new Date(token.date + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (tokenDate < today) {
      return res.json({ success: false, error: "Cannot edit past tokens" });
    }

    token.meals = meals;
    token.totalAmount = meals.reduce((sum, m) => sum + (m.price * m.quantity), 0);
    await token.save();

    // Update user orders
    const user = await User.findOne({ email: token.userEmail });
    if (user) {
      // Remove old orders for this token
      user.orders = user.orders.filter(o => o.token !== token.token || o.orderDate !== token.date);
      
      // Add updated orders
      meals.forEach(meal => {
        for (let i = 0; i < meal.quantity; i++) {
          user.orders.push({
            mealName: meal.name,
            price: meal.price,
            date: new Date(),
            orderDate: token.date,
            paid: true,
            batch: token.batch,
            token: token.token
          });
        }
      });
      
      await user.save();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update token error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get token by token number
app.get("/token/:token", async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tokenDoc = await Token.findOne({
      token: req.params.token,
      date: today
    });

    if (!tokenDoc) {
      return res.json({ success: false, error: "Token not found or expired" });
    }

    res.json({
      success: true,
      token: tokenDoc.token,
      userEmail: tokenDoc.userEmail,
      userName: tokenDoc.userName,
      userPhoto: tokenDoc.userPhoto,
      batch: tokenDoc.batch,
      meals: tokenDoc.meals,
      totalAmount: tokenDoc.totalAmount,
      paid: tokenDoc.paid,
      verified: tokenDoc.verified,
      verifiedAt: tokenDoc.verifiedAt,
      date: tokenDoc.date
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify token payment
app.post("/verify-token-payment", async (req, res) => {
  try {
    const { token } = req.body;
    const today = new Date().toISOString().split('T')[0];

    const tokenDoc = await Token.findOne({ token, date: today });
    if (!tokenDoc) {
      return res.json({ success: false, error: "Token not found" });
    }

    tokenDoc.verified = true;
    tokenDoc.verifiedAt = new Date();
    await tokenDoc.save();

    const user = await User.findOne({ email: tokenDoc.userEmail });
    if (user) {
      user.verifiedToday = {
        date: today,
        verified: true,
        verifiedAt: new Date(),
        meals: tokenDoc.meals
      };
      await user.save();

      await sendPushNotification(tokenDoc.userEmail, {
        title: '🎉 Payment Verified!',
        body: 'Your payment has been verified. Enjoy your meal!',
        type: 'order_update',
        reason: 'payment_verified',
        data: { url: '/dashboard' }
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// QR scan verification
app.post("/verify-qr", async (req, res) => {
  try {
    const { userEmail, date } = req.body;

    if (!userEmail || !date) {
      return res.json({ success: false, error: "Missing data" });
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      return res.json({ success: false, error: "User not found" });
    }

    const todayOrders = user.orders.filter(o => 
      (o.orderDate === date || new Date(o.date).toISOString().split('T')[0] === date) && o.paid
    );

    if (todayOrders.length === 0) {
      return res.json({ success: false, error: "No paid orders for this date" });
    }

    const mealGroups = {};
    todayOrders.forEach(order => {
      if (!mealGroups[order.mealName]) {
        mealGroups[order.mealName] = { quantity: 0, totalPrice: 0 };
      }
      mealGroups[order.mealName].quantity++;
      mealGroups[order.mealName].totalPrice += order.price;
    });

    user.verifiedToday = {
      date,
      verified: true,
      verifiedAt: new Date(),
      meals: Object.entries(mealGroups).map(([name, data]) => ({
        name,
        quantity: data.quantity,
        totalPrice: data.totalPrice
      }))
    };

    await user.save();

    // Mark all tokens for this date as verified
    await Token.updateMany(
      { userEmail, date },
      { verified: true, verifiedAt: new Date() }
    );

    await sendPushNotification(userEmail, {
      title: '🎉 Order Verified!',
      body: 'Your meal order has been verified. Enjoy your food!',
      type: 'order_update',
      reason: 'qr_verified',
      data: { url: '/dashboard' }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check if verified
app.post("/check-verified", async (req, res) => {
  try {
    const { userEmail, date } = req.body;
    const user = await User.findOne({ email: userEmail });
    
    if (!user) {
      return res.json({ verified: false });
    }

    const verified = user.verifiedToday && 
                     user.verifiedToday.date === date && 
                     user.verifiedToday.verified;

    res.json({ verified });
  } catch (err) {
    res.status(500).json({ verified: false, error: err.message });
  }
});

// Get user orders
app.get("/orders/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) {
      return res.json({ success: false, error: "User not found" });
    }
    res.json({ success: true, orders: user.orders || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rate meal
app.post("/rate", async (req, res) => {
  try {
    const { mealName, rating, email } = req.body;
    
    if (!mealName || typeof rating === 'undefined' || !email) {
      return res.json({ success: false, error: "Missing fields" });
    }
    
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, error: "User not found" });
    
    user.ratings.set(mealName, Number(rating));
    await user.save();
    
    const meal = await Meal.findOne({ name: mealName });
    if (!meal) return res.json({ success: false, error: "Meal not found" });
    
    meal.ratings.push(Number(rating));
    const avgRating = meal.ratings.length ? (meal.ratings.reduce((a,b)=>a+b,0) / meal.ratings.length) : 0;
    meal.avgRating = Number(avgRating.toFixed(1));
    meal.totalRatings = meal.ratings.length;
    
    await meal.save();
    broadcastRatingUpdate(mealName, meal.avgRating, meal.totalRatings);
    res.json({ success: true, avgRating: meal.avgRating, totalRatings: meal.totalRatings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get meal details
app.get("/meal/:name", async (req, res) => {
  try {
    const meal = await Meal.findOne({ name: req.params.name });
    if (meal) {
      const avgRating = meal.ratings.length ? (meal.ratings.reduce((a,b)=>a+b,0) / meal.ratings.length) : 0;
      res.json({ 
        success: true, 
        name: meal.name, 
        image: meal.image, 
        description: meal.description, 
        price: meal.price, 
        avgRating: Number(avgRating.toFixed(1)), 
        totalRatings: meal.ratings.length 
      });
    } else {
      res.status(404).json({ success: false, error: "Meal not found" });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Producer stats
app.get("/producer/stats", async (req, res) => {
  try {
    const { period = 'day' } = req.query;
    const users = await User.find({});
    let allOrders = [];
    let verifiedCount = 0;
    
    users.forEach(u => {
      allOrders.push(...(u.orders || []));
      if (u.verifiedToday && u.verifiedToday.verified) {
        const todayStr = new Date().toISOString().split('T')[0];
        if (u.verifiedToday.date === todayStr) {
          verifiedCount += u.verifiedToday.meals.reduce((sum, m) => sum + m.quantity, 0);
        }
      }
    });
    
    const now = new Date();
    let startDate;
    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        startDate = new Date(0);
    }

    const filteredOrders = allOrders.filter(o => new Date(o.date) >= startDate);

    const total = filteredOrders.length;
    const paid = filteredOrders.filter(o => o.paid).length;
    const unpaid = total - paid;

    const mealCounts = {};
    filteredOrders.forEach(o => {
      mealCounts[o.mealName] = (mealCounts[o.mealName] || 0) + 1;
    });

    res.json({ total, paid, unpaid, meals: mealCounts, verified: verifiedCount });
  } catch (err) {
    console.error("Error fetching producer stats:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// SSE for ratings
app.get("/sse-ratings", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.push(res);
  console.log("Client connected to rating SSE");

  req.on("close", () => {
    sseClients = sseClients.filter(client => client !== res);
    console.log("Client disconnected from rating SSE");
  });
});

function broadcastRatingUpdate(mealName, avgRating, totalRatings) {
  const data = JSON.stringify({ mealName, avgRating, totalRatings });
  sseClients.forEach(client => {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (err) {
      console.error("Error sending SSE:", err);
    }
  });
}

// Serve HTML files
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

app.get("/dashboard1", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard1.html"));
});

app.get("/dashboard3", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard3.html"));
});

app.get("/dashboard4", (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard4.html"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ success: false, error: "Server error" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log("📡 MongoDB connection active");
  console.log("☁️ Cloudinary configured");
  console.log("🔐 Google OAuth configured");
  console.log("🔔 Push notifications enabled");
  console.log("📅 Calendar-based ordering system active");
  console.log("✏️ Token editing feature enabled");
  console.log("🎫 FIXED: Tokens for TODAY generated immediately, FUTURE tokens are PENDING");
  console.log("⏰ Scheduled token generation at 8:00 AM daily for future orders");
});
