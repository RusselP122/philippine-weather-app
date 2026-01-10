// src/components/Navbar.jsx
import React, { useState, useEffect, useRef } from "react";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isForecastOpen, setIsForecastOpen] = useState(false);
  const [isMobileForecastOpen, setIsMobileForecastOpen] = useState(false);
  const [isCycloneOpen, setIsCycloneOpen] = useState(false);
  const [isMobileCycloneOpen, setIsMobileCycloneOpen] = useState(false);
  const navRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setIsForecastOpen(false);
        setIsMobileForecastOpen(false);
        setIsCycloneOpen(false);
        setIsMobileCycloneOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      className="bg-gradient-to-r from-sky-100 via-sky-50 to-white text-slate-900 shadow-md z-[1000] backdrop-blur"
    >
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <img
            src="/images/logo.png"
            alt="Philippine Typhoon/Weather logo"
            className="h-8 w-8 rounded-lg object-contain border border-sky-400/40 bg-white"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-xl font-semibold tracking-tight text-slate-900">
              Philippine Typhoon/Weather
            </span>
            <span className="text-xs text-slate-500">AI Forecast & Cyclone Tracking</span>
          </div>
        </div>
        {/* Navigation Links */}
        <ul className="hidden md:flex items-center gap-6 text-sm font-medium">
          <li>
            <a href="/" className="hover:text-sky-700 transition-colors">
              Home
            </a>
          </li>
          <li>
            <a href="/weather" className="hover:text-sky-700 transition-colors">
              Weather
            </a>
          </li>
          {/* AI Forecast dropdown */}
          <li className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-sky-700 transition-colors"
              onClick={() => setIsForecastOpen((prev) => !prev)}
            >
              <span>AI Forecast</span>
              <span className="text-[10px]">▾</span>
            </button>
            {isForecastOpen && (
              <div className="absolute right-0 mt-2 min-w-[180px] rounded-md border border-slate-200 bg-white py-1 text-xs text-slate-800 shadow-lg">
                <a
                  href="/forecast"
                  className="block px-3 py-1.5 hover:bg-sky-50 hover:text-sky-700"
                >
                  AI Forecast (Tracks)
                </a>
                <a
                  href="/outlook"
                  className="block px-3 py-1.5 hover:bg-sky-50 hover:text-sky-700"
                >
                  Tropical Weather Outlook
                </a>
              </div>
            )}
          </li>
          {/* Tropical Cyclone dropdown */}
          <li className="relative">
            <button
              type="button"
              className="inline-flex items-center gap-1 hover:text-sky-700 transition-colors"
              onClick={() => setIsCycloneOpen((prev) => !prev)}
            >
              <span>Tropical Cyclone</span>
              <span className="text-[10px]">▾</span>
            </button>
            {isCycloneOpen && (
              <div className="absolute right-0 mt-2 min-w-[210px] rounded-md border border-slate-200 bg-white py-1 text-xs text-slate-800 shadow-lg">
                <a
                  href="/cyclone"
                  className="block px-3 py-1.5 hover:bg-sky-50 hover:text-sky-700"
                >
                  Tropical Cyclone Track (Map)
                </a>
                <a
                  href="/tc-info"
                  className="block px-3 py-1.5 hover:bg-sky-50 hover:text-sky-700"
                >
                  Tropical Cyclone Information
                </a>
              </div>
            )}
          </li>
          <li>
            <a
              href="/about"
              className="px-3 py-1.5 rounded-full bg-sky-600 text-white border border-sky-500 hover:bg-sky-700 transition-colors text-xs uppercase tracking-wide shadow-sm"
            >
              About Us
            </a>
          </li>
        </ul>
        {/* Mobile menu toggle */}
        <button
          type="button"
          className="md:hidden inline-flex items-center justify-center p-2 rounded-md border border-sky-300 hover:bg-sky-100/80 transition-colors"
          aria-label="Toggle navigation menu"
          onClick={() => setIsOpen((prev) => !prev)}
        >
          <span
            className={`block w-5 h-0.5 bg-slate-900 transition-transform duration-200 ${
              isOpen ? "translate-y-1.5 rotate-45" : "mb-1"
            }`}
          />
          <span
            className={`block w-5 h-0.5 bg-slate-900 transition-opacity duration-200 ${
              isOpen ? "opacity-0" : "mb-1"
            }`}
          />
          <span
            className={`block w-5 h-0.5 bg-slate-900 transition-transform duration-200 ${
              isOpen ? "-translate-y-1.5 -rotate-45" : ""
            }`}
          />
        </button>
      </div>
      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden border-t border-sky-100 bg-white/80 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-4 py-3 space-y-2 text-sm font-medium text-slate-800">
            <a href="/" className="block py-1 hover:text-sky-700">
              Home
            </a>
            <a href="/weather" className="block py-1 hover:text-sky-700">
              Weather
            </a>
            {/* Mobile AI Forecast dropdown */}
            <button
              type="button"
              className="flex w-full items-center justify-between py-1 hover:text-sky-700"
              onClick={() => setIsMobileForecastOpen((prev) => !prev)}
            >
              <span>AI Forecast</span>
              <span className="text-[10px]">{isMobileForecastOpen ? "▴" : "▾"}</span>
            </button>
            {isMobileForecastOpen && (
              <div className="ml-3 space-y-1 text-xs">
                <a
                  href="/forecast"
                  className="block py-0.5 hover:text-sky-700"
                >
                  AI Forecast (Tracks)
                </a>
                <a
                  href="/outlook"
                  className="block py-0.5 hover:text-sky-700"
                >
                  Tropical Weather Outlook
                </a>
              </div>
            )}
            {/* Mobile Tropical Cyclone dropdown */}
            <button
              type="button"
              className="flex w-full items-center justify-between py-1 hover:text-sky-700"
              onClick={() => setIsMobileCycloneOpen((prev) => !prev)}
            >
              <span>Tropical Cyclone</span>
              <span className="text-[10px]">
                {isMobileCycloneOpen ? "▴" : "▾"}
              </span>
            </button>
            {isMobileCycloneOpen && (
              <div className="ml-3 space-y-1 text-xs">
                <a
                  href="/cyclone"
                  className="block py-0.5 hover:text-sky-700"
                >
                  Tropical Cyclone Track (Map)
                </a>
                <a
                  href="/tc-info"
                  className="block py-0.5 hover:text-sky-700"
                >
                  Tropical Cyclone Information
                </a>
              </div>
            )}
            <a
              href="/about"
              className="mt-2 inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-sky-600 text-white text-xs uppercase tracking-wide shadow-sm hover:bg-sky-700"
            >
              About Us
            </a>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
