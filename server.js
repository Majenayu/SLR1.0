// server.js - Enhanced with Calendar-Based Ordering and Token Management
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

// Updated Token Schema
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

// Enhanced Checkout (Calendar-Based)
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

    for (const key in ordersByDateBatch) {
      const { date, batch, meals } = ordersByDateBatch[key];
      
      // Get count of tokens for this date and batch to generate unique token number
      const tokenCount = await Token.countDocuments({ date, batch });
      const newToken = (tokenCount + 1).toString();

      const mealArray = Object.entries(meals).map(([name, data]) => ({
        name,
        quantity: data.quantity,
        price: data.price
      }));

      const totalAmount = mealArray.reduce((sum, m) => sum + (m.price * m.quantity), 0);

      const tokenDoc = new Token({
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
      
      tokens.push({
        token: newToken,
        date,
        batch,
        meals: mealArray
      });

      // Add to user orders
      mealArray.forEach(meal => {
        for (let i = 0; i < meal.quantity; i++) {
          user.orders.push({
            mealName: meal.name,
            price: meal.price,
            date: new Date(),
            orderDate: date,
            paid: true,
            batch: batch,
            token: newToken
          });
        }
      });
    }

    await user.save();

    // Send order confirmation notification
    await sendPushNotification(email, {
      title: '✅ Order Confirmed!',
      body: `Your order has been placed successfully. ${tokens.length} token(s) generated.`,
      type: 'order_update',
      reason: 'order_placed',
      data: {
        url: '/dashboard'
      }
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

// Add this new endpoint to your server.js file

// Enhanced Producer stats with batch-based counting (excludes verified orders)
app.get("/producer/stats-batch", async (req, res) => {
  try {
    const { period = 'day' } = req.query;
    const users = await User.find({});
    const today = new Date().toISOString().split('T')[0];
    
    let allOrders = [];
    let verifiedCount = 0;
    const verifiedTokens = new Set();
    
    // Collect all verified tokens for today
    const todayTokens = await Token.find({ date: today, verified: true });
    todayTokens.forEach(token => {
      verifiedTokens.add(`${token.token}-${token.batch}-${token.date}`);
      verifiedCount += token.meals.reduce((sum, m) => sum + m.quantity, 0);
    });
    
    users.forEach(u => {
      allOrders.push(...(u.orders || []));
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

    // Count meals EXCLUDING verified orders
    const mealCounts = {};
    filteredOrders.forEach(order => {
      // Create unique key for this order's token
      const tokenKey = `${order.token}-${order.batch}-${order.orderDate}`;
      
      // Only count if this token is NOT verified
      if (!verifiedTokens.has(tokenKey)) {
        mealCounts[order.mealName] = (mealCounts[order.mealName] || 0) + 1;
      }
    });

    res.json({ 
      total, 
      paid, 
      unpaid, 
      meals: mealCounts, 
      verified: verifiedCount 
    });
  } catch (err) {
    console.error("Error fetching producer stats:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

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
  console.log("🎫 Unique tokens per date & batch");
});
