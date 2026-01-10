// src/components/Footer.jsx
import React from "react";

const Footer = () => {
  return (
    <footer className="bg-slate-950 text-slate-100 border-t border-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-center md:text-left">
          <h3 className="text-lg font-semibold tracking-tight mb-1">
            Philippine Typhoon/Weather
          </h3>
          <p className="text-sm text-slate-400 max-w-md">
            Provide visual AI forecasts and tropical cyclone track so communities can
            stay ahead of severe weather across the Philippines.
          </p>
        </div>
        <div className="flex flex-col items-center md:items-end gap-2 text-sm">
          <div className="flex items-center gap-3">
            <a
              href="/about"
              className="inline-flex items-center gap-1 text-slate-200 hover:text-sky-300 transition-colors"
            >
              About Us
              <span className="text-xs">→</span>
            </a>
            <a
              href="https://www.facebook.com/profile.php?id=100092463782813"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-200 hover:bg-sky-600 hover:text-white transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
              >
                <path d="M22 12.07C22 6.51 17.52 2 12 2S2 6.51 2 12.07C2 17.1 5.66 21.21 10.44 22v-6.99H7.9v-2.94h2.54V9.83c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.94h-2.34V22C18.34 21.21 22 17.1 22 12.07Z" />
              </svg>
            </a>
          </div>
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Philippine Typhoon/Weather. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
