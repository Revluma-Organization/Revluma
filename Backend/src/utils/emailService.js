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