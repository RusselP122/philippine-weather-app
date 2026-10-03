// src/components/Footer.jsx
import React from "react";

const Footer = () => {
  return (
    <footer className="bg-slate-950 text-slate-100 border-t border-slate-800/80 relative">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row items-center lg:items-start justify-between gap-6">
          {/* Brand & Subtitle */}
          <div className="text-center lg:text-left space-y-2 max-w-md">
            <div className="flex items-center justify-center lg:justify-start gap-2.5">
              <img
                src="/images/logo.png"
                alt="Philippine Typhoon/Weather logo"
                className="h-8 w-8 rounded-lg object-contain border border-sky-400/40 bg-white"
              />
              <span className="text-base font-bold text-white tracking-tight">
                Philippine Typhoon/Weather
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              Providing visual AI forecasts and tropical cyclone tracking to help communities stay prepared across the Philippines.
            </p>
          </div>

          {/* Links & Actions */}
          <div className="flex flex-col items-center lg:items-end gap-4">
            {/* Primary & Legal Links */}
            <div className="flex flex-wrap items-center justify-center lg:justify-end gap-x-5 gap-y-2 text-xs sm:text-sm font-medium">
              <a
                href="/about"
                className="text-slate-300 hover:text-sky-300 transition-colors"
              >
                About Us
              </a>
              <a
                href="/disclaimer"
                className="text-slate-300 hover:text-amber-400 transition-colors"
              >
                Safety & Disclaimer
              </a>
              <a
                href="/privacy"
                className="text-slate-300 hover:text-cyan-400 transition-colors"
              >
                Privacy Policy
              </a>
              <a
                href="/terms"
                className="text-slate-300 hover:text-indigo-400 transition-colors"
              >
                Terms of Service
              </a>
              <a
                href="/support"
                className="inline-flex items-center gap-1 text-rose-400 font-semibold hover:text-rose-300 transition-colors text-xs bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/30"
              >
                Support Us ❤️
              </a>
            </div>

            {/* Social & Copyright */}
            <div className="flex items-center gap-3 pt-1">
              <p className="text-xs text-slate-500">
                © {new Date().getFullYear()} Philippine Typhoon/Weather. All rights reserved.
              </p>
              <div className="flex items-center gap-2">
                <a
                  href="https://www.facebook.com/profile.php?id=100092463782813"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Facebook Page"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:bg-sky-600 hover:text-white transition-all"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M22 12.07C22 6.51 17.52 2 12 2S2 6.51 2 12.07C2 17.1 5.66 21.21 10.44 22v-6.99H7.9v-2.94h2.54V9.83c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.94h-2.34V22C18.34 21.21 22 17.1 22 12.07Z" />
                  </svg>
                </a>
                <a
                  href="https://www.tiktok.com/@typhoonweather"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="TikTok Profile"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:bg-[#fe2c55] hover:text-white transition-all"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.88 2.89 2.89 0 0 1-2.88-2.88 2.89 2.89 0 0 1 2.88-2.88c.41 0 .8.08 1.15.24V9.45a6.37 6.37 0 0 0-1.15-.1 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.75a8.16 8.16 0 0 0 4.76 1.52V6.82a4.85 4.85 0 0 1-1-.13z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

