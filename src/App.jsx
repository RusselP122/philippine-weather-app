// src/App.js
import React, { Suspense, lazy } from "react";
import { Analytics } from "@vercel/analytics/react";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";

// Lazy-load route components to optimize chunk sizes and initial load time
const Features = lazy(() => import("./components/Features"));
const About = lazy(() => import("./components/About"));
const Forecast = lazy(() => import("./components/Forecast"));
const TCPositions = lazy(() => import("./components/TCPositions"));
const Cyclone = lazy(() => import("./components/Cyclone"));
const TropicalOutlook = lazy(() => import("./components/TropicalOutlook"));
const TropicalCycloneInformation = lazy(() => import("./components/TropicalCycloneInformation"));
const Weather = lazy(() => import("./components/Weather"));
const Alert = lazy(() => import("./components/alert"));
const Warning = lazy(() => import("./components/Warning"));
const Earthquake = lazy(() => import("./components/Earthquake"));
const DailySynoptic = lazy(() => import("./components/DailySynoptic"));
const Volcanoes = lazy(() => import("./components/Volcanoes"));
const ForecastModels = lazy(() => import("./components/ForecastModels"));
const SpaghettiPlot = lazy(() => import("./components/SpaghettiPlot"));
const EnsoMonitor = lazy(() => import("./components/EnsoMonitor"));
const TropicalCyclonePrediction = lazy(() => import("./components/TropicalCyclonePrediction"));
const WeatherAdvisory = lazy(() => import("./components/WeatherAdvisory"));
const Lightning = lazy(() => import("./components/Lightning"));
const LiveRadar = lazy(() => import("./components/LiveRadar"));
const RiskArea = lazy(() => import("./components/RiskArea"));
const SupportUs = lazy(() => import("./components/SupportUs"));

function PageLoader() {
  return (
    <div className="relative flex items-center justify-center min-h-[70vh] w-full px-4 select-none">
      {/* Background Atmospheric Glow */}
      <div className="absolute w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none animate-pulse"></div>
      <div className="absolute w-48 h-48 bg-blue-600/10 rounded-full blur-2xl pointer-events-none"></div>

      {/* Glassmorphic Loader Container */}
      <div className="relative flex flex-col items-center max-w-sm w-full p-8 rounded-2xl bg-slate-900/80 border border-slate-800/80 backdrop-blur-xl shadow-2xl shadow-cyan-950/30 text-center animate-border-glow">
        
        {/* Radar / Cyclone Animation Core */}
        <div className="relative flex items-center justify-center w-20 h-20 mb-6">
          {/* Radar ping pulse wave */}
          <div className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping [animation-duration:2.5s]"></div>
          
          {/* Outer Dashed Radar Reticle */}
          <div className="absolute inset-0 rounded-full border border-dashed border-cyan-500/40 animate-spin [animation-duration:12s]"></div>
          
          {/* Inner Rotating Doppler Arc */}
          <div className="absolute inset-1.5 rounded-full border-2 border-transparent border-t-cyan-400 border-r-cyan-400/50 animate-spin [animation-duration:1.2s]"></div>

          {/* Central Cyclone/Weather Icon */}
          <div className="relative z-10 flex items-center justify-center w-10 h-10 rounded-full bg-slate-950 border border-cyan-500/30 shadow-inner shadow-cyan-500/20 text-cyan-400">
            <svg
              className="w-5 h-5 animate-pulse"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a10 10 0 0 0-9.5 7A10 10 0 0 1 12 12a10 10 0 0 1 9.5-3A10 10 0 0 0 12 2z" />
              <path d="M12 22a10 10 0 0 0 9.5-7A10 10 0 0 1 12 12a10 10 0 0 1-9.5 3A10 10 0 0 0 12 22z" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
          </div>
        </div>

        {/* Live Badge */}
        <div className="inline-flex items-center gap-2 px-2.5 py-1 mb-3 rounded-full bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono font-medium tracking-wider uppercase">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
          </span>
          Philippine WX System
        </div>

        {/* Title & Subtitle */}
        <h3 className="text-base font-semibold text-slate-100 tracking-tight mb-1">
          Loading Module
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed mb-5">
          Initializing meteorological data & forecast models...
        </p>

        {/* Shimmering Progress Bar */}
        <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80 relative">
          <div className="h-full w-2/5 bg-gradient-to-r from-transparent via-cyan-400 to-sky-400 rounded-full animate-loader-shimmer"></div>
        </div>
      </div>
    </div>
  );
}

function AppContent() {
  const path = window.location.pathname;

  if (path === "/lightning") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Lightning />
        </main>
      </div>
    );
  }

  if (path === "/radar") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <LiveRadar />
        </main>
      </div>
    );
  }

  if (path === "/about") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <About />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/weather-advisory") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <WeatherAdvisory />
        </main>
      </div>
    );
  }

  if (path === "/tc-info") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TropicalCycloneInformation />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/outlook") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TropicalOutlook />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/cyclone") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow flex flex-col">
          <Cyclone />
        </main>
      </div>
    );
  }

  if (path === "/forecast") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Forecast />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/tc-positions") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TCPositions />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/weather") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Weather />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/alert") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Alert />
        </main>
      </div>
    );
  }

  if (path === "/warning") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Warning />
        </main>
      </div>
    );
  }

  if (path === "/tc-prediction") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <TropicalCyclonePrediction />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/earthquake") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Earthquake />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/synoptic-reports") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <DailySynoptic />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/volcanoes") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <Volcanoes />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/forecast-models") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <ForecastModels />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/spaghetti") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <SpaghettiPlot />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/enso") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <EnsoMonitor />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/risk-area") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <RiskArea />
        </main>
        <Footer />
      </div>
    );
  }

  if (path === "/support" || path === "/donate") {
    return (
      <div className="min-h-screen flex flex-col bg-slate-950">
        <Navbar />
        <main className="flex-grow">
          <SupportUs />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-950">
      <Navbar />
      <main className="flex-grow">
        <Features />
      </main>
      <Footer />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AppContent />
      <Analytics />
    </Suspense>
  );
}

export default App;
