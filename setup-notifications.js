#!/usr/bin/env node

// setup-notifications.js - Helper script to set up push notifications

const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     MessMate Push Notification Setup                      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('🔑 Generating VAPID keys for web push notifications...\n');

// Generate VAPID keys
const vapidKeys = webpush.generateVAPIDKeys();

console.log('✅ VAPID keys generated successfully!\n');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('📋 Public Key (VAPID_PUBLIC_KEY):');
console.log(vapidKeys.publicKey);
console.log('\n🔒 Private Key (VAPID_PRIVATE_KEY):');
console.log(vapidKeys.privateKey);

console.log('\n═══════════════════════════════════════════════════════════\n');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
const envExists = fs.existsSync(envPath);

if (envExists) {
  console.log('📝 Found existing .env file. Would you like to update it? (y/n)');
  console.log('   Manual update: Copy the keys above to your .env file');
} else {
  console.log('📝 Creating .env file...');
  
  const envTemplate = `# MongoDB Configuration
MONGODB_URI=mongodb+srv://SLR:SLR@slr.eldww0q.mongodb.net/mess_db?retryWrites=true&w=majority&appName=SLR

# Server Configuration
PORT=3000
NODE_ENV=production
FRONTEND_URL=https://your-app-name.onrender.com

# Google OAuth Configuration
GOOGLE_CLIENT_ID=67430401790-jdomcgb5s0vcvsp6ln56j3g3aem2h26v.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret_here

# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=dcd0vatd4
CLOUDINARY_API_KEY=686887924855346
CLOUDINARY_API_SECRET=HcltpsGGsCldCyoBtuGMOpwv3iI

# Web Push VAPID Keys (Generated on ${new Date().toISOString()})
VAPID_PUBLIC_KEY=${vapidKeys.publicKey}
VAPID_PRIVATE_KEY=${vapidKeys.privateKey}
VAPID_MAILTO=mailto:your-email@example.com
`;

  fs.writeFileSync(envPath, envTemplate);
  console.log('✅ Created .env file with VAPID keys!');
}

console.log('\n═══════════════════════════════════════════════════════════\n');
console.log('📌 Next Steps:');
console.log('   1. Update VAPID_MAILTO in .env with your email');
console.log('   2. Update other configuration values in .env');
console.log('   3. Add the same keys to your Render.com environment variables');
console.log('   4. Start your server: npm start');
console.log('\n═══════════════════════════════════════════════════════════\n');

console.log('⚠️  IMPORTANT SECURITY NOTES:');
console.log('   • Keep your private key SECRET');
console.log('   • Never commit .env to Git (already in .gitignore)');
console.log('   • Use the same keys in production (Render.com)');
console.log('   • Push notifications only work over HTTPS');
console.log('\n═══════════════════════════════════════════════════════════\n');

console.log('🎉 Setup complete! Your push notifications are ready to use.\n');

// Create a keys backup file
const backupPath = path.join(__dirname, 'vapid-keys-backup.txt');
const backup = `VAPID Keys Generated: ${new Date().toISOString()}

Public Key:
${vapidKeys.publicKey}

Private Key:
${vapidKeys.privateKey}

⚠️  WARNING: Keep this file secure and never commit to Git!
Add these keys to:
1. Your .env file (local development)
2. Render.com environment variables (production)
`;

fs.writeFileSync(backupPath, backup);
console.log(`💾 Keys backed up to: ${backupPath}`);
console.log('   (Keep this file secure and delete after setup)\n');