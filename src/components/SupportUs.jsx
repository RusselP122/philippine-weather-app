// src/components/SupportUs.jsx
import React, { useState } from "react";
import { Heart, Coffee, QrCode, Copy, Check, Server, Globe, Zap, ExternalLink, ShieldCheck, Sparkles, Download } from "lucide-react";

const SupportUs = () => {
  const [copiedBank, setCopiedBank] = useState(false);
  const [copiedAccount, setCopiedAccount] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);

  const accountInfo = {
    bank: "MariBank (InstaPay)",
    accountName: "RUSSEL",
    accountNumber: "****8067",
    fullNumber: "MariBank InstaPay ****8067"
  };

  const handleCopyBank = () => {
    navigator.clipboard.writeText(accountInfo.bank);
    setCopiedBank(true);
    setTimeout(() => setCopiedBank(false), 2000);
  };

  const handleCopyAccount = () => {
    navigator.clipboard.writeText(accountInfo.accountNumber);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8 font-sans relative overflow-hidden">
      {/* Background Subtle Gradient Spheres */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-4xl mx-auto relative z-10 space-y-10">

        {/* Hero Section */}
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-semibold uppercase tracking-wider shadow-inner">
            <Heart className="w-4 h-4 fill-rose-400 animate-pulse" />
            Support Our Mission
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            Help Us Keep <span className="bg-gradient-to-r from-sky-400 via-cyan-300 to-rose-400 bg-clip-text text-transparent">Philippine Weather Free & Improving</span>
          </h1>
          <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            Your generous contributions directly power our high-resolution AI weather models, real-time radar processing, server hosting, and help secure a dedicated new custom domain for faster community access across the Philippines.
          </p>
        </div>

        {/* Purpose / Impact Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md hover:border-sky-500/40 transition-all duration-300 shadow-xl group">
            <div className="h-10 w-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 mb-4 group-hover:scale-110 transition-transform">
              <Server className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Server & API Operations</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Powers 24/7 data processing for ECMWF IFS, AIFS, GDM WNC, satellite imagery, and live Doppler radars.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md hover:border-cyan-500/40 transition-all duration-300 shadow-xl group">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-4 group-hover:scale-110 transition-transform">
              <Globe className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">New Custom Domain</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Funding dedicated to acquiring a custom primary web domain to make site access easier for all Filipinos.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-md hover:border-rose-500/40 transition-all duration-300 shadow-xl group">
            <div className="h-10 w-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 group-hover:scale-110 transition-transform">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Continuous Enhancements</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Supports ongoing development of higher resolution ensemble tracks, storm alerts, and mobile UX refinements.
            </p>
          </div>
        </div>

        {/* Donation Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Option 1: Local Support (MariBank / InstaPay / QR PH) */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7 backdrop-blur-xl shadow-2xl flex flex-col justify-between space-y-6 relative group overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/10 rounded-bl-full pointer-events-none group-hover:bg-orange-500/20 transition-all" />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs font-bold uppercase tracking-wider">
                  <QrCode className="w-3.5 h-3.5" />
                  Local Support (Philippines)
                </div>
                <span className="text-[11px] text-slate-400 font-medium">InstaPay / QR PH</span>
              </div>

              <h2 className="text-xl font-bold text-white">MariBank / InstaPay QR</h2>
              <p className="text-xs text-slate-400">
                Scan the QR code below using GFX/GCash, Maya, MariBank, ShopeePay, or any bank app via InstaPay.
              </p>

              {/* QR Image Container */}
              <div className="flex flex-col items-center justify-center p-4 bg-slate-950/80 border border-slate-800 rounded-2xl relative group/qr shadow-inner">
                <img
                  src="/assets/support_qr.jpg"
                  alt="MariBank InstaPay QR Code - RUSSEL"
                  className="w-56 h-auto rounded-xl object-contain shadow-lg cursor-pointer hover:scale-105 transition-transform duration-300"
                  onClick={() => setShowQrModal(true)}
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = "/images/support_qr.jpg";
                  }}
                />
                <button
                  onClick={() => setShowQrModal(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Click to view full size
                </button>
              </div>

              {/* Account Details Box */}
              <div className="space-y-2 text-xs bg-slate-950/60 rounded-xl p-3.5 border border-slate-800/80">
                <div className="flex items-center justify-between py-1 border-b border-slate-800/50">
                  <span className="text-slate-400">Bank Name</span>
                  <div className="flex items-center gap-1.5 font-bold text-slate-200">
                    <span>{accountInfo.bank}</span>
                    <button
                      onClick={handleCopyBank}
                      className="p-1 text-slate-400 hover:text-white transition-colors"
                      title="Copy bank name"
                    >
                      {copiedBank ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-slate-800/50">
                  <span className="text-slate-400">Account Name</span>
                  <span className="font-bold text-slate-200">{accountInfo.accountName}</span>
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-slate-400">Account No.</span>
                  <div className="flex items-center gap-1.5 font-bold text-slate-200">
                    <span>{accountInfo.accountNumber}</span>
                    <button
                      onClick={handleCopyAccount}
                      className="p-1 text-slate-400 hover:text-white transition-colors"
                      title="Copy account number"
                    >
                      {copiedAccount ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <a
              href="/assets/support_qr.jpg"
              download="MariBank_QR_Russel.jpg"
              className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded-xl flex items-center justify-center gap-2 border border-slate-700 transition-all shadow-md"
            >
              <Download className="w-4 h-4 text-sky-400" />
              Save QR Code Image
            </a>
          </div>

          {/* Option 2: International Support (Ko-fi) */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 sm:p-7 backdrop-blur-xl shadow-2xl flex flex-col justify-between space-y-6 relative group overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-bl-full pointer-events-none group-hover:bg-cyan-500/20 transition-all" />

            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-bold uppercase tracking-wider">
                  <Coffee className="w-3.5 h-3.5" />
                  International Support
                </div>
                <span className="text-[11px] text-slate-400 font-medium">Global / Credit Card / PayPal</span>
              </div>

              <h2 className="text-xl font-bold text-white">Ko-fi (Buy Us a Coffee ☕)</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                If you are supporting from outside the Philippines, you can donate quickly and securely using Ko-fi with any major credit card, debit card, or PayPal.
              </p>

              {/* Ko-fi Interactive Card Feature */}
              <div className="p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-slate-800 rounded-2xl flex flex-col items-center text-center space-y-4 shadow-inner relative">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-lg">
                  <Coffee className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Support via Ko-fi</h4>
                  <p className="text-xs text-slate-400 mt-1">ko-fi.com/philippinetyphoonweather</p>
                </div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  No account required • Instant & Safe
                </div>
              </div>
            </div>

            <a
              href="https://ko-fi.com/philippinetyphoonweather"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 bg-gradient-to-r from-sky-500 via-cyan-500 to-teal-500 hover:from-sky-400 hover:via-cyan-400 hover:to-teal-400 text-slate-950 font-black text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/40 transition-all duration-300 uppercase tracking-wide"
            >
              <Coffee className="w-5 h-5 fill-slate-950" />
              Donate on Ko-fi
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

        </div>

        {/* Community Gratitude Note */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-2 shadow-xl">
          <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            Thank You For Supporting Us
          </h3>
          <p className="text-xs text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Every donation, no matter how small, directly helps keep our severe weather visual tracking operational and accessible to everyone. Maraming salamat sa inyong suporta!
          </p>
        </div>

      </div>

      {/* QR Modal Overlay */}
      {showQrModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-sm w-full space-y-4 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">MariBank InstaPay QR</h3>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-slate-400 hover:text-white text-xs font-semibold px-2 py-1 bg-slate-800 rounded-lg"
              >
                Close
              </button>
            </div>
            <img
              src="/assets/support_qr.jpg"
              alt="MariBank QR Code Full"
              className="w-full h-auto rounded-2xl border border-slate-800"
            />
            <p className="text-center text-xs text-slate-400">
              Scan with MariBank, GCash, Maya, ShopeePay, or any bank app via InstaPay.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupportUs;
