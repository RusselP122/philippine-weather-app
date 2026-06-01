// src/components/Navbar.jsx
import React, { useState, useEffect, useRef } from "react";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);

  // Dropdown States
  const [activeDropdown, setActiveDropdown] = useState(null); // 'weather', 'ai-forecast', 'cyclone', 'volcano'

  const navRef = useRef(null);

  const toggleDropdown = (name) => {
    setActiveDropdown(prev => prev === name ? null : name);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setActiveDropdown(null);
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Navigation Data Structure
  const navItems = [
    {
      label: "Home",
      href: "/",
      type: "link"
    },
    {
      label: "Weather",
      type: "dropdown",
      id: "weather",
      items: [
        { label: "Synoptic Reports", href: "/synoptic-reports" },
        { label: "Forecast Models", href: "/forecast-models" },
        { label: "Alert", href: "/alert" },
        { label: "Weather Advisory", href: "/weather-advisory" },
        { label: "Lightning Detection", href: "/lightning" },
        { label: "Live Doppler Radar", href: "/radar" },
        { label: "ENSO Monitor", href: "/enso" },
      ]
    },
    {
      label: "AI Forecast",
      type: "dropdown",
      id: "ai-forecast",
      items: [
        { label: "AI Forecast (Tracks)", href: "/forecast" },
        { label: "Tropical Weather Outlook", href: "/outlook" }
      ]
    },
    {
      label: "Tropical Cyclone",
      type: "dropdown",
      id: "cyclone",
      items: [
        { label: "Tropical Cyclone Track", href: "/cyclone" },
        { label: "Tropical Cyclone Prediction", href: "/tc-prediction" },
        { label: "Tropical Cyclone Info", href: "/tc-info" },
        { label: "Warning", href: "/warning" },
        { label: "Tropical Cyclone Strike Probability", href: "/strike-probability" }
      ]
    },
    {
      label: "Volcano",
      type: "dropdown",
      id: "volcano",
      items: [
        { label: "Volcanoes", href: "/volcanoes" }
      ]
    },
    {
      label: "Earthquake",
      href: "/earthquake",
      type: "link"
    },
    {
      label: "About Us",
      href: "/about",
      type: "button"
    }
  ];

  return (
    <nav
      ref={navRef}
      className="bg-gradient-to-r from-sky-100 via-sky-50 to-white text-slate-900 shadow-md z-[2000] backdrop-blur sticky top-0"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <img
            src="/images/logo.png"
            alt="Philippine Typhoon/Weather logo"
            className="h-8 w-8 rounded-lg object-contain border border-sky-400/40 bg-white"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-xl font-semibold tracking-tight text-slate-900 hidden sm:block">
              Philippine Typhoon/Weather
            </span>
            <span className="text-xl font-semibold tracking-tight text-slate-900 sm:hidden">
              PT/W
            </span>
            <span className="text-[10px] text-slate-500 hidden sm:block">AI Forecast & Cyclone Tracking</span>
          </div>
        </div>

        {/* Desktop Navigation */}
        <ul className="hidden lg:flex items-center gap-6 text-sm font-medium">
          {navItems.map((item, index) => {
            if (item.type === "link") {
              return (
                <li key={index}>
                  <a href={item.href} className="hover:text-sky-700 transition-colors">
                    {item.label}
                  </a>
                </li>
              );
            }
            if (item.type === "button") {
              return (
                <li key={index}>
                  <a
                    href={item.href}
                    className="px-4 py-1.5 rounded-full bg-sky-600 text-white border border-sky-500 hover:bg-sky-700 transition-colors text-xs uppercase tracking-wide shadow-sm"
                  >
                    {item.label}
                  </a>
                </li>
              );
            }
            // Dropdown
            return (
              <li key={index} className="relative">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1 hover:text-sky-700 transition-colors cursor-pointer ${activeDropdown === item.id ? 'text-sky-700' : ''}`}
                  onClick={() => toggleDropdown(item.id)}
                >
                  <span>{item.label}</span>
                  <span className="text-[10px] transform transition-transform duration-200" style={{ transform: activeDropdown === item.id ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                </button>

                {/* Dropdown Menu */}
                {activeDropdown === item.id && (
                  <div className="absolute left-0 mt-2 rounded-xl border border-slate-200 bg-white/95 backdrop-blur-md py-2 shadow-xl min-w-[200px] animate-in fade-in zoom-in-95 duration-200 z-[1001]">
                    {item.items.map((subItem, subIndex) => (
                      <a
                        key={subIndex}
                        href={subItem.href}
                        className="block px-4 py-2 text-sm text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition-colors"
                        onClick={() => setActiveDropdown(null)}
                      >
                        {subItem.label}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {/* Mobile Menu Toggle */}
        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center p-2 rounded-md border border-sky-300 hover:bg-sky-100/80 transition-colors cursor-pointer"
          onClick={() => setIsOpen(!isOpen)}
        >
          <div className="space-y-1.5">
            <span className={`block w-6 h-0.5 bg-slate-800 transition-transform ${isOpen ? "rotate-45 translate-y-2" : ""}`}></span>
            <span className={`block w-6 h-0.5 bg-slate-800 transition-opacity ${isOpen ? "opacity-0" : ""}`}></span>
            <span className={`block w-6 h-0.5 bg-slate-800 transition-transform ${isOpen ? "-rotate-45 -translate-y-2" : ""}`}></span>
          </div>
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="lg:hidden border-t border-sky-100 bg-white/95 backdrop-blur-md h-screen overflow-y-auto pb-20">
          <div className="px-4 py-4 space-y-1">
            {navItems.map((item, index) => {
              if (item.type === "link") {
                return (
                  <a key={index} href={item.href} className="block py-3 px-2 text-slate-800 font-medium hover:bg-sky-50 rounded-lg">
                    {item.label}
                  </a>
                );
              }
              if (item.type === "button") {
                return (
                  <a key={index} href={item.href} className="block mt-4 text-center py-2 px-4 bg-sky-600 text-white rounded-lg font-medium shadow-sm">
                    {item.label}
                  </a>
                );
              }
              // Dropdown
              return (
                <div key={index} className="border-b border-slate-100 last:border-0">
                  <button
                    className="w-full flex items-center justify-between py-3 px-2 text-slate-800 font-medium hover:bg-sky-50 rounded-lg cursor-pointer"
                    onClick={() => toggleDropdown(item.id)}
                  >
                    {item.label}
                    <span className={`transform transition-transform ${activeDropdown === item.id ? "rotate-180" : ""}`}>▾</span>
                  </button>

                  {activeDropdown === item.id && (
                    <div className="pl-6 pb-2 space-y-1 bg-sky-50/50 rounded-lg mb-2">
                      {item.items.map((subItem, subIndex) => (
                        <a
                          key={subIndex}
                          href={subItem.href}
                          className="block py-2 px-2 text-sm text-slate-600 hover:text-sky-700"
                          onClick={() => setIsOpen(false)}
                        >
                          {subItem.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
