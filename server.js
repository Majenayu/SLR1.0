// server.js - Updated with Push Notifications & Daily Reminders
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
  origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL || 'https://your-render-app.onrender.com' : '*',
  credentials: true
}));
app.use(express.static(__dirname));

// Web Push Configuration
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BHxzQRQvqZ8Cd7TJOJkKw1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'YOUR_PRIVATE_KEY_HERE';
const VAPID_MAILTO = process.env.VAPID_MAILTO || 'mailto:your-email@example.com';

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

    console.log(`✅ Push notification sent to ${userEmail}`);
    return { success: true };
  } catch (err) {
    console.error(`❌ Error sending push to ${userEmail}:`, err.message);
    
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
    if (err.statusCode === 410) {
      const user = await User.findOne({ email: userEmail });
      if (user) {
        user.pushSubscription = null;
        await user.save();
        console.log(`🗑️ Removed invalid subscription for ${userEmail}`);
      }
    }

    return { success: false, error: err.message };
  }
}

// Send notification to all users with specific filter
async function sendBulkNotification(filter, payload) {
  try {
    const users = await User.find(filter);
    console.log(`📢 Sending bulk notification to ${users.length} users`);

    const results = await Promise.allSettled(
      users.map(user => sendPushNotification(user.email, payload))
    );

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;

    console.log(`✅ Bulk notification complete: ${successful} sent, ${failed} failed`);
    return { successful, failed };
  } catch (err) {
    console.error('Bulk notification error:', err);
    return { successful: 0, failed: 0, error: err.message };
  }
}

// ==================== CRON JOBS ====================

// Daily reminder at 10 AM (Monday to Saturday only, excluding Sunday)
cron.schedule('0 10 * * 1-6', async () => {
  console.log('🔔 Running daily order reminder at 10 AM...');
  
  try {
    const today = new Date().toDateString();
    
    // Find all students who haven't ordered today
    const allStudents = await User.find({ role: 'student' });
    const usersWithoutOrders = [];

    for (const student of allStudents) {
      const hasOrderedToday = student.orders.some(
        order => new Date(order.date).toDateString() === today
      );

      if (!hasOrderedToday && student.notificationPreferences.dailyReminder) {
        usersWithoutOrders.push(student);
      }
    }

    console.log(`📊 Found ${usersWithoutOrders.length} students without orders today`);

    if (usersWithoutOrders.length > 0) {
      const payload = {
        title: '🍽️ MessMate Order Reminder',
        body: 'Don\'t forget to place your meal order for today! Orders close soon.',
        icon: '/icon-192x192.png',
        type: 'daily_reminder',
        data: {
          url: '/dashboard',
          action: 'order_now'
        }
      };

      // Send to all users without orders
      for (const user of usersWithoutOrders) {
        await sendPushNotification(user.email, payload);
      }

      // Notify producer dashboard
      notifyProducerDashboard({
        type: 'daily_reminder_sent',
        count: usersWithoutOrders.length,
        message: `Daily reminder sent to ${usersWithoutOrders.length} students`
      });
    }
  } catch (err) {
    console.error('❌ Daily reminder cron error:', err);
  }
});

// Cleanup expired tokens daily at midnight
cron.schedule('0 0 * * *', async () => {
  console.log('🧹 Cleaning up expired tokens...');
  try {
    const result = await Token.deleteMany({
      expiresAt: { $lt: new Date() },
      verified: false
    });
    console.log(`✅ Deleted ${result.deletedCount} expired tokens`);
  } catch (err) {
    console.error('❌ Token cleanup error:', err);
  }
});

// ==================== PRODUCER NOTIFICATION FUNCTIONS ====================

// Notify producer dashboard via SSE
function notifyProducerDashboard(data) {
  producerSSEClients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error('Error sending to producer client:', err);
    }
  });
}

// Producer SSE endpoint for real-time notifications
app.get('/sse-producer-notifications', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  producerSSEClients.push(res);
  console.log('🔌 Producer connected to notification stream');

  req.on('close', () => {
    producerSSEClients = producerSSEClients.filter(client => client !== res);
    console.log('🔌 Producer disconnected from notification stream');
  });
});

// Manual producer notification trigger
app.post('/trigger-producer-alert', async (req, res) => {
  try {
    const today = new Date().toDateString();
    const allStudents = await User.find({ role: 'student' });
    const usersWithoutOrders = [];

    for (const student of allStudents) {
      const hasOrderedToday = student.orders.some(
        order => new Date(order.date).toDateString() === today
      );
      if (!hasOrderedToday) {
        usersWithoutOrders.push(student);
      }
    }

    notifyProducerDashboard({
      type: 'manual_alert',
      count: usersWithoutOrders.length,
      message: `${usersWithoutOrders.length} students haven't ordered yet today`,
      users: usersWithoutOrders.map(u => ({ name: u.name, email: u.email }))
    });

    res.json({
      success: true,
      count: usersWithoutOrders.length,
      message: 'Alert sent to producer dashboard'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Send reminder to specific users (producer triggered)
app.post('/send-reminder-to-users', async (req, res) => {
  try {
    const { userEmails } = req.body;
    
    if (!userEmails || userEmails.length === 0) {
      return res.json({ success: false, error: 'No users specified' });
    }

    const payload = {
      title: '⏰ Last Call for Orders!',
      body: 'This is your final reminder to place your meal order for today.',
      icon: '/icon-192x192.png',
      type: 'payment_reminder',
      data: {
        url: '/dashboard',
        action: 'order_now'
      }
    };

    let sent = 0;
    for (const email of userEmails) {
      const result = await sendPushNotification(email, payload);
      if (result.success) sent++;
    }

    res.json({
      success: true,
      sent,
      total: userEmails.length,
      message: `Reminders sent to ${sent}/${userEmails.length} users`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== EXISTING ENDPOINTS (Keeping all your original code) ====================

async function generateDailyToken(date) {
  const dateStr = date.toDateString();
  
  let retries = 5;
  while (retries > 0) {
    try {
      const lastToken = await Token.findOne({ date: dateStr })
        .sort({ createdAt: -1, token: -1 })
        .select('token');
      
      let nextTokenNum = 1;
      if (lastToken && lastToken.token) {
        const tokenNum = parseInt(lastToken.token);
        if (!isNaN(tokenNum)) {
          nextTokenNum = tokenNum + 1;
        }
      }
      
      return nextTokenNum.toString();
    } catch (err) {
      retries--;
      if (retries === 0) {
        console.error("Failed to generate sequential token, using fallback");
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function initMeals() {
  try {
    const count = await Meal.countDocuments();
    if (count === 0) {
      const defaultMeals = [
        { name: "Masala Dosa", description: "Crispy dosa with spicy potato filling", price: 40 },
        { name: "Idli Sambar", description: "Steamed rice cakes with lentil curry", price: 30 },
        { name: "Paneer Butter Masala", description: "Rich and creamy paneer curry", price: 90 },
        { name: "Veg Biryani", description: "Aromatic rice with mixed vegetables", price: 80 },
        { name: "Chole Bhature", description: "Spicy chickpea curry with fried bread", price: 70 }
      ];
      await Meal.insertMany(defaultMeals);
      console.log("✅ Default meals initialized");
    }
  } catch (err) {
    console.error("Error initializing meals:", err);
  }
}

// Google OAuth
app.post('/auth/google', async (req, res) => {
  try {
    const { token } = req.body;
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: CLIENT_ID
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const picture = payload.picture;

    if (!email.endsWith('@vvce.ac.in')) {
      return res.json({ success: false, error: 'Please use your @vvce.ac.in email' });
    }

    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        name,
        email,
        role: 'student',
        profilePhoto: picture,
        profileComplete: false
      });
      await user.save();
      console.log(`✅ New user registered via Google: ${email}`);
    }

    res.json({
      success: true,
      email: user.email,
      name: user.name,
      role: user.role,
      profileComplete: user.profileComplete
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
});

// Regular login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.json({ success: false, error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.json({ success: false, error: "Invalid password" });
    }

    res.json({
      success: true,
      email: user.email,
      name: user.name,
      role: user.role,
      profileComplete: user.profileComplete
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Register
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.json({ success: false, error: "duplicate" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role: role || "student",
      profileComplete: false
    });

    await newUser.save();
    console.log(`✅ New user registered: ${email} (${role})`);

    res.json({
      success: true,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      profileComplete: newUser.profileComplete
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Profile completion
app.post('/complete-profile', uploadProfile.single('profilePhoto'), async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.json({ success: false, error: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }

    if (req.file) {
      if (user.profilePhotoId) {
        await cloudinary.uploader.destroy(user.profilePhotoId);
      }
      user.profilePhoto = req.file.path;
      user.profilePhotoId = req.file.filename;
    }

    user.profileComplete = true;
    await user.save();

    res.json({
      success: true,
      profilePhoto: user.profilePhoto,
      message: 'Profile completed successfully'
    });
  } catch (err) {
    console.error('Profile completion error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get user profile
app.get('/user/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }
    res.json({
      success: true,
      name: user.name,
      email: user.email,
      role: user.role,
      profilePhoto: user.profilePhoto,
      profileComplete: user.profileComplete,
      notificationPreferences: user.notificationPreferences
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update notification preferences
app.post('/update-notification-preferences', async (req, res) => {
  try {
    const { email, preferences } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: false, error: 'User not found' });
    }

    user.notificationPreferences = {
      ...user.notificationPreferences,
      ...preferences
    };
    await user.save();

    res.json({ success: true, preferences: user.notificationPreferences });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get meals
app.get("/meals", async (req, res) => {
  try {
    const meals = await Meal.find().sort({ name: 1 });
    res.json(meals);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add meal
app.post("/add-meal", uploadMeal.single('image'), async (req, res) => {
  try {
    const { name, price, description } = req.body;
    
    if (!name || !price) {
      return res.json({ success: false, error: "Name and price are required" });
    }

    const existing = await Meal.findOne({ name });
    if (existing) {
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
    console.log(`✅ New meal added: ${name}`);
    res.json({ success: true, meal });
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

    if (name) meal.name = name;
    if (price) meal.price = Number(price);
    if (description !== undefined) meal.description = description;

    if (req.file) {
      if (meal.cloudinaryId) {
        await cloudinary.uploader.destroy(meal.cloudinaryId);
      }
      meal.image = req.file.path;
      meal.cloudinaryId = req.file.filename;
    }

    meal.updatedAt = new Date();
    await meal.save();

    res.json({ success: true, meal });
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
      await cloudinary.uploader.destroy(meal.cloudinaryId);
    }

    await Meal.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Book order
app.post("/book", async (req, res) => {
  try {
    const { email, mealName } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.json({ success: false, error: "User not found" });
    }

    if (!user.profileComplete) {
      return res.json({ success: false, error: "Please complete your profile first" });
    }

    const meal = await Meal.findOne({ name: mealName });
    if (!meal) {
      return res.json({ success: false, error: "Meal not found" });
    }

    user.orders.push({
      mealName: meal.name,
      price: meal.price,
      date: new Date(),
      paid: false
    });

    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Checkout
app.post("/checkout", async (req, res) => {
  try {
    const { email, orders } = req.body;
    
    if (!email || !orders || orders.length === 0) {
      return res.json({ success: false, error: "Missing required fields" });
    }
    
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, error: "User not found" });
    
    if (!user.profileComplete) {
      return res.json({ success: false, error: "Please complete your profile first" });
    }
    
    const total = orders.reduce((sum, order) => sum + order.price, 0);
    
    const mealGroups = {};
    orders.forEach(order => {
      if (!mealGroups[order.mealName]) {
        mealGroups[order.mealName] = { quantity: 0, price: order.price };
      }
      mealGroups[order.mealName].quantity++;
    });
    
    const meals = Object.entries(mealGroups).map(([name, info]) => ({
      name,
      quantity: info.quantity,
      price: info.price
    }));
    
    const todayDate = new Date();
    const newOrders = [];
    
    orders.forEach(order => {
      const newOrder = {
        mealName: order.mealName,
        price: order.price,
        date: todayDate,
        paid: false,
        day: order.day,
        batch: order.batch
      };
      user.orders.push(newOrder);
      newOrders.push(newOrder);
    });
    
    await user.save();
    
    const today = new Date().toDateString();
    let tokenDoc = await Token.findOne({ userEmail: email, date: today });
    
    if (tokenDoc) {
      tokenDoc.totalAmount += total;
      tokenDoc.meals = meals;
      
      const allTodayOrders = user.orders.filter(o => 
        new Date(o.date).toDateString() === today
      );
      tokenDoc.orderIds = allTodayOrders.map(o => o._id);
      
      await tokenDoc.save();
    } else {
      const token = await generateDailyToken(new Date());
      
      const todayOrders = user.orders.filter(o => 
        new Date(o.date).toDateString() === today
      );
      
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 30);
      
      tokenDoc = await new Token({
        token,
        userEmail: email,
        userName: user.name,
        userPhoto: user.profilePhoto,
        date: today,
        meals: meals,
        totalAmount: total,
        paid: false,
        verified: false,
        orderIds: todayOrders.map(o => o._id),
        expiresAt: expiresAt
      }).save();
    }
    
    console.log(`✅ Token ${tokenDoc.token} created/updated for ${email} - Amount: ₹${total}`);
    
    res.json({
      success: true,
      token: tokenDoc.token,
      meals: meals,
      totalAmount: total,
      message: "Orders placed successfully. Please proceed to payment."
    });
    
  } catch (err) {
    console.error("Checkout error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Pay endpoint
app.post("/pay", async (req, res) => {
  try {
    const { email } = req.body;
    const now = new Date();
    const todayStr = now.toDateString();
    
    if (!email) {
      return res.json({ success: false, error: "Missing email" });
    }
    
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, error: "User not found" });
    
    if (!user.profileComplete) {
      return res.json({ success: false, error: "Please complete your profile first" });
    }
    
    const todayUnpaid = user.orders.filter(o => new Date(o.date).toDateString() === todayStr && !o.paid);
    if (todayUnpaid.length === 0) {
      return res.json({ success: false, error: "No unpaid orders today" });
    }
    
    let tokenDoc = null;
    let retries = 5;
    
    while (retries > 0 && !tokenDoc) {
      try {
        const token = await generateDailyToken(now);
        
        const mealGroups = {};
        todayUnpaid.forEach(order => {
          if (!mealGroups[order.mealName]) {
            mealGroups[order.mealName] = { quantity: 0, price: order.price };
          }
          mealGroups[order.mealName].quantity++;
        });
        
        const meals = Object.entries(mealGroups).map(([name, data]) => ({
          name,
          quantity: data.quantity,
          price: data.price
        }));
        
        const totalAmount = todayUnpaid.reduce((sum, o) => sum + o.price, 0);
        const expiresAt = new Date(now.getTime() + (24 * 60 * 60 * 1000));
        
        tokenDoc = new Token({
          token,
          date: todayStr,
          userEmail: email,
          userName: user.name,
          userPhoto: user.profilePhoto,
          meals,
          totalAmount,
          paid: false,
          verified: false,
          expiresAt
        });
        
        await tokenDoc.save();
        console.log(`✅ Token ${token} generated for ${email}`);
      } catch (err) {
        if (err.code === 11000) {
          retries--;
          if (retries === 0) {
            return res.json({ success: false, error: "Failed to generate unique token. Please try again." });
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        } else {
          throw err;
        }
      }
    }
    
    const qrData = JSON.stringify({
      userEmail: email,
      userName: user.name,
      token: tokenDoc.token,
      meals: tokenDoc.meals,
      totalAmount: tokenDoc.totalAmount,
      date: todayStr
    });
    
    const qrCode = await QRCode.toDataURL(qrData);
    
    res.json({
      success: true,
      qrCode,
      token: tokenDoc.token,
      totalAmount: tokenDoc.totalAmount,
      meals: tokenDoc.meals
    });
  } catch (err) {
    console.error("Payment error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verify token payment
app.post('/verify-token-payment', async (req, res) => {
  try {
    const { token, amount } = req.body;
    
    const today = new Date().toDateString();
    const tokenDoc = await Token.findOne({ token: token.toString(), date: today });
    
    if (!tokenDoc) {
      return res.json({ success: false, error: 'Token not found' });
    }

    if (tokenDoc.verified) {
      return res.json({ success: false, error: 'Token already verified' });
    }

    tokenDoc.paid = true;
    tokenDoc.verified = true;
    tokenDoc.verifiedAt = new Date();
    await tokenDoc.save();

    const user = await User.findOne({ email: tokenDoc.userEmail });
    if (user) {
      user.orders.forEach(order => {
        if (new Date(order.date).toDateString() === today && !order.paid) {
          order.paid = true;
          order.token = token.toString();
        }
      });
      await user.save();
    }

    // Send notification
    await sendPushNotification(tokenDoc.userEmail, {
      title: '✅ Payment Confirmed',
      body: `Your payment of ₹${amount} has been verified. Token #${token} is now active.`,
      type: 'payment_reminder',
      data: { url: '/dashboard' }
    });

    res.json({ success: true, message: 'Payment verified successfully' });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get token details
app.get('/token/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const today = new Date().toDateString();
    
    const tokenDoc = await Token.findOne({ token: token.toString(), date: today });
    
    if (!tokenDoc) {
      return res.json({ success: false, error: 'Token not found for today' });
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

// Verify order
app.post("/verify", async (req, res) => {
  try {
    const { userEmail, date } = req.body;
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
  console.log("⏰ Daily reminder scheduled for 10 AM (Mon-Sat)");
});