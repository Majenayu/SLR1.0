// server.js - Enhanced Push Notifications with Producer Control & 10 AM Reminders
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
}).then(() => {
  console.log("✅ MongoDB Connected Successfully");
  initMeals();
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
    paid: { type: Boolean, default: false },
    token: String,
    day: String,
    batch: String
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

const tokenSchema = new mongoose.Schema({
  token: { type: String, required: true },
  date: { type: String, required: true },
  userEmail: { type: String, required: true },
  userName: { type: String, required: true },
  userPhoto: String,
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

tokenSchema.index({ token: 1, date: 1 }, { unique: true });
const Token = mongoose.model("Token", tokenSchema);

// Notification Log Schema
const notificationLogSchema = new mongoose.Schema({
  userEmail: String,
  type: { type: String, enum: ['daily_reminder', 'payment_reminder', 'order_update', 'producer_alert'] },
  title: String,
  message: String,
  sentAt: { type: Date, default: Date.now },
  success: Boolean,
  error: String
});

const NotificationLog = mongoose.model("NotificationLog", notificationLogSchema);

// SSE connections
let sseClients = [];
let producerSSEClients = [];

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
    
    // Log successful notification
    await new NotificationLog({
      userEmail,
      type: payload.type || 'order_update',
      title: payload.title,
      message: payload.body,
      success: true
    }).save();

    // Update last notification time
    user.lastNotificationSent = new Date();
    await user.save();

    console.log(`✅ Push notification sent to ${userEmail}: ${payload.title}`);
    return { success: true };
  } catch (err) {
    console.error(`❌ Push notification error for ${userEmail}:`, err.message);
    
    // Log failed notification
    await new NotificationLog({
      userEmail,
      type: payload.type || 'order_update',
      title: payload.title,
      message: payload.body,
      success: false,
      error: err.message
    }).save();

    // If subscription is invalid, remove it
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

// Send bulk notifications to all students
async function sendBulkNotifications(payload) {
  try {
    const students = await User.find({ 
      role: 'student',
      pushSubscription: { $ne: null }
    });

    console.log(`📢 Sending bulk notification to ${students.length} students...`);
    
    const results = {
      total: students.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const student of students) {
      const result = await sendPushNotification(student.email, payload);
      if (result.success) {
        results.successful++;
      } else {
        results.failed++;
        results.errors.push({ email: student.email, error: result.error });
      }
      
      // Small delay to avoid overwhelming the push service
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Bulk notification complete: ${results.successful}/${results.total} successful`);
    return results;
  } catch (err) {
    console.error('❌ Bulk notification error:', err);
    return { success: false, error: err.message };
  }
}

// ==================== PRODUCER NOTIFICATION ENDPOINTS ====================

// Send reminder to all students (Producer-triggered)
app.post('/producer/send-reminders', async (req, res) => {
  try {
    const { producerEmail, message } = req.body;
    
    // Verify producer
    const producer = await User.findOne({ email: producerEmail, role: 'producer' });
    if (!producer) {
      return res.status(403).json({ success: false, error: 'Unauthorized: Producer only' });
    }

    // Get unpaid orders count
    const students = await User.find({ role: 'student' });
    const todayStr = new Date().toDateString();
    let totalUnpaid = 0;
    
    students.forEach(student => {
      const unpaidToday = student.orders.filter(o => 
        new Date(o.date).toDateString() === todayStr && !o.paid
      );
      totalUnpaid += unpaidToday.length;
    });

    // Custom message or default
    const notificationBody = message || 
      `⏰ Meal Reminder!\n\n${totalUnpaid > 0 ? `You have ${totalUnpaid} unpaid orders. ` : ''}Don't forget to order your meals for today! Check out our delicious menu. 🍽️`;

    const payload = {
      title: '🍽️ MessMate - Meal Reminder',
      body: notificationBody,
      type: 'producer_alert',
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      data: {
        url: '/dashboard',
        action: 'view_meals'
      }
    };

    const results = await sendBulkNotifications(payload);

    // Notify producer clients
    broadcastToProducers({
      type: 'reminder_sent',
      results,
      timestamp: new Date().toISOString()
    });

    res.json({ 
      success: true, 
      message: 'Reminders sent successfully',
      results 
    });
  } catch (err) {
    console.error('Send reminders error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get notification statistics (for producer dashboard)
app.get('/producer/notification-stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await NotificationLog.aggregate([
      {
        $match: {
          sentAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: '$success',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalStudents = await User.countDocuments({ role: 'student' });
    const subscribedStudents = await User.countDocuments({ 
      role: 'student',
      pushSubscription: { $ne: null }
    });

    const successful = stats.find(s => s._id === true)?.count || 0;
    const failed = stats.find(s => s._id === false)?.count || 0;

    res.json({
      success: true,
      stats: {
        totalStudents,
        subscribedStudents,
        notificationsToday: {
          successful,
          failed,
          total: successful + failed
        },
        subscriptionRate: ((subscribedStudents / totalStudents) * 100).toFixed(1)
      }
    });
  } catch (err) {
    console.error('Notification stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get recent notifications log
app.get('/producer/recent-notifications', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const notifications = await NotificationLog.find()
      .sort({ sentAt: -1 })
      .limit(limit)
      .lean();

    res.json({
      success: true,
      notifications
    });
  } catch (err) {
    console.error('Recent notifications error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== SCHEDULED NOTIFICATIONS ====================

// Daily reminder at 10 AM (Monday to Saturday) - IST Time
cron.schedule('0 10 * * 1-6', async () => {
  console.log('⏰ Running scheduled 10 AM meal reminder...');
  
  try {
    // Get all students with unpaid orders
    const students = await User.find({ role: 'student' });
    const todayStr = new Date().toDateString();
    
    let studentsWithUnpaidOrders = [];
    let totalUnpaid = 0;
    
    students.forEach(student => {
      const unpaidToday = student.orders.filter(o => 
        new Date(o.date).toDateString() === todayStr && !o.paid
      );
      
      if (unpaidToday.length > 0) {
        studentsWithUnpaidOrders.push({
          email: student.email,
          unpaidCount: unpaidToday.length
        });
        totalUnpaid += unpaidToday.length;
      }
    });

    // Send general reminder to all students
    const payload = {
      title: '🌅 Good Morning! Time for Breakfast',
      body: `⏰ It's 10 AM! Don't forget to order your meals for today. ${totalUnpaid > 0 ? `${totalUnpaid} orders are awaiting payment. ` : ''}Check out today's special menu! 🍽️`,
      type: 'daily_reminder',
      icon: '/icon-192x192.png',
      badge: '/badge-72x72.png',
      data: {
        url: '/dashboard',
        action: 'view_meals',
        scheduled: true
      }
    };

    const results = await sendBulkNotifications(payload);
    
    console.log(`✅ 10 AM reminder sent: ${results.successful}/${results.total} successful`);
    
    // Notify producers about the reminder
    broadcastToProducers({
      type: 'scheduled_reminder_sent',
      time: '10:00 AM',
      results,
      unpaidOrders: totalUnpaid,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Scheduled reminder error:', err);
  }
}, {
  timezone: "Asia/Kolkata"
});

// Payment reminder - 6 PM (for unpaid orders)
cron.schedule('0 18 * * 1-6', async () => {
  console.log('⏰ Running 6 PM payment reminder...');
  
  try {
    const students = await User.find({ role: 'student' });
    const todayStr = new Date().toDateString();
    
    for (const student of students) {
      const unpaidToday = student.orders.filter(o => 
        new Date(o.date).toDateString() === todayStr && !o.paid
      );
      
      if (unpaidToday.length > 0 && student.pushSubscription) {
        const totalAmount = unpaidToday.reduce((sum, order) => sum + order.price, 0);
        
        await sendPushNotification(student.email, {
          title: '💰 Payment Reminder',
          body: `You have ${unpaidToday.length} unpaid orders (₹${totalAmount}). Please complete payment to receive your meals tomorrow. 🍽️`,
          type: 'payment_reminder',
          data: {
            url: '/dashboard',
            action: 'pay_orders'
          }
        });
        
        // Small delay between notifications
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log('✅ Payment reminders sent');
  } catch (err) {
    console.error('❌ Payment reminder error:', err);
  }
}, {
  timezone: "Asia/Kolkata"
});

// ==================== SSE FOR PRODUCER DASHBOARD ====================

app.get('/producer/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  producerSSEClients.push(res);
  console.log('✅ Producer connected to notification SSE');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  req.on('close', () => {
    producerSSEClients = producerSSEClients.filter(client => client !== res);
    console.log('❌ Producer disconnected from notification SSE');
  });
});

function broadcastToProducers(data) {
  const message = JSON.stringify(data);
  producerSSEClients.forEach(client => {
    try {
      client.write(`data: ${message}\n\n`);
    } catch (err) {
      console.error('Error broadcasting to producer:', err);
    }
  });
}

// ==================== EXISTING ENDPOINTS (keeping all original functionality) ====================

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

// Checkout (create token)
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

    const today = new Date().toDateString();
    const existingToken = await Token.findOne({ userEmail: email, date: today });

    if (existingToken) {
      return res.json({
        success: true,
        token: existingToken.token,
        meals: existingToken.meals
      });
    }

    const mealGroups = {};
    let totalAmount = 0;

    orders.forEach(order => {
      if (!mealGroups[order.mealName]) {
        mealGroups[order.mealName] = { quantity: 0, price: order.price };
      }
      mealGroups[order.mealName].quantity++;
      totalAmount += order.price;

      user.orders.push({
        mealName: order.mealName,
        price: order.price,
        date: new Date(),
        paid: true,
        day: order.day,
        batch: order.batch
      });
    });

    await user.save();

    const tokenCount = await Token.countDocuments({ date: today });
    const newToken = (tokenCount + 1).toString();

    const meals = Object.entries(mealGroups).map(([name, data]) => ({
      name,
      quantity: data.quantity,
      price: data.price
    }));

    const tokenDoc = new Token({
      token: newToken,
      date: today,
      userEmail: email,
      userName: user.name,
      userPhoto: user.profilePhoto,
      meals,
      totalAmount,
      paid: true,
      verified: false
    });

    await tokenDoc.save();

    // Send order confirmation notification
    await sendPushNotification(email, {
      title: '✅ Order Confirmed!',
      body: `Your order has been placed successfully. Total: ₹${totalAmount}. Token #${newToken}`,
      type: 'order_update',
      data: {
        url: '/dashboard',
        token: newToken
      }
    });

    res.json({ success: true, token: newToken, meals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get token details
app.get("/token/:token", async (req, res) => {
  try {
    const today = new Date().toDateString();
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
    const today = new Date().toDateString();

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

      // Send verification notification
      await sendPushNotification(tokenDoc.userEmail, {
        title: '🎉 Payment Verified!',
        body: 'Your payment has been verified. Enjoy your meal!',
        type: 'order_update',
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
      new Date(o.date).toDateString() === date && o.paid
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

    const tokenDoc = await Token.findOne({ userEmail, date });
    if (tokenDoc) {
      tokenDoc.verified = true;
      tokenDoc.verifiedAt = new Date();
      await tokenDoc.save();
    }

    // Send notification
    await sendPushNotification(userEmail, {
      title: '🎉 Order Verified!',
      body: 'Your meal order has been verified. Enjoy your food!',
      type: 'order_update',
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
        const todayStr = new Date().toDateString();
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
  console.log("⏰ Daily reminders scheduled:");
  console.log("   - 10:00 AM: Meal reminder (Mon-Sat)");
  console.log("   - 6:00 PM: Payment reminder (Mon-Sat)");
});
