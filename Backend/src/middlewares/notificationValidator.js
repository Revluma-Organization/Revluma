const { query, param } = require("express-validator");

exports.validateGetNotifications = [
  query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be an integer between 1 and 100"),
];

exports.validateMarkNotificationRead = [
  param("id")
    .isUUID()
    .withMessage("Invalid notification id"),
];