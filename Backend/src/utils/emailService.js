const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const emailService = {
  async sendWelcomeEmail(recipientEmail, userData) {
    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Welcome to the Revluma Waitlist! 🎉🚀',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body {
                  font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                  line-height: 1.6;
                  color: #333;
                  background-color: #f9f9f9;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  padding: 40px;
                  border-radius: 12px;
                  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                }
                .header {
                  text-align: center;
                  margin-bottom: 30px;
                  border-bottom: 2px solid #f0f0f0;
                  padding-bottom: 20px;
                }
                .logo {
                  font-size: 28px;
                  font-weight: 800;
                  background: linear-gradient(135deg, #ffffff, #d8d8ff 45%, #b5b5ff);
                  -webkit-background-clip: text;
                  -webkit-text-fill-color: transparent;
                  background-clip: text;
                  margin-bottom: 10px;
                }
                .subtitle {
                  font-size: 14px;
                  color: #666;
                  font-weight: 500;
                }
                h1 {
                  font-size: 24px;
                  font-weight: 700;
                  color: #0a0a0a;
                  margin: 20px 0 15px 0;
                }
                .greeting {
                  font-size: 16px;
                  color: #333;
                  margin-bottom: 15px;
                }
                .position-box {
                  background: linear-gradient(135deg, #f5f5ff 0%, #f0f0ff 100%);
                  border-left: 4px solid #7c5cff;
                  padding: 20px;
                  margin: 25px 0;
                  border-radius: 8px;
                }
                .position-label {
                  font-size: 13px;
                  font-weight: 600;
                  color: #666;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                  margin-bottom: 8px;
                }
                .position-number {
                  font-size: 48px;
                  font-weight: 800;
                  color: #7c5cff;
                  margin: 0;
                }
                .position-text {
                  font-size: 13px;
                  color: #777;
                  margin-top: 8px;
                }
                .content {
                  font-size: 15px;
                  color: #555;
                  line-height: 1.8;
                  margin: 20px 0;
                }
                .features {
                  background-color: #fafafa;
                  padding: 20px;
                  border-radius: 8px;
                  margin: 25px 0;
                }
                .features-title {
                  font-size: 14px;
                  font-weight: 700;
                  color: #0a0a0a;
                  margin-bottom: 15px;
                }
                .feature-item {
                  font-size: 14px;
                  color: #555;
                  margin: 10px 0;
                  padding-left: 25px;
                  position: relative;
                }
                .feature-item:before {
                  content: "✓";
                  position: absolute;
                  left: 0;
                  color: #7c5cff;
                  font-weight: bold;
                  font-size: 16px;
                }
                .cta-section {
                  text-align: center;
                  margin: 30px 0;
                }
                .cta-button {
                  display: inline-block;
                  background: linear-gradient(135deg, #7c5cff 0%, #6b4df0 100%);
                  color: white;
                  padding: 14px 32px;
                  border-radius: 8px;
                  text-decoration: none;
                  font-weight: 600;
                  font-size: 14px;
                  transition: transform 0.2s;
                }
                .cta-button:hover {
                  transform: translateY(-2px);
                }
                .divider {
                  border: 0;
                  border-top: 1px solid #e0e0e0;
                  margin: 30px 0;
                }
                .footer {
                  text-align: center;
                  padding-top: 20px;
                  border-top: 1px solid #f0f0f0;
                  font-size: 13px;
                  color: #999;
                }
                .footer-text {
                  margin: 8px 0;
                }
                .closing {
                  font-weight: 600;
                  color: #333;
                  margin-top: 15px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <!-- Header -->
                <div class="header">
                  <div class="logo">Revluma</div>
                  <div class="subtitle">Revenue Recovery & Growth Intelligence</div>
                </div>

                <!-- Main Greeting -->
                <h1>Welcome to the Revluma Waitlist! 🎉🚀</h1>
                <p class="greeting">Hi <strong>${escapeHtml(userData.full_name)}</strong>,</p>

                <!-- Waitlist Position Box -->
                <div class="position-box">
                  <div class="position-label">Your Waitlist Position</div>
                  <div class="position-number">#${userData.waitlist_position}</div>
                  <div class="position-text">You're on the list and we're counting down to early access</div>
                </div>

                <!-- Thank You & Message -->
                <div class="content">
                  <p>Thank you for joining us early and believing in what we're building.</p>
                  <p><strong>Revluma</strong> is designed to help eCommerce brands like yours:</p>
                </div>

                <!-- Features -->
                <div class="features">
                  <div class="features-title">What Revluma Brings to Your Business</div>
                  <div class="feature-item">Recover lost revenue from abandoned carts and churning customers</div>
                  <div class="feature-item">Improve customer retention with AI-powered insights</div>
                  <div class="feature-item">Reduce operational chaos with intelligent automation</div>
                  <div class="feature-item">Make smarter decisions with AI-powered analytics</div>
                </div>

                <!-- Next Steps -->
                <div class="content">
                  <p>We'll keep you updated with our progress and let you know as soon as early access becomes available. Your position will determine priority access to the platform.</p>
                  <p><strong>Stay tuned for:</strong></p>
                  <ul style="color: #555; font-size: 14px; line-height: 1.8;">
                    <li>Exclusive beta features</li>
                    <li>Founding member benefits</li>
                    <li>Special early-bird pricing</li>
                    <li>Direct founder access</li>
                  </ul>
                </div>

                <!-- Closing -->
                <div class="content">
                  <p>We're excited to have you with us.</p>
                  <p class="closing">The Revluma Team</p>
                </div>

                <hr class="divider">

                <!-- Footer -->
                <div class="footer">
                  <div class="footer-text">📧 <strong>Questions?</strong> Reply to this email or visit us at revluma.com</div>
                  <div class="footer-text">🔒 Your data is safe. We never share your information with third parties.</div>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      const result = await sgMail.send(msg);
      console.log('✅ Welcome email sent successfully to:', recipientEmail);
      return true;
    } catch (error) {
      console.error('❌ Email send error:', error);
      throw error;
    }
  },

  async sendWaitlistNotification(recipientEmail, subject, message) {
    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: subject,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body {
                  font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                  line-height: 1.6;
                  color: #333;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 40px;
                }
                .logo {
                  font-size: 24px;
                  font-weight: 800;
                  margin-bottom: 30px;
                }
                .content {
                  font-size: 15px;
                  color: #555;
                  line-height: 1.8;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="logo">Revluma</div>
                <div class="content">${message}</div>
                <br>
                <p>Best regards,<br><strong>The Revluma Team</strong></p>
              </div>
            </body>
          </html>
        `,
      };

      await sgMail.send(msg);
      console.log('✅ Notification email sent to:', recipientEmail);
      return true;
    } catch (error) {
      console.error('❌ Notification email error:', error);
      throw error;
    }
  },
};

module.exports = emailService;