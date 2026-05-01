## REVLUMA PRODUCTION DEPLOYMENT GUIDE

### Deployment URLs
- **Frontend**: https://revluman.vercel.app (Vercel)
- **Backend**: https://revluma.onrender.com (Render)

### FRONTEND DEPLOYMENT (Vercel)

No additional setup needed. The frontend API configuration (`Frontend/assets/js/apiConfig.js`) automatically detects:
- Production environment: Uses `https://revluma.onrender.com/api` when hostname is `revluman.vercel.app`
- Development: Uses same-origin API or local fallback

**Verify in browser DevTools console:**
```javascript
window.REVLUMA_CONFIG
// Should show:
// {
//   apiBase: "https://revluma.onrender.com/api",
//   mode: "production"
// }
```

### BACKEND DEPLOYMENT (Render)

1. **Set Environment Variables in Render Dashboard:**
   - Go to your Render PostgreSQL service and note the `DATABASE_URL`
   - Go to your Render Web Service settings and add these environment variables:

   ```
   DATABASE_URL=<your-render-postgres-connection-string>
   NODE_ENV=production
   JWT_SECRET=<generate-a-new-secure-random-string>
   FRONTEND_URL=https://revluman.vercel.app
   CORS_ORIGINS=https://revluman.vercel.app,https://www.revluman.vercel.app
   SENDGRID_API_KEY=<your-sendgrid-key>
   SENDGRID_FROM_EMAIL=noreply@revluma.com
   SENDGRID_FROM_NAME=Revluma
   TWILIO_ACCOUNT_SID=<if-using-twilio>
   TWILIO_AUTH_TOKEN=<if-using-twilio>
   TWILIO_PHONE_NUMBER=<if-using-twilio>
   TWILIO_WHATSAPP_NUMBER=<if-using-twilio>
   ```

2. **Run Migrations on Render:**
   - Render will automatically run `npm start` which executes `npx prisma migrate deploy` before starting the server
   - Verify migrations complete successfully in Render logs

3. **Verify CORS Configuration:**
   - Backend will accept requests from:
     - `https://revluman.vercel.app`
     - `https://www.revluman.vercel.app`
   - Falls back to `CORS_ORIGINS` and `FRONTEND_URL` environment variables

### TESTING PRODUCTION DEPLOYMENT

1. **Test Login Flow:**
   ```
   1. Go to https://revluman.vercel.app/auth/loginIn.html
   2. Check browser DevTools Console for API base
   3. Attempt login - should make requests to https://revluma.onrender.com/api
   ```

2. **Test Registration Flow:**
   ```
   1. Go to https://revluman.vercel.app/auth/onboarding.html
   2. Complete registration form
   3. Verify API calls go to https://revluma.onrender.com/api
   ```

3. **Test Dashboard:**
   ```
   1. Go to https://revluman.vercel.app/dashboard/
   2. Check window.REVLUMA_CONFIG in console
   3. Verify authenticated requests reach backend
   ```

4. **Check Backend Logs on Render:**
   ```
   1. Open Render dashboard
   2. View Logs for auth/login, auth/register endpoints
   3. Verify CORS accepts frontend origin
   ```

### TROUBLESHOOTING

**Issue: 404 NOT_FOUND when logging in/signing up**
- Check `window.REVLUMA_CONFIG.apiBase` in browser console
- Verify it shows `https://revluma.onrender.com/api`
- Check Render backend logs for CORS errors

**Issue: CORS error from backend**
- Verify `CORS_ORIGINS` or `FRONTEND_URL` is set in Render environment
- Backend should show allowed origins in logs
- Clear browser cache and hard refresh (Ctrl+Shift+R or Cmd+Shift+R)

**Issue: Database migrations not running**
- Check Render logs during deploy
- Verify `DATABASE_URL` is correct
- Try manual trigger from Render dashboard

### ROLLBACK PROCEDURE

If needed to revert:
1. Revert commits to `main` branch
2. Push to GitHub
3. Render will auto-redeploy previous version
4. Verify in Render logs that correct code version deployed

### MONITORING

Monitor these endpoints on both services:
- Backend health: `https://revluma.onrender.com/health`
- Frontend loading: Check page source for correct API config

Check Render logs for:
- Database connection status
- Auth endpoint errors
- CORS rejections
