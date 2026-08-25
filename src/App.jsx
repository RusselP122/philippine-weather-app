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
    <div className="flex items-center justify-center min-h-[60vh] w-full">
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 border-3 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"></div>
        <p className="text-slate-400 text-xs font-medium tracking-wide">Loading module...</p>
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
