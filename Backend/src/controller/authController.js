const { validationResult } = require("express-validator");
const {generateVerificationCode,getVerificationExpiry,} = require("../utils/otp");
const emailService = require("../utils/emailService");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");


const dbConfig = require("../configs/database");
const { error } = require("node:console");
const prisma = dbConfig.prisma;

const SALT_ROUNDS = 12;


// REGISTER
exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((err) => err.msg),
      });
    }

    const { account, storeSetup, preferences } = req.body;

    const existingUser = await prisma.users.findUnique({
      where: {
        email: account.email,
      },
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "Email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(
      account.password,
      SALT_ROUNDS
    );

    const code = generateVerificationCode();
    const expiry = getVerificationExpiry();

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          full_name: `${account.firstName} ${account.lastName}`.trim(),
          email: account.email,
          password_hash: hashedPassword,

          email_verified: false,
          verification_code: code,
          verification_expires_at: expiry,

          accepted_terms: account.termsAgreed,
          accepted_privacy_policy: account.termsAgreed,
        },
      });

      const organization = await tx.organizations.create({
        data: {
          owner_id: user.id,

          // Frontend sends brand_name, DB stores company_name
          company_name: storeSetup.brand_name,

          website_url: storeSetup.storeUrl || null,
          store_url: storeSetup.storeUrl || null,

          industry: storeSetup.storeCategory,

          country: storeSetup.country,
          state_region: storeSetup.state || null,

          monthly_revenue_range:
            preferences?.monthlyRevenue || null,
        },
      });

      return {
        user,
        organization,
      };
    });

    await emailService.sendVerificationEmail(
      result.user.email,
      result.user.full_name,
      code
    );

    return res.status(201).json({
      success: true,
      message: "Verification code sent to your email.",
      data: {
        email: result.user.email,
      },
    });

  } catch (error) {
    next(error);
  }
};

//VerifyEmail
exports.verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body;

    // Check if required fields are provided
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: "Email and verification code are required.",
      });
    }

    // Find user by email
    const user = await prisma.users.findUnique({
      where: {
        email,
      },
    });

    // User not found
    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    // Already verified
    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        error: "Email has already been verified.",
      });
    }

    // Invalid verification code
    if (user.verification_code !== code.trim()) {
      return res.status(400).json({
        success: false,
        error: "Invalid verification code.",
      });
    }

    // Expired verification code
    if (
      !user.verification_expires_at ||
      new Date() > user.verification_expires_at
    ) {
      return res.status(400).json({
        success: false,
        error: "Verification code has expired.",
      });
    }

    // Update user
    await prisma.users.update({
      where: {
        id: user.id,
      },
      data: {
        email_verified: true,
        verification_code: null,
        verification_expires_at: null,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Email verified successfully.",
    });

  } catch (error) {
    next(error);
  }
};

// LOGIN
exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((err) => err.msg),
      });
    }

    const { account } = req.body;

    const user = await prisma.users.findUnique({
      where: {
        email: account.email,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(
      account.password,
      user.password_hash
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    // Check if email has been verified
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        error: "Please verify your email before logging in.",
      });
    }

    const organization = await prisma.organizations.findFirst({
      where: {
        owner_id: user.id,
      },

      select: {
        id: true,
      },
    });

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        tenantId: organization?.id || null,
      },

      process.env.JWT_SECRET,
      {
        expiresIn: "15m",
      }
    );

    const refreshToken = jwt.sign(
      {
        userId: user.id,
      },
      process.env.JWT_REFRESH_SECRET,
      {
        expiresIn: "7d",
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

//ResendVerificationEmail
exports.resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required.",
      });
    }

    const user = await prisma.users.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    if (user.email_verified) {
      return res.status(400).json({
        success: false,
        error: "Email has already been verified.",
      });
    }

    const code = generateVerificationCode();
    const expiry = getVerificationExpiry();

    await prisma.users.update({
      where: {
        id: user.id,
      },
      data: {
        verification_code: code,
        verification_expires_at: expiry,
      },
    });

    await emailService.sendVerificationEmail(
      user.email,
      user.full_name,
      code
    );

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email.",
    });

  } catch (error) {
    next(error);
  }
};


// GET CURRENT USER PROFILE
// GET CURRENT USER PROFILE
exports.getProfile = async (req, res) => {
  try {
    const user = await prisma.users.findUnique({
      where: {
        id: req.user.id,
      },
      select: {
        id: true,
        full_name: true,
        email: true,
        email_verified: true,
        onboarding_completed: true,
        status: true,
        created_at: true,
        organizations: {
          select: {
            id: true,
            company_name: true,
            website_url: true,
            store_url: true,
            industry: true,
            country: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Get profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
    });
  }
};

// LOGOUT
exports.logout = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    next(error);
  }
};

// REFRESH TOKEN
exports.refresh = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        error: "Refresh token is required.",
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(
      refresh_token,
      process.env.JWT_REFRESH_SECRET
    );

    // Find user
    const user = await prisma.users.findUnique({
      where: {
        id: decoded.userId,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found.",
      });
    }

    // Prevent unverified users from getting new access tokens
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        error: "Please verify your email before continuing.",
      });
    }

    // Get organization
    const organization = await prisma.organizations.findFirst({
      where: {
        owner_id: user.id,
      },
      select: {
        id: true,
      },
    });

    // Generate new access token
    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        tenantId: organization?.id || null,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "15m",
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
      },
    });

  } catch (error) {
    return res.status(401).json({
      success: false,
      error: "Refresh token expired or invalid.",
    });
  }
};