const { validationResult } = require("express-validator");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbConfig = require("../configs/database");
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

    const hashedPassword = await bcrypt.hash(account.password, SALT_ROUNDS
    );

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.users.create({
        data: {
          full_name: `${account.firstName} ${account.lastName}`.trim(),
          email: account.email,
          password_hash: hashedPassword,
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

      return { user, organization, };

    });

    const accessToken = jwt.sign(
      {
        userId: result.user.id,
        email: result.user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "15m",
      }
    );

    const refreshToken = jwt.sign(
      {
        userId: result.user.id,
      },
      process.env.JWT_REFRESH_SECRET,
      {
        expiresIn: "7d",
      }
    );

    return res.status(201).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
          id: result.user.id,
          full_name: result.user.full_name,
          email: result.user.email,
        },
        organization: {
          id: result.organization.id,
          company_name: result.organization.company_name,
        },
      },
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

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
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

// GET CURRENT USER PROFILE
exports.getProfile = async (req, res, next) => {
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
        onboarding_step: true,
        status: true,
        created_at: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
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