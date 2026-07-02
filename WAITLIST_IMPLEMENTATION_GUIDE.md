# Revluma Waitlist Implementation Guide

## Overview
This guide covers the complete setup needed to make the waitlist fully functional with backend integration and SendGrid email notifications.

---

## Part 1: Environment Variables (.env)

Add these variables to your `.env` file in the `Backend/` directory:

### Email Service (SendGrid)
```env
SENDGRID_API_KEY="your_sendgrid_api_key_here"
SENDGRID_FROM_EMAIL="noreply@revluma.com"
SENDGRID_WELCOME_TEMPLATE_ID="your_sendgrid_template_id_for_welcome_email"
```

### Existing Variables (Already in .env.sample)
```env
PORT=8080
DATABASE_URL="your_postgresql_connection_string"
DIRECT_URL="direct_url_for_prisma"
DATABASE_USER="your_db_user"
DATABASE_PASSWORD="your_db_password"
DATABASE_PORT=5432
DATABASE_HOST="your_db_host"
DATABASE_NAME="postgres"
NODE_ENV="development"
JWT_SECRET="your_super_secret_access_token_key"
JWT_REFRESH_SECRET="your_super_secret_refresh_token_key"
JWT_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
FRONTEND_URL="http://localhost:3000"
API_KEY="your_shopify_api_key"
API_SECRET="your_shopify_api_secret"
```

---

## Part 2: Backend Implementation

### Step 1: Install SendGrid Package
```bash
cd Backend
npm install @sendgrid/mail
```

### Step 2: Create Email Service (`Backend/src/utils/emailService.js`)
```javascript
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const emailService = {
  async sendWelcomeEmail(recipientEmail, userData) {
    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Welcome to Revluma - Your Waitlist Position Confirmed!',
        html: `
          <h2>Welcome to Revluma!</h2>
          <p>Hi ${userData.full_name},</p>
          <p>Thank you for joining our waitlist! We're excited to have you on board.</p>
          <p><strong>Your Waitlist Position:</strong> #${userData.waitlist_position}</p>
          <p>We're going to be using SendGrid to keep you updated on Revluma's progress.</p>
          <p>Stay tuned for exclusive updates and early access opportunities!</p>
          <p>Best regards,<br/>The Revluma Team</p>
        `,
      };

      await sgMail.send(msg);
      return true;
    } catch (error) {
      console.error('Email send error:', error);
      throw error;
    }
  },
};

module.exports = emailService;
```

### Step 3: Create Waitlist Controller (`Backend/src/controller/waitlistController.js`)
```javascript
const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const dbConfig = require('../configs/database');
const emailService = require('../utils/emailService');

const prisma = dbConfig.prisma;

exports.joinWaitlist = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((err) => err.msg),
      });
    }

    const {
      full_name,
      work_email,
      phone_number,
      twitter_handle,
      tiktok_handle,
      instagram_handle,
      company_name,
      website_url,
      store_url,
      industry,
      country,
      state_region,
      team_size,
      monthly_revenue_range,
      monthly_order_volume,
      ecommerce_platform,
      email_platform,
      analytics_platform,
      support_platform,
      ad_platform,
      primary_goal,
      biggest_challenge,
      current_churn_problem,
      abandoned_cart_problem,
      retention_problem,
      revenue_visibility_problem,
      why_join_waitlist,
      interested_in_beta,
    } = req.body;

    // Check if email already exists
    const existingWaitlistUser = await prisma.waitlist_users.findUnique({
      where: { work_email },
    });

    if (existingWaitlistUser) {
      return res.status(400).json({
        success: false,
        error: 'This email is already on the waitlist',
      });
    }

    // Get the current highest waitlist position
    const lastWaitlistUser = await prisma.waitlist_users.findFirst({
      orderBy: { waitlist_position: 'desc' },
    });

    const nextPosition = (lastWaitlistUser?.waitlist_position || 0) + 1;

    // Calculate lead score based on answers
    const leadScore = calculateLeadScore({
      team_size,
      monthly_revenue_range,
      interested_in_beta,
      current_churn_problem,
      abandoned_cart_problem,
      retention_problem,
      revenue_visibility_problem,
    });

    // Create the waitlist record
    const waitlistUser = await prisma.waitlist_users.create({
      data: {
        id: uuidv4(),
        full_name,
        work_email,
        phone_number: phone_number || null,
        twitter_handle: twitter_handle || null,
        tiktok_handle: tiktok_handle || null,
        instagram_handle: instagram_handle || null,
        company_name,
        website_url: website_url || null,
        store_url: store_url || null,
        industry,
        country,
        state_region: state_region || null,
        team_size: team_size || null,
        monthly_revenue_range: monthly_revenue_range || null,
        monthly_order_volume: monthly_order_volume || null,
        ecommerce_platform: ecommerce_platform || null,
        email_platform: email_platform || null,
        analytics_platform: analytics_platform || null,
        support_platform: support_platform || null,
        ad_platform: ad_platform || null,
        primary_goal: primary_goal || null,
        biggest_challenge,
        current_churn_problem: Boolean(current_churn_problem),
        abandoned_cart_problem: Boolean(abandoned_cart_problem),
        retention_problem: Boolean(retention_problem),
        revenue_visibility_problem: Boolean(revenue_visibility_problem),
        why_join_waitlist: why_join_waitlist || null,
        interested_in_beta: interested_in_beta !== false,
        waitlist_position: nextPosition,
        lead_score: leadScore,
        status: 'pending',
        welcome_email_sent: false,
        ip_address: req.ip || req.connection.remoteAddress || null,
        user_agent: req.get('user-agent') || null,
      },
    });

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(work_email, {
        full_name,
        waitlist_position: nextPosition,
      });

      // Update the welcome_email_sent flag
      await prisma.waitlist_users.update({
        where: { id: waitlistUser.id },
        data: { welcome_email_sent: true },
      });
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the request if email fails, but log it
    }

    return res.status(201).json({
      success: true,
      message: 'Successfully joined the waitlist!',
      data: {
        id: waitlistUser.id,
        waitlist_position: waitlistUser.waitlist_position,
        lead_score: waitlistUser.lead_score,
        email: waitlistUser.work_email,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to calculate lead score
function calculateLeadScore(data) {
  let score = 0;

  // Team size scoring
  const teamSizeScores = {
    '1': 10,
    '2-5': 20,
    '6-10': 30,
    '11-25': 40,
    '26-50': 45,
    '50+': 50,
  };
  score += teamSizeScores[data.team_size] || 0;

  // Monthly revenue scoring
  const revenueScores = {
    '<10k': 10,
    '10k-50k': 20,
    '50k-100k': 30,
    '100k-500k': 40,
    '500k-1m': 45,
    '1m+': 50,
  };
  score += revenueScores[data.monthly_revenue_range] || 0;

  // Problem scoring (each problem = +15 points)
  if (data.current_churn_problem) score += 15;
  if (data.abandoned_cart_problem) score += 15;
  if (data.retention_problem) score += 15;
  if (data.revenue_visibility_problem) score += 15;

  // Beta interest bonus
  if (data.interested_in_beta) score += 10;

  return Math.min(score, 200); // Cap at 200
}

exports.getWaitlistStats = async (req, res, next) => {
  try {
    const stats = await prisma.waitlist_users.aggregate({
      _count: true,
      _avg: { lead_score: true },
    });

    const topLeads = await prisma.waitlist_users.findMany({
      where: { status: 'pending' },
      orderBy: { lead_score: 'desc' },
      take: 10,
      select: {
        id: true,
        full_name: true,
        company_name: true,
        lead_score: true,
        waitlist_position: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        total_waitlist_count: stats._count,
        average_lead_score: Math.round(stats._avg.lead_score || 0),
        top_leads: topLeads,
      },
    });
  } catch (error) {
    next(error);
  }
};
```

### Step 4: Create Waitlist Routes (`Backend/src/route/waitlistRoute.js`)
```javascript
const express = require('express');
const router = express.Router();
const waitlistController = require('../controller/waitlistController');
const { validateWaitlist } = require('../middlewares/validateWaitlist');

router.post('/join', validateWaitlist, waitlistController.joinWaitlist);
router.get('/stats', waitlistController.getWaitlistStats);

module.exports = router;
```

### Step 5: Create Validation Middleware (`Backend/src/middlewares/validateWaitlist.js`)
```javascript
const { body, validationResult } = require('express-validator');

exports.validateWaitlist = [
  body('full_name')
    .trim()
    .notEmpty()
    .withMessage('Full name is required'),
  body('work_email')
    .trim()
    .isEmail()
    .withMessage('Valid email is required'),
  body('company_name')
    .trim()
    .notEmpty()
    .withMessage('Company name is required'),
  body('industry')
    .trim()
    .notEmpty()
    .withMessage('Industry is required'),
  body('country')
    .trim()
    .notEmpty()
    .withMessage('Country is required'),
  body('biggest_challenge')
    .trim()
    .notEmpty()
    .withMessage('Biggest challenge is required'),
  body('phone_number').trim().optional(),
  body('twitter_handle').trim().optional(),
  body('tiktok_handle').trim().optional(),
  body('instagram_handle').trim().optional(),
  body('website_url').trim().optional(),
  body('store_url').trim().optional(),
  body('state_region').trim().optional(),
  body('team_size').trim().optional(),
  body('monthly_revenue_range').trim().optional(),
  body('monthly_order_volume').trim().optional(),
  body('ecommerce_platform').trim().optional(),
  body('email_platform').trim().optional(),
  body('analytics_platform').trim().optional(),
  body('support_platform').trim().optional(),
  body('ad_platform').trim().optional(),
  body('primary_goal').trim().optional(),
  body('why_join_waitlist').trim().optional(),
  body('current_churn_problem').optional().isBoolean(),
  body('abandoned_cart_problem').optional().isBoolean(),
  body('retention_problem').optional().isBoolean(),
  body('revenue_visibility_problem').optional().isBoolean(),
  body('interested_in_beta').optional().isBoolean(),
];
```

### Step 6: Update app.js to Include Waitlist Routes
```javascript
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const globalErrorHandler = require("./middlewares/globalHandler")
const authRoutes = require('./route/authRoute');
const waitlistRoutes = require('./route/waitlistRoute');

const app = express();

//Global Middlewares
app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true
}));

app.use(express.json());
app.use(cookieParser());

//  API Routers
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/waitlist', waitlistRoutes);

// Base API Checking Endpoint
app.get('/', (req, res) => {
    res.send('Revluma Backend API is running...');
});

// Health Check Endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date()
    });
});

// Always LAST
app.use(globalErrorHandler);

module.exports = app;
```

---

## Part 3: Frontend Integration

### Step 1: Update apiConfig.js
Create or update `Frontend/assets/js/apiConfig.js`:

```javascript
// API Configuration
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:8080/api/v1'
  : 'https://your-production-backend-url/api/v1';

async function callAPI(endpoint, method = 'GET', data = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (data) {
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.errors?.join(', ') || 'API Error');
    }

    return result;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Waitlist API Functions
async function submitWaitlistForm(formData) {
  return callAPI('/waitlist/join', 'POST', formData);
}

async function getWaitlistStats() {
  return callAPI('/waitlist/stats', 'GET');
}
```

### Step 2: Update Frontend Form Handler (in index.html)
Update the waitlist form submission to use Alpine.js properly:

```html
<form id="waitlist-form" method="POST" 
  x-data="waitlistForm()" 
  @submit.prevent="handleSubmit()"
  class="space-y-8">
  
  <!-- Form fields here -->
  
  <button type="submit" 
    :disabled="isSubmitting || !isValid"
    class="w-full px-6 py-3 rounded-full bg-white text-black font-bold hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
    <span x-show="!isSubmitting">Join the Waitlist</span>
    <span x-show="isSubmitting">Joining...</span>
  </button>
</form>

<script>
function waitlistForm() {
  return {
    isSubmitting: false,
    isValid: false,
    
    async handleSubmit() {
      this.isSubmitting = true;
      
      try {
        const form = document.getElementById('waitlist-form');
        const formData = new FormData(form);
        const data = Object.fromEntries(formData);
        
        // Convert checkboxes to booleans
        data.current_churn_problem = form.current_churn_problem?.checked || false;
        data.abandoned_cart_problem = form.abandoned_cart_problem?.checked || false;
        data.retention_problem = form.retention_problem?.checked || false;
        data.revenue_visibility_problem = form.revenue_visibility_problem?.checked || false;
        data.interested_in_beta = form.interested_in_beta?.checked !== false;
        
        const response = await submitWaitlistForm(data);
        
        if (response.success) {
          // Show success message
          this.$dispatch('show-toast', 'Successfully joined the waitlist! Check your email for confirmation.');
          form.reset();
          // Close modal if applicable
          document.querySelector('[x-data*="waitlistModal"]').__x.$data.waitlistModal = false;
        }
      } catch (error) {
        this.$dispatch('show-toast', `Error: ${error.message}`);
      } finally {
        this.isSubmitting = false;
      }
    }
  }
}
</script>
```

---

## Part 4: Manual Setup Steps

### For Development (Local):

1. **Create SendGrid Account:**
   - Go to https://sendgrid.com
   - Sign up for free account (25,000 emails/month)
   - Verify sender email address

2. **Get SendGrid API Key:**
   - Navigate to Settings → API Keys
   - Create new API Key with "Full Access"
   - Copy the key to your `.env` file as `SENDGRID_API_KEY`

3. **Get SendGrid Template ID (Optional but Recommended):**
   - Go to Email API → Dynamic Templates
   - Create a new template or use the default
   - Copy template ID to `SENDGRID_WELCOME_TEMPLATE_ID` in `.env`
   - Or use the HTML email in the emailService.js code above

4. **Set SendGrid From Email:**
   - Add `SENDGRID_FROM_EMAIL` to `.env` (e.g., noreply@yourdomain.com)
   - Must be verified in SendGrid

5. **Update Database Connection:**
   - Ensure `DATABASE_URL` is set correctly in `.env`
   - Run migrations: `npx prisma migrate dev --name init`

6. **Install Dependencies:**
   ```bash
   cd Backend
   npm install @sendgrid/mail
   npm install
   ```

7. **Start Backend Server:**
   ```bash
   npm run dev
   ```

### For Production (Render):

1. **Add Environment Variables in Render Dashboard:**
   - Go to your service settings
   - Add all variables from the `.env` section above
   - Key variables for production:
     - `SENDGRID_API_KEY` - SendGrid API key
     - `SENDGRID_FROM_EMAIL` - Verified sender email
     - `DATABASE_URL` - Production database URL
     - `FRONTEND_URL` - Production frontend URL
     - `NODE_ENV` - "production"

2. **Database Migration:**
   - Run migration as part of build process or manually:
   - Add to your Render pre-deployment script: `npx prisma migrate deploy`

3. **Verify Sender Email in SendGrid:**
   - SendGrid will only send from verified addresses
   - Production emails will be rejected if sender isn't verified

---

## Part 5: Testing the Waitlist

### Test Locally:
```bash
# 1. Start backend
cd Backend
npm run dev

# 2. Test via curl or Postman
curl -X POST http://localhost:8080/api/v1/waitlist/join \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "John Doe",
    "work_email": "john@example.com",
    "company_name": "Test Co",
    "industry": "E-commerce",
    "country": "USA",
    "biggest_challenge": "Customer retention"
  }'

# 3. Check if email was sent (check SendGrid dashboard)
# 4. Verify record in database using Prisma Studio:
npx prisma studio
```

### Test on Production:
1. Submit form through frontend
2. Check email inbox for welcome message
3. Verify record in production database

---

## Part 6: Important Notes

### SendGrid Configuration:
- Free tier: 25,000 emails/month
- Upgrade as needed: https://sendgrid.com/pricing
- Always verify sender email in SendGrid
- Template IDs are optional but recommended for professional emails

### Database Indexing:
- `waitlist_users` table already has indexes on:
  - `work_email` (unique)
  - `country`, `industry`, `lead_score`, `status`, `waitlist_position`
- This ensures fast lookups and sorting

### Security:
- API validates all inputs with `express-validator`
- SendGrid API key is never exposed to frontend
- Email addresses are validated before insertion
- IP address and user agent are logged for analytics

### Lead Scoring:
- Automatic calculation based on user answers
- Factors: team size, revenue, problems, beta interest
- Max score: 200 points
- Helps identify high-value leads

---

## Troubleshooting

### Email Not Sending:
1. Check if `SENDGRID_API_KEY` is set correctly
2. Verify sender email in SendGrid dashboard
3. Check SendGrid activity log for bounce/rejection
4. Ensure backend logs show email service initialized

### Database Connection Error:
1. Verify `DATABASE_URL` format in `.env`
2. Check database credentials
3. Ensure Supabase/database is running
4. Run: `npx prisma db push`

### CORS Error on Frontend:
1. Ensure `FRONTEND_URL` in backend `.env` matches your frontend URL
2. Check backend logs for specific CORS error

### Form Not Submitting:
1. Check browser console for JavaScript errors
2. Verify API endpoint URL in apiConfig.js
3. Check network tab for API response
4. Ensure all required fields are filled

---

## Summary Checklist

- [ ] Install SendGrid package: `npm install @sendgrid/mail`
- [ ] Add all `.env` variables from Part 1
- [ ] Create `emailService.js` in `Backend/src/utils/`
- [ ] Create `waitlistController.js` in `Backend/src/controller/`
- [ ] Create `waitlistRoute.js` in `Backend/src/route/`
- [ ] Create `validateWaitlist.js` in `Backend/src/middlewares/`
- [ ] Update `app.js` to include waitlist routes
- [ ] Create `apiConfig.js` in `Frontend/assets/js/`
- [ ] Update waitlist form handler in `Frontend/index.html`
- [ ] Create SendGrid account and get API key
- [ ] Add all environment variables to Render dashboard
- [ ] Test locally with curl/Postman
- [ ] Test in production
- [ ] Monitor SendGrid dashboard for deliverability
