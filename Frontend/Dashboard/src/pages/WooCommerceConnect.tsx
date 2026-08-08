import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Loader2, ExternalLink, Plug, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

function FieldInfo({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`How to find your ${title}`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-t3 transition-colors hover:text-t1"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[280px] border-border-md bg-bg-3 p-3.5 text-t2 shadow-elegant"
      >
        <p className="mb-1.5 flex items-center gap-1.5 text-[0.78rem] font-semibold text-t1">
          <ShieldCheck className="h-3.5 w-3.5" style={{ color: "hsl(var(--accent))" }} />
          {title}
        </p>
        <div className="space-y-1.5 text-[0.74rem] leading-relaxed text-t2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

interface WooCommerceConnectProps {
  accentColor: string;
  onCancel: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

export const WooCommerceConnect: React.FC<WooCommerceConnectProps> = ({
  accentColor,
  onCancel,
  onSuccess,
  onError,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  
  const [isConnecting, setIsConnecting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // STEP 1: Connect & Redirect
  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeUrl) return;
    setIsConnecting(true);
    
    try {
      const res = await api.post('/api/v1/integrations/woocommerce/connect', { storeUrl });
      
      if (res.data?.redirectUrl) {
        window.open(res.data.redirectUrl, '_blank');
      } else {
        throw new Error("No redirect URL returned from the backend");
      }
      setStep(2);
    } catch (err: any) {
      console.error("WooCommerce connect failed:", err);
      onError(err.message || "We couldn't connect to your store. Please check the URL.");
    } finally {
      setIsConnecting(false);
    }
  };

  // STEP 2: Verify API Keys
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consumerKey || !consumerSecret) return;
    setIsVerifying(true);

    try {
      await api.post('/api/v1/integrations/woocommerce/callback', { 
        storeUrl, 
        consumerKey, 
        consumerSecret 
      });
      onSuccess();
    } catch (err: any) {
      console.error("WooCommerce verification failed:", err);
      onError(err.message || 'Invalid API keys. Please try again.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 mt-1">
      {/* Security Notice (Matches screenshot perfectly) */}
      <div className="flex items-start gap-2 rounded-lg border border-border-md bg-glass/[0.02] px-3 py-2.5 text-[0.72rem] leading-relaxed text-t3">
        <ShieldCheck className="mt-[1px] h-3.5 w-3.5 shrink-0" style={{ color: accentColor }} />
        Your credentials are encrypted and only ever used to sync orders and customers from your store.
      </div>

      <AnimatePresence mode="wait">
        
        {/* STEP 1: CONNECT STORE */}
        {step === 1 && (
          <motion.form 
            key="step1"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            onSubmit={handleConnect} 
            className="space-y-3.5"
          >
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-t2">
                Store URL
                <FieldInfo title="Store URL">
                  <p>The full web address of your WooCommerce store, including <span className="text-t1">https://</span>.</p>
                  <p className="text-t3">Example: https://yourstore.com</p>
                </FieldInfo>
              </label>
              <input
                type="url"
                placeholder="https://yourstore.com"
                required
                disabled={isConnecting}
                className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none transition-colors focus:border-[color:var(--woo-focus)] disabled:opacity-50"
                style={{ ["--woo-focus" as string]: accentColor }}
                value={storeUrl}
                onChange={e => setStoreUrl(e.target.value)}
              />
            </div>
            
            <div className="flex gap-2 mt-1">
              <button 
                type="button" 
                onClick={onCancel} 
                className="flex-1 rounded-md border border-border bg-bg-2 py-2 text-[0.82rem] font-medium text-t2 hover:bg-glass/[0.04]"
              >
                Cancel
              </button>
              <button 
                type="submit" 
                disabled={!storeUrl || isConnecting} 
                className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-[0.82rem] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50" 
                style={{ background: accentColor }}
              >
                {isConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                Authorize
              </button>
            </div>
          </motion.form>
        )}

        {/* STEP 2: VERIFY KEYS */}
        {step === 2 && (
          <motion.form 
            key="step2"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            onSubmit={handleVerify} 
            className="space-y-3.5"
          >
            <div className="space-y-1.5 opacity-60">
              <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-t2">
                Connected Store
              </label>
              <input
                type="url"
                disabled
                className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none"
                value={storeUrl}
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-t2">
                Consumer Key
                <FieldInfo title="Consumer Key">
                  <p>Found in your WordPress admin under:</p>
                  <p className="text-t1">WooCommerce → Settings → Advanced → REST API</p>
                  <p>Click <span className="text-t1">Add key</span>, set to <span className="text-t1">Read/Write</span>, then generate. Starts with <span className="text-t1">ck_</span>.</p>
                </FieldInfo>
              </label>
              <input
                type="text"
                required
                placeholder="ck_..."
                disabled={isVerifying}
                className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none transition-colors focus:border-[color:var(--woo-focus)] disabled:opacity-50"
                style={{ ["--woo-focus" as string]: accentColor }}
                value={consumerKey}
                onChange={e => setConsumerKey(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-[0.75rem] font-medium text-t2">
                Consumer Secret
                <FieldInfo title="Consumer Secret">
                  <p>Generated alongside your Consumer Key. It starts with <span className="text-t1">cs_</span>.</p>
                </FieldInfo>
              </label>
              <input
                type="password"
                required
                placeholder="cs_..."
                disabled={isVerifying}
                className="w-full rounded-md border border-border bg-bg-3 px-3 py-2 text-[0.82rem] text-t1 outline-none transition-colors focus:border-[color:var(--woo-focus)] disabled:opacity-50"
                style={{ ["--woo-focus" as string]: accentColor }}
                value={consumerSecret}
                onChange={e => setConsumerSecret(e.target.value)}
              />
            </div>

            <div className="flex gap-2 mt-1">
              <button 
                type="button" 
                onClick={() => setStep(1)} 
                className="flex-1 rounded-md border border-border bg-bg-2 py-2 text-[0.82rem] font-medium text-t2 hover:bg-glass/[0.04]"
              >
                Back
              </button>
              <button 
                type="submit" 
                disabled={!consumerKey || !consumerSecret || isVerifying} 
                className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-[0.82rem] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50" 
                style={{ background: accentColor }}
              >
                {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                Verify & Sync
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
};
        
