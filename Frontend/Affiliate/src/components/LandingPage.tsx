import { useState } from 'react';
import {
  ArrowRight, Shield, Zap, Sparkles, User, Database, Coins, Layers,
  HelpCircle, ChevronDown, CheckCircle2, ChevronRight, Globe, TrendingUp, Flame, Code
} from 'lucide-react';
import { PartnerProfile } from '../types';
import revlumaLogo from '../assets/images/Revluma-logo.png';
import splendorImg from '../assets/images/Splendor.jpg';

interface LandingPageProps {
  onNavigateToAuth: (view: 'login' | 'register') => void;
  currentProfile: PartnerProfile | null;
  onNavigateToDashboard: () => void;
}

export default function LandingPage({ onNavigateToAuth, currentProfile, onNavigateToDashboard }: LandingPageProps) {
  // Calculator state for compounding partner incentives
  const [activeAudience, setActiveAudience] = useState(5000);
  const [conversionRate, setConversionRate] = useState(1); // percent
  const [avgTicketPrice, setAvgTicketPrice] = useState(20); // Monthly recurring first 12 months plan
  const partnerCommission = 0.40; // 30% recurring first 12 months

  // FAQ Active State
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Computed projections
  const estimatedReferrals = Math.floor(activeAudience * (conversionRate / 100));
  const estimatedMrr = Number((estimatedReferrals * avgTicketPrice * partnerCommission).toFixed(2));
  const estimatedAnnualPayout = Number((estimatedMrr * 12).toFixed(2));

  const faqs = [
    {
      q: "What is Revluma?",
      a: "Revluma AI is an AI-powered eCommerce operations and revenue intelligence platform focused on helping online brands recover lost revenue, spot winning products, automate retention workflows, analyze customer behavior, and reduce operational inefficiencies. It aims to act as a centralized operational layer instead of businesses relying on disconnected & fragmanted tools and manual processes. The core idea behind Revluma is that most eCommerce stores leak money through abandoned checkouts, spotting winning products before competitors do, weak retention systems, fragmented analytics, bad inventory management, poor customer lifecycle management, and slow decision-making. Revluma is being built to solve those problems through automation, predictive intelligence, and unified business operations."
    },
    {
      q: "What is Luminor Terminal?",
      a: "Luminor Terminal is the central intelligence house building scalable AI-guided infrastructure systems, predictive databases, and behavioral automation frameworks for modern global digital commerce networks."
    },
    {
      q: "How does the partner program work?",
      a: "As an approved Revluma Partner, you receive a custom referral ID and campaign console. Every commerce brand or business leader you introduce who registers a paid account unlocks recurring first 12 months commission streams (starting at 20% and upgrading to 40% on performance tiers)."
    },
    {
      q: "Is this recurring first 12 months commission based?",
      a: "Yes. Unlike transactional static referral codes, all Revluma agreements operate on a recurring subscription structure. As long as your referred brands remain active on their AI operations plan, if they upgrade to a higher plan, you commission increases and vice versa, your commission continues monthly for the first 12 months."
    },
    {
      q: "What tools are provided for creators and partners?",
      a: "We configure an enterprise-grade Growth Operating System dashboard. Inside, you secure custom UTM campaign links, visual telemetry charts, promotional templates (Twitter, Reddit, Email newsletters, ads), an active server-side AI Content Assistant powered by Grok, and real-time support alerts."
    },
    {
      q: "Who can apply, and how does the selective approval work?",
      a: "We seek high-quality operators, e-commerce consultants, SaaS developers, and marketing experts. Every application undergoes strict manual review by our Luminor Terminal Operations Team. Approvals are vetted based on audience alignment, portfolio context, and operational experience."
    },
    {
      q: "When and how are partner payouts processed?",
      a: "Commissions are cleared within 24 hours following the billing month closure. cleared funds are systematically deposited directly to your bank account or connected Stripe wallet (customizable in your client settings page)."
    }
  ];

  return (
    <div id="landing-container" className="min-h-screen bg-zinc-950 text-zinc-100 geo-grid relative selection:bg-blue-600 selection:text-white">
      {/* Background radial atmosphere controls */}
      <div className="absolute top-0 left-0 right-0 h-[600px] glow-blue pointer-events-none z-0"></div>
      <div className="absolute top-[200vh] left-[10%] w-[80vw] h-[600px] glow-blue pointer-events-none opacity-40 z-0"></div>

      {/* Sticky Top Navbar */}
      <nav id="landing-navbar" className="sticky top-0 z-50 bg-black/60 backdrop-blur-xl border-b border-zinc-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo/Brand */}
            <div className="flex items-center space-x-3 select-none">
              <img src={revlumaLogo} alt="Revluma" className="w-14 h-14 object-contain rounded-md" />
              <div className="flex flex-col">
                <span className="font-display font-semibold tracking-tight text-white text-lg">REVLUMA</span>
                <span className="text-[10px] text-zinc-500 font-mono tracking-wider">BY LUMINOR TERMINAL</span>
              </div>
            </div>

            {/* Middle Nav Links */}
            <div className="hidden md:flex items-center space-x-8 text-sm font-medium text-zinc-400">
              <a href="#about" className="hover:text-white transition-colors">About</a>
              <a href="#revluma" className="hover:text-white transition-colors">Revluma</a>
              <a href="#program" className="hover:text-white transition-colors">Program</a>
              <a href="#partner-requirements" className="hover:text-white transition-colors">Requirements</a>
              <a href="#benefits" className="hover:text-white transition-colors">Benefits</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            </div>

            {/* CTAs */}
            <div className="flex items-center space-x-4">
              {currentProfile ? (
                <button
                  onClick={onNavigateToDashboard}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition-all flex items-center gap-1.5"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Terminal Dashboard
                </button>
              ) : (
                <>
                  <button
                    onClick={() => onNavigateToAuth('login')}
                    className="text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                  >
                    Login
                  </button>
                  <button
                    onClick={() => onNavigateToAuth('register')}
                    className="px-4 py-2 rounded-lg text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-all hover:scale-[1.02]"
                  >
                    Become a Partner
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        {/* HERO SECTION */}
        <section id="hero" className="text-center max-w-4xl mx-auto mb-28">
          {/* Subtle tag indicator */}
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 mb-8 font-mono">
            <Sparkles className="w-3 h-3 text-zinc-300" />
            <span>Revluma Affiliate Partnership Program</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-display font-bold tracking-tight text-white mb-6 leading-tight">
            Revluma Affiliate Partnership<br />
            <span className="bg-gradient-to-r from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent">
              Program.
            </span>
          </h1>

          <p className="text-base sm:text-lg text-zinc-400 mb-10 leading-relaxed max-w-2xl mx-auto">
            Welcome to the <strong>Revluma Affiliate Partnership Program</strong>. Help modern ecommerce brands recover lost revenue, automate retention workflows, and scale customer growth with AI-powered commerce intelligence. Earn recurring first 12 months commissions while introducing businesses to the future of ecommerce operations.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => onNavigateToAuth('register')}
              className="w-full sm:w-auto px-8 py-4 rounded-xl font-semibold bg-white text-zinc-950 hover:bg-zinc-100 font-display flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
            >
              Become a Founding Partner
              <ArrowRight className="w-4 h-4 text-zinc-950" />
            </button>
            <a
              href="#calculator"
              className="w-full sm:w-auto px-6 py-4 rounded-xl font-semibold bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-zinc-300 font-display transition-all block text-center"
            >
              Calculate Referral Yield
            </a>
          </div>

          {/* Interactive Core Platform Metric Box */}
          <div className="mt-16 p-px bg-zinc-800 rounded-2xl">
            <div className="bg-zinc-950 rounded-2xl p-8 flex flex-col md:flex-row gap-8 items-center text-left">
              <div className="flex-1">
                <div className="flex items-center space-x-2 text-zinc-400 text-xs font-mono tracking-wider uppercase mb-2">
                  <Database className="w-3.5 h-3.5" />
                  <span>Interactive Real-time Yield Analytics</span>
                </div>
                <h3 className="text-xl font-display font-medium text-white mb-1">
                  Compound Revenue Recovery Live Sandbox
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Toggle target audience details below to evaluate how your referral tier compounds. Revluma pays recurring first 12 months Monthly SaaS yields on all active operations accounts.
                </p>
              </div>
              <div className="w-full md:w-auto grid grid-cols-2 md:flex gap-4 md:space-x-8">
                <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-center min-w-[120px]">
                  <span className="block text-[10px] text-zinc-500 font-mono">RECOVERY INDEX</span>
                  <span className="text-lg font-display font-bold text-white">+22.4%</span>
                </div>
                <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-center min-w-[120px]">
                  <span className="block text-[10px] text-zinc-500 font-mono">ECOSYSTEM SCALE</span>
                  <span className="text-lg font-display font-bold text-white">4.8M+</span>
                </div>
                <div className="p-4 bg-zinc-900 rounded-xl border border-zinc-800 text-center min-w-[120px]">
                  <span className="block text-[10px] text-zinc-500 font-mono">PARTNERS DISPATCHED</span>
                  <span className="text-lg font-display font-bold text-white">1,240+</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: PARENT COMPANY (Luminor Terminal) */}
        <section id="about" className="py-16 border-t border-zinc-900">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-xs text-zinc-450 font-mono">
                <Code className="w-3.5 h-3.5 text-zinc-500" />
                <span>PARENT INFRASTRUCTURE ENTITY</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-display font-bold text-white leading-tight">
                Luminor Terminal: Building the <br />Next Gen AI Infrastructure.
              </h2>
              <p className="text-zinc-400 text-sm sm:text-base leading-relaxed">
                Luminor Terminal builds secure AI infrastructure designed to redefine operational efficiency for the commerce era. We reject simple API wraps, engineering dedicated database abstractions, high-performance web servers, and algorithmic triggers that protect, analyze, and retain high-growth commercial assets.
              </p>
              <div className="grid grid-cols-2 gap-6 pt-2">
                <div className="flex items-start space-x-3">
                  <div className="mt-1 p-1 bg-zinc-900 rounded border border-zinc-805">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">Autonomous Scaling</h4>
                    <p className="text-xs text-zinc-500">Autonomous cluster orchestration handles traffic spikes seamlessly.</p>
                  </div>
                </div>
                <div className="flex items-start space-x-3">
                  <div className="mt-1 p-1 bg-zinc-900 rounded border border-zinc-805">
                    <CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-white">PostgreSQL Abstractions</h4>
                    <p className="text-xs text-zinc-500">RLS-hardened relational backends optimized for zero latency.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 p-6 bg-zinc-900/40 rounded-2xl border border-zinc-800/80 relative overflow-hidden flex flex-col justify-between min-h-[340px]">
              <div className="absolute top-0 right-0 -mr-16 -mt-16 w-38 h-38 bg-zinc-800/10 rounded-full blur-3xl pointer-events-none"></div>
              <div>
                <span className="font-mono text-[9px] text-zinc-500 tracking-widest block mb-1 uppercase">Mission Framework</span>
                <p className="font-display text-zinc-200 text-lg leading-relaxed italic">
                  &ldquo;To construct intelligence layers that sit quietly on top of global database clusters, automating commercial decisions and allowing teams to scale effortlessly without operational bottlenecks.&rdquo;
                </p>
              </div>
              <div className="pt-6 border-t border-zinc-800">
                <div className="font-mono text-xs text-zinc-400">Luminor Operations Core</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">EST. Cloud Relational Infrastructure, LLC</div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: PRODUCT (Revluma) */}
        <section id="revluma" className="py-20 border-t border-zinc-900">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs text-zinc-400 uppercase font-mono tracking-widest block mb-3">Core Application Feature Suite</span>
            <h2 className="text-3xl sm:text-4xl font-display font-medium text-white mb-4">
              Revluma transforms silent data into active revenue.
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Our autonomous customer analysis helps commerce storefronts secure their leaks, target customer retention sequences based on user activity levels, and auto-segment behaviors.
            </p>
          </div>

          <div id="product-grid" className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="p-6 bg-zinc-900/50 hover:bg-zinc-900/70 border border-zinc-850 rounded-2xl transition-all space-y-4">
              <div className="w-10 h-10 bg-zinc-805 rounded-lg flex items-center justify-center border border-zinc-800">
                <Coins className="w-5 h-5 text-zinc-300" />
              </div>
              <h3 className="text-lg font-display font-semibold text-white">Autonomous Revenue Recovery</h3>
              <p className="text-xs text-zinc-450 leading-relaxed">
                Revluma automates the micro-attribution of dropped shopping sessions, healing transactional links and driving client recovery margins up by a measurable 22.4%.
              </p>
            </div>

            {/* Card 2 */}
            <div className="p-6 bg-zinc-900/50 hover:bg-zinc-900/70 border border-zinc-850 rounded-2xl transition-all space-y-4">
              <div className="w-10 h-10 bg-zinc-805 rounded-lg flex items-center justify-center border border-zinc-800">
                <Zap className="w-5 h-5 text-zinc-300" />
              </div>
              <h3 className="text-lg font-display font-semibold text-white">Retention Automation Loops</h3>
              <p className="text-xs text-zinc-450 leading-relaxed">
                Maintains behavioral telemetry on all subscribers, predicting customer fatigue signals 14 days before a cancellation vector forms, dispatching contextual offers.
              </p>
            </div>

            {/* Card 3 */}
            <div className="p-6 bg-zinc-900/50 hover:bg-zinc-900/70 border border-zinc-850 rounded-2xl transition-all space-y-4">
              <div className="w-10 h-10 bg-zinc-805 rounded-lg flex items-center justify-center border border-zinc-800">
                <TrendingUp className="w-5 h-5 text-zinc-300" />
              </div>
              <h3 className="text-lg font-display font-semibold text-white">Predictive Customer Segments</h3>
              <p className="text-xs text-zinc-455 leading-relaxed">
                Ditch outdated demographic categorization. Revluma builds predictive clusters using active operational parameters and purchase recurrence speeds.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION: YIELD CALCULATOR */}
        <section id="calculator" className="py-20 border-t border-zinc-900">
          <div className="glass-card rounded-2xl p-8 max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <div className="font-mono text-[10px] text-zinc-450 uppercase tracking-widest mb-1">INTERACTIVE INCENTIVES CALCULATOR</div>
              <h3 className="text-2xl font-display font-semibold text-white mb-2">Estimate Your Affiliate Payouts</h3>
              <p className="text-xs text-zinc-400 max-w-xl mx-auto">
                Discover the recurring first 12 months revenue scaling metrics backed by Revluma's generous 40% founding partner incentive rates.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="space-y-6">
                {/* Control 1 */}
                <div>
                  <div className="flex justify-between text-xs font-medium text-zinc-400 mb-2">
                    <span>Audience Reach</span>
                    <span className="text-white font-mono font-bold">{activeAudience.toLocaleString()} leads</span>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="50000"
                    step="1000"
                    value={activeAudience}
                    onChange={(e) => setActiveAudience(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-200"
                  />
                </div>

                {/* Control 2 */}
                <div>
                  <div className="flex justify-between text-xs font-medium text-zinc-400 mb-2">
                    <span>Assumed Conversion Rate</span>
                    <span className="text-white font-mono font-bold">{conversionRate}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="30"
                    step="0.5"
                    value={conversionRate}
                    onChange={(e) => setConversionRate(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-200"
                  />
                </div>

                {/* Control 3 */}
                <div>
                  <div className="flex justify-between text-xs font-medium text-zinc-400 mb-2">
                    <span>Average Monthly Contract Value</span>
                    <span className="text-white font-mono font-bold">${avgTicketPrice} / mo</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="999"
                    step="10"
                    value={avgTicketPrice}
                    onChange={(e) => setAvgTicketPrice(Number(e.target.value))}
                    className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-200"
                  />
                </div>
              </div>

              {/* Earnings Reveal Box */}
              <div className="p-6 bg-zinc-950 rounded-xl border border-zinc-800 text-center space-y-4">
                <div>
                  <span className="text-[10px] text-zinc-500 font-mono block uppercase">ESTIMATED ACTIVE REFERRALS</span>
                  <span className="text-2xl font-display font-medium text-white">{estimatedReferrals} active brands</span>
                </div>
                <div className="py-4 border-y border-zinc-900 bg-zinc-900/45 rounded-lg border-zinc-850">
                  <span className="text-[10px] text-zinc-400 font-mono block uppercase">MONTHLY RECURRING FIRST 12 MONTHS REVENUE (MRR)</span>
                  <span className="text-4xl font-display font-bold text-white">${estimatedMrr.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 font-mono block uppercase">ANNUAL REVENUE YIELD</span>
                  <span className="text-lg font-mono font-medium text-white">${estimatedAnnualPayout.toLocaleString()} / year</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: PARTNER REQUIREMENTS & ONBOARDING */}
        <section id="partner-requirements" className="py-20 border-t border-zinc-900">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs text-zinc-500 font-mono tracking-widest block uppercase mb-3">Program Standards</span>
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-white">
              Partner Requirements &amp; Onboarding
            </h2>
            <p className="text-sm text-zinc-400 mt-3 leading-relaxed max-w-2xl mx-auto">
              To maintain the quality of the Revluma Affiliate Partnership Program, all applicants go through a structured onboarding process.
            </p>
          </div>

          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Card 1 */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-300 group-hover:border-zinc-600 transition-colors">01</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">Account Review &amp; Vetting</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">Every application is manually reviewed to ensure alignment with the Revluma brand and partner standards.</p>
                </div>
              </div>
            </div>

            {/* Card 2 */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-300 group-hover:border-zinc-600 transition-colors">02</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">1-Week Partner Orientation</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">Approved partners complete a short orientation program covering Revluma, ecommerce intelligence, positioning, and promotion best practices.</p>
                </div>
              </div>
            </div>

            {/* Card 3 */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-300 group-hover:border-zinc-600 transition-colors">03</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">Access to Partner Resources</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">Receive marketing assets, product guides, referral tools, and campaign resources designed to help you succeed.</p>
                </div>
              </div>
            </div>

            {/* Card 4 */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-300 group-hover:border-zinc-600 transition-colors">04</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">Professional Conduct</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">Partners are expected to represent Revluma professionally and promote the platform accurately and ethically.</p>
                </div>
              </div>
            </div>

            {/* Card 5 */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-300 group-hover:border-zinc-600 transition-colors">05</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">Performance-Based Growth</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">Top-performing partners may receive higher commission tiers, exclusive incentives, priority support, and early access to new products and features.</p>
                </div>
              </div>
            </div>

            {/* Card 6 */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-300 group-hover:border-zinc-600 transition-colors">06</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">Ongoing Support</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">Our team provides continuous guidance, product updates, and partner assistance to help maximize results.</p>
                </div>
              </div>
            </div>

            {/* Card 7 */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-800/60 rounded-2xl hover:border-zinc-700 hover:bg-zinc-900/50 transition-all duration-300">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-300 group-hover:border-zinc-600 transition-colors">07</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">Commission Eligibility</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">Commissions are earned on verified referrals that meet program requirements and remain in good standing.</p>
                </div>
              </div>
            </div>

            {/* Card 8 — full width */}
            <div className="group p-6 bg-zinc-900/30 border border-zinc-700 rounded-2xl hover:border-zinc-600 hover:bg-zinc-900/60 transition-all duration-300 md:col-span-2 relative overflow-hidden">
              <div className="absolute top-0 right-0 py-1 px-3 bg-white text-[8.5px] font-mono text-zinc-950 rounded-bl border-b border-l border-zinc-800 uppercase tracking-widest font-bold">Long-Term Vision</div>
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-8 h-8 bg-zinc-900 border border-zinc-600 rounded-lg flex items-center justify-center font-mono text-[10px] text-zinc-200 group-hover:border-zinc-500 transition-colors">08</div>
                <div className="space-y-1.5">
                  <h4 className="text-sm font-display font-semibold text-white">Long-Term Partnership</h4>
                  <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl">We're building a network of growth partners committed to helping ecommerce brands scale through AI-powered commerce intelligence. This is a relationship built to last with shared success as the foundation.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION: PROGRAM TIMELINE & MILESTONES */}
        <section id="program" className="py-20 border-t border-zinc-900">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs text-zinc-500 font-mono tracking-widest block uppercase mb-3">Onboarding Roadmap</span>
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-white">
              The Path to Elite Partnership
            </h2>
            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
              We vet growth ecosystems rigorously to maintain operational excellence and customer compliance.
            </p>
          </div>

          <div className="relative border-l border-zinc-800 ml-4 md:ml-40 space-y-12">
            {/* Step 1 */}
            <div className="relative pl-8">
              <div className="absolute -left-3 top-1.5 w-6 h-6 rounded-full bg-zinc-950 border-2 border-zinc-600 flex items-center justify-center font-mono text-[10px] text-white">1</div>
              <div className="absolute -left-36 top-1 hidden md:block text-right w-28 font-mono text-xs text-zinc-500">PHASE 01 // APPLY</div>
              <h4 className="text-lg font-display font-semibold text-white">Application & Portfolio Review</h4>
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">
                Submit an overview of your audience segment, commerce agency portfolio, or developer credentials. We scrutinize compliance frameworks.
              </p>
            </div>

            {/* Step 2 */}
            <div className="relative pl-8">
              <div className="absolute -left-3 top-1.5 w-6 h-6 rounded-full bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center font-mono text-[10px] text-zinc-400">2</div>
              <div className="absolute -left-36 top-1 hidden md:block text-right w-28 font-mono text-xs text-zinc-500">PHASE 02 // ACCESS</div>
              <h4 className="text-lg font-display font-semibold text-white">Custom Growth Terminal Deployment</h4>
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">
                Approved accounts receive dynamic onboarding credentials. Secure your customized analytics links, UTM tracking parameters, and campaign directories.
              </p>
            </div>

            {/* Step 3 */}
            <div className="relative pl-8">
              <div className="absolute -left-3 top-1.5 w-6 h-6 rounded-full bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center font-mono text-[10px] text-zinc-400">3</div>
              <div className="absolute -left-36 top-1 hidden md:block text-right w-28 font-mono text-xs text-zinc-500">PHASE 03 // SCALE</div>
              <h4 className="text-lg font-display font-semibold text-white">AI Copilot Dispatch & Conversion Analysis</h4>
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">
                Utilize our server-side Gemini AI content builder to craft specialized campaigns and newsletter bulletins. Review detailed attribution channels.
              </p>
            </div>

            {/* Step 4 */}
            <div className="relative pl-8">
              <div className="absolute -left-3 top-1.5 w-6 h-6 rounded-full bg-zinc-950 border-2 border-zinc-800 flex items-center justify-center font-mono text-[10px] text-zinc-400">4</div>
              <div className="absolute -left-36 top-1 hidden md:block text-right w-28 font-mono text-xs text-zinc-500">PHASE 04 // COMMAND</div>
              <h4 className="text-lg font-display font-semibold text-white">Compounding Recurring First 12 Months Payouts</h4>
              <p className="text-xs text-zinc-400 mt-1 max-w-xl">
                Clear customer referrals shift into the billing cycle. Review monthly commission clearances, retained accounts, and watch your margins expand.
              </p>
            </div>
          </div>
        </section>

        {/* SECTION: PARTNER TIERS */}
        <section id="benefits" className="py-20 border-t border-zinc-900">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs text-zinc-500 font-mono tracking-widest block uppercase mb-3">Loyalty Progress Framework</span>
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-white">
              Ecosystem Tiers &amp; Commission Tiers
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Tier 1 */}
            <div className="p-6 bg-zinc-900/40 rounded-xl border border-zinc-850 hover:border-zinc-800 transition-colors flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono text-zinc-500">TIER 01</span>
                <h4 className="text-lg font-display font-semibold text-white uppercase mt-1">Affiliate</h4>
                <div className="text-2xl font-bold text-zinc-300 my-3">20% <span className="text-xs text-zinc-500 font-normal">Recurring First 12 Months</span></div>
                <ul className="space-y-2 mt-4 text-xs text-zinc-400">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Basic Campaign Dashboard</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> standard Copy Center</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> standard bank payouts</li>
                </ul>
              </div>
              <div className="mt-8 pt-4 border-t border-zinc-850 text-[10px] text-zinc-500 font-mono">UNLOCK // DEFAULT START</div>
            </div>

            {/* Tier 2 */}
            <div className="p-6 bg-zinc-900/40 rounded-xl border border-zinc-850 hover:border-zinc-800 transition-colors flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono text-zinc-500">TIER 02</span>
                <h4 className="text-lg font-display font-semibold text-white uppercase mt-1 font-sans">Growth</h4>
                <div className="text-2xl font-bold text-zinc-300 my-3">30% <span className="text-xs text-zinc-500 font-normal">Recurring First 12 Months</span></div>
                <ul className="space-y-2 mt-4 text-xs text-zinc-400">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Advanced Campaign UTMs</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Gemini Copy Assistant access</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Custom branding collateral</li>
                </ul>
              </div>
              <div className="mt-8 pt-4 border-t border-zinc-850 text-[10px] text-zinc-500 font-mono">UNLOCK // 10 ACTIVE REFERRALS</div>
            </div>

            {/* Tier 3 */}
            <div className="p-6 bg-zinc-900 rounded-xl border border-zinc-700 hover:border-zinc-600 transition-colors flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 py-1 px-3 bg-white text-[8.5px] font-mono text-zinc-950 rounded-bl border-b border-l border-zinc-800 uppercase tracking-widest font-bold">Recommended</div>
              <div>
                <span className="text-[10px] font-mono text-zinc-550">TIER 03</span>
                <h4 className="text-lg font-display font-semibold text-white uppercase mt-1">Elite</h4>
                <div className="text-2xl font-bold text-white my-3">35% <span className="text-xs text-zinc-500 font-normal">Recurring First 12 Months</span></div>
                <ul className="space-y-2 mt-4 text-xs text-zinc-400">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> Multi-attribution campaign channels</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> Priority 24-hr payout clearance</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> Private Discord access & Slack groups</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-300" /> Direct engineering consultation</li>
                </ul>
              </div>
              <div className="mt-8 pt-4 border-t border-zinc-850 text-[10px] text-zinc-450 font-mono">UNLOCK // 30 ACTIVE REFERRALS</div>
            </div>

            {/* Tier 4 */}
            <div className="p-6 bg-zinc-900/40 rounded-xl border border-zinc-850 hover:border-zinc-800 transition-colors flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-mono text-zinc-550">TIER 04</span>
                <h4 className="text-lg font-display font-semibold text-white uppercase mt-1">Ambassador</h4>
                <div className="text-2xl font-bold text-zinc-300 my-3">40% <span className="text-xs text-zinc-500 font-normal">Recurring First 12 Months</span></div>
                <ul className="space-y-2 mt-4 text-xs text-zinc-400">
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Direct access to founder syncs</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Customized sign-up landing codes</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Co-marketing press campaigns</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-zinc-400" /> Elite Advisory Board invite</li>
                </ul>
              </div>
              <div className="mt-8 pt-4 border-t border-zinc-850 text-[10px] text-zinc-550 font-mono">UNLOCK // 50 ACTIVE REFERRALS</div>
            </div>
          </div>
        </section>

        {/* SECTION: FOUNDER SPOTLIGHT */}
        <section id="founder" className="py-20 border-t border-zinc-900">
          <div className="p-8 bg-zinc-900/30 rounded-2xl border border-zinc-850 max-w-4xl mx-auto flex flex-col md:flex-row gap-8 items-center">
            <div className="w-36 h-36 rounded-full overflow-hidden border-2 border-zinc-700 shrink-0">
              <img
                src={splendorImg}
                alt="Portrait of Splendor Benjamin, Founder & CEO of Luminor Terminal"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="space-y-4">
              <div className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-450 uppercase tracking-widest">
                <Flame className="w-3 h-3 text-zinc-400" />
                <span>Founder Spotlight & Vision</span>
              </div>
              <p className="font-display font-medium text-white italic text-base leading-relaxed">
                &ldquo;Revluma helps ecommerce brands discover winning opportunities, track competitors, recover lost revenue, scale with less operational chaos, and grow faster with AI-powered intelligence. As a Revluma Growth Partner, you're helping businesses make smarter decisions and scale with confidence. Promote the future of ecommerce. Earn as you grow.&rdquo;
              </p>
              <div>
                <h5 className="text-sm font-semibold text-white">Splendor Benjamin</h5>
                <span className="text-xs text-zinc-500">Founder & CEO , Luminor Terminal</span>
              </div>
              {/* Fake Social Profiles */}
              <div className="flex gap-4 text-xs font-mono text-zinc-400 pt-2">
                <span className="cursor-pointer hover:text-white">Splendor Benjamin</span>
                <span className="text-zinc-700">|</span>
                <span className="cursor-pointer hover:text-white">x.com/@SplendorBen</span>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ SECTION */}
        <section id="faq" className="py-20 border-t border-zinc-900">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="text-xs text-zinc-500 font-mono tracking-widest block uppercase mb-3 text-center">INTELLIGENT KNOWLEDGE BASE</span>
            <h2 className="text-3xl sm:text-4xl font-display font-semibold text-white">
              Ecosystem Frequently Asked Questions
            </h2>
            <p className="text-xs text-zinc-400 mt-2">
              Everything you need to master your journey inside our enterprise partnership network.
            </p>
          </div>

          <div id="faq-accordions" className="max-w-3xl mx-auto space-y-4">
            {faqs.map((faq, index) => {
              const isOpen = openFaqIndex === index;
              return (
                <div
                  key={index}
                  className="bg-zinc-900/20 border border-zinc-850/80 rounded-xl overflow-hidden transition-all"
                >
                  <button
                    onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                    className="w-full text-left p-5 flex justify-between items-center bg-zinc-900/20 hover:bg-zinc-900/40 transition-colors"
                  >
                    <span className="text-sm font-medium text-white">{faq.q}</span>
                    <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${isOpen ? 'rotate-180 text-white' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="p-5 border-t border-zinc-850-900 text-xs text-zinc-400 leading-relaxed bg-zinc-950/40">
                      {faq.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* BOTTOM CTA */}
        <section id="co-founder-cta" className="py-20 border-t border-zinc-900 text-center">
          <div className="glass-card max-w-4xl mx-auto rounded-3xl p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 -mr-24 -mt-24 w-48 h-48 bg-zinc-850/5 rounded-full blur-3xl pointer-events-none"></div>
            <h3 className="text-2xl sm:text-4xl font-display font-semibold text-white mb-4">
              Secure Your Founding Ambassadorship
            </h3>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-xl mx-auto mb-8">
              We are offering early partner slots to premium eCommerce consultants, marketing agencies, and niche tech creators prior to general release. Get vetted now.
            </p>
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <button
                onClick={() => onNavigateToAuth('register')}
                className="w-full sm:w-auto px-8 py-4 rounded-xl text-xs font-semibold bg-white text-zinc-950 hover:bg-zinc-200 transition-all flex items-center justify-center gap-2 font-display uppercase tracking-widest hover:scale-[1.02]"
              >
                Apply for Vetting Access
                <ArrowRight className="w-4 h-4 text-zinc-950" />
              </button>
              <button
                onClick={() => onNavigateToAuth('login')}
                className="w-full sm:w-auto px-6 py-4 rounded-xl text-xs font-semibold bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 transition-all"
              >
                Partner Login Portal
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-zinc-900 bg-zinc-950 py-12 text-xs text-zinc-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <img src={revlumaLogo} alt="Revluma" className="w-12 h-12 object-contain rounded-md" />
              <div className="font-display font-bold text-white text-sm">REVLUMA</div>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Luminor Terminal is the parent technology company building intelligent AI infrastructure products for digital commerce and operational growth channels.
            </p>
          </div>

          <div>
            <span className="block font-mono text-[9px] text-zinc-500 tracking-wider mb-3 uppercase">Legal Frameworks</span>
            <ul className="space-y-2">
              <li><span className="hover:text-white cursor-pointer">Terms of Operation</span></li>
              <li><span className="hover:text-white cursor-pointer">Ecosystem Regulations</span></li>
              <li><span className="hover:text-white cursor-pointer">Affiliate Compliance</span></li>
              <li><span className="hover:text-white cursor-pointer">Cookie Parameters</span></li>
            </ul>
          </div>

          <div>
            <span className="block font-mono text-[9px] text-zinc-500 tracking-wider mb-3 uppercase">Ecosystem Resources</span>
            <ul className="space-y-2">
              <li><span className="hover:text-white cursor-pointer">Luminor Terminal Codebase</span></li>
              <li><span className="hover:text-white cursor-pointer">Revluma Cloud API</span></li>
              <li><span className="hover:text-white cursor-pointer">PostgreSQL schemas</span></li>
              <li><span className="hover:text-white cursor-pointer">Security Core audit logs</span></li>
            </ul>
          </div>

          <div>
            <span className="block font-mono text-[9px] text-zinc-500 tracking-wider mb-3 uppercase font-sans">Ecosystem Dispatch Newsletter</span>
            <p className="text-[11px] text-zinc-500 leading-relaxed mb-3">
              Subscribe to weekly API deployments, founder notes, and marketing directives.
            </p>
            <div className="flex">
              <input
                type="email"
                placeholder="Submit partner email"
                className="bg-zinc-900 text-xs text-white border border-zinc-800 rounded-l px-3 py-2 focus:outline-none focus:border-zinc-700 w-full"
              />
              <button className="bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-white border border-zinc-800 border-l-0 rounded-r font-mono">Join</button>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-zinc-900 mt-8 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] text-zinc-650">
          <div>
            © {new Date().getFullYear()} Luminor Terminal Ecosystem. All credentials verified. Built with premium TypeScript and React framework.
          </div>
          <div className="flex items-center space-x-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>SYSTEM SECURITY VERIFIED</span>
          </div>
        </div>
      </footer>
    </div>
  );
}