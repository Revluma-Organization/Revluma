import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, AlertCircle, Loader2, Shield, CheckCircle2 } from 'lucide-react';

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [formData, setFormData] = useState({
    fullName: '',
    password: '',
    confirmPassword: ''
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  // If there's no token in the URL, immediately show an error state
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 p-8 text-center"
        >
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Invalid Invitation
          </h2>
          <p className="text-slate-600 dark:text-slate-400">
            This invitation link is invalid or has expired. Please ask your workspace admin to send you a new invite.
          </p>
        </motion.div>
      </div>
    );
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    // Clear error when user types
    if (errorMessage) setErrorMessage('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    // Frontend validation
    if (formData.password !== formData.confirmPassword) {
      setErrorMessage("Passwords don't match. Please check and try again.");
      return;
    }
    
    if (formData.password.length < 8) {
      setErrorMessage("Password must be at least 8 characters long.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // TODO: api.post('/auth/accept-invite', { token, ...formData })
      console.log('Submitting invitation acceptance for:', formData.fullName);
      
      setIsSuccess(true);
    } catch (error) {
      setErrorMessage('Failed to accept invitation. Please try again later.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 p-8 text-center"
        >
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
            Welcome to Revluma!
          </h2>
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            Your account has been successfully set up. You can now access your workspace.
          </p>
          <button 
            onClick={() => window.location.href = '/dashboard'}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
          >
            Go to Dashboard
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-200 dark:border-slate-800 p-8"
      >
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-sm">
            <Shield size={24} />
          </div>
        </div>
        
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Join your team
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            Set up your Revluma account to accept the invitation
          </p>
        </div>

        {errorMessage && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-6 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3"
          >
            <AlertCircle className="text-red-600 dark:text-red-500 shrink-0 mt-0.5" size={18} />
            <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Full Name
            </label>
            <input
              type="text"
              name="fullName"
              required
              value={formData.fullName}
              onChange={handleChange}
              className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
              placeholder="Jane Doe"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                name="password"
                required
                value={formData.password}
                onChange={handleChange}
                className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                name="confirmPassword"
                required
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full px-3 py-2.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-colors pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed mt-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" size={18} />
                <span>Setting up account...</span>
              </>
            ) : (
              <span>Accept Invitation</span>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
